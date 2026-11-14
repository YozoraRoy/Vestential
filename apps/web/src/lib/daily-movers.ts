/**
 * Issue #78：台股收盤異動日報引擎。
 *
 * 資料源（全免費免 Key）：
 * - TWSE openapi `v1/exchangeReport/STOCK_DAY_ALL`（收盤、漲跌、開高低、成交量／額）
 * - TWSE openapi `v1/announcement/punish`（處置股公告）
 * - TWSE openapi `v1/announcement/notice`（注意股公告）
 * - TWSE rwd `TWT38U` + `TWT44U`（外資合計＋投信，沿用 `chip-radar.ts` 解析器）
 */

import {
  getAgentSetting,
  getDailyMoverByDate,
  getDailyMoversHistory,
  getLatestDailyMover,
  listDailyMoverDates,
  setAgentSetting,
  taipeiTodayStr,
  upsertDailyMover,
  type DailyMoverRow,
} from '@stock/database'
import { cleanChipCode, parseTwseNum, parseTwt38u, parseTwt44u } from './chip-radar'

const STOCK_DAY_ALL_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
const PUNISH_URL = 'https://openapi.twse.com.tw/v1/announcement/punish'
const NOTICE_URL = 'https://openapi.twse.com.tw/v1/announcement/notice'
const TWT38U_URL = 'https://www.twse.com.tw/rwd/zh/fund/TWT38U'
const TWT44U_URL = 'https://www.twse.com.tw/rwd/zh/fund/TWT44U'

const FETCH_TIMEOUT_MS = 15_000

export interface StockDayAllEntry {
  date: string
  code: string
  name: string
  close: number
  change: number
  open: number
  high: number
  low: number
  volume: number
  tradeValue: number
}

export interface MoverQuoteItem {
  code: string
  name: string
  close: number
  change: number
  changePct: number
  volume: number
  tradeValue: number
  volumeRatio: number | null
  limitStatus: 'limit_up' | 'limit_down' | 'none'
  exDividendNote?: boolean
}

export interface AnnouncementItem {
  type: 'punish' | 'notice'
  code: string
  name: string
  date: string
  announcementNo: string
  reason: string
  dedupKey: string
  isNew: boolean
}

export interface InstMoverItem {
  code: string
  name: string
  netShares: number
  close: number | null
  tradeValue: number | null
}

export interface MarketBreadth {
  total: number
  up: number
  down: number
  flat: number
  limitUp: number
  limitDown: number
}

export interface DailyMoversPayload {
  tradeDate: string
  summaryText: string
  breadth: MarketBreadth
  limitUp: MoverQuoteItem[]
  limitDown: MoverQuoteItem[]
  volumeSurge: MoverQuoteItem[]
  punish: AnnouncementItem[]
  notice: AnnouncementItem[]
  instBuy: InstMoverItem[]
  instSell: InstMoverItem[]
  degraded: boolean
  degradedReason: string | null
  updatedAt: string | null
}

/** 依台股升降單位規則回傳該價位對應的 tick size。 */
export function twTickSize(price: number): number {
  if (price < 10) return 0.01
  if (price < 50) return 0.05
  if (price < 100) return 0.1
  if (price < 500) return 0.5
  if (price < 1000) return 1
  return 5
}

/** 依昨收（或平盤參考價）計算台股 ±10% 理論漲停／跌停價。 */
export function calcTwLimitPrice(prevClose: number, direction: 'up' | 'down'): number {
  if (!Number.isFinite(prevClose) || prevClose <= 0) return 0
  if (direction === 'up') {
    const raw = prevClose * 1.1
    const tick = twTickSize(raw)
    return Math.round(Math.floor(raw / tick + 1e-9) * tick * 100) / 100
  }
  const raw = prevClose * 0.9
  const tick = twTickSize(raw)
  return Math.round(Math.ceil(raw / tick - 1e-9) * tick * 100) / 100
}

