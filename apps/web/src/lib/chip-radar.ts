/**
 * Issue #71：主力籌碼雷達 — 三大法人連買賣＋佔比異常榜（上市 MVP）。
 *
 * 資料源（PoC 2026-10-13 定案，見 #71 comment）：
 * - `https://www.twse.com.tw/rwd/zh/fund/TWT38U?date=YYYYMMDD&response=json`
 *   （UTF-8，`stat==='OK'` 判有檔；groups 對映 4 組欄位：
 *   外資及陸資(不含自營)[3,4,5]／外資自營商[6,7,8]／外資及陸資合計[9,10,11]；
 *   本單取合計超＝idx11；TWT38U 無自營商欄，自營商在 TWT43U 另表，本單不含）
 * - `.../TWT44U?...`（投信，fields 6 欄，超＝idx5；僅列當日有買賣者，缺列視為 0）
 * - openapi 版 302 不用、exchangeReport 版 404 不用（PoC 已驗）。
 * - 佔比＝|法人合計超(股)×當日收盤|／STOCK_DAY_ALL 當日成交金額；
 *   收盤＋成交額取 openapi `v1/exchangeReport/STOCK_DAY_ALL`（當日檔，無 date 參數）。
 *
 * 融資券降級（PoC FAIL：MI_MARGIN/MI_MARGN×selectType、TWT92U/TWT93U、
 * afterTrading、exchangeReport 6 variants 全空）：
 * - 本單不做融資背離；`MARGIN_DIVERGE_AVAILABLE=false`，diverge 永 false；
 * - 佔比只算法人；UI 融資欄顯示「未含融資」；`chip.margin_diverge_on` 照規格
 *   註冊（預設 on）但無融資源故永不觸發，留待第二期接源即生效。
 *
 * 抓取模式沿 `lib/twse-dividends.ts`（逾時 abort＋失敗 throw 由呼叫端降級＋
 * `reportServerError` 告警 30 分鐘去重，不擋主流程）。
 * 引擎皆純函式（參考 `packages/backtest` 模式），可單測：
 * `trailingStreak`／`chipRatioPct`／`isChipAnomaly`／`buildChipAnomalies`。
 *
 * 無 DB migration（約束）：榜單讀時即算＋程序內短 TTL 快取；
 * 閾值走既有 `agent_settings`（`chip.consec_days`／`chip.ratio_pct`／
 * `chip.margin_diverge_on`，見 `lib/agent-settings.ts`）。
 */

/** 單檔抓取超時（TWSE 偶發慢回；逾時視為失敗，走降級＋告警，不擋主流程）。 */
export const CHIP_FETCH_TIMEOUT_MS = 20000

const TWT38U_URL = 'https://www.twse.com.tw/rwd/zh/fund/TWT38U'
const TWT44U_URL = 'https://www.twse.com.tw/rwd/zh/fund/TWT44U'
const STOCK_DAY_ALL_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'

/** 回看交易日數（近 5 日淨超序列；連買賣天數上限即 5）。 */
export const CHIP_LOOKBACK_DAYS = 5
/** 榜單上限（全市場掃完取佔比排序前 N；email 內文同表）。 */
export const CHIP_TOP_N = 50
/** 程序內快取 TTL（讀時即算 best-effort；同日 10 分鐘內不重打 TWSE）。 */
export const CHIP_CACHE_TTL_MS = 10 * 60 * 1000

/**
 * #71 後續（夜間誤報修復）：三大法人日報為盤後公布（約 19 點後才有今日檔）。
 * 公布前今日檔不存在 → 舊窗含今日會把「尚未公布」誤判為缺檔 partial、
 * 缺日補 0 切斷連買 streak（榜單系統性偏空）、讀時順帶寄出夜間信。
 * 故交易日當天 Taipei hour < 此值 → 回看窗排除今日（不打 TWSE、不進
 * partial、streak 不受污染）；≥ 此值含今日（仍缺→照常 partial 真異常）。
 */
export const CHIP_PUBLISH_HOUR_TAIPEI = 19

/**
 * 台北時區當前小時（0–23；沿 `twse-calendar.ts taipeiTodayStr` 的
 * `Intl … Asia/Taipei` 模式，就地以 Intl 取 hour 並註明；
 * hour12:false 在午夜可能回傳 24，一律正規化為 0）。
 */
