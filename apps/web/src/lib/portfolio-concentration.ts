import { industryKeyOf } from './industry'

/**
 * 持股集中度門檻常數（單一真相源，供純函式計算 flags 使用；UI 不得自判門檻）。
 */
export const CONCENTRATION_THRESHOLDS = {
  stockWarnPct: 20,
  stockDangerPct: 30,
  industryDangerPct: 50,
  hhiDanger: 0.25,
} as const

export interface ConcentrationPosition {
  market: 'tw' | 'us'
  symbol: string
  marketValue: number
}

export interface TopWeight {
  market: 'tw' | 'us'
  symbol: string
  weightPct: number
}

export interface IndustryExposure {
  industry: string
  weightPct: number
}

export type ConcentrationFlag = 'stockWarn' | 'stockDanger' | 'industryDanger' | 'hhiDanger'

export interface ConcentrationReport {
  empty: boolean
  hhi: number
  topWeights: TopWeight[]
  industryExposure: IndustryExposure[]
  flags: ConcentrationFlag[]
}

const EMPTY_REPORT: ConcentrationReport = {
  empty: true,
  hhi: 0,
  topWeights: [],
  industryExposure: [],
  flags: [],
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function lookupIndustry(
  industryBySymbol:
    | Record<string, string | null | undefined>
    | Map<string, string | null | undefined>
    | undefined,
  market: 'tw' | 'us',
  symbol: string,
): string | null | undefined {
  if (!industryBySymbol) return undefined
  const keyWithMarket = `${market}:${symbol}`
  if (industryBySymbol instanceof Map) {
    return industryBySymbol.get(keyWithMarket) ?? industryBySymbol.get(symbol)
  }
  return industryBySymbol[keyWithMarket] ?? industryBySymbol[symbol]
}

/**
 * 計算投資組合的個股集中度（HHI、前三大權重）與產業曝險。
 * 純函式，無外部 I/O 與 i18n 依賴；所有無效或非正數市值將被忽略，總市值 <= 0 時回傳空狀態報告。
 */
export function computeConcentration(
  positions: ConcentrationPosition[],
  industryBySymbol?:
    | Record<string, string | null | undefined>
    | Map<string, string | null | undefined>,
): ConcentrationReport {
  if (!Array.isArray(positions) || positions.length === 0) {
    return { ...EMPTY_REPORT, topWeights: [], industryExposure: [], flags: [] }
  }

  // 合併相同 (market, symbol) 的有效正數市值
  const merged = new Map<string, ConcentrationPosition>()
  for (const pos of positions) {
    if (!Number.isFinite(pos.marketValue) || pos.marketValue <= 0) continue
    const market = pos.market === 'us' ? 'us' : 'tw'
    const symbol = String(pos.symbol ?? '').trim().toUpperCase()
    if (!symbol) continue
    const key = `${market}:${symbol}`
    const existing = merged.get(key)
    if (existing) {
      existing.marketValue += pos.marketValue
    } else {
      merged.set(key, { market, symbol, marketValue: pos.marketValue })
    }
  }

  const validPositions = [...merged.values()]
  const totalMarketValue = validPositions.reduce((sum, p) => sum + p.marketValue, 0)
  if (!Number.isFinite(totalMarketValue) || totalMarketValue <= 0) {
    return { ...EMPTY_REPORT, topWeights: [], industryExposure: [], flags: [] }
  }

  // 個股權重與 HHI
  let hhiRaw = 0
  const weightedPositions: TopWeight[] = validPositions.map((p) => {
    const ratio = p.marketValue / totalMarketValue
    hhiRaw += ratio * ratio
    return {
      market: p.market,
      symbol: p.symbol,
      weightPct: roundTo(ratio * 100, 4),
    }
  })

  weightedPositions.sort(
    (a, b) => b.weightPct - a.weightPct || a.symbol.localeCompare(b.symbol),
  )

  const hhi = roundTo(hhiRaw, 6)
  const topWeights = weightedPositions.slice(0, 3)

  // 產業曝險彙總
  const industryTotals = new Map<string, number>()
  for (const p of validPositions) {
    const rawIndustry = lookupIndustry(industryBySymbol, p.market, p.symbol)
    const industryKey = industryKeyOf({ industry_name: rawIndustry })
    industryTotals.set(industryKey, (industryTotals.get(industryKey) ?? 0) + p.marketValue)
  }

  const industryExposure: IndustryExposure[] = [...industryTotals.entries()]
    .map(([industry, value]) => ({
      industry,
      weightPct: roundTo((value / totalMarketValue) * 100, 4),
    }))
    .sort((a, b) => b.weightPct - a.weightPct || a.industry.localeCompare(b.industry, 'zh-TW'))

  // 風險旗標判定
  const flags: ConcentrationFlag[] = []
  const maxStockPct = weightedPositions[0]?.weightPct ?? 0
  const maxIndustryPct = industryExposure[0]?.weightPct ?? 0

  if (maxStockPct >= CONCENTRATION_THRESHOLDS.stockWarnPct) {
    flags.push('stockWarn')
  }
  if (maxStockPct >= CONCENTRATION_THRESHOLDS.stockDangerPct) {
    flags.push('stockDanger')
  }
  if (maxIndustryPct >= CONCENTRATION_THRESHOLDS.industryDangerPct) {
    flags.push('industryDanger')
  }
  if (hhi > CONCENTRATION_THRESHOLDS.hhiDanger) {
    flags.push('hhiDanger')
  }

  return {
    empty: false,
    hhi,
    topWeights,
    industryExposure,
    flags,
  }
}
