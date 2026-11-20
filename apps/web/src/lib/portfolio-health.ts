/**
 * Issue #173：/portfolio 基本面健檢與續抱評估 — 純計算引擎（零 LLM、零 Node/DB 依賴）。
 *
 * 設計原則：
 * 1. 個股（一般企業）、金融業個股、ETF 三軌嚴格分流，絕不把 PE/ROE/流動比硬套到 ETF 或金融股。
 * 2. 缺值三態處理：Yahoo / TWSE 未提供之欄位顯示為 null（UI 呈現 `—`），不硬填 0、不計入扣分；
 *    有效可評估指標過少時標示 `insufficient`（資料不足），不硬給紅綠燈。
 * 3. 合規邊界：只呈現客觀體檢狀態標籤與事實檢核清單，不下前瞻買賣／加碼／停損指令。
 * 4. 組合匯總依台／美股分幣別計算市值加權健康比例，所有除法皆有零守衛。
 */

import { isEtfSymbol } from './portfolio-net'
import { CORE_ETF_DIVIDEND_COMPOSITIONS } from './etf-dividend-composition'
import { CORE_ETF_HOLDINGS_MAP } from './etf-holdings-radar'

export type HealthMarket = 'tw' | 'us'
export type AssetCategory = 'equity' | 'financial' | 'etf'
export type CheckStatus = 'pass' | 'neutral' | 'warn' | 'na'
export type HealthVerdict = 'discount_healthy' | 'healthy' | 'watch' | 'warning' | 'insufficient'

export interface MetricCheck {
  key: string
  label: string
  value: number | null
  formatted: string
  threshold: string
  status: CheckStatus
  note?: string
}

export interface DimensionResult {
  key: 'profitability' | 'financialSafety' | 'valuation' | 'shareholderReturn'
  label: string
  status: CheckStatus
  score: number | null
  metrics: MetricCheck[]
}

export interface FundamentalsInput {
  peRatio?: number
  forwardPe?: number
  priceToBook?: number
  pegRatio?: number
  eps?: number
  dividendYield?: number
  trailingAnnualDividendYield?: number
  payoutRatio?: number
  returnOnEquity?: number
  operatingMargins?: number
  grossMargins?: number
  profitMargins?: number
  revenueGrowth?: number
  earningsGrowth?: number
  debtToEquity?: number
  currentRatio?: number
  freeCashflow?: number
  operatingCashflow?: number
  fiftyTwoWeekHigh?: number
  fiftyTwoWeekLow?: number
  currentPrice?: number
  quoteType?: string
  sector?: string
  industry?: string
}

export interface HoldingHealthInput {
  market: HealthMarket
  symbol: string
  symbolName?: string | null
  shares: number
  cost: number
  currentPrice: number
  marketValue: number
  unrealizedPnlPct: number
  /** 由外部解析好的產業別（Yahoo / TWSE / fallback） */
  sector?: string | null
  /** 台股 TWSE 真源 5 年平均殖利率（％，例如 5.2 代表 5.2%） */
  twseAvgYield5y?: number | null
  /** 台股 TWSE 近 5 年有配息的年份數（0~5） */
  twseDividendYears5y?: number | null
  fundamentals?: FundamentalsInput | null
}

export interface HoldingHealthResult {
  market: HealthMarket
  symbol: string
  symbolName: string | null
  assetCategory: AssetCategory
  sector: string | null
  shares: number
  cost: number
  currentPrice: number
  marketValue: number
  unrealizedPnlPct: number
  /** 距 52 週高點回撤％（負數代表下跌幅度，例如 -22.5） */
  drawdownFrom52wHighPct: number | null
  /** 綜合體質分數（0~100；資料不足時為 null） */
  healthScore: number | null
  verdict: HealthVerdict
  /** 一句事實導向的體檢摘要（繁體中文、無前瞻買賣指示） */
  summary: string
  dimensions: {
    profitability: DimensionResult
    financialSafety: DimensionResult
    valuation: DimensionResult
    shareholderReturn: DimensionResult
  }
  /** 表格快覽用關鍵數值 */
  highlights: {
    pe: number | null
    pb: number | null
    roePct: number | null
    fcfPositive: boolean | null
    dividendYieldPct: number | null
  }
  /** 已評估的有效指標數 */
  evaluatedMetricCount: number
}