export function taipeiHourOf(now: Date = new Date()): number {
  const h = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei',
      hour: 'numeric',
      hour12: false,
    }).format(now),
  )
  if (!Number.isFinite(h)) return 0
  return h === 24 ? 0 : h
}

/** 融資背離第二期：本單無融資源，一律 false（AC 以「未含融資」交付）。 */
export const MARGIN_DIVERGE_AVAILABLE = false

// ─── 純函式：解析 ────────────────────────────────────────────────

/** TWSE 數字欄（含千分位逗號／空白；空值視為 0，非法視為 0 不 throw）。 */
export function parseTwseNum(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const t = String(raw ?? '').replace(/,/g, '').trim()
  if (!t || t === '--' || t === '---') return 0
  const n = Number(t)
  return Number.isFinite(n) ? n : 0
}

/** 代號清洗：`'2887  '` → `'2887'`（TWT38U 代號帶尾空白；轉大寫）。 */
export function cleanChipCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase()
}

export interface ChipForeignRow {
  name: string
  /** 外資及陸資合計買賣超股數（TWT38U idx11）。 */
  foreignNet: number
}

/**
 * 解析 TWT38U dated JSON（fields 12 欄＋groups 4 組）：
 * - `stat!=='OK'` → 回空 Map（呼叫端視為缺檔，不 throw）；
 * - groups[3].title 含「外資及陸資」即欄位對映確認，不符僅 console.warn 不炸
 *  （欄順異動容錯：仍按 idx1/2/11 取，P1 已確認 2026-10 欄位穩定）。
 */
export function parseTwt38u(payload: unknown): Map<string, ChipForeignRow> {
  const out = new Map<string, ChipForeignRow>()
  const p = payload as { stat?: string; data?: unknown[][]; groups?: { title?: string }[] } | null
  if (!p || p.stat !== 'OK' || !Array.isArray(p.data)) return out
  const g3 = p.groups?.[3]?.title ?? ''
  if (g3 && !g3.includes('外資及陸資')) {
    console.warn(`[ChipRadar] TWT38U groups[3] title unexpected: ${g3}（仍按 idx11 取合計超）`)
  }
  for (const r of p.data) {
    if (!Array.isArray(r)) continue
    const code = cleanChipCode(r[1])
    if (!code) continue
    out.set(code, { name: String(r[2] ?? '').trim(), foreignNet: parseTwseNum(r[11]) })
  }
  return out
}

/** 解析 TWT44U dated JSON（投信，fields 6 欄，超＝idx5；缺列由合併層視為 0）。 */
export function parseTwt44u(payload: unknown): Map<string, number> {
  const out = new Map<string, number>()
  const p = payload as { stat?: string; data?: unknown[][] } | null
  if (!p || p.stat !== 'OK' || !Array.isArray(p.data)) return out
  for (const r of p.data) {
    if (!Array.isArray(r)) continue
    const code = cleanChipCode(r[1])
    if (!code) continue
    out.set(code, parseTwseNum(r[5]))
  }
  return out
}

export interface ChipQuote {
  /** 當日收盤（STOCK_DAY_ALL ClosingPrice）。 */
  close: number
  /** 當日成交金額（STOCK_DAY_ALL TradeValue，元）。 */
  tradeValue: number
}

/** 解析 STOCK_DAY_ALL（當日檔；Code/ClosingPrice/TradeValue；非法列略過）。 */
export function parseStockDayAll(payload: unknown): Map<string, ChipQuote> {
  const out = new Map<string, ChipQuote>()
  if (!Array.isArray(payload)) return out
  for (const r of payload as Record<string, unknown>[]) {
    const code = cleanChipCode(r?.Code)
    if (!code) continue
    const close = parseTwseNum(r?.ClosingPrice)
    const tradeValue = parseTwseNum(r?.TradeValue)
    if (!(close > 0) || !(tradeValue > 0)) continue
    out.set(code, { close, tradeValue })
  }
  return out
}

// ─── 純函式：引擎 ────────────────────────────────────────────────

export type ChipDirection = 'buy' | 'sell' | 'none'

export interface ChipStreak {
  direction: ChipDirection
  /** 尾端同向連續天數（0 表當日無超／方向中斷）。 */
  days: number
}

/**
 * 尾端連買／連賣天數（輸入為升冪淨超序列，含當日）：
 * - 當日為 0 → `{none, 0}`（無方向）；
 * - 當日 >0 往前數連續 >0 者；當日 <0 往前數連續 <0 者；遇 0／反向即斷。
 */
