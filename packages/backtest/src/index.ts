export interface OHLCV {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface SeriesPoint {
  /** Unix 秒（保持與輸入 timestamp 一致；輸入為 ms 時為 ms） */
  date: number
  close: number
  ma60: number | null
  /** 季線乖離率 (close / ma60 - 1)，未能計算時為 null */
  bias: number | null
  /** 使用最佳參數時，此日是否觸發進場訊號 */
  trigger: boolean
}

export interface TradeRecord {
  entryDate: number
  entryPrice: number
  outcome: 'win' | 'loss' | 'neutral'
  /** 自進場算起，達到 +8% 目標的交易天數；非 win 為 null */
  daysToTarget: number | null
}

export interface ThresholdResult {
  /** 進場閾值（乖離率，%，負值） */
  threshold: number
  totalTrades: number
  wins: number
  losses: number
  neutral: number
  winRate: number | null
  avgDaysToTarget: number | null
  trades: TradeRecord[]
}

export interface GridResult {
  bestThreshold: number
  totalTrades: number
  winRate: number | null
  avgDaysToTarget: number | null
  wins: number
  losses: number
  neutral: number
  /** 勝率未達 75% 目標時為 true */
  belowTarget: boolean
  allThresholds: ThresholdResult[]
  series: SeriesPoint[]
  triggerDates: number[]
  usage: {
    startDate: number
    endDate: number
    dataPoints: number
    /** 使用的進場閾值（%），與 bestThreshold 一致 */
    entryThresholdPct: number
  }
}

/** 預設目標條件 */
export const TARGET_PROFIT = 0.08
export const MAX_DRAWDOWN = 0.05
export const HOLDING_DAYS = 40
export const MA_PERIOD = 60

/** 進場/目標/停損 etc. 可調整參數 */
export interface ModelParams {
  /** 目標獲利（比值，如 0.08 = +8%） */
  targetProfit?: number
  /** 最大回撤停損（比值，如 0.05 = -5%） */
  maxDrawdown?: number
  /** 持有天數上限（達此仍未觸發目標/停損則為中性） */
  holdingDays?: number
}

/** 平滑移動平均線；前 period-1 個元素為 null */
export function computeSMA(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

/** 季線乖離率：close 已全還原，故直接用 close */
export function computeBias60MA(close: number[], ma60: (number | null)[]): (number | null)[] {
  return close.map((c, i) => (ma60[i] != null && ma60[i]! > 0 ? c / ma60[i]! - 1 : null))
}

export class BacktestEngine {
  /**
   * 對單一進場閾值執行回測（非重疊交易 + 40 日窗 + 同日雙殺保守判定）。
   * @param entryThreshold 進場閾值（百分比，負值，如 -7.5）
   */
  static run(ohlcv: OHLCV[], entryThreshold: number, params: ModelParams = {}): ThresholdResult {
    const n = ohlcv.length
    const close = ohlcv.map((v) => v.close)
    const ma60 = computeSMA(close, MA_PERIOD)
    const bias = computeBias60MA(close, ma60)
    const holdingDays = params.holdingDays ?? HOLDING_DAYS

    const trades: TradeRecord[] = []
    let i = 0

    // 訊號需有 MA60（i >= MA_PERIOD-1 才有 bias）
    // entryThreshold 以「百分比」表示（如 -7.5），bias 為比值，故除以 100 比較。
    const thresholdRatio = entryThreshold / 100
    while (i < n) {
      const b = bias[i]
      // 收盤確認訊號後，於次一交易日 open 進場
      if (b != null && b <= thresholdRatio && i + 1 < n) {
        const entryPrice = ohlcv[i + 1].open
        if (entryPrice > 0) {
          const t = this.simulateTrade(ohlcv, i + 1, entryPrice, params)
          trades.push(t)
          // inPosition 鎖：跳到下一筆交易判定後一天（非重疊）
          i = Math.min(i + 1 + holdingDays, n)
          continue
        }
      }
      i++
    }

    const wins = trades.filter((t) => t.outcome === 'win').length
    const losses = trades.filter((t) => t.outcome === 'loss').length
    const neutral = trades.filter((t) => t.outcome === 'neutral').length
    const decided = wins + losses
    const winRate = decided > 0 ? wins / decided : null
    const winTrades = trades.filter((t) => t.daysToTarget != null && t.outcome === 'win')
    const avgDaysToTarget =
      winTrades.length > 0 ? winTrades.reduce((s, t) => s + (t.daysToTarget ?? 0), 0) / winTrades.length : null

    return {
      threshold: entryThreshold,
      totalTrades: decided,
      wins,
      losses,
      neutral,
      winRate,
      avgDaysToTarget,
      trades,
    }
  }

  /**
   * 進場後，於 40 日窗內逐日判定先觸發者。
   * - 同日 high 達 +8% 且 low 達 -5% → 保守判定 Loss（同日雙殺）
   * - 否則先 +8% → Win；先 -5% → Loss
   * - 40 日滿未觸發 → Neutral
   */
  private static simulateTrade(
    ohlcv: OHLCV[],
    startIdx: number,
    entryPrice: number,
    params: ModelParams = {},
  ): TradeRecord {
    const targetProfit = params.targetProfit ?? TARGET_PROFIT
    const maxDrawdown = params.maxDrawdown ?? MAX_DRAWDOWN
    const holdingDays = params.holdingDays ?? HOLDING_DAYS
    const targetPrice = entryPrice * (1 + targetProfit)
    const stopPrice = entryPrice * (1 - maxDrawdown)
    const endIdx = Math.min(startIdx + holdingDays, ohlcv.length)

    for (let i = startIdx; i < endIdx; i++) {
      const high = ohlcv[i].high
      const low = ohlcv[i].low
      const hitTarget = high >= targetPrice
      const hitStop = low <= stopPrice

      if (hitTarget && hitStop) {
        // 同日雙殺：保守原則視為先觸發停損
        return { entryDate: ohlcv[startIdx].timestamp, entryPrice, outcome: 'loss', daysToTarget: null }
      }
      if (hitTarget) {
        return {
          entryDate: ohlcv[startIdx].timestamp,
          entryPrice,
          outcome: 'win',
          daysToTarget: i - startIdx + 1,
        }
      }
      if (hitStop) {
        return { entryDate: ohlcv[startIdx].timestamp, entryPrice, outcome: 'loss', daysToTarget: null }
      }
    }
    return { entryDate: ohlcv[startIdx].timestamp, entryPrice, outcome: 'neutral', daysToTarget: null }
  }
}

export interface GridSearchOptions {
  /** 勝率目標（預設 0.75） */
  targetWinRate?: number
  /** 最低可採樣交易筆數（低於此值的參數視為樣本不足，不得選為最佳；預設 10） */
  minTrades?: number
  /** 起始閾值（%，負值，預設 -3） */
  startPct?: number
  /** 結束閾值（%，負值，預設 -15） */
  endPct?: number
  /** 步階（%，預設 0.5） */
  stepPct?: number
  /** 目標獲利 / 停損 / 持有天數 等模型參數 */
  params?: ModelParams
}

/** 遍歷進場閾值，並依「勝率>目標 → trades 多 → avgDays 少」選最佳參數。 */
export function runGridSearch(ohlcv: OHLCV[], options: GridSearchOptions = {}): GridResult {
  const targetWinRate = options.targetWinRate ?? 0.75
  const minTrades = options.minTrades ?? 10
  const startPct = options.startPct ?? -3
  const endPct = options.endPct ?? -15
  const stepPct = options.stepPct ?? 0.5
  const params = options.params ?? {}

  // 產生由 max→min 遞減的閾值清單：-3, -3.5, ..., -15
  const thresholds: number[] = []
  for (let v = startPct; v >= endPct; v -= stepPct) {
    thresholds.push(Math.round(v * 100) / 100)
  }

  const allThresholds: ThresholdResult[] = thresholds.map((t) => BacktestEngine.run(ohlcv, t, params))

  // 排序：先決 WinRate >= target 且樣本 >= minTrades → trades 多 → avgDaysToTarget 少（null 視為最差）
  const qualified = allThresholds.filter(
    (r) => r.winRate != null && r.winRate >= targetWinRate && r.totalTrades >= minTrades,
  )
  // fallback 亦須過樣本門檻：低樣本的高勝率不得因「達標者從缺」而被選為最佳
  const pool = qualified.length > 0 ? qualified : allThresholds.filter((r) => r.winRate != null && r.totalTrades >= minTrades)
  const belowTarget = qualified.length === 0

  const sortFn = (a: ThresholdResult, b: ThresholdResult) => {
    const aw = a.winRate ?? -1
    const bw = b.winRate ?? -1
    if (bw !== aw) return bw - aw
    if (b.totalTrades !== a.totalTrades) return b.totalTrades - a.totalTrades
    const ad = a.avgDaysToTarget ?? Number.POSITIVE_INFINITY
    const bd = b.avgDaysToTarget ?? Number.POSITIVE_INFINITY
    return ad - bd
  }

  pool.sort(sortFn)
  const best = pool[0]

  const series = buildSeries(ohlcv)
  const bestTriggerDates: number[] = []

  // 標記最佳參數下的觸發訊號日（bias <= bestThreshold 且次一交易日確實進場）
  if (best) {
    const bestThreshold = best.threshold
    const close = ohlcv.map((v) => v.close)
    const ma60 = computeSMA(close, MA_PERIOD)
    const bias = computeBias60MA(close, ma60)
    const bestEntryDates = new Set(best.trades.map((t) => t.entryDate))
    ohlcv.forEach((v, idx) => {
      // 訊號日：bias 符合閾值，且其「進場日」確實發生在 best.trades（進場日 = idx+1）
      const entryAt = ohlcv[idx + 1]
      if (entryAt && bestEntryDates.has(entryAt.timestamp) && bias[idx] != null && bias[idx]! <= bestThreshold / 100) {
        series[idx].trigger = true
        bestTriggerDates.push(v.timestamp)
      }
    })
  }

  const n = ohlcv.length

  return {
    bestThreshold: best?.threshold ?? 0,
    totalTrades: best?.totalTrades ?? 0,
    winRate: best?.winRate ?? null,
    avgDaysToTarget: best?.avgDaysToTarget ?? null,
    wins: best?.wins ?? 0,
    losses: best?.losses ?? 0,
    neutral: best?.neutral ?? 0,
    belowTarget,
    allThresholds,
    series,
    triggerDates: bestTriggerDates,
    usage: {
      startDate: n > 0 ? ohlcv[0].timestamp : 0,
      endDate: n > 0 ? ohlcv[n - 1].timestamp : 0,
      dataPoints: n,
      entryThresholdPct: best?.threshold ?? 0,
    },
  }
}

/** 建構供前端繪圖的每日序列（含 MA60 與乖離率）。 */
function buildSeries(ohlcv: OHLCV[]): SeriesPoint[] {
  const close = ohlcv.map((v) => v.close)
  const ma60 = computeSMA(close, MA_PERIOD)
  const bias = computeBias60MA(close, ma60)
  return ohlcv.map((v, i) => ({
    date: v.timestamp,
    close: v.close,
    ma60: ma60[i],
    bias: bias[i],
    trigger: false,
  }))
}

/** 檢查資料量是否足以回測（需 MA60 warmup + 至少 1 次進場）。 */
export function isDataSufficient(ohlcv: OHLCV[]): boolean {
  return ohlcv.length >= MA_PERIOD + 1
}

export * from './dca'

