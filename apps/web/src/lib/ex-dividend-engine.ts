/**
 * Issue #67：除權息填息統計純函式引擎（client-safe，零 Node/DB 依賴）。
 *
 * 選邊註明（參考 `packages/backtest` 純函式＋單測模式）：
 * - 輸入＝還原權值收盤序列（adjclose，沿用 #69 P1 交叉核對：Yahoo
 *   `adjclose` 全域等比例還原，0050/00878/00919 誤差 0）＋除息事件；
 *   本檔只做純算，不抓網、不讀庫（歷史事件回溯以 adjclose＋本地快取為主，
 *   缺歷史日視為無事件並由呼叫端註「年份不全」）。
 * - 填息定義＝收盤 ≥ 除息前收盤（除息日前一交易日收盤）。
 * - 窗口 D1/D5/D10/D20/D40＝除息日起 N 個「交易日」內曾達標；
 *   D1 即除息日當天收盤 ≥ 除息前收盤。
 * - 到期填息比率＝滿 40 個交易日窗口（matured）事件中曾達標者佔比；
 *   DN 比率則以「窗口可觀察」（往後有 ≥N 根 bars）事件為分母，
 *   故到期比率與 D40 可能不同（最近事件未滿窗不計入到期分母）。
 * - 事件數 < 3 → insufficient，不給評分／機率硬分數（UI 顯示「樣本不足」）。
 * - 文案紅線：僅歷史統計，禁「預測/保證」字眼。
 */

/** 還原權值收盤序列（日期升冪；close 為 adjclose）。 */
export interface ExDividendPriceBar {
  /** 'YYYY-MM-DD' */
  date: string
  close: number
}

/** 除息事件輸入（exDate 需落在 bars 覆蓋窗內，否則該事件略過）。 */
export interface ExDividendEventInput {
  /** 除息日 'YYYY-MM-DD' */
  exDate: string
  /** 每股現金股利（元；可選，僅供 UI 顯示，不影響填息判定）。 */
  cashDividend?: number
}

/** 填息觀察窗口（交易日數）。 */
export const FILL_WINDOWS = [1, 5, 10, 20, 40] as const
export type FillWindow = (typeof FILL_WINDOWS)[number]

/** 滿窗天數（到期判定用＝40 個交易日）。 */
export const FILL_MATURE_DAYS = 40

/** 評分所需最少事件數（<3 即樣本不足，不給分）。 */
export const MIN_EVENTS_FOR_SCORE = 3

/** ETF／個股分流（沿用 market-data quoteType 語義）。 */
export type ExDividendAssetKind = 'etf' | 'stock' | 'unknown'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * quoteType → 資產鏈路：
 * - `ETF` → 配息鏈路（'etf'，UI 標籤「ETF配息」）；
 * - `EQUITY` → 除權息鏈路（'stock'，UI 標籤「個股除權息」）；
 * - 其餘／空 → 'unknown'。
 */
export function classifyAssetKind(quoteType: string | null | undefined): ExDividendAssetKind {
  const t = (quoteType ?? '').trim().toUpperCase()
  if (t === 'ETF') return 'etf'
  if (t === 'EQUITY') return 'stock'
  return 'unknown'
}

/** 資產鏈路 UI 標籤（與 classifyAssetKind 一一對應）。 */
export function assetKindLabel(kind: ExDividendAssetKind): string {
  if (kind === 'etf') return 'ETF配息'
  if (kind === 'stock') return '個股除權息'
  return '未知類型'
}

/**
 * 除息最後買進日 `ex_last_buy_date`＝exDate 前一交易日（遇假日順延往前）。
 * - isTradingDay 由呼叫端注入正源（`lib/twse-calendar.ts isTwseTradingDay`），
 *   本函式保持純函式可單測；
 * - 最多往前找 10 天；輸入非法回 ''（呼叫端視為缺值，不硬給）。
 */
export function computeExLastBuyDate(
  exDate: string,
  isTradingDay: (dateStr: string) => boolean,
): string {
  if (!DATE_RE.test(exDate)) return ''
  const t = new Date(`${exDate}T12:00:00+08:00`).getTime()
  if (Number.isNaN(t)) return ''
  for (let i = 1; i <= 10; i++) {
    const s = new Date(t - i * 24 * 3600 * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
    if (isTradingDay(s)) return s
  }
  return ''
}

/** 今日距除息日曆天（exDate - today；負值＝已除息）。 */
export function daysUntilEx(today: string, exDate: string): number | null {
  if (!DATE_RE.test(today) || !DATE_RE.test(exDate)) return null
  const a = new Date(`${today}T12:00:00+08:00`).getTime()
  const b = new Date(`${exDate}T12:00:00+08:00`).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / (24 * 3600 * 1000))
}

