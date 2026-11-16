/**
 * Issue #120：除息現金流月曆純函式計算引擎（client-safe，零 Node/DB 依賴）。
 *
 * 適用稅制與費率年度：2026
 * - 二代健保補充保費：單次給付 >= NT$ 20,000 扣繳 2.11%（以單檔單次給付為單位）
 * - 股利可抵減稅額（合併計稅試算參考）：min(年度總股利 * 8.5%, NT$ 80,000)
 * - 實拿現金流＝稅前現金股利－二代健保補充保費（可抵減稅額單獨列示，不混入實拿）
 */

export const TAX_RULES_EFFECTIVE_YEAR = 2026
export const NHI_SUPPLEMENT_THRESHOLD = 20_000
export const NHI_SUPPLEMENT_RATE = 0.0211
export const DIVIDEND_TAX_CREDIT_RATE = 0.085
export const DIVIDEND_TAX_CREDIT_CAP = 80_000

export interface CalendarHoldingInput {
  symbol: string
  name?: string | null
  shares: number
  market?: string | null
  costBasis?: number | null
  marketValue?: number | null
}

export interface CalendarDividendInput {
  symbol: string
  /** 'YYYY-MM-DD' */
  ex_date: string
  cash_dividend: number
  prev_close?: number | null
}

export interface DividendCalendarEvent {
  symbol: string
  name: string | null
  exDate: string
  /** YYYY-MM */
  monthKey: string
  /** 1..12 */
  month: number
  shares: number
  cashDividendPerShare: number
  /** 稅前現金股利（元，四捨五入至整數） */
  grossAmount: number
  /** 二代健保補充保費（元；單筆 >= 20,000 元扣 2.11%） */
  nhiFee: number
  /** 是否達二代健保起扣門檻 */
  nhiTriggered: boolean
  /** 稅後實拿（grossAmount - nhiFee） */
  netAmount: number
  /** 除息狀態：已除息 | 待除息 */
  exStatus: 'ex_passed' | 'upcoming'
  /** 發放日（Phase 1 不捏造日期，固定 null） */
  payDate: string | null
  /** 發放日狀態：待公告 */
  payStatus: 'pending_announcement'
  /** 是否為去年同期推估（非正式公告） */
  isEstimated?: boolean
  /** 推估來源年份 */
  sourceYear?: number
}

export interface DividendCalendarMonth {
  /** 1..12 */
  month: number
  /** YYYY-MM */
  monthKey: string
  totalGross: number
  totalNhiFee: number
  totalNet: number
  events: DividendCalendarEvent[]
}

export interface DividendCalendarResult {
  year: number
  today: string
  taxRulesYear: number
  hasHoldings: boolean
  eventCount: number
  isEstimatedYear: boolean
  estimatedFromYear: number | null
  totalGross: number
  totalNhiFee: number
  totalNet: number
  /** 合併計稅情境可抵減稅額（單獨列示，不混入實拿） */
  taxCredit: number
  /** 實質稅後殖利率（%）；無成本或無現值基礎時為 null */
  effectiveNetYieldPct: number | null
  months: DividendCalendarMonth[]
}

export interface HoldingNhiCheckResult {
  warn: boolean
  latestCashDividend: number
  estimatedGross: number
  estimatedFee: number
}

/**
 * 依真實配息紀錄判斷單檔持股是否達二代健保補充保費起扣門檻（>= 20,000 元）。
 * 不配息 ETF（如凱基台灣 TOP50）因無現金股利紀錄，即使持股 >= 25,000 股也不會誤報預警。
 */
