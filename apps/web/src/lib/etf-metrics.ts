import { INDUSTRY_BOND_ETF } from './industry'

export type EtfSubtype = 'broad' | 'dividend' | 'bond'
export type EtfTrendState = 'bull' | 'neutral' | 'pullback'

export interface EtfPriceBar {
  close: number
  volume?: number | null
}

export interface EtfMetricsInput {
  symbol: string
  name?: string | null
  industryName?: string | null
  bars: EtfPriceBar[]
  dividendCash1y?: number | null
  dividendCount1y?: number | null
}

export interface EtfMetricsReport {
  symbol: string
  subtype: EtfSubtype
  latestClose: number | null
  ma60: number | null
  bias60Pct: number | null
  ma240: number | null
  bias240Pct: number | null
  trendState: EtfTrendState
  annualVolatilityPct: number | null
  maxDrawdownPct: number | null
  avgVolume20d: number | null
  dividendCash1y: number | null
  dividendCount1y: number | null
  trailingYieldPct: number | null
}

function roundTo(val: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(val * f) / f
}

function mean(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

export function classifyEtfSubtype(params: {
  name?: string | null
  industryName?: string | null
  dividendCount1y?: number | null
  trailingYieldPct?: number | null
}): EtfSubtype {
  const name = (params.name ?? '').trim()
  const industry = (params.industryName ?? '').trim()

  if (
    industry === INDUSTRY_BOND_ETF ||
    /債|bond|treasury|fixed\s*income/i.test(name)
  ) {
    return 'bond'
  }

  if (
    /高股息|高息|dividend|income|yield/i.test(name) ||
    ((params.dividendCount1y ?? 0) >= 2 && (params.trailingYieldPct ?? 0) >= 4)
  ) {
    return 'dividend'
  }

  return 'broad'
}

/**
 * 計算 ETF Phase 1 核心定量指標（季線/年線乖離、波動度、最大回撤、20日均量、近1年殖利率與子類型）。
 * 純函式，資料不足時對應欄位回 null，絕不產生 NaN / Infinity。
 */
export function computeEtfMetrics(input: EtfMetricsInput): EtfMetricsReport {
  const validBars = (input.bars ?? []).filter(
    (b) => Number.isFinite(b.close) && b.close > 0,
  )

  const latestClose =
    validBars.length > 0 ? roundTo(validBars[validBars.length - 1].close, 2) : null

  let ma60: number | null = null
  let bias60Pct: number | null = null
  if (validBars.length >= 60 && latestClose !== null) {
    const avg60 = mean(validBars.slice(-60).map((b) => b.close))
    if (avg60 > 0) {
      ma60 = roundTo(avg60, 2)
      bias60Pct = roundTo(((latestClose - avg60) / avg60) * 100, 2)
    }
  }

  let ma240: number | null = null
  let bias240Pct: number | null = null
  if (validBars.length >= 240 && latestClose !== null) {
    const avg240 = mean(validBars.slice(-240).map((b) => b.close))
    if (avg240 > 0) {
      ma240 = roundTo(avg240, 2)
      bias240Pct = roundTo(((latestClose - avg240) / avg240) * 100, 2)
    }
  }

  let trendState: EtfTrendState = 'neutral'
  if (bias60Pct !== null) {
    if (bias60Pct >= 2) trendState = 'bull'
    else if (bias60Pct <= -2) trendState = 'pullback'
  }

  let annualVolatilityPct: number | null = null
  if (validBars.length >= 20) {
    const returns: number[] = []
    for (let i = 1; i < validBars.length; i++) {
      const r = (validBars[i].close - validBars[i - 1].close) / validBars[i - 1].close
      if (Number.isFinite(r)) returns.push(r)
    }
    if (returns.length >= 10) {
      const avgR = mean(returns)
      const variance =
        returns.reduce((sum, r) => sum + (r - avgR) ** 2, 0) / (returns.length - 1)
      const stdDev = Math.sqrt(variance)
      if (Number.isFinite(stdDev)) {
        annualVolatilityPct = roundTo(stdDev * Math.sqrt(252) * 100, 2)
      }
    }
  }

  let maxDrawdownPct: number | null = null
  if (validBars.length >= 5) {
    let peak = validBars[0].close
    let maxDd = 0
    for (const bar of validBars) {
      if (bar.close > peak) peak = bar.close
      const dd = peak > 0 ? ((peak - bar.close) / peak) * 100 : 0
      if (dd > maxDd) maxDd = dd
    }
    maxDrawdownPct = roundTo(maxDd, 2)
  }

  let avgVolume20d: number | null = null
  const recentVols = validBars
    .slice(-20)
    .map((b) => b.volume)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)
  if (recentVols.length >= 5) {
    avgVolume20d = Math.round(mean(recentVols))
  }

  const divCash =
    typeof input.dividendCash1y === 'number' &&
    Number.isFinite(input.dividendCash1y) &&
    input.dividendCash1y > 0
      ? roundTo(input.dividendCash1y, 4)
      : null
  const divCount =
    typeof input.dividendCount1y === 'number' &&
    Number.isFinite(input.dividendCount1y) &&
    input.dividendCount1y > 0
      ? Math.round(input.dividendCount1y)
      : null
  const trailingYieldPct =
    divCash !== null && latestClose !== null && latestClose > 0
      ? roundTo((divCash / latestClose) * 100, 2)
      : null

  const subtype = classifyEtfSubtype({
    name: input.name,
    industryName: input.industryName,
    dividendCount1y: divCount,
    trailingYieldPct,
  })

  return {
    symbol: input.symbol,
    subtype,
    latestClose,
    ma60,
    bias60Pct,
    ma240,
    bias240Pct,
    trendState,
    annualVolatilityPct,
    maxDrawdownPct,
    avgVolume20d,
    dividendCash1y: divCash,
    dividendCount1y: divCount,
    trailingYieldPct,
  }
}