export function trailingStreak(nets: readonly number[]): ChipStreak {
  if (nets.length === 0) return { direction: 'none', days: 0 }
  const last = nets[nets.length - 1] ?? 0
  if (last === 0) return { direction: 'none', days: 0 }
  const wantBuy = last > 0
  let days = 0
  for (let i = nets.length - 1; i >= 0; i--) {
    const v = nets[i] ?? 0
    if ((wantBuy && v > 0) || (!wantBuy && v < 0)) days++
    else break
  }
  return { direction: wantBuy ? 'buy' : 'sell', days }
}

/**
 * 法人佔比％＝|淨超(股)×收盤|／成交金額×100。
 * 任一輸入非法（收盤≤0／成交額≤0）→ null（該檔不列榜，不硬給）。
 */
export function chipRatioPct(netShares: number, close: number, tradeValue: number): number | null {
  if (!Number.isFinite(netShares) || !(close > 0) || !(tradeValue > 0)) return null
  return (Math.abs(netShares * close) / tradeValue) * 100
}

export interface ChipThresholds {
  /** 連買／賣天數門檻（預設 3）。 */
  consecDays: number
  /** 佔比門檻％（預設 5）。 */
  ratioPct: number
  /** 融資背離開關（預設 on；本單無源永不觸發，第二期接源即生效）。 */
  marginDivergeOn: boolean
}

export const DEFAULT_CHIP_THRESHOLDS: ChipThresholds = {
  consecDays: 3,
  ratioPct: 5,
  marginDivergeOn: true,
}

/** agent_settings 字串 → 閾值（非法／缺值退預設，不 throw；可單測）。 */
export function parseChipThresholds(raw: {
  consecDays?: string | null
  ratioPct?: string | null
  marginDivergeOn?: string | null
}): ChipThresholds {
  const cd = Number(raw.consecDays)
  const rp = Number(raw.ratioPct)
  return {
    consecDays: Number.isInteger(cd) && cd >= 2 && cd <= 5 ? cd : DEFAULT_CHIP_THRESHOLDS.consecDays,
    ratioPct: Number.isFinite(rp) && rp > 0 && rp <= 100 ? rp : DEFAULT_CHIP_THRESHOLDS.ratioPct,
    marginDivergeOn: (raw.marginDivergeOn ?? 'on').trim().toLowerCase() !== 'off',
  }
}

/**
 * 榜單判定（純）：方向非 none 且天數達標且佔比達標。
 * 融資背離不列入（`MARGIN_DIVERGE_AVAILABLE=false`，第二期）。
 */
export function isChipAnomaly(
  streak: ChipStreak,
  ratioPct: number | null,
  thresholds: ChipThresholds,
): boolean {
  if (streak.direction === 'none' || streak.days < thresholds.consecDays) return false
  if (ratioPct == null || !Number.isFinite(ratioPct) || ratioPct < thresholds.ratioPct) return false
  return true
}

export interface ChipAnomalyInput {
  name: string
  /** 升冪法人合計淨超序列（外資合計＋投信，股數；缺日補 0 由呼叫端處理）。 */
  nets: number[]
  quote: ChipQuote | null
}

export interface ChipAnomalyRow {
  symbol: string
  name: string
  direction: ChipDirection
  /** 連買／賣天數。 */
  days: number
  /** 當日法人合計淨超（股；外資合計＋投信）。 */
  netShares: number
  /** 佔比％（當日；null 表缺報價不列榜，已濾除）。 */
  ratioPct: number
  /** 近 5 日淨超序列（mini 趨勢軸用，升冪）。 */
  trend: number[]
  /** 融資背離：本單一律 false（未含融資，第二期）。 */
  diverge: boolean
  /** 融資欄固定文案（AC 以「未含融資」交付）。 */
  marginNote: '未含融資'
}

/**
 * 建榜（純）：逐檔算 streak＋ratio＋判定，達標者依佔比降冪取前 topN。
 * - 非上市（代號含非數字前綴如 ETF 仍為上市掛牌，TWSE 全為上市；上櫃源本單不接，
 *   故本表天然只含上市——AC「MVP 只含上市」由資料源保證）；
 * - 缺報價（ratio null）→ 不列榜。
 */
