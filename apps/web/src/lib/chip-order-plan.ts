/**
 * Issue #147：籌碼雷達「明日掛單計畫」純計算引擎。
 *
 * - 資料源由呼叫端傳入日線 OHLCV（近 1 年日線）；不負責網路請求。
 * - 日線層級無盤中逐筆 Tick，當日 VWAP 以典型價格 TP = (H + L + C) / 3 近似，
 *   近 20 日主力成本下緣參考近 20 日成交量加權 TP（vwap20）與近 20 日低點。
 * - 有效日線少於 60 日時不拋錯，回傳 `insufficientData: true`。
 */

export interface OrderPlanBar {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface OrderPlanOptions {
  /** 手續費折扣（預設 1 = 不打折；例如 0.6 表示 6 折）。 */
  feeDiscount?: number
  /** 是否以當沖證交稅 0.15% 試算（預設 false = 現股 0.3%）。 */
  dayTrade?: boolean
  /** 帳戶總資金（預設 1,000,000 元，用於 2% 單筆風險回推建議張數）。 */
  capital?: number
}

export interface ChipOrderPlan {
  symbol: string
  insufficientData: boolean
  barsCount: number
  lastClose: number
  todayVwap: number
  vwap20: number
  ma20: number
  atr14: number
  support60: number
  resistance60: number
  /** 回檔不破月線／支撐之參考掛單價。 */
  limitBuyPrice: number
  /** 追價上限（todayVwap + 1.5 * ATR(14)）。 */
  chaseStopPrice: number
  /** 停損參考價（近 20 日成本下緣）。 */
  stopLossPrice: number
  /** 計入手續費與證交稅之損益兩平賣出價。 */
  breakEvenPrice: number
  /** 風險報酬比：(resistance60 - limitBuyPrice) / (limitBuyPrice - stopLossPrice)。 */
  riskRewardRatio: number | null
  negativeRiskReward: boolean
  positionSizeSuggestion: {
    capital: number
    riskBudget: number
    riskPerShare: number
    suggestedShares: number
    suggestedLots: number
  }
  feeRate: number
  taxRate: number
  vwapMethodology: string
}

export const TW_FEE_RATE = 0.001425
export const TW_TAX_RATE = 0.003
export const TW_DAYTRADE_TAX_RATE = 0.0015

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function calcTypicalPrice(bar: Pick<OrderPlanBar, 'high' | 'low' | 'close'>): number {
  const high = bar.high > 0 ? bar.high : bar.close
  const low = bar.low > 0 ? bar.low : bar.close
  return (high + low + bar.close) / 3
}

/**
 * 計算 ATR(period)：採最近 `period` 根 True Range 簡單平均。
 * 至少需要 2 根 K 線計算 TR；若只有 1 根則以當根振幅 (high - low) 估算。
 */
export function calcAtr(bars: OrderPlanBar[], period = 14): number {
  if (bars.length === 0) return 0
  if (bars.length === 1) {
    const b = bars[0]
    return Math.max(0, (b.high > 0 ? b.high : b.close) - (b.low > 0 ? b.low : b.close))
  }
  const trs: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i]
    const prevClose = bars[i - 1].close
    const h = cur.high > 0 ? cur.high : cur.close
    const l = cur.low > 0 ? cur.low : cur.close
    const tr = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose))
    trs.push(tr)
  }
  const slice = trs.slice(-period)
  const sum = slice.reduce((acc, v) => acc + v, 0)
  return slice.length > 0 ? sum / slice.length : 0
}

/**
 * 計算台股現股買賣保本賣出價：
 * 買進成本 = buyPrice * (1 + buyFeeRate)
 * 賣出實收 = sellPrice * (1 - sellFeeRate - sellTaxRate)
 * 損益兩平 => sellPrice = buyPrice * (1 + buyFeeRate) / (1 - sellFeeRate - sellTaxRate)
 */
export function calcBreakEvenPrice(
  buyPrice: number,
  feeDiscount = 1,
  dayTrade = false,
): { breakEvenPrice: number; effectiveFeeRate: number; taxRate: number } {
  const safeDiscount = Number.isFinite(feeDiscount) && feeDiscount > 0 && feeDiscount <= 1 ? feeDiscount : 1
  const effectiveFeeRate = TW_FEE_RATE * safeDiscount
  const taxRate = dayTrade ? TW_DAYTRADE_TAX_RATE : TW_TAX_RATE
  if (buyPrice <= 0) {
    return { breakEvenPrice: 0, effectiveFeeRate, taxRate }
  }
  const raw = (buyPrice * (1 + effectiveFeeRate)) / (1 - effectiveFeeRate - taxRate)
  return {
    breakEvenPrice: round2(raw),
    effectiveFeeRate,
    taxRate,
  }
}