/**
 * 判定當日是否漲停或跌停：
 * - 以 prevClose = close - change 計算漲跌幅與理論漲跌停價
 * - 除權息當日參考價非昨收時，`change` 可能與除權息後百分比略有差異，附上 `exDividendNote` 註記。
 */
export function classifyLimitStatus(
  close: number,
  change: number,
  high?: number,
  low?: number,
): { status: 'limit_up' | 'limit_down' | 'none'; changePct: number; exDividendNote: boolean } {
  if (!Number.isFinite(close) || close <= 0) {
    return { status: 'none', changePct: 0, exDividendNote: false }
  }
  const prevClose = close - change
  if (!Number.isFinite(prevClose) || prevClose <= 0) {
    return { status: 'none', changePct: 0, exDividendNote: false }
  }

  const changePct = Math.round((change / prevClose) * 10_000) / 100
  const upPrice = calcTwLimitPrice(prevClose, 'up')
  const downPrice = calcTwLimitPrice(prevClose, 'down')

  const atHigh = !high || high <= 0 || Math.abs(close - high) < 1e-6
  const atLow = !low || low <= 0 || Math.abs(close - low) < 1e-6

  if (Math.abs(close - upPrice) < 1e-6 && atHigh) {
    const exact10 = Math.abs(changePct - 10) <= 0.35
    return { status: 'limit_up', changePct, exDividendNote: !exact10 }
  }
  if (Math.abs(close - downPrice) < 1e-6 && atLow) {
    const exact10 = Math.abs(changePct + 10) <= 0.35
    return { status: 'limit_down', changePct, exDividendNote: !exact10 }
  }

  // 邊界容錯：若遇除權息參考價微幅差異（>= 9.85% 且收在當日最高 / <= -9.85% 且收在當日最低）
  if (changePct >= 9.85 && atHigh) {
    return { status: 'limit_up', changePct, exDividendNote: true }
  }
  if (changePct <= -9.85 && atLow) {
    return { status: 'limit_down', changePct, exDividendNote: true }
  }

  return { status: 'none', changePct, exDividendNote: false }
}

/** 計算量比＝今日量 / 近 N 日平均量（無歷史日資料或均量為 0 回 null）。 */
export function computeVolumeRatio(todayVolume: number, priorVolumes: number[]): number | null {
  if (!Number.isFinite(todayVolume) || todayVolume <= 0) return null
  const valid = priorVolumes.filter((v) => Number.isFinite(v) && v > 0)
  if (valid.length === 0) return null
  const avg = valid.reduce((sum, v) => sum + v, 0) / valid.length
  if (avg <= 0) return null
  return Math.round((todayVolume / avg) * 100) / 100
}