export function buildChipAnomalies(
  input: ReadonlyMap<string, ChipAnomalyInput>,
  thresholds: ChipThresholds,
  topN: number = CHIP_TOP_N,
): ChipAnomalyRow[] {
  const rows: ChipAnomalyRow[] = []
  for (const [symbol, v] of input) {
    const streak = trailingStreak(v.nets)
    if (streak.direction === 'none') continue
    const netShares = v.nets[v.nets.length - 1] ?? 0
    const ratio = v.quote ? chipRatioPct(netShares, v.quote.close, v.quote.tradeValue) : null
    if (!isChipAnomaly(streak, ratio, thresholds)) continue
    rows.push({
      symbol,
      name: v.name,
      direction: streak.direction,
      days: streak.days,
      netShares,
      ratioPct: ratio as number,
      trend: [...v.nets],
      diverge: false,
      marginNote: '未含融資',
    })
  }
  rows.sort((a, b) => b.ratioPct - a.ratioPct)
  return rows.slice(0, Math.max(1, topN))
}

// ─── 抓取層（沿 twse-dividends.ts 逾時＋throw 降級模式） ──────────

async function fetchChipJson(url: string): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CHIP_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Referer: 'https://www.twse.com.tw/',
      },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`TWSE chip fetch error: ${res.status} (${url})`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** 抓 TWT38U 單日 dated JSON（`YYYY-MM-DD`→`YYYYMMDD`）；stat 非 OK 由解析層回空。 */
export async function fetchTwt38uDay(dateStr: string): Promise<Map<string, ChipForeignRow>> {
  const payload = await fetchChipJson(`${TWT38U_URL}?date=${dateStr.replace(/-/g, '')}&response=json`)
  return parseTwt38u(payload)
}

/** 抓 TWT44U 單日 dated JSON（投信）；stat 非 OK 由解析層回空。 */
export async function fetchTwt44uDay(dateStr: string): Promise<Map<string, number>> {
  const payload = await fetchChipJson(`${TWT44U_URL}?date=${dateStr.replace(/-/g, '')}&response=json`)
  return parseTwt44u(payload)
}

/** 抓 STOCK_DAY_ALL 當日檔（openapi，無 date 參數；失敗 throw 由呼叫端降級）。 */
export async function fetchStockDayAll(): Promise<Map<string, ChipQuote>> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CHIP_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(STOCK_DAY_ALL_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`STOCK_DAY_ALL error: ${res.status}`)
    return parseStockDayAll(await res.json())
  } finally {
    clearTimeout(timer)
  }
}

/** 讀閾值（agent_settings；讀不到退預設，不 throw）。 */
export async function getChipThresholds(): Promise<ChipThresholds> {
  try {
    const { getAgentSetting } = await import('@stock/database')
    const [consecDays, ratioPct, marginDivergeOn] = await Promise.all([
      getAgentSetting('chip.consec_days').catch(() => null),
      getAgentSetting('chip.ratio_pct').catch(() => null),
      getAgentSetting('chip.margin_diverge_on').catch(() => null),
    ])
    return parseChipThresholds({ consecDays, ratioPct, marginDivergeOn })
  } catch {
    return { ...DEFAULT_CHIP_THRESHOLDS }
  }
}

// ─── 編排層（讀時即算＋短 TTL；永不 throw） ──────────────────────

export type ChipRadarStatus = 'ok' | 'closed' | 'degraded'

export interface ChipRadarSnapshot {
  status: ChipRadarStatus
  today: string
  /** 資料時間（榜單最後一日；休市時為最近交易日）。 */
  asOf: string | null
  isTradingDay: boolean
  degraded: boolean
  /** 'non-trading-day' | 'insufficient-days' | 'partial-days:..' | 'no-quotes' | 錯誤訊息；正常為 null。 */
  degradedReason: string | null
  thresholds: ChipThresholds
  /** 回看交易日（升冪，mini 軸橫軸用）。 */
  windowDays: string[]
  items: ChipAnomalyRow[]
  scanned: number
  notice: string
}

