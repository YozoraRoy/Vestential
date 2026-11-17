/**
 * Issue #132：ETF 配息組成（54C 境內股利所得 / 收益平準金 / 資本利得）
 * 與二代健保補充保費（單次給付達 NT$ 20,000 扣繳 2.11%）安全張數計算器。
 */

export interface EtfDividendComposition {
  symbol: string
  name: string
  /** 54C 境內股利所得佔比 (0 ~ 1) */
  dividend54cRatio: number
  /** 收益平準金佔比 (0 ~ 1) */
  equalizationRatio: number
  /** 76 財產交易所得/資本利得佔比 (0 ~ 1) */
  capitalGainRatio: number
  /** 參考期別或公告備註 */
  asOfPeriod?: string
}

/** 核心 ETF 配息組成歷史常態基準表 */
export const CORE_ETF_DIVIDEND_COMPOSITIONS: Record<string, EtfDividendComposition> = {
  '00878': {
    symbol: '00878',
    name: '國泰永續高股息',
    dividend54cRatio: 0.35,
    equalizationRatio: 0.25,
    capitalGainRatio: 0.40,
    asOfPeriod: '2024~2026 常態平均',
  },
  '0056': {
    symbol: '0056',
    name: '元大高股息',
    dividend54cRatio: 0.30,
    equalizationRatio: 0.20,
    capitalGainRatio: 0.50,
    asOfPeriod: '2024~2026 常態平均',
  },
  '00919': {
    symbol: '00919',
    name: '群益台灣精選高息',
    dividend54cRatio: 0.18,
    equalizationRatio: 0.32,
    capitalGainRatio: 0.50,
    asOfPeriod: '2024~2026 常態平均',
  },
  '00929': {
    symbol: '00929',
    name: '復華台灣科技優息',
    dividend54cRatio: 0.25,
    equalizationRatio: 0.35,
    capitalGainRatio: 0.40,
    asOfPeriod: '2024~2026 常態平均',
  },
  '00713': {
    symbol: '00713',
    name: '元大台灣高息低波',
    dividend54cRatio: 0.28,
    equalizationRatio: 0.18,
    capitalGainRatio: 0.54,
    asOfPeriod: '2024~2026 常態平均',
  },
  '0050': {
    symbol: '0050',
    name: '元大台灣50',
    dividend54cRatio: 0.82,
    equalizationRatio: 0.00,
    capitalGainRatio: 0.18,
    asOfPeriod: '2024~2026 常態平均',
  },
  '006208': {
    symbol: '006208',
    name: '富邦台50',
    dividend54cRatio: 0.85,
    equalizationRatio: 0.00,
    capitalGainRatio: 0.15,
    asOfPeriod: '2024~2026 常態平均',
  },
  '00940': {
    symbol: '00940',
    name: '元大台灣價值高息',
    dividend54cRatio: 0.45,
    equalizationRatio: 0.15,
    capitalGainRatio: 0.40,
    asOfPeriod: '2024~2026 常態平均',
  },
  '00939': {
    symbol: '00939',
    name: '統一台灣高息動能',
    dividend54cRatio: 0.40,
    equalizationRatio: 0.20,
    capitalGainRatio: 0.40,
    asOfPeriod: '2024~2026 常態平均',
  },
  '00757': {
    symbol: '00757',
    name: '統一FANG+',
    dividend54cRatio: 0.00,
    equalizationRatio: 0.00,
    capitalGainRatio: 1.00,
    asOfPeriod: '海外股票型（不計健保）',
  },
  '00891': {
    symbol: '00891',
    name: '中信關鍵半導體',
    dividend54cRatio: 0.20,
    equalizationRatio: 0.25,
    capitalGainRatio: 0.55,
    asOfPeriod: '2024~2026 常態平均',
  },
  '00992A': {
    symbol: '00992A',
    name: '群益科技高息成長',
    dividend54cRatio: 0.00,
    equalizationRatio: 0.20,
    capitalGainRatio: 0.80,
    asOfPeriod: '2026 公告 54C=0%',
  },
  '00918': {
    symbol: '00918',
    name: '大華優利高填息30',
    dividend54cRatio: 0.25,
    equalizationRatio: 0.30,
    capitalGainRatio: 0.45,
    asOfPeriod: '2024~2026 常態平均',
  },
  '00915': {
    symbol: '00915',
    name: '凱基優選高股息30',
    dividend54cRatio: 0.20,
    equalizationRatio: 0.25,
    capitalGainRatio: 0.55,
    asOfPeriod: '2024~2026 常態平均',
  },
}

