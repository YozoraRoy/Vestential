/**
 * Issue #120：除息現金流月曆純函式計算引擎（client-safe，零 Node/DB 依賴）。
 *
 * 適用稅制與費率年度：2026
 * - 二代健保補充保費：單次給付 >= NT$ 20,000 扣繳 2.11%（以單檔單次給付為單位）
 * - 股利可抵減稅額（合併計稅試算參考）：min(年度總股利 * 8.5%, NT$ 80,000)
 * - 實拿現金流＝稅前現金股利－二代健保補充保費（可抵減稅額單獨列示，不混入實拿）
 */

import { getTaxable54cRatio } from './etf-dividend-composition'

export const TAX_RULES_EFFECTIVE_YEAR = 2026
export const NHI_SUPPLEMENT_THRESHOLD = 20_000
export const NHI_SUPPLEMENT_RATE = 0.0211
export const DIVIDEND_TAX_CREDIT_RATE = 0.085
export const DIVIDEND_TAX_CREDIT_CAP = 80_000
export const DEFAULT_PAY_LAG_DAYS = 25

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
  /** 現金股利發放日 'YYYY-MM-DD' */
  pay_date?: string | null
}

export interface DividendCalendarEvent {
  symbol: string
  name: string | null
  exDate: string
  /** YYYY-MM（依 groupBy 決定為發放月或除息月） */
  monthKey: string
  /** 1..12 */
  month: number
  shares: number
  cashDividendPerShare: number
  /** 稅前現金股利（元，四捨五入至整數） */
  grossAmount: number
  /** 54C 股利所得佔比（0~1；個股為 1，ETF 依常態比例） */
  dividend54cRatio: number
  /** 預估 54C 應稅股利金額（元） */
  taxable54cAmount: number
  /** 二代健保補充保費（元；僅針對 54C 應稅額 >= 20,000 元扣 2.11%） */
  nhiFee: number
  /** 是否達二代健保起扣門檻 */
  nhiTriggered: boolean
  /** 稅後實拿（grossAmount - nhiFee） */
  netAmount: number
  /** 除息狀態：已除息 | 待除息 */
  exStatus: 'ex_passed' | 'upcoming'
  /** 發放日 'YYYY-MM-DD'（真實公告或依歷史間隔推估） */
  payDate: string | null
  /** 發放日狀態：已領息 | 待發放 | 待公告 */
  payStatus: 'paid' | 'scheduled' | 'pending_announcement'
  /** 發放日是否為參考去年／歷史間隔推估 */
  payEstimated?: boolean
  /** 是否為去年同期推估（非正式除息公告） */
  isEstimated?: boolean
  /** 推估來源年份 */
  sourceYear?: number
  /** 推估說明（例如「近3年同月均算」） */
  estimateLabel?: string
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

export interface ExcludedDividendHolding {
  symbol: string
  name: string | null
  shares: number
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
  /** 實際投入產生股利的總本金金額（僅計納入計算且該年度有配息之標的的 costBasis 總和） */
  totalInvestedCost: number
  /** 該年度有產生股利的標的檔數 */
  dividendGeneratingSymbolCount: number
  /** 依實際投入本金計算的稅後成本殖利率（%） */
  effectiveCostYieldPct: number | null
  /** 因不足 minShares 而被剔除的台股標的清單 */
  excludedHoldings: ExcludedDividendHolding[]
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

/** 股票分割還原對照表：若歷史除息日早於 splitDate，將當時每股配息除以 ratio 還原為分割後口徑 */
export const STOCK_SPLIT_ADJUSTMENTS: Record<string, Array<{ splitDate: string; ratio: number }>> = {
  '0050': [{ splitDate: '2025-06-18', ratio: 4 }],
}

export function adjustDividendForSplits(symbol: string, exDate: string, cashDividend: number): number {
  const splits = STOCK_SPLIT_ADJUSTMENTS[symbol.trim().toUpperCase()]
  if (!splits || splits.length === 0) return cashDividend
  let factor = 1
  for (const s of splits) {
    if (exDate < s.splitDate && s.ratio > 0) {
      factor *= s.ratio
    }
  }
  if (factor === 1) return cashDividend
  return Math.round((cashDividend / factor) * 10000) / 10000
}

function addCalendarDays(isoDate: string, days: number): string {
  const ts = Date.parse(`${isoDate}T00:00:00Z`)
  if (!Number.isFinite(ts)) return isoDate
  return new Date(ts + days * 86_400_000).toISOString().slice(0, 10)
}

/** 預估發放日若遇週六（+2）或週日（+1），自動順延至次一週一營業日 */
function shiftWeekendToMonday(isoDate: string): string {
  const ts = Date.parse(`${isoDate}T00:00:00Z`)
  if (!Number.isFinite(ts)) return isoDate
  const day = new Date(ts).getUTCDay()
  if (day === 6) return addCalendarDays(isoDate, 2)
  if (day === 0) return addCalendarDays(isoDate, 1)
  return isoDate
}

function diffCalendarDays(fromIso: string, toIso: string): number | null {
  const a = Date.parse(`${fromIso}T00:00:00Z`)
  const b = Date.parse(`${toIso}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  const diff = Math.round((b - a) / 86_400_000)
  return diff >= 0 && diff <= 180 ? diff : null
}

export type EstimateLookbackYears = 1 | 2 | 3

export function buildDividendCalendar(
  holdings: readonly CalendarHoldingInput[],
  dividends: readonly CalendarDividendInput[],
  options?: {
    today?: string
    year?: number
    allowEstimate?: boolean
    groupBy?: 'pay' | 'ex'
    minShares?: number
    estimateYears?: EstimateLookbackYears
  },
): DividendCalendarResult {
  const today = options?.today && DATE_RE.test(options.today)
    ? options.today
    : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
  const currentYear = Number(today.slice(0, 4))
  const year = options?.year ?? currentYear
  const allowEstimate = options?.allowEstimate !== false
  const groupBy = options?.groupBy ?? 'ex'
  const minShares = options?.minShares && options.minShares > 0 ? options.minShares : 0
  const estimateYears: EstimateLookbackYears =
    options?.estimateYears === 1 || options?.estimateYears === 2 || options?.estimateYears === 3
      ? options.estimateYears
      : 3
  const yearPrefix = `${year}-`

  // 聚合台股持股（同代號多筆合併股數；排除 shares <= 0 或美股）
  const rawHoldingMap = new Map<
    string,
    { symbol: string; name: string | null; shares: number; basis: number; costBasis: number }
  >()
  for (const h of holdings ?? []) {
    if (h.market === 'us') continue
    const sym = (h.symbol ?? '').trim().toUpperCase()
    const shares = Number(h.shares)
    if (!sym || !Number.isFinite(shares) || shares <= 0) continue
    const prev = rawHoldingMap.get(sym)
    const mv = Number(h.marketValue)
    const cb = Number(h.costBasis)
    const validCost = Number.isFinite(cb) && cb > 0 ? cb : 0
    const itemBasis = Number.isFinite(mv) && mv > 0 ? mv : validCost
    if (prev) {
      prev.shares += shares
      prev.basis += itemBasis
      prev.costBasis += validCost
      if (!prev.name && h.name) prev.name = h.name
    } else {
      rawHoldingMap.set(sym, {
        symbol: sym,
        name: h.name ?? null,
        shares,
        basis: itemBasis,
        costBasis: validCost,
      })
    }
  }

  // 依 minShares 剔除不足門檻之標的（如不足 1,000 股的零股）
  const holdingMap = new Map<
    string,
    { symbol: string; name: string | null; shares: number; basis: number; costBasis: number }
  >()
  const excludedHoldings: ExcludedDividendHolding[] = []
  for (const [sym, item] of rawHoldingMap.entries()) {
    if (minShares > 0 && item.shares < minShares) {
      excludedHoldings.push({ symbol: item.symbol, name: item.name, shares: item.shares })
    } else {
      holdingMap.set(sym, item)
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
      hasHoldings: rawHoldingMap.size > 0,
      eventCount: 0,
      isEstimatedYear: false,
      estimatedFromYear: null,
      totalGross: 0,
      totalNhiFee: 0,
      totalNet: 0,
      taxCredit: 0,
      effectiveNetYieldPct: null,
      totalInvestedCost: 0,
      dividendGeneratingSymbolCount: 0,
      effectiveCostYieldPct: null,
      excludedHoldings,
      months,
    }
  }

  const seenEvent = new Set<string>()
  const officialSymbolMonths = new Set<string>()
  const dividendGeneratingSymbols = new Set<string>()
  let totalGross = 0
  let totalTaxable54c = 0
  let totalNhiFee = 0
  let totalNet = 0
  let eventCount = 0
  let hasEstimatedEvents = false

  // 統計各標的歷史「除息日 → 發放日」平均間隔天數，供未來未公告發放日推估使用
  const lagSumBySym = new Map<string, { sum: number; count: number }>()
  for (const d of dividends ?? []) {
    const sym = (d.symbol ?? '').trim().toUpperCase()
    const ex = (d.ex_date ?? '').trim()
    const pay = (d.pay_date ?? '').trim()
    if (!sym || !DATE_RE.test(ex) || !DATE_RE.test(pay)) continue
    const diff = diffCalendarDays(ex, pay)
    if (diff == null) continue
    const prev = lagSumBySym.get(sym) ?? { sum: 0, count: 0 }
    prev.sum += diff
    prev.count += 1
    lagSumBySym.set(sym, prev)
  }

  const estimatePayDate = (sym: string, exDate: string): string => {
    const stat = lagSumBySym.get(sym)
    const lag = stat && stat.count > 0 ? Math.round(stat.sum / stat.count) : DEFAULT_PAY_LAG_DAYS
    return shiftWeekendToMonday(addCalendarDays(exDate, lag))
  }

  const pushEvent = (
    sym: string,
    exDate: string,
    cashDiv: number,
    rawPayDate: string | null | undefined,
    isEstimated: boolean,
    sourceYear?: number,
    estimateLabel?: string,
  ) => {
    const holding = holdingMap.get(sym)
    if (!holding) return
    const dedupeKey = `${sym}:${exDate}`
    if (seenEvent.has(dedupeKey)) return

    const hasRealPayDate = Boolean(rawPayDate && DATE_RE.test(rawPayDate.trim()))
    const resolvedPayDate = hasRealPayDate
      ? rawPayDate!.trim()
      : groupBy === 'pay' || isEstimated
        ? estimatePayDate(sym, exDate)
        : null

    const targetDate = groupBy === 'pay' ? resolvedPayDate ?? exDate : exDate
    if (!targetDate.startsWith(yearPrefix)) return

    seenEvent.add(dedupeKey)

    const grossAmount = Math.round(holding.shares * cashDiv)
    if (grossAmount <= 0) return

    const { ratio: dividend54cRatio } = getTaxable54cRatio(sym)
    const taxable54cAmount = Math.round(grossAmount * dividend54cRatio)
    const nhiFee = computeNhiSupplementFee(taxable54cAmount)
    const netAmount = grossAmount - nhiFee
    const month = Number(targetDate.slice(5, 7))
    if (month < 1 || month > 12) return

    const payStatus: DividendCalendarEvent['payStatus'] = resolvedPayDate
      ? resolvedPayDate <= today && !isEstimated
        ? 'paid'
        : 'scheduled'
      : 'pending_announcement'

    const event: DividendCalendarEvent = {
      symbol: sym,
      name: holding.name,
      exDate,
      monthKey: targetDate.slice(0, 7),
      month,
      shares: holding.shares,
      cashDividendPerShare: cashDiv,
      grossAmount,
      dividend54cRatio,
      taxable54cAmount,
      nhiFee,
      nhiTriggered: taxable54cAmount >= NHI_SUPPLEMENT_THRESHOLD,
      netAmount,
      exStatus: exDate <= today && !isEstimated ? 'ex_passed' : 'upcoming',
      payDate: resolvedPayDate,
      payStatus,
      ...(resolvedPayDate && !hasRealPayDate ? { payEstimated: true } : {}),
      ...(isEstimated ? { isEstimated: true, sourceYear, estimateLabel } : {}),
    }

    const bucket = months[month - 1]!
    bucket.events.push(event)
    bucket.totalGross += grossAmount
    bucket.totalNhiFee += nhiFee
    bucket.totalNet += netAmount

    totalGross += grossAmount
    totalTaxable54c += taxable54cAmount
    totalNhiFee += nhiFee
    totalNet += netAmount
    eventCount++
    dividendGeneratingSymbols.add(sym)
    if (isEstimated) hasEstimatedEvents = true
  }

  for (const d of dividends ?? []) {
    const sym = (d.symbol ?? '').trim().toUpperCase()
    const exDate = (d.ex_date ?? '').trim()
    const cashDiv = Number(d.cash_dividend)
    if (!sym || !DATE_RE.test(exDate)) continue
    if (!Number.isFinite(cashDiv) || cashDiv <= 0) continue
    const exYear = Number(exDate.slice(0, 4))
    if (groupBy === 'ex' && exYear !== year) continue
    if (groupBy === 'pay' && exYear !== year && exYear !== year - 1) continue
    const monthNum = Number(exDate.slice(5, 7))
    officialSymbolMonths.add(`${sym}:${exYear}:${monthNum}`)
    pushEvent(sym, exDate, cashDiv, d.pay_date, false)
  }

  // 近 N 年同月歷史均算預估（1 / 2 / 3 年）：對當年尚未公告的未來月份（如 2026-12）或明年全年，
  // 嚴格回看選定年數區間 [maxHistYear - estimateYears + 1, maxHistYear] 同月份歷史配息取平均值補齊
  const currentMonth = Number(today.slice(5, 7))
  const prevYear = year - 1
  if (allowEstimate && (year > currentYear || year === currentYear)) {
    const scanYears = groupBy === 'pay' && year > currentYear ? [year - 1, year] : [year]
    for (const targetExYear of scanYears) {
      const maxHistYear = Math.min(currentYear, targetExYear - 1)
      const minHistYear = maxHistYear - estimateYears + 1

      for (const sym of holdingMap.keys()) {
        for (let m = 1; m <= 12; m++) {
          if (officialSymbolMonths.has(`${sym}:${targetExYear}:${m}`)) continue
          if (targetExYear === currentYear && m < currentMonth) continue
          if (targetExYear < currentYear) continue

          const mmStr = String(m).padStart(2, '0')
          const samples: { exDate: string; cashDiv: number }[] = []
          for (const d of dividends ?? []) {
            const dSym = (d.symbol ?? '').trim().toUpperCase()
            const dDate = (d.ex_date ?? '').trim()
            const dDiv = Number(d.cash_dividend)
            if (dSym !== sym || !DATE_RE.test(dDate) || !Number.isFinite(dDiv) || dDiv <= 0) continue
            const dYear = Number(dDate.slice(0, 4))
            const dMonth = Number(dDate.slice(5, 7))
            if (dYear >= minHistYear && dYear <= maxHistYear && dMonth === m) {
              samples.push({ exDate: dDate, cashDiv: adjustDividendForSplits(sym, dDate, dDiv) })
            }
          }
          if (samples.length === 0) continue

          samples.sort((a, b) => (a.exDate < b.exDate ? 1 : -1))
          const avgDiv = Math.round((samples.reduce((s, x) => s + x.cashDiv, 0) / samples.length) * 1000) / 1000
          const latestSample = samples[0]!
          const dd = latestSample.exDate.slice(8, 10) === '29' && m === 2 ? '28' : latestSample.exDate.slice(8, 10)
          const latestSampleYear = Number(latestSample.exDate.slice(0, 4))
          const label = samples.length >= 2 ? `近${samples.length}年同月均算` : `依 ${latestSampleYear} 推估`
          pushEvent(sym, `${targetExYear}-${mmStr}-${dd}`, avgDiv, null, true, latestSampleYear, label)
        }
      }
    }
  }

  for (const m of months) {
    m.events.sort((a, b) => {
      const da = groupBy === 'pay' ? a.payDate ?? a.exDate : a.exDate
      const db = groupBy === 'pay' ? b.payDate ?? b.exDate : b.exDate
      return da < db ? -1 : da > db ? 1 : a.symbol.localeCompare(b.symbol)
    })
  }

  const totalBasis = [...holdingMap.values()].reduce((sum, h) => sum + h.basis, 0)
  const effectiveNetYieldPct =
    totalBasis > 0 && eventCount > 0
      ? Math.round((totalNet / totalBasis) * 10000) / 100
      : null

  let totalInvestedCostRaw = 0
  for (const sym of dividendGeneratingSymbols) {
    const h = holdingMap.get(sym)
    if (h) totalInvestedCostRaw += h.costBasis
  }
  const totalInvestedCost = Math.round(totalInvestedCostRaw)
  const dividendGeneratingSymbolCount = dividendGeneratingSymbols.size
  const effectiveCostYieldPct =
    totalInvestedCost > 0 && eventCount > 0
      ? Math.round((totalNet / totalInvestedCost) * 10000) / 100
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
    taxCredit: computeDividendTaxCredit(totalTaxable54c),
    effectiveNetYieldPct,
    totalInvestedCost,
    dividendGeneratingSymbolCount,
    effectiveCostYieldPct,
    excludedHoldings,
    months,
  }
}
