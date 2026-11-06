/**
 * Issue #132：ETF 穿透式成分股重疊度雷達 (Look-Through Holdings Radar)
 * 將投資組合中持有的多檔 ETF 與直接持有的個股合併加權，
 * 計算真實前十大個股曝險比例、重疊度分析與過度集中預警。
 */

import { isCoreEtf } from '@stock/cycle-entry'

export interface ConstituentHolding {
  symbol: string
  name: string
  /** 權重 (0 ~ 1，例如 0.052 代表 5.2%) */
  weight: number
}

export interface EtfConstituents {
  etfSymbol: string
  etfName: string
  top10: ConstituentHolding[]
  asOfDate?: string
}

/** 核心台股 ETF 前十大成分股權重對照表 */
export const CORE_ETF_HOLDINGS_MAP: Record<string, EtfConstituents> = {
  '0050': {
    etfSymbol: '0050',
    etfName: '元大台灣50',
    asOfDate: '2026-Q1',
    top10: [
      { symbol: '2330', name: '台積電', weight: 0.552 },
      { symbol: '2454', name: '聯發科', weight: 0.048 },
      { symbol: '2317', name: '鴻海', weight: 0.042 },
      { symbol: '2308', name: '台達電', weight: 0.021 },
      { symbol: '2382', name: '廣達', weight: 0.018 },
      { symbol: '3711', name: '日月光投控', weight: 0.015 },
      { symbol: '2891', name: '中信金', weight: 0.014 },
      { symbol: '2881', name: '富邦金', weight: 0.013 },
      { symbol: '2303', name: '聯電', weight: 0.012 },
      { symbol: '2882', name: '國泰金', weight: 0.011 },
    ],
  },
  '006208': {
    etfSymbol: '006208',
    etfName: '富邦台50',
    asOfDate: '2026-Q1',
    top10: [
      { symbol: '2330', name: '台積電', weight: 0.554 },
      { symbol: '2454', name: '聯發科', weight: 0.048 },
      { symbol: '2317', name: '鴻海', weight: 0.042 },
      { symbol: '2308', name: '台達電', weight: 0.021 },
      { symbol: '2382', name: '廣達', weight: 0.018 },
      { symbol: '3711', name: '日月光投控', weight: 0.015 },
      { symbol: '2891', name: '中信金', weight: 0.014 },
      { symbol: '2881', name: '富邦金', weight: 0.013 },
      { symbol: '2303', name: '聯電', weight: 0.012 },
      { symbol: '2882', name: '國泰金', weight: 0.011 },
    ],
  },
  '0056': {
    etfSymbol: '0056',
    etfName: '元大高股息',
    asOfDate: '2026-Q1',
    top10: [
      { symbol: '2454', name: '聯發科', weight: 0.042 },
      { symbol: '2603', name: '長榮', weight: 0.038 },
      { symbol: '2891', name: '中信金', weight: 0.035 },
      { symbol: '2303', name: '聯電', weight: 0.034 },
      { symbol: '4938', name: '和碩', weight: 0.032 },
      { symbol: '6176', name: '瑞儀', weight: 0.031 },
      { symbol: '2301', name: '光寶科', weight: 0.030 },
      { symbol: '2382', name: '廣達', weight: 0.029 },
      { symbol: '3702', name: '大聯大', weight: 0.028 },
      { symbol: '2474', name: '可成', weight: 0.027 },
    ],
  },
  '00878': {
    etfSymbol: '00878',
    etfName: '國泰永續高股息',
    asOfDate: '2026-Q1',
    top10: [
      { symbol: '2454', name: '聯發科', weight: 0.045 },
      { symbol: '3034', name: '聯詠', weight: 0.042 },
      { symbol: '2382', name: '廣達', weight: 0.040 },
      { symbol: '3711', name: '日月光投控', weight: 0.038 },
      { symbol: '3702', name: '大聯大', weight: 0.037 },
      { symbol: '2324', name: '仁寶', weight: 0.036 },
      { symbol: '3231', name: '緯創', weight: 0.035 },
      { symbol: '2377', name: '微星', weight: 0.034 },
      { symbol: '2301', name: '光寶科', weight: 0.033 },
      { symbol: '2357', name: '華碩', weight: 0.032 },
    ],
  },
  '00919': {
    etfSymbol: '00919',
    etfName: '群益台灣精選高息',
    asOfDate: '2026-Q1',
    top10: [
      { symbol: '2603', name: '長榮', weight: 0.105 },
      { symbol: '2303', name: '聯電', weight: 0.082 },
      { symbol: '2454', name: '聯發科', weight: 0.075 },
      { symbol: '2891', name: '中信金', weight: 0.068 },
      { symbol: '3034', name: '聯詠', weight: 0.062 },
      { symbol: '2618', name: '長榮航', weight: 0.055 },
      { symbol: '5347', name: '世界', weight: 0.048 },
      { symbol: '6239', name: '力成', weight: 0.045 },
      { symbol: '2404', name: '漢唐', weight: 0.042 },
      { symbol: '6176', name: '瑞儀', weight: 0.040 },
    ],
  },
  '00929': {
    etfSymbol: '00929',
    etfName: '復華台灣科技優息',
    asOfDate: '2026-Q1',
    top10: [
      { symbol: '2454', name: '聯發科', weight: 0.095 },
      { symbol: '3034', name: '聯詠', weight: 0.085 },
      { symbol: '3711', name: '日月光投控', weight: 0.078 },
      { symbol: '4938', name: '和碩', weight: 0.072 },
      { symbol: '3702', name: '大聯大', weight: 0.068 },
      { symbol: '6176', name: '瑞儀', weight: 0.062 },
      { symbol: '6239', name: '力成', weight: 0.058 },
      { symbol: '2449', name: '京元電子', weight: 0.054 },
      { symbol: '2382', name: '廣達', weight: 0.050 },
      { symbol: '2301', name: '光寶科', weight: 0.046 },
    ],
  },
  '00713': {
    etfSymbol: '00713',
    etfName: '元大台灣高息低波',
    asOfDate: '2026-Q1',
    top10: [
      { symbol: '1216', name: '統一', weight: 0.058 },
      { symbol: '2474', name: '可成', weight: 0.055 },
      { symbol: '3045', name: '台灣大', weight: 0.052 },
      { symbol: '4904', name: '遠傳', weight: 0.048 },
      { symbol: '2357', name: '華碩', weight: 0.045 },
      { symbol: '2324', name: '仁寶', weight: 0.042 },
      { symbol: '2301', name: '光寶科', weight: 0.040 },
      { symbol: '2385', name: '群光', weight: 0.038 },
      { symbol: '2356', name: '英業達', weight: 0.036 },
      { symbol: '2891', name: '中信金', weight: 0.035 },
    ],
  },
}