function addDaysStr(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00+08:00`) + n * 86400000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

/**
 * 回看窗構造（純，可單測；#71 後續夜間誤報修復）：
 * - today 是交易日且 hour < `CHIP_PUBLISH_HOUR_TAIPEI` → 錨點往前挪一天
 *   （排除今日：不打 TWSE、不進 partial、streak 不受未公布日污染）；
 * - 否則錨點即 today（含今日；公布後仍缺→照常 partial 真異常）。
 * 由錨點往舊找 `CHIP_LOOKBACK_DAYS` 個交易日，回傳升冪。
 * 休市分支由 `ensureChipRadar` 另行處理（closed，不調用本函式取窗）。
 */
export function buildChipWindowDays(
  today: string,
  taipeiHour: number,
  isTradingDay: (d: string) => boolean,
): string[] {
  const excludeToday = isTradingDay(today) && taipeiHour < CHIP_PUBLISH_HOUR_TAIPEI
  const anchor = excludeToday ? addDaysStr(today, -1) : today
  const days: string[] = []
  for (let i = 0; i < 14 && days.length < CHIP_LOOKBACK_DAYS; i++) {
    const d = addDaysStr(anchor, -i)
    if (isTradingDay(d)) days.push(d)
  }
  days.sort()
  return days
}

/**
 * 告警分級（#71 後續縱深防禦；route 層使用）：
 * `partial-days:X` 僅含今日單日且等於 today（盤後公布前尚未有檔，
 * 非真異常）→ 呼叫端不寄信；缺過去日照常寄。
 * （註：實際 reason 日格式為 YYYY-MM-DD，故以「單日＋等於 today」判定，
 * 格式無關；`insufficient-days`／`no-quotes` 一律回 false。）
 */
export function isTodayOnlyPartial(reason: string | null, today: string): boolean {
  if (!reason || !reason.startsWith('partial-days:')) return false
  const days = reason
    .slice('partial-days:'.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return days.length === 1 && days[0] === today
}

function isRateLimitedLike(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return /429|rate.?limit|too many/i.test(msg)
}

const snapshotCache = new Map<string, { at: number; data: ChipRadarSnapshot }>()

export function clearChipRadarCache(): void {
  snapshotCache.clear()
}

/**
 * 讀時編排（best-effort 永不 throw）：
 * - 非交易日 → `closed`（休市無新盤；asOf＝最近交易日，不打 TWSE）；
 * - 交易日 → 近 5 交易日 TWT38U＋TWT44U（逐日 Promise.all，逐日失敗記 partial），
 *   STOCK_DAY_ALL 報價（失敗則全榜 ratio null→空榜＋'no-quotes'）；
 * - 任一日缺檔（空 Map）視為該日無資料併入（nets 缺日補 0）；可用日 <3 即
 *   `insufficient-days` 空榜（不斷言，避免誤榜）。
 */
export interface EnsureChipRadarOptions {
  /**
   * 台北小時（0–23；測試可注入，預設取真實時鐘 `taipeiHourOf()`）。
   * 未滿 `CHIP_PUBLISH_HOUR_TAIPEI` 且 today 為交易日時回看窗排除今日。
   */
  taipeiHour?: number
  /**
   * 單日抓取覆寫（測試注入免打網；預設走 TWSE；有任一覆寫即 bypass 快取）。
   */
  fetchForeignDay?: typeof fetchTwt38uDay
  fetchTrustDay?: typeof fetchTwt44uDay
  fetchQuotes?: typeof fetchStockDayAll
}

export async function ensureChipRadar(
  today: string,
  opts?: EnsureChipRadarOptions,
): Promise<ChipRadarSnapshot> {
  const useTestDeps = Boolean(opts?.fetchForeignDay ?? opts?.fetchTrustDay ?? opts?.fetchQuotes)
  // 快取鍵含公布前／後相位（同日 19 點前後窗不同，不可共用快取）。
  const phaseHour = opts?.taipeiHour ?? taipeiHourOf()
  const cacheKey = `${today}:${phaseHour < CHIP_PUBLISH_HOUR_TAIPEI ? 'pre' : 'post'}`
  const cached = useTestDeps ? undefined : snapshotCache.get(cacheKey)
  if (cached && Date.now() - cached.at < CHIP_CACHE_TTL_MS) return cached.data

  const thresholds = await getChipThresholds()
  const base: ChipRadarSnapshot = {
    status: 'ok',
    today,
    asOf: null,
    isTradingDay: true,
    degraded: false,
    degradedReason: null,
    thresholds,
    windowDays: [],
    items: [],
    scanned: 0,
    notice: '法人買賣超為盤後初值（TWSE 可能延遲修正，隔日重算覆蓋）；統計訊號非投資建議。',
  }
  try {
    const { isTwseTradingDay } = await import('./twse-calendar')
    if (!isTwseTradingDay(today)) {
      // 休市：往前找最近交易日作 asOf（僅日期計算，不打網）。
      let asOf: string | null = null
      for (let i = 1; i <= 10; i++) {
        const d = addDaysStr(today, -i)
        if (isTwseTradingDay(d)) {
          asOf = d
          break
        }
      }
      const snap: ChipRadarSnapshot = {
        ...base,
        status: 'closed',
        asOf,
        isTradingDay: false,
        degraded: true,
        degradedReason: 'non-trading-day',
      }
      if (!useTestDeps) snapshotCache.set(cacheKey, { at: Date.now(), data: snap })
      return snap
    }

    // 近 5 交易日（#71 後續：公布前排除今日，見 `buildChipWindowDays`；
    // 休市分支已在上方 return，本窗只處理交易日）。
    const days = buildChipWindowDays(today, phaseHour, isTwseTradingDay)
    base.windowDays = days

    const dayForeign: Map<string, ChipForeignRow>[] = []
    const dayTrust: Map<string, number>[] = []
    const partial: string[] = []
    const fetchF = opts?.fetchForeignDay ?? fetchTwt38uDay
    const fetchT = opts?.fetchTrustDay ?? fetchTwt44uDay
    for (const d of days) {
      try {
        const [f, t] = await Promise.all([fetchF(d), fetchT(d)])
        dayForeign.push(f)
        dayTrust.push(t)
        if (f.size === 0) partial.push(d)
      } catch (e) {
        console.error(`[ChipRadar] day fetch failed (${d}, non-blocking):`, e)
        dayForeign.push(new Map())
        dayTrust.push(new Map())
        partial.push(d)
      }
    }
    const okDays = days.length - partial.length
    if (okDays < 3) {
      const snap: ChipRadarSnapshot = {
        ...base,
        status: 'degraded',
        asOf: days[days.length - 1] ?? null,
        degraded: true,
        degradedReason: 'insufficient-days',
        scanned: 0,
      }
      if (!useTestDeps) snapshotCache.set(cacheKey, { at: Date.now(), data: snap })
      return snap
    }

    let quotes = new Map<string, ChipQuote>()
    try {
      quotes = await (opts?.fetchQuotes ?? fetchStockDayAll)()
    } catch (e) {
      console.error('[ChipRadar] STOCK_DAY_ALL failed (non-blocking):', e)
    }

    // 合併：universe 取各日外資表聯集；缺日補 0（該日無檔不中斷 streak 計算，
    // 但 partial 揭露，避免把缺檔誤讀為斷連）。
    const universe = new Map<string, { name: string; nets: number[] }>()
    days.forEach((d, di) => {
      const f = dayForeign[di]!
      const t = dayTrust[di]!
      for (const [code, row] of f) {
        let u = universe.get(code)
        if (!u) {
          u = { name: row.name, nets: new Array(days.length).fill(0) }
          universe.set(code, u)
        }
        if (!u.name && row.name) u.name = row.name
        u.nets[di] = (row.foreignNet || 0) + (t.get(code) || 0)
      }
      // 投信有、外資缺的邊角列（理論上不發生；防呆併入）。
      for (const [code, net] of t) {
        if (universe.has(code)) continue
        const u = { name: '', nets: new Array(days.length).fill(0) }
        u.nets[di] = net || 0
        universe.set(code, u)
      }
    })

    const input = new Map<string, ChipAnomalyInput>()
    for (const [code, u] of universe) {
      input.set(code, { name: u.name, nets: u.nets, quote: quotes.get(code) ?? null })
    }
    const items = buildChipAnomalies(input, thresholds)
    const asOf = days[days.length - 1] ?? null
    const snap: ChipRadarSnapshot = {
      ...base,
      status: partial.length > 0 || quotes.size === 0 ? 'degraded' : 'ok',
      asOf,
      degraded: partial.length > 0 || quotes.size === 0,
      degradedReason:
        quotes.size === 0 ? 'no-quotes' : partial.length > 0 ? `partial-days:${partial.join(',')}` : null,
      items,
      scanned: universe.size,
    }
    if (!useTestDeps) snapshotCache.set(cacheKey, { at: Date.now(), data: snap })
    return snap
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'chip radar failed'
    console.error('[ChipRadar] ensure failed (non-blocking):', message)
    try {
      const { reportServerError } = await import('./server-alert')
      void reportServerError({
        route: 'chip-radar ensure',
        status: isRateLimitedLike(e) ? 429 : 502,
        error: `chip-radar ensure failed (${today}): ${message}`,
      })
    } catch {}
    const snap: ChipRadarSnapshot = {
      ...base,
      status: 'degraded',
      degraded: true,
      degradedReason: message,
    }
    return snap
  }
}