/** 處置／注意股去重：同一批與歷史已通知鍵值比對，標記 isNew。 */
export function dedupAnnouncements(
  items: Omit<AnnouncementItem, 'dedupKey' | 'isNew'>[],
  previousKeys: Set<string>,
): AnnouncementItem[] {
  const seen = new Set<string>()
  const out: AnnouncementItem[] = []
  for (const item of items) {
    const code = cleanChipCode(item.code)
    if (!code) continue
    const dedupKey = `${item.type}:${code}:${item.date}:${item.announcementNo}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)
    out.push({
      ...item,
      code,
      dedupKey,
      isNew: !previousKeys.has(dedupKey),
    })
  }
  return out
}

/** 將 TWSE 民國年日期（如 1151114 或 115/11/14）或西元 YYYYMMDD 正規化為 YYYY-MM-DD。 */
export function normalizeTwseDate(raw: unknown): string {
  const s = String(raw ?? '').trim().replace(/[/-]/g, '')
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  if (/^\d{7}$/.test(s)) {
    const year = Number(s.slice(0, 3)) + 1911
    return `${year}-${s.slice(3, 5)}-${s.slice(5, 7)}`
  }
  return taipeiTodayStr()
}

export function buildDailyMoversSummaryText(params: {
  tradeDate: string
  breadth: MarketBreadth
  volumeSurge: MoverQuoteItem[]
  punish: AnnouncementItem[]
}): string {
  const { tradeDate, breadth, volumeSurge, punish } = params
  const tone =
    breadth.up > breadth.down * 1.2
      ? '盤面偏多走揚'
      : breadth.down > breadth.up * 1.2
        ? '盤面偏空承壓'
        : '盤面多空拉鋸'
  const topVol = volumeSurge[0]
    ? `爆量居首為 ${volumeSurge[0].code} ${volumeSurge[0].name}（量比 ${volumeSurge[0].volumeRatio ?? '—'}x）`
    : '暫無顯著爆量股'
  const newPunishCount = punish.filter((p) => p.isNew).length
  const punishNote =
    punish.length > 0
      ? `處置公告 ${punish.length} 檔（今日新增 ${newPunishCount} 檔）`
      : '今日無處置股名單'
  return `${tradeDate} ${tone}：上漲 ${breadth.up} 家、下跌 ${breadth.down} 家（漲停 ${breadth.limitUp} 家／跌停 ${breadth.limitDown} 家）；${topVol}；${punishNote}。`
}

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

export function parseStockDayAllRows(payload: unknown): StockDayAllEntry[] {
  if (!Array.isArray(payload)) return []
  const out: StockDayAllEntry[] = []
  for (const r of payload as Record<string, unknown>[]) {
    const code = cleanChipCode(r.Code)
    if (!code || !/^\d{4}$/.test(code)) continue
    const close = parseTwseNum(r.ClosingPrice)
    if (close <= 0) continue
    out.push({
      date: normalizeTwseDate(r.Date),
      code,
      name: String(r.Name ?? '').trim(),
      close,
      change: parseTwseNum(r.Change),
      open: parseTwseNum(r.OpeningPrice),
      high: parseTwseNum(r.HighestPrice),
      low: parseTwseNum(r.LowestPrice),
      volume: parseTwseNum(r.TradeVolume),
      tradeValue: parseTwseNum(r.TradeValue),
    })
  }
  return out
}

export function parsePunishPayload(payload: unknown): Omit<AnnouncementItem, 'dedupKey' | 'isNew'>[] {
  if (!Array.isArray(payload)) return []
  return (payload as Record<string, unknown>[]).map((r) => ({
    type: 'punish',
    code: cleanChipCode(r.Code),
    name: String(r.Name ?? '').trim(),
    date: normalizeTwseDate(r.Date),
    announcementNo: String(r.NumberOfAnnouncement ?? r.Number ?? '').trim(),
    reason: String(r.ReasonsOfDisposition ?? '').trim(),
  }))
}

export function parseNoticePayload(payload: unknown): Omit<AnnouncementItem, 'dedupKey' | 'isNew'>[] {
  if (!Array.isArray(payload)) return []
  return (payload as Record<string, unknown>[]).map((r) => ({
    type: 'notice',
    code: cleanChipCode(r.Code),
    name: String(r.Name ?? '').trim(),
    date: normalizeTwseDate(r.Date),
    announcementNo: String(r.NumberOfAnnouncement ?? r.Number ?? '').trim(),
    reason: String(r.TradingInfoForAttention ?? '').trim(),
  }))
}

const LAST_PUNISH_KEYS_SETTING = 'daily_movers.last_punish_keys'

export async function refreshAndSaveDailyMovers(): Promise<DailyMoverRow> {
  const [dayAllRaw, punishRaw, noticeRaw] = await Promise.all([
    fetchJsonWithTimeout(STOCK_DAY_ALL_URL),
    fetchJsonWithTimeout(PUNISH_URL).catch(() => []),
    fetchJsonWithTimeout(NOTICE_URL).catch(() => []),
  ])

  const entries = parseStockDayAllRows(dayAllRaw)
  if (entries.length === 0) {
    throw new Error('TWSE STOCK_DAY_ALL 回傳空資料')
  }

  const tradeDate = entries[0].date
  const ymd = tradeDate.replace(/-/g, '')

  // 抓取外資＋投信買賣超（盤後尚未公布時容錯降級為空）
  const [twt38uRaw, twt44uRaw] = await Promise.all([
    fetchJsonWithTimeout(`${TWT38U_URL}?date=${ymd}&response=json`).catch(() => null),
    fetchJsonWithTimeout(`${TWT44U_URL}?date=${ymd}&response=json`).catch(() => null),
  ])
  const foreignMap = parseTwt38u(twt38uRaw)
  const trustMap = parseTwt44u(twt44uRaw)

  // 讀取過去 4 筆歷史日報成交量作為 5 日均量基底
  const prevHistoryRows = await getDailyMoversHistory(6)
  const priorVolumeMaps: Record<string, number>[] = []
  for (const hr of prevHistoryRows) {
    if (hr.trade_date >= tradeDate) continue
    if (hr.volume_history_json) {
      try {
        priorVolumeMaps.push(JSON.parse(hr.volume_history_json) as Record<string, number>)
      } catch {}
    }
    if (priorVolumeMaps.length >= 4) break
  }

  const breadth: MarketBreadth = {
    total: entries.length,
    up: 0,
    down: 0,
    flat: 0,
    limitUp: 0,
    limitDown: 0,
  }

  const quoteItems: MoverQuoteItem[] = []
  const todayVolumes: Record<string, number> = {}
  const entryMap = new Map<string, StockDayAllEntry>()

  for (const e of entries) {
    entryMap.set(e.code, e)
    todayVolumes[e.code] = e.volume

    if (e.change > 0) breadth.up++
    else if (e.change < 0) breadth.down++
    else breadth.flat++

    const lim = classifyLimitStatus(e.close, e.change, e.high, e.low)
    if (lim.status === 'limit_up') breadth.limitUp++
    if (lim.status === 'limit_down') breadth.limitDown++

    const priorVols = priorVolumeMaps
      .map((m) => m[e.code])
      .filter((v): v is number => typeof v === 'number' && v > 0)
    const volumeRatio = computeVolumeRatio(e.volume, priorVols)

    quoteItems.push({
      code: e.code,
      name: e.name,
      close: e.close,
      change: e.change,
      changePct: lim.changePct,
      volume: e.volume,
      tradeValue: e.tradeValue,
      volumeRatio,
      limitStatus: lim.status,
      exDividendNote: lim.exDividendNote || undefined,
    })
  }

  const limitUp = quoteItems
    .filter((q) => q.limitStatus === 'limit_up')
    .sort((a, b) => b.tradeValue - a.tradeValue)
    .slice(0, 10)

  const limitDown = quoteItems
    .filter((q) => q.limitStatus === 'limit_down')
    .sort((a, b) => b.tradeValue - a.tradeValue)
    .slice(0, 10)

  // 若尚無前 4 日快照（volumeRatio 全為 null），依成交額排序作為爆量焦點候選
  const hasVolumeRatio = quoteItems.some((q) => q.volumeRatio !== null && q.volumeRatio > 0)
  const volumeSurge = quoteItems
    .filter((q) => q.volume > 0)
    .sort((a, b) => {
      if (hasVolumeRatio) {
        return (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0) || b.tradeValue - a.tradeValue
      }
      return b.tradeValue - a.tradeValue
    })
    .slice(0, 10)

  // 處置／注意去重
  const prevKeysRaw = await getAgentSetting(LAST_PUNISH_KEYS_SETTING).catch(() => null)
  let prevKeys = new Set<string>()
  if (prevKeysRaw) {
    try {
      const parsed = JSON.parse(prevKeysRaw)
      if (Array.isArray(parsed)) prevKeys = new Set(parsed.map(String))
    } catch {}
  }

  const punish = dedupAnnouncements(parsePunishPayload(punishRaw), prevKeys)
  const notice = dedupAnnouncements(parseNoticePayload(noticeRaw), prevKeys)
  const nextKeys = [...punish.map((p) => p.dedupKey), ...notice.map((n) => n.dedupKey)]
  if (nextKeys.length > 0) {
    await setAgentSetting({
      key: LAST_PUNISH_KEYS_SETTING,
      value: JSON.stringify(nextKeys.slice(0, 500)),
      category: 'daily-movers',
      label: '處置/注意股已通知去重鍵',
    }).catch(() => {})
  }

  // 法人大買賣超 Top 10（外資＋投信）
  const instCodes = new Set([...foreignMap.keys(), ...trustMap.keys()])
  const instItems: InstMoverItem[] = []
  for (const code of instCodes) {
    if (!/^\d{4}$/.test(code)) continue
    const f = foreignMap.get(code)
    const t = trustMap.get(code) ?? 0
    const netShares = (f?.foreignNet ?? 0) + t
    if (netShares === 0) continue
    const quote = entryMap.get(code)
    instItems.push({
      code,
      name: quote?.name || f?.name || code,
      netShares,
      close: quote?.close ?? null,
      tradeValue: quote?.tradeValue ?? null,
    })
  }
  const instBuy = instItems
    .filter((x) => x.netShares > 0)
    .sort((a, b) => b.netShares - a.netShares)
    .slice(0, 10)
  const instSell = instItems
    .filter((x) => x.netShares < 0)
    .sort((a, b) => a.netShares - b.netShares)
    .slice(0, 10)

  const degraded = foreignMap.size === 0
  const degradedReason = degraded ? 'institutional-pending' : null
  const summaryText = buildDailyMoversSummaryText({ tradeDate, breadth, volumeSurge, punish })

  await upsertDailyMover({
    tradeDate,
    summaryText,
    breadthJson: JSON.stringify(breadth),
    limitUpJson: JSON.stringify(limitUp),
    limitDownJson: JSON.stringify(limitDown),
    volumeSurgeJson: JSON.stringify(volumeSurge),
    punishJson: JSON.stringify(punish),
    noticeJson: JSON.stringify(notice),
    instBuyJson: JSON.stringify(instBuy),
    instSellJson: JSON.stringify(instSell),
    volumeHistoryJson: JSON.stringify(todayVolumes),
    degraded,
    degradedReason,
  })

  return (await getDailyMoverByDate(tradeDate))!
}

export function rowToPayload(row: DailyMoverRow): DailyMoversPayload {
  const safeParse = <T>(raw: string | null, fallback: T): T => {
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  return {
    tradeDate: row.trade_date,
    summaryText: row.summary_text ?? '',
    breadth: safeParse<MarketBreadth>(row.breadth_json, {
      total: 0,
      up: 0,
      down: 0,
      flat: 0,
      limitUp: 0,
      limitDown: 0,
    }),
    limitUp: safeParse<MoverQuoteItem[]>(row.limit_up_json, []),
    limitDown: safeParse<MoverQuoteItem[]>(row.limit_down_json, []),
    volumeSurge: safeParse<MoverQuoteItem[]>(row.volume_surge_json, []),
    punish: safeParse<AnnouncementItem[]>(row.punish_json, []),
    notice: safeParse<AnnouncementItem[]>(row.notice_json, []),
    instBuy: safeParse<InstMoverItem[]>(row.inst_buy_json, []),
    instSell: safeParse<InstMoverItem[]>(row.inst_sell_json, []),
    degraded: row.degraded === 1,
    degradedReason: row.degraded_reason,
    updatedAt: row.updated_at ?? null,
  }
}

export async function getDailyMoversSnapshot(dateParam?: string): Promise<{
  payload: DailyMoversPayload | null
  availableDates: string[]
}> {
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const byDate = await getDailyMoverByDate(dateParam)
    const dates = await listDailyMoverDates(30)
    return { payload: byDate ? rowToPayload(byDate) : null, availableDates: dates }
  }

  let latest = await getLatestDailyMover()
  const today = taipeiTodayStr()
  if (!latest || latest.trade_date < today) {
    try {
      latest = await refreshAndSaveDailyMovers()
    } catch {
      // 無法即時抓到新資料時，降級顯示資料庫中最新一筆
    }
  }
  const dates = await listDailyMoverDates(30)
  return {
    payload: latest ? rowToPayload(latest) : null,
    availableDates: dates,
  }
}
