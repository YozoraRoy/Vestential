/**
 * Issue #174：美股個人損益試算純計算引擎（零 LLM、零 Node/DB 依賴，client-safe）。
 *
 * 涵蓋：
 * - 券商手續費模型：海外券商（0%／低消 $0）vs. 台灣複委託（預設 0.15%／低消 US$15，支援自訂）。
 * - 股息預扣稅試算：依每股年配息（或殖利率推算）× 股數，支援 30%（美股/美系ETF）、15%（愛爾蘭ETF）、0%。
 * - USD/TWD 匯率折算與匯差拆解（當提供買入平均匯率時，拆解股價價差 vs. 匯率損益）。
 * - 互動式試算：加碼攤平試算（支援依股數或金額）與賣出試算。
 */

export type UsBrokerMode = 'overseas' | 'subbrokerage'
export type UsDividendTaxRate = 0.3 | 0.15 | 0

export interface UsBrokerConfig {
  mode: UsBrokerMode
  /** 手續費率（小數，例如 0.0015 代表 0.15%） */
  feeRate: number
  /** 單筆最低手續費（USD） */
  minFeeUsd: number
  /** 股息預扣稅率（0.3 / 0.15 / 0） */
  dividendTaxRate: number
}

export const DEFAULT_OVERSEAS_CONFIG: UsBrokerConfig = {
  mode: 'overseas',
  feeRate: 0,
  minFeeUsd: 0,
  dividendTaxRate: 0.3,
}

export const DEFAULT_SUBBROKERAGE_CONFIG: UsBrokerConfig = {
  mode: 'subbrokerage',
  feeRate: 0.0015,
  minFeeUsd: 15,
  dividendTaxRate: 0.3,
}

function numOrZero(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : 0
}

function posOrNull(n: unknown): number | null {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? v : null
}

/** 計算單筆美股交易手續費（USD） */
export function computeUsTradeFee(grossUsd: number, config: Pick<UsBrokerConfig, 'mode' | 'feeRate' | 'minFeeUsd'>): number {
  const gross = Math.max(0, numOrZero(grossUsd))
  if (gross <= 0 || config.mode === 'overseas') return 0
  const rate = Math.max(0, numOrZero(config.feeRate))
  const minFee = Math.max(0, numOrZero(config.minFeeUsd))
  const raw = gross * rate
  return Math.round(Math.max(raw, minFee) * 100) / 100
}

export interface UsPositionNetInput {
  shares: number
  cost: number
  currentPrice: number
  /** 每股年配息（USD，Yahoo dividendRate） */
  dividendRate?: number | null
  /** 殖利率百分比（例如 1.5 代表 1.5%，dividendRate 缺值時作為備援） */
  dividendYieldPct?: number | null
  config: UsBrokerConfig
  /** 即時 USD/TWD 匯率；null 表示無法換算台幣（UI 顯示 —） */
  fxRate?: number | null
}

export interface UsPositionMetrics {
  shares: number
  costBasisUsd: number
  marketValueUsd: number
  grossPnlUsd: number
  grossPnlPct: number
  /** 預估買入＋賣出總手續費（USD） */
  estimatedFeesUsd: number
  netPnlUsd: number
  netPnlPct: number
  /** 折合台幣市值（缺匯率時為 null） */
  marketValueTwd: number | null
  /** 折合台幣淨損益（缺匯率時為 null） */
  netPnlTwd: number | null
  /** 預估年配息（稅前 USD）；無配息資料時為 null */
  annualDividendGrossUsd: number | null
  /** 預估年配息（扣預扣稅後 USD） */
  annualDividendNetUsd: number | null
  /** 預估年配息（扣稅後折合台幣） */
  annualDividendNetTwd: number | null
}