/** 單一除息事件的填息明細（供單檔展開顯示）。 */
export interface ExDividendEventFill {
  exDate: string
  /** 除息前收盤（除息日前一交易日 adjclose；缺值即該事件略過不計）。 */
  preClose: number
  cashDividend: number | null
  /** 窗口內是否曾達標（收盤 ≥ 除息前收盤）。 */
  filled: boolean
  /** 首次達標為除息日起第幾個交易日（1＝當天；未達標為 null）。 */
  daysToFill: number | null
  /** 各窗口是否達標（僅窗口可觀察時有意義）。 */
  hitD1: boolean
  hitD5: boolean
  hitD10: boolean
  hitD20: boolean
  hitD40: boolean
  /** 窗口內最大未填息幅度（(最低收盤/除息前收盤-1)*100；全程達標即 0）。 */
  maxDrawdownPct: number
  /** 該事件往後是否有滿 40 根 bars（到期與否）。 */
  matured: boolean
}

/** 填息統計彙總（排行榜用）。 */
export interface ExDividendStats {
  /** 納入評估事件數。 */
  eventCount: number
  /** 因缺除息前收盤／除息日無後續 bars 而略過的事件數。 */
  skippedCount: number
  /** 事件數 < 3 → true；為 true 時 fillScore 與各比率不應展示硬分數。 */
  insufficient: boolean
  fillRateD1: number | null
  fillRateD5: number | null
  fillRateD10: number | null
  fillRateD20: number | null
  fillRateD40: number | null
  /** 到期填息比率（滿窗事件中達標佔比；無滿窗事件為 null）。 */
  expiryFillRate: number | null
  /** 滿窗事件數（到期分母）。 */
  maturedCount: number
  /** 平均填息天數（達標事件平均；無達標為 null）。 */
  avgFillDays: number | null
  /** 最大未填息幅度（未達標滿窗事件中最深者，%；無則 null）。 */
  maxUnfilledDrawdownPct: number | null
  /** 填息力評分 0–100（insufficient 時為 null）。 */
  fillScore: number | null
  events: ExDividendEventFill[]
  /** 納入事件涵蓋年份（升冪；供「年份不全」註記）。 */
  yearsCovered: string[]
}

function rate(hits: number, total: number): number | null {
  if (total <= 0) return null
  return hits / total
}

/**
 * 填息力評分 0–100：
 * score ＝ 40×D20 ＋ 40×到期比率 ＋ 20×速度分
 * （速度分＝1-(avgFillDays-1)/39，越快越高；任一項缺值以 0 計）。
 */
export function computeFillScore(
  fillRateD20: number | null,
  expiryFillRate: number | null,
  avgFillDays: number | null,
): number {
  const d20 = fillRateD20 ?? 0
  const exp = expiryFillRate ?? 0
  const speed = avgFillDays == null ? 0 : Math.max(0, 1 - (avgFillDays - 1) / (FILL_MATURE_DAYS - 1))
  return Math.round((40 * d20 + 40 * exp + 20 * speed) * 10) / 10
}

/**
 * 核心回測：對每個除息事件，以除息前收盤為基準，
 * 往後 40 個交易日逐日判定收盤 ≥ 除息前收盤。
 */