export function shouldWarnNhiForHolding(
  symbol: string,
  shares: number,
  market: string | null | undefined,
  dividends: readonly CalendarDividendInput[],
): HoldingNhiCheckResult {
  if (market === 'us' || !Number.isFinite(shares) || shares <= 0) {
    return { warn: false, latestCashDividend: 0, estimatedGross: 0, estimatedFee: 0 }
  }
  const cleanSym = (symbol ?? '').trim().toUpperCase()
  if (!cleanSym) {
    return { warn: false, latestCashDividend: 0, estimatedGross: 0, estimatedFee: 0 }
  }

  let latestDate = ''
  let latestCashDividend = 0
  for (const d of dividends ?? []) {
    if ((d.symbol ?? '').trim().toUpperCase() !== cleanSym) continue
    const amt = Number(d.cash_dividend)
    const exDate = (d.ex_date ?? '').trim()
    if (!Number.isFinite(amt) || amt <= 0 || !exDate) continue
    if (exDate > latestDate) {
      latestDate = exDate
      latestCashDividend = amt
    }
  }

  if (latestCashDividend <= 0) {
    return { warn: false, latestCashDividend: 0, estimatedGross: 0, estimatedFee: 0 }
  }
  const estimatedGross = Math.round(shares * latestCashDividend)
  const estimatedFee = computeNhiSupplementFee(estimatedGross)
  return {
    warn: estimatedGross >= NHI_SUPPLEMENT_THRESHOLD,
    latestCashDividend,
    estimatedGross,
    estimatedFee,
  }
}

/**
 * 計算單筆給付的二代健保補充保費。
 * 邊界：19,999 -> 0；20,000 -> Math.round(20000 * 0.0211) = 422。
 */
export function computeNhiSupplementFee(grossAmount: number): number {
  if (!Number.isFinite(grossAmount) || grossAmount < NHI_SUPPLEMENT_THRESHOLD) {
    return 0
  }
  return Math.round(grossAmount * NHI_SUPPLEMENT_RATE)
}

/**
 * 計算股利可抵減稅額（合併計稅試算參考）：min(總股利 * 8.5%, 80,000)。
 */
