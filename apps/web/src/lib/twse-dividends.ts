/**
 * Issue #35：TWSE TWT48U（除權除息預告表）每日 CSV 抓取＋解析。
 *
 * 沿用 arena MI_INDEX 抓取模式（`packages/ai-engine/src/arena/universe.ts`）：
 * big5 解碼（失敗退 utf-8）＋容錯解析（欄位名動態定位、非法列略過）＋
 * 失敗不擋主流程（呼叫端 best-effort，見 `ensureTodayDividends`）＋
 * 限流/失敗告警沿用 #24 `reportServerError`（30 分鐘同 key 去重）。
 *
 * TWT48U 實測格式（2026-08 起）：
 * - 首行 `"除權除息預告表"`；表頭含 `除權除息日期,股票代號,名稱,除權息,...,現金股利,...`
 * - 日期為民國年 `115年10月08日`；代號帶 Excel 前綴 `="00400A"`；
 * - `現金股利` 可能是數字或 `待公告實際收益分配金額`（後者略過不寫快取）。
 */

import type { TwseDividendInput } from '@stock/database'

const TWT48U_URL = 'https://www.twse.com.tw/exchangeReport/TWT48U'

/** TWT48U 單檔抓取超時（TWSE 偶發慢回；逾時視為失敗，走降級＋告警，不擋主流程）。 */
export const TWT48U_FETCH_TIMEOUT_MS = 20000

export interface Twt48uParseResult {
  rows: TwseDividendInput[]
  /** 略過列數（待公告／格式不符；供 log 觀察，不進 UI）。 */
  skipped: number
}

/** 民國年日期 `115年10月08日` → `2026-10-08`；格式不符回 null（該列略過）。 */
export function parseRocDateToIso(raw: string): string | null {
  const m = (raw ?? '').trim().match(/^(\d{2,3})年(\d{1,2})月(\d{1,2})日$/)
  if (!m) return null
  const y = 1911 + Number(m[1])
  const mo = String(Number(m[2])).padStart(2, '0')
  const d = String(Number(m[3])).padStart(2, '0')
  const iso = `${y}-${mo}-${d}`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const t = new Date(`${iso}T12:00:00+08:00`)
  return Number.isNaN(t.getTime()) ? null : iso
}

/** 代號清洗：`="00400A"` → `00400A`；去除空白引號，轉大寫。 */
export function cleanTwseCode(raw: string): string {
  return (raw ?? '')
    .trim()
    .replace(/^="?(.*?)"?$/, '$1')
    .replace(/^"+|"+$/g, '')
    .trim()
    .toUpperCase()
}

function parseCashDividend(raw: string): number | null {
  const t = (raw ?? '').trim().replace(/,/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 簡易 CSV 行切分（TWT48U 欄位皆以雙引號包覆；內嵌逗號不切）。 */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuote = !inQuote
      }
    } else if (c === ',' && !inQuote) {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out.map((f) => f.trim())
}

/**
 * 容錯解析 TWT48U CSV 全文：
 * - 表頭以欄位名動態定位（`股票代號`／`除權除息日期`／`現金股利`），欄順異動不炸；
 * - 找不到表頭 → 回空陣列（呼叫端視為無檔，不 throw）；
 * - 資料列任一欄非法（代號空／日期非法／現金非正數）→ 單列略過計 skipped。
 */
