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

// ─── #44：5 年殖利率回填（lazy＋封頂＋斷點續抓）────────────────────
// 背景：twse_dividends 由每日 ensureTodayDividends 逐日累積，當年齊全；
// 過去年份冷啟動時整年缺檔，5 年平均需回填歷史 TWT48U。
//
// 上限值（實作註明）：YIELD_BACKFILL_MAX_DAYS_PER_RUN＝30（每輪最多抓 30 個
// 交易日；TWT48U 單日回全市場檔，故每檔均攤同一上限，無需逐檔配額）。
// 斷點續抓：agent_settings `twse_dividends.backfill_cursor` 記「下次起抓日」
// （由新往舊掃；掃完記 'done'；年份窗滾動時自動失效重掃）。
// 呼叫時機：同步鈕＋排程順帶（沿用既有 ensureTodayDividends 位置），
// best-effort 永不 throw；/dividends 讀取端唯讀不觸發。
//
// MOPS 選邊註明：TWT48U 的 ?date= 歷史檔僅 TWSE 保留近期才有；若舊年份
// 連續回空／HTTP 錯（實測待確認），改用 MOPS「股利分派表」逐檔查
// （未實作：需另接 MOPS API＋欄位對映，本輪先以 TWT48U＋年份不全註記覆蓋）。
export const YIELD_BACKFILL_YEARS = 5
export const YIELD_BACKFILL_MAX_DAYS_PER_RUN = 30
export const TWSE_DIVIDENDS_BACKFILL_CURSOR = 'twse_dividends.backfill_cursor'

export type YieldBackfillStatus = 'done' | 'advanced' | 'failed'

export interface YieldBackfillYear {
  year: string
  rows: number
  missing: boolean
}

export interface YieldBackfillResult {
  status: YieldBackfillStatus
  years: YieldBackfillYear[]
  /** 本輪實際抓取交易日數（≤ 上限 30）。 */
  fetchedDays: number
  /** 本輪寫入筆數。 */
  written: number
  /** 斷點 cursor（下次起抓日／'done'）。 */
  cursor: string | null
  /** 失敗／空檔說明；正常時為 null。 */
  reason: string | null
}

function backfillTargetYears(today: string): string[] {
  const y = Number(today.slice(0, 4))
  if (!Number.isInteger(y)) return []
  const out: string[] = []
  // 過去 4 個完整年（當年由每日 ensureTodayDividends 負責，不列入回填）。
  for (let i = YIELD_BACKFILL_YEARS - 1; i >= 1; i--) out.push(String(y - i))
  return out
}

/** 某年交易日清單（由新往舊；週末必休＋已知國定假日表；更早年份僅週末判斷，見註明）。 */
async function listYearTradingDaysDesc(year: string): Promise<string[]> {
  const { isTwseTradingDay } = await import('./twse-calendar')
  const days: string[] = []
  const d = new Date(`${year}-12-31T12:00:00+08:00`)
  if (Number.isNaN(d.getTime())) return days
  const start = new Date(`${year}-01-01T12:00:00+08:00`).getTime()
  for (let t = d.getTime(); t >= start; t -= 24 * 3600 * 1000) {
    const s = new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
    if (isTwseTradingDay(s)) days.push(s)
  }
  return days
}

export async function ensureYieldHistoryBackfill(
  today: string,
  opts?: { maxDays?: number },
): Promise<YieldBackfillResult> {
  const maxDays = opts?.maxDays ?? YIELD_BACKFILL_MAX_DAYS_PER_RUN
  const empty: YieldBackfillResult = {
    status: 'failed', years: [], fetchedDays: 0, written: 0, cursor: null, reason: null,
  }
  try {
    const { getAgentSetting, setAgentSetting, getTwseDividendsByYear, upsertTwseDividends } =
      await import('@stock/database')

    const targetYears = backfillTargetYears(today)
    if (targetYears.length === 0) return { ...empty, reason: 'invalid-today' }

    // 覆蓋檢查：整年 0 筆＝缺年（需回填）；有筆即視為齊全（逐日冪等，不重掃）。
    const years: YieldBackfillYear[] = []
    for (const year of targetYears) {
      let rows = 0
      try {
        rows = (await getTwseDividendsByYear(year)).length
      } catch {
        rows = 0
      }
      years.push({ year, rows, missing: rows === 0 })
    }
    const missingYears = years.filter((y) => y.missing).map((y) => y.year)
    if (missingYears.length === 0) {
      return { status: 'done', years, fetchedDays: 0, written: 0, cursor: 'done', reason: null }
    }

    // 斷點：cursor 為「下次起抓日」（含）；'done' 但窗內又有缺年 → 視為失效重掃。
    let cursor: string | null = null
    try {
      cursor = await getAgentSetting(TWSE_DIVIDENDS_BACKFILL_CURSOR)
    } catch {
      cursor = null
    }
    const needRescan = cursor === 'done'

    // 候選日：缺年交易日由新往舊；cursor 有效時只取 ≤cursor 者（已抓過的不重抓）。
    const candidates: string[] = []
    for (const year of missingYears) {
      const days = await listYearTradingDaysDesc(year)
      for (const day of days) {
        if (!needRescan && cursor && cursor !== 'done' && day > cursor) continue
        candidates.push(day)
      }
    }
    candidates.sort().reverse()
    if (candidates.length === 0) {
      try {
        await setAgentSetting({
          key: TWSE_DIVIDENDS_BACKFILL_CURSOR,
          value: 'done',
          category: 'sync',
          label: 'TWT48U 5 年回填斷點（下次起抓日；done＝窗內齊全）',
        })
      } catch {}
      return { status: 'done', years, fetchedDays: 0, written: 0, cursor: 'done', reason: null }
    }

    // 每輪封頂：只抓前 maxDays 天（TWT48U 單日回全市場，逐日 best-effort）。
    const batch = candidates.slice(0, Math.max(1, maxDays))
    let written = 0
    let okDays = 0
    let lastError: string | null = null
    for (const day of batch) {
      try {
        const { rows } = await fetchTwt48uDay(day)
        okDays++
        try {
          written += await upsertTwseDividends(rows)
        } catch (e) {
          console.error('[TwseDividends] backfill upsert failed (non-blocking):', e)
        }
      } catch (e: unknown) {
        // 單日失敗不中斷整輪（舊年份 TWSE 可能已無檔；連續失敗由 reason 揭露）。
        lastError = e instanceof Error ? e.message : 'TWT48U history fetch failed'
      }
    }

    const oldestAttempted = batch[batch.length - 1]
    const remaining = candidates.length - batch.length
    // 斷點＝已抓最舊日的前一日（下輪由該日起抓；無剩餘即 done）。
    const nextCursor = remaining <= 0 ? 'done' : prevDayStr(oldestAttempted)
    try {
      await setAgentSetting({
        key: TWSE_DIVIDENDS_BACKFILL_CURSOR,
        value: nextCursor,
        category: 'sync',
        label: 'TWT48U 5 年回填斷點（下次起抓日；done＝窗內齊全）',
      })
    } catch {}
    if (okDays === 0) {
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

/** 前一日 'YYYY-MM-DD'（斷點 cursor 用；非法回 null 由呼叫端視為 done）。 */
function prevDayStr(dateStr: string): string {
  const t = new Date(`${dateStr}T12:00:00+08:00`).getTime()
  if (Number.isNaN(t)) return 'done'
  return new Date(t - 24 * 3600 * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
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