export function computeChipOrderPlan(
  symbol: string,
  rawBars: OrderPlanBar[],
  opts: OrderPlanOptions = {},
): ChipOrderPlan {
  const bars = rawBars
    .filter((b) => Number.isFinite(b.close) && b.close > 0)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)

  if (bars.length === 0) {
    throw new Error(`No valid price bars for ${symbol}`)
  }

  const insufficientData = bars.length < 60
  const last = bars[bars.length - 1]
  const lastClose = round2(last.close)
  const todayVwap = round2(calcTypicalPrice(last))

  const bars20 = bars.slice(-20)
  const ma20Raw = bars20.reduce((s, b) => s + b.close, 0) / bars20.length
  const ma20 = round2(ma20Raw)

  let tpVolSum = 0
  let volSum = 0
  for (const b of bars20) {
    const vol = b.volume > 0 ? b.volume : 1
    tpVolSum += calcTypicalPrice(b) * vol
    volSum += vol
  }
  const vwap20 = round2(volSum > 0 ? tpVolSum / volSum : ma20Raw)

  const atr14Raw = calcAtr(bars, 14)
  const atr14 = round2(atr14Raw)

  const bars60 = bars.slice(-60)
  const support60 = round2(
    Math.min(...bars60.map((b) => (b.low > 0 ? b.low : b.close))),
  )
  const resistance60 = round2(
    Math.max(...bars60.map((b) => (b.high > 0 ? b.high : b.close))),
  )

  const low20 = Math.min(...bars20.map((b) => (b.low > 0 ? b.low : b.close)))

  // 掛單價：回檔不破月線（取 lastClose 與 ma20 較低者，同時不低於 60 日支撐）
  const limitBuyRaw = Math.max(Math.min(last.close, ma20Raw), support60)
  const limitBuyPrice = round2(limitBuyRaw)

  // 追價上限：todayVwap + 1.5 * ATR(14)
  const chaseStopPrice = round2(todayVwap + 1.5 * atr14Raw)

  // 停損參考價：取近 20 日低點與 (vwap20 - 1.0 * ATR14) 較高者
  const costFloor = Math.max(low20, vwap20 - atr14Raw)
  const stopLossPrice = round2(Math.max(0.01, costFloor))

  const { breakEvenPrice, effectiveFeeRate, taxRate } = calcBreakEvenPrice(
    limitBuyPrice,
    opts.feeDiscount ?? 1,
    opts.dayTrade ?? false,
  )

  // 風險報酬比：(60日壓力 - 掛單價) / (掛單價 - 停損價)
  const riskPerShareRaw = limitBuyPrice - stopLossPrice
  const rewardPerShareRaw = resistance60 - limitBuyPrice
  let riskRewardRatio: number | null = null
  if (riskPerShareRaw > 0) {
    riskRewardRatio = round2(rewardPerShareRaw / riskPerShareRaw)
  } else if (riskPerShareRaw < 0) {
    // 停損高於掛單價（極端倒掛），以負值標記讓前端警示
    riskRewardRatio = round2(-Math.abs(rewardPerShareRaw / Math.max(atr14Raw, 0.01)))
  }
  const negativeRiskReward = riskRewardRatio === null || riskRewardRatio <= 0

  const capital = opts.capital && opts.capital > 0 ? opts.capital : 1_000_000
  const riskBudget = round2(capital * 0.02)
  const riskPerShareForSizing = round2(Math.max(riskPerShareRaw, atr14Raw, 0.01))
  const suggestedShares = Math.max(0, Math.floor(riskBudget / riskPerShareForSizing))
  const suggestedLots = Math.floor(suggestedShares / 1000)

  return {
    symbol: symbol.toUpperCase(),
    insufficientData,
    barsCount: bars.length,
    lastClose,
    todayVwap,
    vwap20,
    ma20,
    atr14,
    support60,
    resistance60,
    limitBuyPrice,
    chaseStopPrice,
    stopLossPrice,
    breakEvenPrice,
    riskRewardRatio,
    negativeRiskReward,
    positionSizeSuggestion: {
      capital,
      riskBudget,
      riskPerShare: riskPerShareForSizing,
      suggestedShares,
      suggestedLots,
    },
    feeRate: effectiveFeeRate,
    taxRate,
    vwapMethodology: '日線典型價格 (High+Low+Close)/3 近似當日 VWAP，20 日成交量加權近似主力成本',
  }
}
