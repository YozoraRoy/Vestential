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
  totalGross: number
  totalNhiFee: number
  totalNet: number
  /** 合併計稅情境可抵減稅額（單獨列示，不混入實拿） */
  taxCredit: number
  /** 實質稅後殖利率（%）；無成本或無現值基礎時為 null */
  effectiveNetYieldPct: number | null
  months: DividendCalendarMonth[]
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
  options?: { today?: string; year?: number },
): DividendCalendarResult {
  const today = options?.today && DATE_RE.test(options.today)
    ? options.today
    : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  const year = options?.year ?? Number(today.slice(0, 4))
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
      totalGross: 0,
      totalNhiFee: 0,
      totalNet: 0,
      taxCredit: 0,
      effectiveNetYieldPct: null,
      months,
    }
  }

  const seenEvent = new Set<string>()
  let totalGross = 0
  let totalNhiFee = 0
  let totalNet = 0
  let eventCount = 0

  for (const d of dividends ?? []) {
    const sym = (d.symbol ?? '').trim().toUpperCase()
    const exDate = (d.ex_date ?? '').trim()
    const cashDiv = Number(d.cash_dividend)
    if (!sym || !DATE_RE.test(exDate) || !exDate.startsWith(yearPrefix)) continue
    if (!Number.isFinite(cashDiv) || cashDiv <= 0) continue

    const holding = holdingMap.get(sym)
    if (!holding) continue

    const dedupeKey = `${sym}:${exDate}`
    if (seenEvent.has(dedupeKey)) continue
    seenEvent.add(dedupeKey)

    const grossAmount = Math.round(holding.shares * cashDiv)
    if (grossAmount <= 0) continue

    const nhiFee = computeNhiSupplementFee(grossAmount)
    const netAmount = grossAmount - nhiFee
    const month = Number(exDate.slice(5, 7))
    if (month < 1 || month > 12) continue

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
    totalGross,
    totalNhiFee,
    totalNet,
    taxCredit: computeDividendTaxCredit(totalGross),
    effectiveNetYieldPct,
    months,
  }
}