export interface PortfolioHoldingItem {
  symbol: string
  symbol_name?: string | null
  market: string
  market_value: number
}

export interface LookThroughStockExposure {
  symbol: string
  name: string
  /** 穿透後總曝險市值 */
  totalExposedValue: number
  /** 佔總投資組合市值比例 (%) */
  weightPct: number
  /** 直接持股市值 */
  directValue: number
  /** 來自各 ETF 的穿透貢獻清單 */
  etfContributions: {
    etfSymbol: string
    etfName: string
    value: number
    weightInEtfPct: number
  }[]
}

export interface EtfOverlapPair {
  etfA: string
  etfB: string
  overlapCount: number
  commonStocks: {
    symbol: string
    name: string
    weightA: number
    weightB: number
  }[]
}

export interface LookThroughRadarResult {
  totalPortfolioValue: number
  topExposures: LookThroughStockExposure[]
  /** 單一最大持股佔比 */
  top1WeightPct: number
  /** 前五大持股合計佔比 */
  top5WeightPct: number
  /** 集中度風險警示 */
  warnings: string[]
  /** ETF 重疊對清單 */
  overlaps: EtfOverlapPair[]
  /** 是否具備足夠 ETF 進行穿透分析 */
  hasEtf: boolean
}

/**
 * 計算投資組合之穿透式成分股總曝險與重疊度雷達
 */