/** 計算單一美股持倉的含費淨損益、匯率折算與稅後年配息 */
export function computeUsPositionMetrics(input: UsPositionNetInput): UsPositionMetrics {
  const shares = Math.max(0, numOrZero(input.shares))
  const cost = Math.max(0, numOrZero(input.cost))
  const price = Math.max(0, numOrZero(input.currentPrice))

  const costBasisUsd = shares * cost
  const marketValueUsd = shares * price
  const grossPnlUsd = marketValueUsd - costBasisUsd
  const grossPnlPct = costBasisUsd > 0 ? (grossPnlUsd / costBasisUsd) * 100 : 0

  const buyFee = shares > 0 && cost > 0 ? computeUsTradeFee(costBasisUsd, input.config) : 0
  const sellFee = shares > 0 && price > 0 ? computeUsTradeFee(marketValueUsd, input.config) : 0
  const estimatedFeesUsd = Math.round((buyFee + sellFee) * 100) / 100

  const netPnlUsd = grossPnlUsd - estimatedFeesUsd
  const effectiveCost = costBasisUsd + buyFee
  const netPnlPct = effectiveCost > 0 ? (netPnlUsd / effectiveCost) * 100 : 0

  const fx = posOrNull(input.fxRate)
  const marketValueTwd = fx != null ? Math.round(marketValueUsd * fx) : null
  const netPnlTwd = fx != null ? Math.round(netPnlUsd * fx) : null

  const divRate = posOrNull(input.dividendRate)
  const divYieldPct = posOrNull(input.dividendYieldPct)
  let annualDividendGrossUsd: number | null = null
  if (shares > 0) {
    if (divRate != null) {
      annualDividendGrossUsd = Math.round(shares * divRate * 100) / 100
    } else if (divYieldPct != null && price > 0) {
      annualDividendGrossUsd = Math.round(marketValueUsd * (divYieldPct / 100) * 100) / 100
    }
  }

  const taxRate = Math.min(1, Math.max(0, numOrZero(input.config.dividendTaxRate)))
  const annualDividendNetUsd =
    annualDividendGrossUsd != null
      ? Math.round(annualDividendGrossUsd * (1 - taxRate) * 100) / 100
      : null
  const annualDividendNetTwd =
    annualDividendNetUsd != null && fx != null ? Math.round(annualDividendNetUsd * fx) : null

  return {
    shares,
    costBasisUsd,
    marketValueUsd,
    grossPnlUsd,
    grossPnlPct,
    estimatedFeesUsd,
    netPnlUsd,
    netPnlPct,
    marketValueTwd,
    netPnlTwd,
    annualDividendGrossUsd,
    annualDividendNetUsd,
    annualDividendNetTwd,
  }
}

export interface UsFxBreakdown {
  costBasisTwd: number
  marketValueTwd: number
  totalPnlTwd: number
  totalPnlTwdPct: number
  /** 股價價差貢獻（以現時匯率換算之原幣價差） */
  pricePnlTwd: number
  /** 匯率變動貢獻（總台幣損益 − 股價價差貢獻） */
  fxPnlTwd: number
}

/** 拆解美股「股價價差損益」與「匯率損益」（TWD） */
export function computeUsFxBreakdown(input: {
  costBasisUsd: number
  marketValueUsd: number
  buyFxRate: number
  currentFxRate: number
}): UsFxBreakdown | null {
  const buyFx = posOrNull(input.buyFxRate)
  const curFx = posOrNull(input.currentFxRate)
  const costUsd = Math.max(0, numOrZero(input.costBasisUsd))
  const mvUsd = Math.max(0, numOrZero(input.marketValueUsd))
  if (buyFx == null || curFx == null || costUsd <= 0) return null

  const costBasisTwd = costUsd * buyFx
  const marketValueTwd = mvUsd * curFx
  const totalPnlTwd = marketValueTwd - costBasisTwd
  const totalPnlTwdPct = (totalPnlTwd / costBasisTwd) * 100
  const pricePnlTwd = (mvUsd - costUsd) * curFx
  const fxPnlTwd = totalPnlTwd - pricePnlTwd

  return {
    costBasisTwd: Math.round(costBasisTwd),
    marketValueTwd: Math.round(marketValueTwd),
    totalPnlTwd: Math.round(totalPnlTwd),
    totalPnlTwdPct,
    pricePnlTwd: Math.round(pricePnlTwd),
    fxPnlTwd: Math.round(fxPnlTwd),
  }
}

export interface AverageDownInput {
  existingShares: number
  existingAvgCost: number
  addShares: number
  addPrice: number
  config: UsBrokerConfig
  fxRate?: number | null
}

export interface AverageDownResult {
  newTotalShares: number
  addGrossUsd: number
  addFeeUsd: number
  addTotalOutlayUsd: number
  addTotalOutlayTwd: number | null
  newAvgCostUsd: number
  /** 均價變化百分比（負數代表攤平降低，例如 -12.5 表示均價下降 12.5%） */
  avgCostChangePct: number
  /** 從目前加碼價漲回新均價所需的漲幅（%）；已低於現價回傳 0 */
  breakevenRallyPct: number
}