export function computeDividendTaxCredit(totalGrossDividends: number): number {
  if (!Number.isFinite(totalGrossDividends) || totalGrossDividends <= 0) {
    return 0
  }
  return Math.min(Math.round(totalGrossDividends * DIVIDEND_TAX_CREDIT_RATE), DIVIDEND_TAX_CREDIT_CAP)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function buildDividendCalendar(
  holdings: readonly CalendarHoldingInput[],
  dividends: readonly CalendarDividendInput[],
  options?: { today?: string; year?: number; allowEstimate?: boolean },
): DividendCalendarResult {
  const today = options?.today && DATE_RE.test(options.today)
    ? options.today
    : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  const currentYear = Number(today.slice(0, 4))
  const year = options?.year ?? currentYear
  const allowEstimate = options?.allowEstimate !== false
  const yearPrefix = `${year}-`

  // 聚合台股持股（同代號多筆合併股數；排除 shares <= 0 或美股）
  const holdingMap = new Map<
    string,
    { symbol: string; name: string | null; shares: number; basis: number }
  >()
  for (const h of holdings ?? []) {
    if (h.market === 'us') continue
    const sym = (h.symbol ?? '').trim().toUpperCase()
    const shares = Number(h.shares)
    if (!sym || !Number.isFinite(shares) || shares <= 0) continue
    const prev = holdingMap.get(sym)
    const mv = Number(h.marketValue)
    const cb = Number(h.costBasis)
    const itemBasis = Number.isFinite(mv) && mv > 0 ? mv : Number.isFinite(cb) && cb > 0 ? cb : 0
    if (prev) {
      prev.shares += shares
      prev.basis += itemBasis
      if (!prev.name && h.name) prev.name = h.name
    } else {
      holdingMap.set(sym, {
        symbol: sym,
        name: h.name ?? null,
        shares,
        basis: itemBasis,
      })
    }
  }

  const months: DividendCalendarMonth[] = Array.from({ length: 12 }, (_, idx) => {
    const m = idx + 1
    return {
      month: m,
      monthKey: `${year}-${String(m).padStart(2, '0')}`,
      totalGross: 0,
      totalNhiFee: 0,
      totalNet: 0,
      events: [],
    }
  })

  if (holdingMap.size === 0) {
    return {
      year,
      today,
      taxRulesYear: TAX_RULES_EFFECTIVE_YEAR,
      hasHoldings: false,
      eventCount: 0,
      isEstimatedYear: false,
      estimatedFromYear: null,
      totalGross: 0,
      totalNhiFee: 0,
      totalNet: 0,
      taxCredit: 0,
      effectiveNetYieldPct: null,
      months,
    }
  }

  const seenEvent = new Set<string>()
  const officialSymbols = new Set<string>()
  let totalGross = 0
  let totalNhiFee = 0
  let totalNet = 0
  let eventCount = 0
  let hasEstimatedEvents = false

  const pushEvent = (sym: string, exDate: string, cashDiv: number, isEstimated: boolean, sourceYear?: number) => {
    const holding = holdingMap.get(sym)
    if (!holding) return
    const dedupeKey = `${sym}:${exDate}`
    if (seenEvent.has(dedupeKey)) return
    seenEvent.add(dedupeKey)

    const grossAmount = Math.round(holding.shares * cashDiv)
    if (grossAmount <= 0) return

    const nhiFee = computeNhiSupplementFee(grossAmount)
    const netAmount = grossAmount - nhiFee
    const month = Number(exDate.slice(5, 7))
    if (month < 1 || month > 12) return

    const event: DividendCalendarEvent = {
      symbol: sym,
      name: holding.name,
      exDate,
      monthKey: exDate.slice(0, 7),
      month,
      shares: holding.shares,
      cashDividendPerShare: cashDiv,
      grossAmount,
      nhiFee,
      nhiTriggered: grossAmount >= NHI_SUPPLEMENT_THRESHOLD,
      netAmount,
      exStatus: exDate <= today ? 'ex_passed' : 'upcoming',
      payDate: null,
      payStatus: 'pending_announcement',
      ...(isEstimated ? { isEstimated: true, sourceYear } : {}),
    }

    const bucket = months[month - 1]!
    bucket.events.push(event)
    bucket.totalGross += grossAmount
    bucket.totalNhiFee += nhiFee
    bucket.totalNet += netAmount

    totalGross += grossAmount
    totalNhiFee += nhiFee
    totalNet += netAmount
    eventCount++
    if (isEstimated) hasEstimatedEvents = true
  }

  for (const d of dividends ?? []) {
    const sym = (d.symbol ?? '').trim().toUpperCase()
    const exDate = (d.ex_date ?? '').trim()
    const cashDiv = Number(d.cash_dividend)
    if (!sym || !DATE_RE.test(exDate) || !exDate.startsWith(yearPrefix)) continue
    if (!Number.isFinite(cashDiv) || cashDiv <= 0) continue
    officialSymbols.add(sym)
    pushEvent(sym, exDate, cashDiv, false)
  }

  // 方案 B：若檢視未來年度（如 2027）且該標的尚無正式公告，將去年（year - 1）同月除息事件平移推估預覽
  const prevYear = year - 1
  if (allowEstimate && year > currentYear) {
    const prevPrefix = `${prevYear}-`
    for (const d of dividends ?? []) {
      const sym = (d.symbol ?? '').trim().toUpperCase()
      const exDate = (d.ex_date ?? '').trim()
      const cashDiv = Number(d.cash_dividend)
      if (!sym || officialSymbols.has(sym)) continue
      if (!DATE_RE.test(exDate) || !exDate.startsWith(prevPrefix)) continue
      if (!Number.isFinite(cashDiv) || cashDiv <= 0) continue
      const mmdd = exDate.slice(5) === '02-29' ? '02-28' : exDate.slice(5)
      pushEvent(sym, `${year}-${mmdd}`, cashDiv, true, prevYear)
    }
  }

  for (const m of months) {
    m.events.sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : a.symbol.localeCompare(b.symbol)))
  }

  const totalBasis = [...holdingMap.values()].reduce((sum, h) => sum + h.basis, 0)
  const effectiveNetYieldPct =
    totalBasis > 0 && eventCount > 0
      ? Math.round((totalNet / totalBasis) * 10000) / 100
      : null

  return {
    year,
    today,
    taxRulesYear: TAX_RULES_EFFECTIVE_YEAR,
    hasHoldings: true,
    eventCount,
    isEstimatedYear: hasEstimatedEvents,
    estimatedFromYear: hasEstimatedEvents ? prevYear : null,
    totalGross,
    totalNhiFee,
    totalNet,
    taxCredit: computeDividendTaxCredit(totalGross),
    effectiveNetYieldPct,
    months,
  }
}