export function computeLookThroughRadar(holdings: PortfolioHoldingItem[]): LookThroughRadarResult {
  let totalPortfolioValue = 0
  const stockMap: Record<
    string,
    {
      symbol: string
      name: string
      directValue: number
      etfContributions: LookThroughStockExposure['etfContributions']
      totalExposedValue: number
    }
  > = {}

  const heldEtfSymbols: string[] = []

  // 1. 累加總市值與拆解各部位
  for (const item of holdings) {
    const mv = Number(item.market_value) || 0
    if (mv <= 0) continue
    totalPortfolioValue += mv

    const sym = item.symbol.trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
    const isEtf = item.market !== 'us' && (isCoreEtf(sym) || sym.startsWith('00'))

    if (isEtf) {
      heldEtfSymbols.push(sym)
      const etfData = CORE_ETF_HOLDINGS_MAP[sym]
      if (etfData) {
        let accountedWeight = 0
        for (const c of etfData.top10) {
          accountedWeight += c.weight
          const exposedVal = mv * c.weight
          if (!stockMap[c.symbol]) {
            stockMap[c.symbol] = {
              symbol: c.symbol,
              name: c.name,
              directValue: 0,
              etfContributions: [],
              totalExposedValue: 0,
            }
          }
          stockMap[c.symbol].totalExposedValue += exposedVal
          stockMap[c.symbol].etfContributions.push({
            etfSymbol: sym,
            etfName: etfData.etfName,
            value: exposedVal,
            weightInEtfPct: Math.round(c.weight * 1000) / 10,
          })
        }
        // 剩餘其餘持股歸入其他
        const restWeight = Math.max(0, 1 - accountedWeight)
        if (restWeight > 0) {
          const restKey = `REST_${sym}`
          const restVal = mv * restWeight
          if (!stockMap[restKey]) {
            stockMap[restKey] = {
              symbol: restKey,
              name: `${etfData.etfName} (其餘分散成分股)`,
              directValue: 0,
              etfContributions: [],
              totalExposedValue: 0,
            }
          }
          stockMap[restKey].totalExposedValue += restVal
        }
      } else {
        // 未收錄前十大成分股之 ETF，整體作為一項
        if (!stockMap[sym]) {
          stockMap[sym] = {
            symbol: sym,
            name: item.symbol_name || sym,
            directValue: 0,
            etfContributions: [],
            totalExposedValue: 0,
          }
        }
        stockMap[sym].totalExposedValue += mv
      }
    } else {
      // 普通直接持有個股
      if (!stockMap[sym]) {
        stockMap[sym] = {
          symbol: sym,
          name: item.symbol_name || sym,
          directValue: 0,
          etfContributions: [],
          totalExposedValue: 0,
        }
      }
      stockMap[sym].directValue += mv
      stockMap[sym].totalExposedValue += mv
    }
  }

  // 2. 排序並計算權重百分比
  const sortedExposures: LookThroughStockExposure[] = Object.values(stockMap)
    .filter((s) => !s.symbol.startsWith('REST_'))
    .map((s) => ({
      symbol: s.symbol,
      name: s.name,
      directValue: Math.round(s.directValue),
      totalExposedValue: Math.round(s.totalExposedValue),
      weightPct:
        totalPortfolioValue > 0
          ? Math.round((s.totalExposedValue / totalPortfolioValue) * 1000) / 10
          : 0,
      etfContributions: s.etfContributions.sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.totalExposedValue - a.totalExposedValue)

  const top10Exposures = sortedExposures.slice(0, 10)
  const top1WeightPct = top10Exposures[0]?.weightPct ?? 0
  const top5WeightPct = top10Exposures
    .slice(0, 5)
    .reduce((acc, curr) => acc + curr.weightPct, 0)

  // 3. 集中度預警判定
  const warnings: string[] = []
  if (top1WeightPct >= 35) {
    warnings.push(
      `第一大曝險個股（${top10Exposures[0].name} ${top10Exposures[0].symbol}）佔比達 ${top1WeightPct.toFixed(1)}%，整體資產深受單一權值股波動影響。`
    )
  }
  if (top5WeightPct >= 60) {
    warnings.push(
      `前五大真實個股曝險合計達 ${top5WeightPct.toFixed(1)}%，持股高度集中，需留意行業或權值族群之系統性拉回風險。`
    )
  }

  // 4. ETF 間重疊度分析
  const uniqueEtfs = [...new Set(heldEtfSymbols)]
  const overlaps: EtfOverlapPair[] = []

  for (let i = 0; i < uniqueEtfs.length; i++) {
    for (let j = i + 1; j < uniqueEtfs.length; j++) {
      const aSym = uniqueEtfs[i]
      const bSym = uniqueEtfs[j]
      const aData = CORE_ETF_HOLDINGS_MAP[aSym]
      const bData = CORE_ETF_HOLDINGS_MAP[bSym]
      if (!aData || !bData) continue

      const common: EtfOverlapPair['commonStocks'] = []
      for (const aHold of aData.top10) {
        const match = bData.top10.find((b) => b.symbol === aHold.symbol)
        if (match) {
          common.push({
            symbol: aHold.symbol,
            name: aHold.name,
            weightA: aHold.weight,
            weightB: match.weight,
          })
        }
      }

      if (common.length > 0) {
        overlaps.push({
          etfA: `${aData.etfName} (${aSym})`,
          etfB: `${bData.etfName} (${bSym})`,
          overlapCount: common.length,
          commonStocks: common,
        })
      }
    }
  }

  return {
    totalPortfolioValue: Math.round(totalPortfolioValue),
    topExposures: top10Exposures,
    top1WeightPct: Math.round(top1WeightPct * 10) / 10,
    top5WeightPct: Math.round(top5WeightPct * 10) / 10,
    warnings,
    overlaps,
    hasEtf: uniqueEtfs.length > 0,
  }
}
