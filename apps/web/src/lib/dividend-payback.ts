/**
 * Issue #177：近 1 / 2 / 3 年滾動配息回本試算純計算引擎（client-safe，零 Node/DB 依賴）。
 *
 * - 時間窗口：滾動 12 個月（1Y）、24 個月÷2（2Y）、36 個月÷3（3Y）。
 * - 回本雙指標：
 *   1. 補平帳面虧損（剩餘虧損 ÷ 稅後年領股息）＋ 預估回本年份
 *   2. 零成本存股（剩餘投入成本 ÷ 稅後年領股息）＋ 預估零成本年份
 * - 支援選填「已累計領回股息」扣減，以及美股預扣稅率（30% / 15% / 0%）。
 */

export type DividendLookbackYears = 1 | 2 | 3

export interface RollingDividendRates {
  avg1y?: number | null
  avg2y?: number | null
  avg3y?: number | null
  /** 實際涵蓋年數（例如年輕 ETF 只有 1.5 年） */
  spanYears?: number | null
}

export interface DividendEventLike {
  ex_date: string
  cash_dividend: number
}

function addDaysIso(todayIso: string, deltaDays: number): string {
  const dt = new Date(`${todayIso}T00:00:00Z`)
  if (Number.isNaN(dt.getTime())) return todayIso
  dt.setUTCDate(dt.getUTCDate() + deltaDays)
  return dt.toISOString().slice(0, 10)
}

/** 由逐筆除息事件計算近 1 / 2 / 3 年滾動年均每股配息（台股 TWSE 真源用） */
export function computeRollingAvgDividendsFromEvents(
  events: DividendEventLike[],
  todayIso: string,
): RollingDividendRates | null {
  const today = /^\d{4}-\d{2}-\d{2}$/.test((todayIso ?? '').trim()) ? todayIso.trim() : null
  if (!today || !events || events.length === 0) return null

  const cut1y = addDaysIso(today, -365)
  const cut2y = addDaysIso(today, -730)
  const cut3y = addDaysIso(today, -1095)

  let sum1y = 0
  let sum2y = 0
  let sum3y = 0
  let earliest = today

  for (const e of events) {
    const ex = (e.ex_date ?? '').trim()
    const cash = Number(e.cash_dividend)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ex) || ex > today) continue
    if (!Number.isFinite(cash) || cash <= 0) continue

    if (ex < earliest) earliest = ex
    if (ex > cut1y) sum1y += cash
    if (ex > cut2y) sum2y += cash
    if (ex > cut3y) sum3y += cash
  }

  if (!(sum1y > 0) && !(sum3y > 0)) return null

  const msSpan = new Date(`${today}T00:00:00Z`).getTime() - new Date(`${earliest}T00:00:00Z`).getTime()
  const rawSpanYears = Math.max(0.25, Math.min(3, Math.round((msSpan / (365 * 86400 * 1000)) * 10) / 10))
  const round4 = (v: number) => Math.round(v * 10000) / 10000

  return {
    avg1y: sum1y > 0 ? round4(sum1y) : null,
    avg2y: sum2y > 0 ? round4(sum2y / Math.min(2, Math.max(1, rawSpanYears))) : null,
    avg3y: sum3y > 0 ? round4(sum3y / Math.min(3, Math.max(1, rawSpanYears))) : null,
    spanYears: rawSpanYears,
  }
}

export interface DividendPaybackInput {
  shares: number
  cost: number
  currentPrice: number
  /** 選定期間（1/2/3年）的稅前每股年均配息 */
  annualDivPerShare: number | null | undefined
  /** 預扣稅率（0 ~ 1，美股預設 0.3，台股為 0） */
  taxRate?: number
  /** 選填：已累計領回股息（總金額） */
  receivedDividendsSoFar?: number
  /** 基準年（預設當年） */
  currentYear?: number
}

export interface DividendPaybackResult {
  hasDividend: boolean
  annualDivPerShareGross: number | null
  annualDivPerShareNet: number | null
  annualTotalNet: number | null
  /** 帳面總虧損（不含已領息扣減，>0 表示目前套牢） */
  grossUnrealizedLoss: number
  /** 扣除已領息後，尚須靠領息補平的價差虧損 */
  remainingLossToRecover: number
  alreadyRecovered: boolean
  /** 補平帳面虧損所需年數（已回本時為 0；無配息為 null） */
  lossPaybackYears: number | null
  estimatedLossRecoveryYear: number | null
  /** 零成本存股尚需年數（拿回 100% 投入成本） */
  principalPaybackYears: number | null
  estimatedZeroCostYear: number | null
}