/** 回傳標的之 54C 應稅股利所得佔比（台股個股為 1.0；ETF 依歷史常態佔比）。 */
export function getTaxable54cRatio(symbol: string): { ratio: number; isEtf: boolean; note?: string } {
  const clean = symbol.trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
  if (CORE_ETF_DIVIDEND_COMPOSITIONS[clean]) {
    const c = CORE_ETF_DIVIDEND_COMPOSITIONS[clean]!
    return { ratio: c.dividend54cRatio, isEtf: true, note: c.asOfPeriod }
  }
  if (clean.startsWith('00')) {
    const fallback = getEtfDividendComposition(clean)
    return { ratio: fallback.dividend54cRatio, isEtf: true, note: fallback.asOfPeriod }
  }
  return { ratio: 1, isEtf: false }
}

/** 常見海外股票 ETF（配息屬海外所得 71/73/76，非 54C 國內股利所得） */
const OVERSEAS_EQUITY_ETF_SYMBOLS = new Set([
  '00646',
  '00662',
  '00757',
  '00830',
  '00885',
  '00893',
  '00895',
  '00916',
  '00926',
  '00971',
  '009800',
  '009801',
])

const BOND_ETF_SYMBOL_RE = /^00\d{3}B$/

/** 取得任一 ETF 的配息組成；債券/海外 ETF 54C=0%，未收錄台股 ETF 回傳通用基準 */
export function getEtfDividendComposition(symbol: string): EtfDividendComposition {
  const clean = symbol.trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
  if (CORE_ETF_DIVIDEND_COMPOSITIONS[clean]) {
    return CORE_ETF_DIVIDEND_COMPOSITIONS[clean]
  }
  if (BOND_ETF_SYMBOL_RE.test(clean) || OVERSEAS_EQUITY_ETF_SYMBOLS.has(clean)) {
    return {
      symbol: clean,
      name: clean,
      dividend54cRatio: 0.0,
      equalizationRatio: 0.0,
      capitalGainRatio: 0.0,
      asOfPeriod: '債券/海外所得型（54C=0%，免扣健保）',
    }
  }
  return {
    symbol: clean,
    name: clean,
    dividend54cRatio: 0.55,
    equalizationRatio: 0.15,
    capitalGainRatio: 0.30,
    asOfPeriod: '台股ETF通用估算基準',
  }
}

export interface HealthInsuranceSafetyEstimate {
  cashDividend: number
  dividend54cPerShare: number
  /** 單次免扣繳 2.11% 二代健保之最大股數 (上限門檻 19,999 元) */
  safeMaxShares: number
  /** 安全持有張數 (整張，即 safeMaxShares / 1000) */
  safeMaxLots: number
  dividend54cRatio: number
  capitalGainRatio: number
  equalizationRatio: number
  asOfPeriod?: string
  /** 當前持股試算 (若有傳入當前股數) */
  holdingEvaluation?: {
    shares: number
    lots: number
    estimated54cAmount: number
    isSubjectToTax: boolean
    estimatedTax: number
  }
}

/** 二代健保補充保費法定門檻 (達 20,000 元即扣繳 2.11%) */
export const HEALTH_TAX_THRESHOLD = 20000
export const HEALTH_TAX_RATE = 0.0211

/**
 * 試算單檔 ETF 當次配息之二代健保安全張數與預估扣繳保費
 */
export function computeHealthTaxSafety(
  symbol: string,
  cashDividend: number,
  holdingShares: number = 0,
): HealthInsuranceSafetyEstimate {
  const comp = getEtfDividendComposition(symbol)
  const validCash = Math.max(0, cashDividend)
  const dividend54cPerShare = validCash * comp.dividend54cRatio

  // 安全股數：floor(19999 / 每股 54C)
  const safeMaxShares =
    dividend54cPerShare > 0
      ? Math.floor((HEALTH_TAX_THRESHOLD - 1) / dividend54cPerShare)
      : 999999999

  const safeMaxLots = Math.floor(safeMaxShares / 1000)

  let holdingEvaluation: HealthInsuranceSafetyEstimate['holdingEvaluation'] = undefined

  if (holdingShares > 0) {
    const estimated54cAmount = Math.round(holdingShares * dividend54cPerShare)
    const isSubjectToTax = estimated54cAmount >= HEALTH_TAX_THRESHOLD
    const estimatedTax = isSubjectToTax
      ? Math.round(estimated54cAmount * HEALTH_TAX_RATE)
      : 0

    holdingEvaluation = {
      shares: holdingShares,
      lots: Math.round((holdingShares / 1000) * 10) / 10,
      estimated54cAmount,
      isSubjectToTax,
      estimatedTax,
    }
  }

  return {
    cashDividend: validCash,
    dividend54cPerShare: Math.round(dividend54cPerShare * 10000) / 10000,
    safeMaxShares,
    safeMaxLots,
    dividend54cRatio: comp.dividend54cRatio,
    capitalGainRatio: comp.capitalGainRatio,
    equalizationRatio: comp.equalizationRatio,
    asOfPeriod: comp.asOfPeriod,
    holdingEvaluation,
  }
}