export function analyzeExDividendEvents(
  bars: ExDividendPriceBar[],
  events: ExDividendEventInput[],
): ExDividendStats {
  const empty: ExDividendStats = {
    eventCount: 0,
    skippedCount: 0,
    insufficient: true,
    fillRateD1: null,
    fillRateD5: null,
    fillRateD10: null,
    fillRateD20: null,
    fillRateD40: null,
    expiryFillRate: null,
    maturedCount: 0,
    avgFillDays: null,
    maxUnfilledDrawdownPct: null,
    fillScore: null,
    events: [],
    yearsCovered: [],
  }
  const clean = (bars ?? [])
    .filter((b) => DATE_RE.test(b.date) && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  if (clean.length === 0) return empty

  const fills: ExDividendEventFill[] = []
  let skipped = 0
  const seen = new Set<string>()
  for (const e of events ?? []) {
    const exDate = (e.exDate ?? '').trim()
    if (!DATE_RE.test(exDate) || seen.has(exDate)) continue
    seen.add(exDate)
    // 除息前收盤＝exDate 前最後一根 bar；除息日索引＝首根 date ≥ exDate。
    let preClose: number | null = null
    let exIdx = -1
    for (let i = 0; i < clean.length; i++) {
      if (clean[i]!.date < exDate) preClose = clean[i]!.close
      else if (exIdx < 0) exIdx = i
    }
    if (preClose == null || preClose <= 0 || exIdx < 0) {
      skipped++
      continue
    }
    const window = clean.slice(exIdx, exIdx + FILL_MATURE_DAYS)
    if (window.length === 0) {
      skipped++
      continue
    }
    const cash = Number(e.cashDividend)
    let daysToFill: number | null = null
    let minClose = Number.POSITIVE_INFINITY
    window.forEach((b, k) => {
      if (b.close < minClose) minClose = b.close
      if (daysToFill == null && b.close >= preClose) daysToFill = k + 1
    })
    const matured = window.length >= FILL_MATURE_DAYS
    fills.push({
      exDate,
      preClose,
      cashDividend: Number.isFinite(cash) && cash > 0 ? cash : null,
      filled: daysToFill != null,
      daysToFill,
      hitD1: daysToFill != null && daysToFill <= 1,
      hitD5: daysToFill != null && daysToFill <= 5,
      hitD10: daysToFill != null && daysToFill <= 10,
      hitD20: daysToFill != null && daysToFill <= 20,
      hitD40: daysToFill != null && daysToFill <= 40,
      maxDrawdownPct: Math.round(((minClose / (preClose as number) - 1) * 100) * 100) / 100,
      matured,
    })
  }

  fills.sort((a, b) => (a.exDate < b.exDate ? -1 : 1))
  // 窗口可觀察＝往後 bars ≥ n；未滿窗但已達標者亦計入
  // （達標事實不受後續缺窗影響；未達標且未滿窗者不計入分母）。
  const countHit = (n: number): { hits: number; total: number } => {
    let hits = 0
    let total = 0
    for (const f of fills) {
      const winLen = windowLenOf(clean, f.exDate)
      if (winLen >= n || (f.daysToFill != null && f.daysToFill <= Math.min(n, winLen))) {
        total++
        if (f.daysToFill != null && f.daysToFill <= n) hits++
      }
    }
    return { hits, total }
  }
  const d1 = countHit(1)
  const d5 = countHit(5)
  const d10 = countHit(10)
  const d20 = countHit(20)
  const d40 = countHit(40)
  const matured = fills.filter((f) => f.matured)
  const filledMatured = matured.filter((f) => f.filled).length
  const filledAll = fills.filter((f) => f.daysToFill != null)
  const avgFillDays =
    filledAll.length > 0
      ? Math.round((filledAll.reduce((s, f) => s + (f.daysToFill as number), 0) / filledAll.length) * 100) / 100
      : null
  const unfilledMatured = matured.filter((f) => !f.filled)
  const maxUnfilled =
    unfilledMatured.length > 0 ? Math.min(...unfilledMatured.map((f) => f.maxDrawdownPct)) : null

  const rD20 = rate(d20.hits, d20.total)
  const rExp = matured.length > 0 ? filledMatured / matured.length : null
  const insufficient = fills.length < MIN_EVENTS_FOR_SCORE
  const yearsCovered = [...new Set(fills.map((f) => f.exDate.slice(0, 4)))].sort()

  return {
    eventCount: fills.length,
    skippedCount: skipped,
    insufficient,
    fillRateD1: insufficient ? null : rate(d1.hits, d1.total),
    fillRateD5: insufficient ? null : rate(d5.hits, d5.total),
    fillRateD10: insufficient ? null : rate(d10.hits, d10.total),
    fillRateD20: insufficient ? null : rD20,
    fillRateD40: insufficient ? null : rate(d40.hits, d40.total),
    expiryFillRate: insufficient ? null : rExp,
    maturedCount: matured.length,
    avgFillDays: insufficient ? null : avgFillDays,
    maxUnfilledDrawdownPct: insufficient ? null : maxUnfilled,
    fillScore: insufficient ? null : computeFillScore(rD20, rExp, avgFillDays),
    events: fills,
    yearsCovered,
  }
}

/** 該除息日往後 bars 根數（窗口可觀察性用）。 */
function windowLenOf(bars: ExDividendPriceBar[], exDate: string): number {
  let idx = -1
  for (let i = 0; i < bars.length; i++) {
    if (bars[i]!.date >= exDate) {
      idx = i
      break
    }
  }
  return idx < 0 ? 0 : bars.length - idx
}