export interface MarketHealthSummary {
  market: HealthMarket
  holdingCount: number
  totalMarketValue: number
  /** 市值加權：體質健全（含折價＋合理）佔該市場總市值百分比 */
  healthyValuePct: number
  /** 市值加權：體質警戒佔比 */
  warningValuePct: number
  counts: {
    discount_healthy: number
    healthy: number
    watch: number
    warning: number
    insufficient: number
  }
}

export interface PortfolioHealthReport {
  asOf: string
  holdings: HoldingHealthResult[]
  summaryByMarket: {
    tw: MarketHealthSummary
    us: MarketHealthSummary
  }
  overallCounts: {
    total: number
    discount_healthy: number
    healthy: number
    watch: number
    warning: number
    insufficient: number
  }
}

function finite(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function normalizeSymbol(symbol: string): string {
  return (symbol ?? '').trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
}

/** 判斷標的分類：ETF / 金融業 / 一般企業 */
export function classifyAssetCategory(input: {
  symbol: string
  market: HealthMarket
  quoteType?: string | null
  sector?: string | null
  industry?: string | null
}): AssetCategory {
  const qt = (input.quoteType ?? '').trim().toUpperCase()
  if (qt === 'ETF' || isEtfSymbol(input.symbol)) {
    return 'etf'
  }
  const sec = `${input.sector ?? ''} ${input.industry ?? ''}`
  if (/金融|銀行|保險|證券|Financial|Bank|Insurance|Capital Markets/i.test(sec)) {
    return 'financial'
  }
  const clean = normalizeSymbol(input.symbol)
  if (input.market === 'tw' && /^(28\d{2}|58\d{2}|60\d{2})$/.test(clean)) {
    return 'financial'
  }
  return 'equity'
}

function fmtPct(v: number | null, digits = 1): string {
  if (v == null) return '—'
  return `${v.toFixed(digits)}%`
}

function fmtNum(v: number | null, digits = 1, suffix = ''): string {
  if (v == null) return '—'
  return `${v.toFixed(digits)}${suffix}`
}

function fmtCompactMoney(v: number | null): string {
  if (v == null) return '—'
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`
  return `${sign}${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function statusToScore(status: CheckStatus): number | null {
  switch (status) {
    case 'pass': return 100
    case 'neutral': return 60
    case 'warn': return 20
    case 'na': return null
  }
}

function aggregateDimension(
  key: DimensionResult['key'],
  label: string,
  metrics: MetricCheck[],
): DimensionResult {
  const scored = metrics
    .map((m) => statusToScore(m.status))
    .filter((s): s is number => s != null)

  if (scored.length === 0) {
    return { key, label, status: 'na', score: null, metrics }
  }
  const avg = Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)
  const status: CheckStatus = avg >= 75 ? 'pass' : avg >= 45 ? 'neutral' : 'warn'
  return { key, label, status, score: avg, metrics }
}

/** 計算距 52 週高點回撤百分比（負數表示低於高點） */
export function computeDrawdownFrom52wHigh(
  currentPrice: number | null,
  high52: number | null,
): number | null {
  if (currentPrice == null || high52 == null || !(high52 > 0) || !(currentPrice > 0)) return null
  const dd = ((currentPrice - high52) / high52) * 100
  return Math.min(0, Math.round(dd * 10) / 10)
}

function resolveYieldPct(input: HoldingHealthInput): { value: number | null; source: string } {
  if (input.market === 'tw' && finite(input.twseAvgYield5y) != null) {
    return { value: input.twseAvgYield5y as number, source: 'TWSE 5年均' }
  }
  const f = input.fundamentals
  const raw = finite(f?.dividendYield) ?? finite(f?.trailingAnnualDividendYield)
  if (raw != null && raw >= 0) {
    // Yahoo summaryDetail.dividendYield 為小數（如 0.032 = 3.2%），防禦異常值 > 1
    const pct = raw > 1 ? raw : raw * 100
    return { value: Math.round(pct * 100) / 100, source: 'Yahoo' }
  }
  return { value: null, source: '' }
}

/** 評估一般企業個股 */
function evaluateEquity(
  input: HoldingHealthInput,
  drawdown52w: number | null,
): Omit<HoldingHealthResult, 'market' | 'symbol' | 'symbolName' | 'assetCategory' | 'sector' | 'shares' | 'cost' | 'currentPrice' | 'marketValue' | 'unrealizedPnlPct' | 'drawdownFrom52wHighPct'> {
  const f = input.fundamentals ?? {}

  // 1. 獲利與護城河
  const roePct = finite(f.returnOnEquity) != null ? (f.returnOnEquity as number) * 100 : null
  const opMarginPct = finite(f.operatingMargins) != null ? (f.operatingMargins as number) * 100 : null
  const growthRaw = finite(f.earningsGrowth) ?? finite(f.revenueGrowth)
  const growthPct = growthRaw != null ? growthRaw * 100 : null
  const growthLabel = finite(f.earningsGrowth) != null ? '獲利年增率' : '營收年增率'

  const profMetrics: MetricCheck[] = [
    {
      key: 'roe',
      label: 'ROE（股東權益報酬率）',
      value: roePct,
      formatted: fmtPct(roePct),
      threshold: '≥ 15% 優 / 8~15% 穩健',
      status: roePct == null ? 'na' : roePct >= 15 ? 'pass' : roePct >= 8 ? 'neutral' : 'warn',
    },
    {
      key: 'opMargin',
      label: '營業利益率',
      value: opMarginPct,
      formatted: fmtPct(opMarginPct),
      threshold: '≥ 12% 優 / 5~12% 穩健',
      status: opMarginPct == null ? 'na' : opMarginPct >= 12 ? 'pass' : opMarginPct >= 5 ? 'neutral' : 'warn',
    },
    {
      key: 'growth',
      label: growthLabel,
      value: growthPct,
      formatted: fmtPct(growthPct),
      threshold: '≥ 5% 成長 / -5~5% 持平',
      status: growthPct == null ? 'na' : growthPct >= 5 ? 'pass' : growthPct >= -5 ? 'neutral' : 'warn',
    },
  ]

  // 2. 財務安全與現金流
  const fcf = finite(f.freeCashflow)
  const ocf = finite(f.operatingCashflow)
  const cashFlowVal = fcf ?? ocf
  const cashFlowLabel = fcf != null ? '自由現金流 (FCF)' : '營業現金流 (OCF)'
  const dte = finite(f.debtToEquity)
  const currRatio = finite(f.currentRatio)

  const safetyMetrics: MetricCheck[] = [
    {
      key: 'fcf',
      label: cashFlowLabel,
      value: cashFlowVal,
      formatted: fmtCompactMoney(cashFlowVal),
      threshold: '> 0 代表本業能正向造血',
      status: cashFlowVal == null ? 'na' : cashFlowVal > 0 ? 'pass' : 'warn',
    },
    {
      key: 'dte',
      label: '負債權益比 (D/E)',
      value: dte,
      formatted: fmtPct(dte, 0),
      threshold: '≤ 80% 穩健 / 80~150% 中等',
      status: dte == null ? 'na' : dte <= 80 ? 'pass' : dte <= 150 ? 'neutral' : 'warn',
    },
    {
      key: 'currentRatio',
      label: '流動比率',
      value: currRatio,
      formatted: fmtNum(currRatio, 2, 'x'),
      threshold: '≥ 1.5x 充裕 / 1.0~1.5x 尚可',
      status: currRatio == null ? 'na' : currRatio >= 1.5 ? 'pass' : currRatio >= 1.0 ? 'neutral' : 'warn',
    },
  ]

  // 3. 價值安全邊際
  const pe = finite(f.forwardPe) ?? finite(f.peRatio)
  const peLabel = finite(f.forwardPe) != null ? '預估本益比 (Forward PE)' : '本益比 (PE)'
  const peg = finite(f.pegRatio)
  const pb = finite(f.priceToBook)

  const valMetrics: MetricCheck[] = [
    {
      key: 'pe',
      label: peLabel,
      value: pe,
      formatted: pe != null ? fmtNum(pe, 1, 'x') : '—',
      threshold: '≤ 15x 折價 / 15~25x 合理',
      status: pe == null ? 'na' : pe <= 0 ? 'warn' : pe <= 15 ? 'pass' : pe <= 25 ? 'neutral' : 'warn',
    },
    {
      key: 'peg',
      label: '本益成長比 (PEG)',
      value: peg,
      formatted: peg != null ? fmtNum(peg, 2) : '—',
      threshold: '≤ 1.2 具成長折價 / 1.2~2.0 合理',
      status: peg == null ? 'na' : peg <= 0 ? 'warn' : peg <= 1.2 ? 'pass' : peg <= 2.0 ? 'neutral' : 'warn',
    },
    {
      key: 'pb',
      label: '股價淨值比 (PB)',
      value: pb,
      formatted: pb != null ? fmtNum(pb, 2, 'x') : '—',
      threshold: '≤ 2.0x 偏低 / 2.0~4.5x 合理',
      status: pb == null ? 'na' : pb <= 0 ? 'warn' : pb <= 2.0 ? 'pass' : pb <= 4.5 ? 'neutral' : 'warn',
    },
  ]

  // 4. 下檔保護（配息）
  const yld = resolveYieldPct(input)
  const payoutPct = finite(f.payoutRatio) != null ? (f.payoutRatio as number) * 100 : null

  const retMetrics: MetricCheck[] = [
    {
      key: 'yield',
      label: yld.source ? `現金殖利率 (${yld.source})` : '現金殖利率',
      value: yld.value,
      formatted: fmtPct(yld.value, 2),
      threshold: '≥ 3.5% 具息收緩衝',
      // 成長型美股常不配息，低殖利率列 neutral 不強扣為警訊
      status: yld.value == null ? 'na' : yld.value >= 3.5 ? 'pass' : 'neutral',
    },
    {
      key: 'payout',
      label: '配息發放率',
      value: payoutPct,
      formatted: fmtPct(payoutPct, 0),
      threshold: '≤ 75% 留有盈餘再投資',
      status: payoutPct == null ? 'na' : payoutPct <= 75 ? 'pass' : payoutPct <= 95 ? 'neutral' : 'warn',
    },
  ]

  const profitability = aggregateDimension('profitability', '獲利與護城河', profMetrics)
  const financialSafety = aggregateDimension('financialSafety', '財務安全與現金流', safetyMetrics)
  const valuation = aggregateDimension('valuation', '價值安全邊際', valMetrics)
  const shareholderReturn = aggregateDimension('shareholderReturn', '下檔保護（配息）', retMetrics)

  const allMetrics = [...profMetrics, ...safetyMetrics, ...valMetrics, ...retMetrics]
  const evaluatedMetricCount = allMetrics.filter((m) => m.status !== 'na').length

  // 綜合體質分數：獲利 50% + 財務安全 50%（缺一側則取另一側）
  const bodyScores = [profitability.score, financialSafety.score].filter((s): s is number => s != null)
  const healthScore = bodyScores.length > 0
    ? Math.round(bodyScores.reduce((a, b) => a + b, 0) / bodyScores.length)
    : null

  let verdict: HealthVerdict = 'insufficient'
  if (evaluatedMetricCount >= 2 && healthScore != null) {
    const severeCashBurn = cashFlowVal != null && cashFlowVal < 0 && growthPct != null && growthPct < -10
    if (healthScore < 40 || severeCashBurn) {
      verdict = 'warning'
    } else if (healthScore < 65) {
      verdict = 'watch'
    } else {
      const hasDiscount =
        valuation.status === 'pass' ||
        (peg != null && peg > 0 && peg <= 1.2) ||
        (drawdown52w != null && drawdown52w <= -15 && valuation.status !== 'warn')
      verdict = hasDiscount ? 'discount_healthy' : 'healthy'
    }
  }

  const summary = buildEquitySummary({
    verdict,
    roePct,
    cashFlowVal,
    pe,
    peg,
    drawdown52w,
    dte,
    growthPct,
  })

  return {
    healthScore,
    verdict,
    summary,
    dimensions: { profitability, financialSafety, valuation, shareholderReturn },
    highlights: {
      pe,
      pb,
      roePct,
      fcfPositive: cashFlowVal != null ? cashFlowVal > 0 : null,
      dividendYieldPct: yld.value,
    },
    evaluatedMetricCount,
  }
}

function buildEquitySummary(p: {
  verdict: HealthVerdict
  roePct: number | null
  cashFlowVal: number | null
  pe: number | null
  peg: number | null
  drawdown52w: number | null
  dte: number | null
  growthPct: number | null
}): string {
  if (p.verdict === 'insufficient') return '公開財報欄位不足，暫無法完整評估體質。'
  const parts: string[] = []
  if (p.roePct != null) parts.push(`ROE ${p.roePct.toFixed(1)}%`)
  if (p.cashFlowVal != null) parts.push(p.cashFlowVal > 0 ? '現金流為正' : '現金流轉負')
  if (p.pe != null && p.pe > 0) parts.push(`PE ${p.pe.toFixed(1)}x`)
  if (p.peg != null && p.peg > 0 && p.peg <= 1.2) parts.push(`PEG ${p.peg.toFixed(2)}`)
  if (p.drawdown52w != null && p.drawdown52w <= -15) parts.push(`距高點回撤 ${Math.abs(p.drawdown52w).toFixed(0)}%`)
  if (p.dte != null && p.dte > 150) parts.push(`負債比偏高 (${p.dte.toFixed(0)}%)`)
  if (p.growthPct != null && p.growthPct < -10) parts.push(`成長衰退 (${p.growthPct.toFixed(1)}%)`)
  return parts.slice(0, 4).join('・') || '已完成基礎財務檢核。'
}

/** 評估金融業個股（排除一般企業的流動比與負債權益比） */
function evaluateFinancial(
  input: HoldingHealthInput,
  drawdown52w: number | null,
): Omit<HoldingHealthResult, 'market' | 'symbol' | 'symbolName' | 'assetCategory' | 'sector' | 'shares' | 'cost' | 'currentPrice' | 'marketValue' | 'unrealizedPnlPct' | 'drawdownFrom52wHighPct'> {
  const f = input.fundamentals ?? {}
  const roePct = finite(f.returnOnEquity) != null ? (f.returnOnEquity as number) * 100 : null
  const opMarginPct = finite(f.operatingMargins) != null ? (f.operatingMargins as number) * 100 : null
  const eps = finite(f.eps)
  const pb = finite(f.priceToBook)
  const pe = finite(f.forwardPe) ?? finite(f.peRatio)
  const payoutPct = finite(f.payoutRatio) != null ? (f.payoutRatio as number) * 100 : null
  const yld = resolveYieldPct(input)

  const profMetrics: MetricCheck[] = [
    {
      key: 'roe',
      label: 'ROE（金融業核心指標）',
      value: roePct,
      formatted: fmtPct(roePct),
      threshold: '≥ 10% 優 / 6~10% 穩健',
      status: roePct == null ? 'na' : roePct >= 10 ? 'pass' : roePct >= 6 ? 'neutral' : 'warn',
    },
    {
      key: 'opMargin',
      label: '營業利益率',
      value: opMarginPct,
      formatted: fmtPct(opMarginPct),
      threshold: '≥ 20% 優 / 10~20% 穩健',
      status: opMarginPct == null ? 'na' : opMarginPct >= 20 ? 'pass' : opMarginPct >= 10 ? 'neutral' : 'warn',
    },
  ]

  const safetyMetrics: MetricCheck[] = [
    {
      key: 'eps',
      label: '近四季 EPS（獲利正數）',
      value: eps,
      formatted: eps != null ? fmtNum(eps, 2) : '—',
      threshold: '> 0 維持正獲利（金融業不套用一般流動/負債比）',
      status: eps == null ? 'na' : eps > 0 ? 'pass' : 'warn',
    },
    {
      key: 'payout',
      label: '配息發放率',
      value: payoutPct,
      formatted: fmtPct(payoutPct, 0),
      threshold: '≤ 85% 未超額配息',
      status: payoutPct == null ? 'na' : payoutPct <= 85 ? 'pass' : payoutPct <= 100 ? 'neutral' : 'warn',
    },
  ]

  const valMetrics: MetricCheck[] = [
    {
      key: 'pb',
      label: '股價淨值比 (PB，金融核心)',
      value: pb,
      formatted: pb != null ? fmtNum(pb, 2, 'x') : '—',
      threshold: '≤ 1.2x 折價 / 1.2~1.8x 合理',
      status: pb == null ? 'na' : pb <= 0 ? 'warn' : pb <= 1.2 ? 'pass' : pb <= 1.8 ? 'neutral' : 'warn',
    },
    {
      key: 'pe',
      label: '本益比 (PE)',
      value: pe,
      formatted: pe != null ? fmtNum(pe, 1, 'x') : '—',
      threshold: '≤ 12x 折價 / 12~18x 合理',
      status: pe == null ? 'na' : pe <= 0 ? 'warn' : pe <= 12 ? 'pass' : pe <= 18 ? 'neutral' : 'warn',
    },
  ]

  const retMetrics: MetricCheck[] = [
    {
      key: 'yield',
      label: yld.source ? `現金殖利率 (${yld.source})` : '現金殖利率',
      value: yld.value,
      formatted: fmtPct(yld.value, 2),
      threshold: '≥ 4.0% 優 / 2.5~4.0% 穩健',
      status: yld.value == null ? 'na' : yld.value >= 4.0 ? 'pass' : yld.value >= 2.5 ? 'neutral' : 'warn',
    },
  ]

  const profitability = aggregateDimension('profitability', '金融獲利能力', profMetrics)
  const financialSafety = aggregateDimension('financialSafety', '盈餘與配息紀律', safetyMetrics)
  const valuation = aggregateDimension('valuation', '金融估值位階', valMetrics)
  const shareholderReturn = aggregateDimension('shareholderReturn', '息收下檔保護', retMetrics)

  const allMetrics = [...profMetrics, ...safetyMetrics, ...valMetrics, ...retMetrics]
  const evaluatedMetricCount = allMetrics.filter((m) => m.status !== 'na').length
  const bodyScores = [profitability.score, financialSafety.score].filter((s): s is number => s != null)
  const healthScore = bodyScores.length > 0
    ? Math.round(bodyScores.reduce((a, b) => a + b, 0) / bodyScores.length)
    : null

  let verdict: HealthVerdict = 'insufficient'
  if (evaluatedMetricCount >= 2 && healthScore != null) {
    if (healthScore < 40) verdict = 'warning'
    else if (healthScore < 65) verdict = 'watch'
    else {
      const hasDiscount =
        valuation.status === 'pass' ||
        (drawdown52w != null && drawdown52w <= -15 && valuation.status !== 'warn')
      verdict = hasDiscount ? 'discount_healthy' : 'healthy'
    }
  }

  const parts: string[] = ['金融業專屬檢核']
  if (roePct != null) parts.push(`ROE ${roePct.toFixed(1)}%`)
  if (pb != null) parts.push(`PB ${pb.toFixed(2)}x`)
  if (yld.value != null) parts.push(`殖利率 ${yld.value.toFixed(2)}%`)
  if (drawdown52w != null && drawdown52w <= -15) parts.push(`回撤 ${Math.abs(drawdown52w).toFixed(0)}%`)

  return {
    healthScore,
    verdict,
    summary: verdict === 'insufficient' ? '金融業公開財報欄位不足，暫無法完整評估。' : parts.join('・'),
    dimensions: { profitability, financialSafety, valuation, shareholderReturn },
    highlights: {
      pe,
      pb,
      roePct,
      fcfPositive: null,
      dividendYieldPct: yld.value,
    },
    evaluatedMetricCount,
  }
}

/** 評估 ETF（嚴格獨立模型：不套用單一公司 PE/ROE/負債比） */
function evaluateEtf(
  input: HoldingHealthInput,
  drawdown52w: number | null,
): Omit<HoldingHealthResult, 'market' | 'symbol' | 'symbolName' | 'assetCategory' | 'sector' | 'shares' | 'cost' | 'currentPrice' | 'marketValue' | 'unrealizedPnlPct' | 'drawdownFrom52wHighPct'> {
  const clean = normalizeSymbol(input.symbol)
  const holdingsMeta = CORE_ETF_HOLDINGS_MAP[clean]
  const divComp = CORE_ETF_DIVIDEND_COMPOSITIONS[clean]
  const yld = resolveYieldPct(input)
  const divYears = finite(input.twseDividendYears5y)

  // 1. 成分股分散度
  const top1WeightPct = holdingsMeta?.top10?.[0] ? holdingsMeta.top10[0].weight * 100 : null
  const top1Name = holdingsMeta?.top10?.[0]?.name
  const profMetrics: MetricCheck[] = [
    {
      key: 'etfTop1',
      label: top1Name ? `最大單一成分股權重 (${top1Name})` : '成分股集中度',
      value: top1WeightPct,
      formatted: fmtPct(top1WeightPct),
      threshold: '≤ 30% 分散 / 30~50% 偏集中 / > 50% 高度集中',
      status:
        top1WeightPct == null
          ? 'na'
          : top1WeightPct <= 30
            ? 'pass'
            : top1WeightPct <= 50
              ? 'neutral'
              : 'warn',
      note: top1WeightPct != null && top1WeightPct > 50 ? '單一權值股占比過半，波動受單一公司影響大' : undefined,
    },
  ]

  // 2. 配息結構健康度（收益平準金佔比）
  const eqPct = divComp ? divComp.equalizationRatio * 100 : null
  const ratio54cPct = divComp ? divComp.dividend54cRatio * 100 : null
  const safetyMetrics: MetricCheck[] = [
    {
      key: 'etfEqualization',
      label: '收益平準金佔比（常態平均）',
      value: eqPct,
      formatted: fmtPct(eqPct, 0),
      threshold: '≤ 25% 穩健 / 25~35% 偏高 / > 35% 依賴平準金',
      status: eqPct == null ? 'na' : eqPct <= 25 ? 'pass' : eqPct <= 35 ? 'neutral' : 'warn',
    },
    {
      key: 'etf54c',
      label: '54C 實質股利所得佔比',
      value: ratio54cPct,
      formatted: fmtPct(ratio54cPct, 0),
      threshold: 'ETF 屬一籃子資產，無單一公司倒閉風險',
      status: ratio54cPct == null ? 'na' : ratio54cPct >= 30 ? 'pass' : 'neutral',
    },
  ]

  // 3. 回檔位階（距 52 週高點）
  const valMetrics: MetricCheck[] = [
    {
      key: 'drawdown52w',
      label: '距 52 週高點回撤',
      value: drawdown52w,
      formatted: drawdown52w != null ? `${drawdown52w.toFixed(1)}%` : '—',
      threshold: '回撤 ≥ 12% 具歷史回檔折價空間',
      status:
        drawdown52w == null
          ? 'na'
          : drawdown52w <= -12
            ? 'pass'
            : drawdown52w <= -5
              ? 'neutral'
              : 'neutral',
    },
  ]

  // 4. 配息穩定度
  const retMetrics: MetricCheck[] = [
    {
      key: 'divYears5y',
      label: '近 5 年有配息年數 (TWSE)',
      value: divYears,
      formatted: divYears != null ? `${divYears} / 5 年` : '—',
      threshold: '≥ 4 年配息紀錄穩定',
      status: divYears == null ? 'na' : divYears >= 4 ? 'pass' : divYears >= 2 ? 'neutral' : 'warn',
    },
    {
      key: 'yield',
      label: yld.source ? `歷史殖利率 (${yld.source})` : '殖利率',
      value: yld.value,
      formatted: fmtPct(yld.value, 2),
      threshold: '≥ 3.5% 具息收緩衝',
      status: yld.value == null ? 'na' : yld.value >= 3.5 ? 'pass' : 'neutral',
    },
  ]

  const profitability = aggregateDimension('profitability', 'ETF 成分分散度', profMetrics)
  const financialSafety = aggregateDimension('financialSafety', '配息結構健康度', safetyMetrics)
  const valuation = aggregateDimension('valuation', '52 週回檔位階', valMetrics)
  const shareholderReturn = aggregateDimension('shareholderReturn', '歷史配息穩定度', retMetrics)

  const allMetrics = [...profMetrics, ...safetyMetrics, ...valMetrics, ...retMetrics]
  const evaluatedMetricCount = allMetrics.filter((m) => m.status !== 'na').length

  // ETF 本身屬一籃子分散工具，基礎體質分從 75 起算，依實測維度微調
  const dimScores = [profitability.score, financialSafety.score, shareholderReturn.score].filter(
    (s): s is number => s != null,
  )
  const healthScore =
    evaluatedMetricCount === 0
      ? null
      : dimScores.length > 0
        ? Math.round(dimScores.reduce((a, b) => a + b, 0) / dimScores.length)
        : 75

  let verdict: HealthVerdict = 'insufficient'
  if (evaluatedMetricCount >= 1 && healthScore != null) {
    if (healthScore < 50) {
      verdict = 'watch'
    } else if (drawdown52w != null && drawdown52w <= -12) {
      verdict = 'discount_healthy'
    } else {
      verdict = 'healthy'
    }
  }

  const parts: string[] = ['ETF 專屬體檢']
  if (drawdown52w != null) parts.push(`距 52 週高點 ${drawdown52w.toFixed(1)}%`)
  if (yld.value != null) parts.push(`殖利率 ${yld.value.toFixed(2)}%`)
  if (divYears != null) parts.push(`近5年配息 ${divYears} 年`)
  if (top1WeightPct != null && top1WeightPct > 50 && top1Name) parts.push(`${top1Name} 占 ${top1WeightPct.toFixed(0)}%`)

  return {
    healthScore,
    verdict,
    summary: verdict === 'insufficient' ? 'ETF 公開歷史與成分資料不足。' : parts.join('・'),
    dimensions: { profitability, financialSafety, valuation, shareholderReturn },
    highlights: {
      pe: null,
      pb: null,
      roePct: null,
      fcfPositive: null,
      dividendYieldPct: yld.value,
    },
    evaluatedMetricCount,
  }
}

/** 評估單一持股基本面健康度 */
export function evaluateHoldingHealth(input: HoldingHealthInput): HoldingHealthResult {
  const f = input.fundamentals ?? {}
  const assetCategory = classifyAssetCategory({
    symbol: input.symbol,
    market: input.market,
    quoteType: f.quoteType,
    sector: input.sector ?? f.sector,
    industry: f.industry,
  })
  const priceForDd = finite(input.currentPrice) ?? finite(f.currentPrice)
  const drawdownFrom52wHighPct = computeDrawdownFrom52wHigh(priceForDd, finite(f.fiftyTwoWeekHigh))

  const core =
    assetCategory === 'etf'
      ? evaluateEtf(input, drawdownFrom52wHighPct)
      : assetCategory === 'financial'
        ? evaluateFinancial(input, drawdownFrom52wHighPct)
        : evaluateEquity(input, drawdownFrom52wHighPct)

  return {
    market: input.market,
    symbol: input.symbol,
    symbolName: input.symbolName ?? null,
    assetCategory,
    sector: input.sector ?? f.sector ?? null,
    shares: input.shares,
    cost: input.cost,
    currentPrice: input.currentPrice,
    marketValue: input.marketValue,
    unrealizedPnlPct: input.unrealizedPnlPct,
    drawdownFrom52wHighPct,
    ...core,
  }
}

function summarizeMarket(market: HealthMarket, items: HoldingHealthResult[]): MarketHealthSummary {
  const counts = {
    discount_healthy: 0,
    healthy: 0,
    watch: 0,
    warning: 0,
    insufficient: 0,
  }
  let totalMv = 0
  let healthyMv = 0
  let warningMv = 0

  for (const item of items) {
    counts[item.verdict] += 1
    const mv = Number.isFinite(item.marketValue) && item.marketValue > 0 ? item.marketValue : 0
    totalMv += mv
    if (item.verdict === 'discount_healthy' || item.verdict === 'healthy') {
      healthyMv += mv
    } else if (item.verdict === 'warning') {
      warningMv += mv
    }
  }

  return {
    market,
    holdingCount: items.length,
    totalMarketValue: totalMv,
    healthyValuePct: totalMv > 0 ? Math.round((healthyMv / totalMv) * 1000) / 10 : 0,
    warningValuePct: totalMv > 0 ? Math.round((warningMv / totalMv) * 1000) / 10 : 0,
    counts,
  }
}

/** 評估整個投資組合的基本面健檢報告 */
export function evaluatePortfolioHealth(
  inputs: HoldingHealthInput[],
  asOf = new Date().toISOString(),
): PortfolioHealthReport {
  const holdings = inputs.map(evaluateHoldingHealth)
  const twItems = holdings.filter((h) => h.market === 'tw')
  const usItems = holdings.filter((h) => h.market === 'us')

  const summaryByMarket = {
    tw: summarizeMarket('tw', twItems),
    us: summarizeMarket('us', usItems),
  }

  const overallCounts = {
    total: holdings.length,
    discount_healthy: summaryByMarket.tw.counts.discount_healthy + summaryByMarket.us.counts.discount_healthy,
    healthy: summaryByMarket.tw.counts.healthy + summaryByMarket.us.counts.healthy,
    watch: summaryByMarket.tw.counts.watch + summaryByMarket.us.counts.watch,
    warning: summaryByMarket.tw.counts.warning + summaryByMarket.us.counts.warning,
    insufficient: summaryByMarket.tw.counts.insufficient + summaryByMarket.us.counts.insufficient,
  }

  return {
    asOf,
    holdings,
    summaryByMarket,
    overallCounts,
  }
}