export function parseTwt48uCsv(text: string): Twt48uParseResult {
  const rows: TwseDividendInput[] = []
  let skipped = 0
  const lines = (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  let idxCode = -1
  let idxDate = -1
  let idxCash = -1
  let headerFound = false
  for (const line of lines) {
    const fields = splitCsvLine(line)
    if (!headerFound) {
      const iCode = fields.findIndex((f) => f.includes('股票代號'))
      const iDate = fields.findIndex((f) => f.includes('除權除息日期'))
      const iCash = fields.findIndex((f) => f.includes('現金股利'))
      if (iCode >= 0 && iDate >= 0 && iCash >= 0) {
        idxCode = iCode
        idxDate = iDate
        idxCash = iCash
        headerFound = true
      }
      continue
    }
    const symbol = cleanTwseCode(fields[idxCode] ?? '')
    const exDate = parseRocDateToIso(fields[idxDate] ?? '')
    const cash = parseCashDividend(fields[idxCash] ?? '')
    if (!symbol || !exDate || cash == null) {
      skipped++
      continue
    }
    rows.push({ symbol, ex_date: exDate, cash_dividend: cash })
  }
  return { rows, skipped }
}

/** 抓 TWT48U 單日 CSV 全文（big5 優先，失敗退 utf-8；逾時/HTTP 錯誤直接 throw）。 */
export async function fetchTwt48uText(dateCompact: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TWT48U_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${TWT48U_URL}?response=csv&date=${dateCompact}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Referer: 'https://www.twse.com.tw/',
      },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`TWSE TWT48U error: ${res.status} (${dateCompact})`)
    const buf = Buffer.from(await res.arrayBuffer())
    try {
      return new TextDecoder('big5', { fatal: true }).decode(buf)
    } catch {
      return new TextDecoder('utf-8').decode(buf)
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 抓＋解析 TWT48U 單日（`YYYY-MM-DD`）；解析層永不 throw（無表頭即回空陣列）。 */
export async function fetchTwt48uDay(dateStr: string): Promise<Twt48uParseResult> {
  const text = await fetchTwt48uText(dateStr.replace(/-/g, ''))
  return parseTwt48uCsv(text)
}

// ─── TWT49U 除權除息計算結果表（Issue #90：真歷史區間查詢）────────────
// 背景：TWT48U `?date=` 無視日期、永遠只回當期預告 → 以它做歷史回填會無限空轉
// （同批反覆重抓、cursor 凍結）。歷史改走 TWT49U `startDate/endDate` 區間。
// 現金股利＝除權息前收盤 − 減除股利參考價（息/權息皆適用；純權無現金→≤0 略過）。
// 月粒度：2022-01 起到當月（含）；已覆蓋月（當月有筆即跳過）不重抓；
// 每輪上限 6 個月；單月失敗不擋整輪（下輪重試該月）；TWT48U 每日累積（往未來）照舊。
const TWT49U_URL = 'https://www.twse.com.tw/exchangeReport/TWT49U'

/** TWT49U 單月抓取超時（月資料約數百列；逾時 throw 由呼叫端逐月 best-effort）。 */
export const TWT49U_FETCH_TIMEOUT_MS = 20000

export interface Twt49uParseResult {
  rows: TwseDividendInput[]
  /** 略過列數（日期/代號非法／無現金）；供 log 觀察。 */
  skipped: number
}

function parseNumLoose(raw: unknown): number | null {
  const t = String(raw ?? '').replace(/,/g, '').trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * 解析 TWT49U JSON data 列：
 * [資料日期ROC, 代號, 名稱, 前收, 參考價, 權值+息值, 權/息, 漲停, 跌停,
 *  開盤競價基準, 減除股利參考價, ...]。純函式，可單測。
 */
export function parseTwt49uRows(data: unknown[][]): Twt49uParseResult {
  const rows: TwseDividendInput[] = []
  let skipped = 0
  for (const cols of data ?? []) {
    const exDate = parseRocDateToIso(String((cols as unknown[])?.[0] ?? ''))
    const symbol = cleanTwseCode(String((cols as unknown[])?.[1] ?? ''))
    const prevClose = parseNumLoose((cols as unknown[])?.[3])
    const deductRef = parseNumLoose((cols as unknown[])?.[10])
    const cash =
      prevClose != null && deductRef != null ? Math.round((prevClose - deductRef) * 10000) / 10000 : null
    if (!symbol || !exDate || cash == null || cash <= 0) {
      skipped++
      continue
    }
    rows.push({ symbol, ex_date: exDate, cash_dividend: cash })
  }
  return { rows, skipped }
}

/** 抓 TWT49U 單月（YYYY-MM）；stat 非 OK 即 throw（呼叫端逐月 best-effort）。 */
export async function fetchTwt49uMonth(month: string): Promise<Twt49uParseResult> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`invalid month: ${month}`)
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const lastDay = new Date(y, m, 0).getDate()
  const mm = String(m).padStart(2, '0')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TWT49U_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(
      `${TWT49U_URL}?response=json&startDate=${y}${mm}01&endDate=${y}${mm}${String(lastDay).padStart(2, '0')}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          Referer: 'https://www.twse.com.tw/',
        },
        signal: ctrl.signal,
      },
    )
    if (!res.ok) throw new Error(`TWSE TWT49U error: ${res.status} (${month})`)
    const body: any = await res.json()
    if (body?.stat !== 'OK') throw new Error(`TWSE TWT49U stat!=OK (${month}): ${String(body?.stat ?? '').slice(0, 80)}`)
    return parseTwt49uRows(Array.isArray(body?.data) ? body.data : [])
  } finally {
    clearTimeout(timer)
  }
}

// ─── #44：5 年殖利率回填（lazy＋封頂；Issue #90 改月粒度 TWT49U）───────
// 背景：twse_dividends 由每日 ensureTodayDividends 逐日累積，當年齊全；
// 過去年份冷啟動時整年缺檔，5 年平均需回填歷史。
//
// 上限值（實作註明）：YIELD_BACKFILL_MAX_MONTHS_PER_RUN＝6（TWT49U 單月回全市場
// 數百列；每月約數百筆寫入，配額遠低於舊逐日 30 天）。
// 進度追蹤：DB 即 cursor——已覆蓋月（當月有筆即跳過）不重抓，無限空轉不可能
// （舊 TWT48U 日粒度＋agent_settings cursor 已移除；舊 key 殘留無害）。
// 呼叫時機：同步鈕＋排程順帶（沿用既有 ensureTodayDividends 位置），
// best-effort 永不 throw；/dividends 讀取端唯讀不觸發。
export const YIELD_BACKFILL_YEARS = 5
export const YIELD_BACKFILL_MAX_MONTHS_PER_RUN = 6

export type YieldBackfillStatus = 'done' | 'advanced' | 'failed'

export interface YieldBackfillYear {
  year: string
  rows: number
  missing: boolean
}

export interface YieldBackfillResult {
  status: YieldBackfillStatus
  years: YieldBackfillYear[]
  /** 本輪實際抓取月數（≤ 上限 6；沿用欄位名，語意為月）。 */
  fetchedDays: number
  /** 本輪寫入筆數。 */
  written: number
  /** 觀測用 cursor（下輪最舊已抓月／'done'；真進度以 DB 覆蓋集為準）。 */
  cursor: string | null
  /** 失敗／空檔說明；正常時為 null。 */
  reason: string | null
}

/** 回填月份窗（當年往前推滿 5 年之 1 月起，到當月；由新往舊）。 */
export function backfillMonthWindow(today: string, windowYears: number = YIELD_BACKFILL_YEARS): string[] {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return []
  const out: string[] = []
  let cy = y
  let cm = m
  const stop = `${y - windowYears + 1}-01`
  while (`${cy}-${String(cm).padStart(2, '0')}` >= stop) {
    out.push(`${cy}-${String(cm).padStart(2, '0')}`)
    cm--
    if (cm < 1) {
      cm = 12
      cy--
    }
  }
  return out
}

export async function ensureYieldHistoryBackfill(
  today: string,
  opts?: { maxMonths?: number },
): Promise<YieldBackfillResult> {
  const maxMonths = opts?.maxMonths ?? YIELD_BACKFILL_MAX_MONTHS_PER_RUN
  const empty: YieldBackfillResult = {
    status: 'failed', years: [], fetchedDays: 0, written: 0, cursor: null, reason: null,
  }
  try {
    const { getTwseDividendsByYear, upsertTwseDividends } = await import('@stock/database')

    const months = backfillMonthWindow(today)
    if (months.length === 0) return { ...empty, reason: 'invalid-today' }

    // 覆蓋檢查：DB 有該月任一筆即視為已覆蓋（TWT49U 單月回全市場，不會有半月）。
    const covered = new Set<string>()
    const years: YieldBackfillYear[] = []
    const seenYears = [...new Set(months.map((mo) => mo.slice(0, 4)))]
    for (const year of seenYears) {
      let rows: Array<{ ex_date: string }> = []
      try {
        rows = await getTwseDividendsByYear(year)
      } catch {
        rows = []
      }
      for (const r of rows) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(r.ex_date)) covered.add(r.ex_date.slice(0, 7))
      }
      years.push({ year, rows: rows.length, missing: rows.length === 0 })
    }

    const pending = months.filter((mo) => !covered.has(mo))
    if (pending.length === 0) {
      return { status: 'done', years, fetchedDays: 0, written: 0, cursor: 'done', reason: null }
    }

    // 每輪封頂：只抓最新 maxMonths 個月；單月失敗不中斷（下輪重試該月）。
    const batch = pending.slice(0, Math.max(1, maxMonths))
    let written = 0
    let okMonths = 0
    let lastError: string | null = null
    for (const mo of batch) {
      try {
        const { rows } = await fetchTwt49uMonth(mo)
        okMonths++
        try {
          written += await upsertTwseDividends(rows)
        } catch (e) {
          console.error('[TwseDividends] backfill upsert failed (non-blocking):', e)
        }
      } catch (e: unknown) {
        lastError = e instanceof Error ? e.message : 'TWT49U month fetch failed'
      }
    }

    const oldestAttempted = batch[batch.length - 1]
    const remaining = pending.length - batch.length
    // cursor 僅供觀測（DB 覆蓋集才是真進度）：下輪最舊已抓月／done。
    const nextCursor = remaining <= 0 ? 'done' : oldestAttempted
    if (okMonths === 0) {
      return {
        status: 'failed', years, fetchedDays: 0, written: 0, cursor: nextCursor,
        reason: lastError ?? 'empty-history',
      }
    }
    return {
      status: nextCursor === 'done' ? 'done' : 'advanced',
      years, fetchedDays: batch.length, written, cursor: nextCursor,
      reason: lastError ? `partial-fail: ${lastError}` : null,
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'yield backfill failed'
    console.error('[TwseDividends] backfill failed (non-blocking):', message)
    return { ...empty, reason: message }
  }
}

// ─── 缺檔才抓（同步鈕＋16:00 排程順帶更新）─────────────────────────
// TWT48U 是「預告表」：單次抓取回多筆未來除息事件，逐日累積成當年快取。
// 「已有快取不重抓」以 agent_settings 抓取日標記判斷（同日第二次直接 skip；
// UNIQUE(symbol, ex_date) 另保冪等）。全程 best-effort：永不 throw，
// 失敗回 { status: 'failed' }＋走 #24 reportServerError 告警（30 分鐘去重）。
export const TWSE_DIVIDENDS_FETCH_MARKER = 'twse_dividends.last_fetch_date'

export type EnsureDividendsStatus =
  | 'updated'
  | 'skipped-cached'
  | 'skipped-non-trading-day'
  | 'failed'

export interface EnsureDividendsResult {
  status: EnsureDividendsStatus
  fetched: number
  written: number
  skippedParse: number
  /** 'non-trading-day' | 'empty-file' | 錯誤訊息；成功且有檔時為 null。 */
  reason: string | null
}

function isRateLimitedLike(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return /429|rate.?limit|too many/i.test(msg)
}

export async function getDividendsCacheInfo(today: string): Promise<{ cacheAsOf: string | null; isTradingDay: boolean }> {
  let cacheAsOf: string | null = null
  try {
    const { getAgentSetting } = await import('@stock/database')
    cacheAsOf = await getAgentSetting(TWSE_DIVIDENDS_FETCH_MARKER)
  } catch {
    cacheAsOf = null
  }
  const { isTwseTradingDay } = await import('./twse-calendar')
  return { cacheAsOf, isTradingDay: isTwseTradingDay(today) }
}

export async function ensureTodayDividends(today: string): Promise<EnsureDividendsResult> {
  const empty: EnsureDividendsResult = { status: 'failed', fetched: 0, written: 0, skippedParse: 0, reason: null }
  try {
    const { isTwseTradingDay } = await import('./twse-calendar')
    if (!isTwseTradingDay(today)) {
      return { ...empty, status: 'skipped-non-trading-day', reason: 'non-trading-day' }
    }
    const { getAgentSetting, setAgentSetting, upsertTwseDividends } = await import('@stock/database')
    let marker: string | null = null
    try {
      marker = await getAgentSetting(TWSE_DIVIDENDS_FETCH_MARKER)
    } catch {}
    if (marker === today) {
      return { ...empty, status: 'skipped-cached', reason: null }
    }
    const { rows, skipped } = await fetchTwt48uDay(today)
    let written = 0
    try {
      written = await upsertTwseDividends(rows)
    } catch (e) {
      console.error('[TwseDividends] upsert failed (non-blocking):', e)
    }
    try {
      await setAgentSetting({
        key: TWSE_DIVIDENDS_FETCH_MARKER,
        value: today,
        category: 'sync',
        label: 'TWT48U 除息快取最近抓取日（YYYY-MM-DD；同日不重抓）',
      })
    } catch {}
    return {
      status: 'updated',
      fetched: rows.length,
      written,
      skippedParse: skipped,
      reason: rows.length === 0 ? 'empty-file' : null,
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'TWT48U fetch failed'
    console.error('[TwseDividends] fetch failed (non-blocking):', message)
    try {
      const { reportServerError } = await import('./server-alert')
      void reportServerError({
        route: 'TWT48U dividends fetch',
        status: isRateLimitedLike(e) ? 429 : 502,
        error: `TWT48U fetch failed (${today}): ${message}`,
      })
    } catch {}
    return { ...empty, reason: message }
  }
}