/** 計算靠領息「補平帳面虧損」與「零成本存股」所需年數與預估年份 */
export function computeDividendPayback(input: DividendPaybackInput): DividendPaybackResult {
  const shares = Math.max(0, Number(input.shares) || 0)
  const cost = Math.max(0, Number(input.cost) || 0)
  const price = Math.max(0, Number(input.currentPrice) || 0)
  const divGross = Number(input.annualDivPerShare)
  const taxRate = Math.min(1, Math.max(0, Number(input.taxRate) || 0))
  const received = Math.max(0, Number(input.receivedDividendsSoFar) || 0)
  const baseYear = Number.isFinite(input.currentYear) ? (input.currentYear as number) : new Date().getFullYear()

  const grossUnrealizedLoss = Math.max(0, (cost - price) * shares)
  const remainingLossToRecover = Math.max(0, grossUnrealizedLoss - received)
  const alreadyRecovered = shares > 0 && remainingLossToRecover <= 0

  if (!(shares > 0) || !Number.isFinite(divGross) || !(divGross > 0)) {
    return {
      hasDividend: false,
      annualDivPerShareGross: null,
      annualDivPerShareNet: null,
      annualTotalNet: null,
      grossUnrealizedLoss,
      remainingLossToRecover,
      alreadyRecovered,
      lossPaybackYears: null,
      estimatedLossRecoveryYear: null,
      principalPaybackYears: null,
      estimatedZeroCostYear: null,
    }
  }

  const annualDivPerShareNet = divGross * (1 - taxRate)
  const annualTotalNet = annualDivPerShareNet * shares

  if (!(annualTotalNet > 0)) {
    return {
      hasDividend: false,
      annualDivPerShareGross: divGross,
      annualDivPerShareNet: 0,
      annualTotalNet: 0,
      grossUnrealizedLoss,
      remainingLossToRecover,
      alreadyRecovered,
      lossPaybackYears: null,
      estimatedLossRecoveryYear: null,
      principalPaybackYears: null,
      estimatedZeroCostYear: null,
    }
  }

  const lossPaybackYears = alreadyRecovered ? 0 : Math.round((remainingLossToRecover / annualTotalNet) * 10) / 10
  const estimatedLossRecoveryYear = alreadyRecovered
    ? baseYear
    : baseYear + Math.ceil(remainingLossToRecover / annualTotalNet)

  const remainingPrincipal = Math.max(0, cost * shares - received)
  const principalPaybackYears = Math.round((remainingPrincipal / annualTotalNet) * 10) / 10
  const estimatedZeroCostYear =
    remainingPrincipal <= 0 ? baseYear : baseYear + Math.ceil(remainingPrincipal / annualTotalNet)

  return {
    hasDividend: true,
    annualDivPerShareGross: Math.round(divGross * 10000) / 10000,
    annualDivPerShareNet: Math.round(annualDivPerShareNet * 10000) / 10000,
    annualTotalNet: Math.round(annualTotalNet * 100) / 100,
    grossUnrealizedLoss,
    remainingLossToRecover,
    alreadyRecovered,
    lossPaybackYears,
    estimatedLossRecoveryYear,
    principalPaybackYears,
    estimatedZeroCostYear,
  }
}

/** 依選定年數 (1/2/3) 取得對應每股均息，缺值時安全降級 */
export function pickRateForWindow(
  rates: RollingDividendRates | null | undefined,
  years: DividendLookbackYears,
  fallbackSingleRate?: number | null,
): { rate: number | null; isPartialHistory: boolean } {
  if (!rates) {
    const fb = Number(fallbackSingleRate)
    return { rate: Number.isFinite(fb) && fb > 0 ? fb : null, isPartialHistory: false }
  }
  const span = Number(rates.spanYears ?? 0)
  let raw: number | null | undefined = null
  if (years === 1) raw = rates.avg1y
  else if (years === 2) raw = rates.avg2y ?? rates.avg1y
  else raw = rates.avg3y ?? rates.avg2y ?? rates.avg1y

  if (raw == null || !(Number(raw) > 0)) {
    const fb = Number(fallbackSingleRate)
    raw = Number.isFinite(fb) && fb > 0 ? fb : null
  }
  return {
    rate: raw != null && Number(raw) > 0 ? Number(raw) : null,
    isPartialHistory: years > 1 && span > 0 && span < years - 0.3,
  }
}