/** 加碼攤平試算（含買入手續費分攤進新均價） */
export function simulateUsAverageDown(input: AverageDownInput): AverageDownResult {
  const curShares = Math.max(0, numOrZero(input.existingShares))
  const curCost = Math.max(0, numOrZero(input.existingAvgCost))
  const addShares = Math.max(0, numOrZero(input.addShares))
  const addPrice = Math.max(0, numOrZero(input.addPrice))

  const addGrossUsd = addShares * addPrice
  const addFeeUsd = addGrossUsd > 0 ? computeUsTradeFee(addGrossUsd, input.config) : 0
  const addTotalOutlayUsd = addGrossUsd + addFeeUsd

  const fx = posOrNull(input.fxRate)
  const addTotalOutlayTwd = fx != null ? Math.round(addTotalOutlayUsd * fx) : null

  const newTotalShares = curShares + addShares
  const oldTotalCost = curShares * curCost
  const newAvgCostUsd = newTotalShares > 0 ? (oldTotalCost + addTotalOutlayUsd) / newTotalShares : 0

  const avgCostChangePct = curCost > 0 && newTotalShares > 0 ? ((newAvgCostUsd - curCost) / curCost) * 100 : 0
  const breakevenRallyPct =
    addPrice > 0 && newAvgCostUsd > addPrice ? ((newAvgCostUsd - addPrice) / addPrice) * 100 : 0

  return {
    newTotalShares,
    addGrossUsd,
    addFeeUsd,
    addTotalOutlayUsd,
    addTotalOutlayTwd,
    newAvgCostUsd,
    avgCostChangePct,
    breakevenRallyPct,
  }
}

export interface SellSimulationInput {
  existingShares: number
  avgCost: number
  sellShares: number
  sellPrice: number
  config: UsBrokerConfig
  fxRate?: number | null
}

export interface SellSimulationResult {
  valid: boolean
  sellGrossUsd: number
  sellFeeUsd: number
  netProceedsUsd: number
  netProceedsTwd: number | null
  realizedPnlUsd: number
  realizedPnlPct: number
  remainingShares: number
}

/** 賣出損益試算 */
export function simulateUsSell(input: SellSimulationInput): SellSimulationResult {
  const existing = Math.max(0, numOrZero(input.existingShares))
  const avgCost = Math.max(0, numOrZero(input.avgCost))
  const sellShares = Math.max(0, numOrZero(input.sellShares))
  const sellPrice = Math.max(0, numOrZero(input.sellPrice))

  const valid = sellShares > 0 && sellShares <= existing && sellPrice > 0
  const sellGrossUsd = sellShares * sellPrice
  const sellFeeUsd = valid ? computeUsTradeFee(sellGrossUsd, input.config) : 0
  const netProceedsUsd = Math.max(0, sellGrossUsd - sellFeeUsd)
  const fx = posOrNull(input.fxRate)
  const netProceedsTwd = fx != null ? Math.round(netProceedsUsd * fx) : null

  const costPart = sellShares * avgCost
  const realizedPnlUsd = valid ? netProceedsUsd - costPart : 0
  const realizedPnlPct = valid && costPart > 0 ? (realizedPnlUsd / costPart) * 100 : 0

  return {
    valid,
    sellGrossUsd,
    sellFeeUsd,
    netProceedsUsd,
    netProceedsTwd,
    realizedPnlUsd,
    realizedPnlPct,
    remainingShares: Math.max(0, existing - sellShares),
  }
}

export interface UsPortfolioSummary {
  holdingCount: number
  totalCostUsd: number
  totalMarketValueUsd: number
  totalGrossPnlUsd: number
  totalEstimatedFeesUsd: number
  totalNetPnlUsd: number
  totalNetPnlPct: number
  totalMarketValueTwd: number | null
  totalNetPnlTwd: number | null
  totalAnnualDividendNetUsd: number
  totalAnnualDividendNetTwd: number | null
}

/** 匯總所有美股持倉的總成本、淨損益、折合台幣與預估稅後年配息 */
export function summarizeUsPortfolio(items: UsPositionMetrics[], fxRate?: number | null): UsPortfolioSummary {
  let totalCostUsd = 0
  let totalMarketValueUsd = 0
  let totalGrossPnlUsd = 0
  let totalEstimatedFeesUsd = 0
  let totalNetPnlUsd = 0
  let totalAnnualDividendNetUsd = 0

  for (const m of items) {
    totalCostUsd += m.costBasisUsd
    totalMarketValueUsd += m.marketValueUsd
    totalGrossPnlUsd += m.grossPnlUsd
    totalEstimatedFeesUsd += m.estimatedFeesUsd
    totalNetPnlUsd += m.netPnlUsd
    totalAnnualDividendNetUsd += m.annualDividendNetUsd ?? 0
  }

  const fx = posOrNull(fxRate)
  const totalNetPnlPct = totalCostUsd > 0 ? (totalNetPnlUsd / totalCostUsd) * 100 : 0

  return {
    holdingCount: items.length,
    totalCostUsd,
    totalMarketValueUsd,
    totalGrossPnlUsd,
    totalEstimatedFeesUsd,
    totalNetPnlUsd,
    totalNetPnlPct,
    totalMarketValueTwd: fx != null ? Math.round(totalMarketValueUsd * fx) : null,
    totalNetPnlTwd: fx != null ? Math.round(totalNetPnlUsd * fx) : null,
    totalAnnualDividendNetUsd: Math.round(totalAnnualDividendNetUsd * 100) / 100,
    totalAnnualDividendNetTwd: fx != null ? Math.round(totalAnnualDividendNetUsd * fx) : null,
  }
}
