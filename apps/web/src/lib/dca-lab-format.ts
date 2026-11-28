/**
 * Issue #213：/dca-lab UI 格式化與「今日加碼倍率行動指南」純函式。
 */

export interface CostComparisonFormat {
  /** 成本是否下降或持平（costReductionPct >= 0） */
  isReduced: boolean
  /** 帶單一符號的百分比字串，如 "-1.8%"、"0.0%"、"+0.2%"（絕不出現 "--0.2%"） */
  formattedPct: string
}

/**
 * 格式化「每股平均成本降幅/增幅」：
 * - costReductionPct > 0（成本下降）：isReduced=true，顯示 "-x.x%"
 * - costReductionPct < 0（成本上升）：isReduced=false，顯示 "+x.x%"
 * - costReductionPct === 0：isReduced=true，顯示 "0.0%"
 */
export function formatCostReduction(costReductionPct: number): CostComparisonFormat {
  const safe = Number.isFinite(costReductionPct) ? costReductionPct : 0
  const rounded = Math.round(safe * 10) / 10
  if (rounded > 0) {
    return { isReduced: true, formattedPct: `-${rounded.toFixed(1)}%` }
  }
  if (rounded < 0) {
    return { isReduced: false, formattedPct: `+${Math.abs(rounded).toFixed(1)}%` }
  }
  return { isReduced: true, formattedPct: '0.0%' }
}

/** 格式化帶符號百分比（絕不出現 "+-0.6%"）。 */
export function formatSignedPct(valuePct: number, decimals = 1): string {
  const safe = Number.isFinite(valuePct) ? valuePct : 0
  const factor = 10 ** decimals
  const rounded = Math.round(safe * factor) / factor
  if (rounded > 0) return `+${rounded.toFixed(decimals)}%`
  if (rounded < 0) return `${rounded.toFixed(decimals)}%`
  return `${(0).toFixed(decimals)}%`
}

export interface TodayDcaSignalInput {
  currentBiasPct: number | null
  thresholdPct: number
  marketLevelStatus: string
  isRadarTriggered: boolean
}

export interface TodayDcaSignalResult {
  action: 'STANDARD' | 'MODERATE_ADD' | 'AGGRESSIVE_ADD'
  multiplier: number
  actionBadge: string
  reason: string
}

/**
 * 依標的季線乖離、大盤歷史水位與落底雷達，產生彼此一致的今日行動指南與倍率建議。
 */
export function buildTodayDcaSignal(input: TodayDcaSignalInput): TodayDcaSignalResult {
  const { currentBiasPct, thresholdPct, marketLevelStatus, isRadarTriggered } = input
  const isMarketLow = marketLevelStatus === 'extreme_cold' || marketLevelStatus === 'cold'
  const isMarketHigh = marketLevelStatus === 'overheated' || marketLevelStatus === 'warm'

  if (currentBiasPct != null && currentBiasPct <= -8 && (isMarketLow || isRadarTriggered)) {
    let reason: string
    if (isMarketLow && isRadarTriggered) {
      reason = `標的目前季線負乖離達 ${currentBiasPct.toFixed(1)}%，大盤估值處於低檔區且落底雷達同步觸發，屬歷史罕見的高勝率黃金加碼點！`
    } else if (isMarketLow) {
      reason = `標的目前季線負乖離達 ${currentBiasPct.toFixed(1)}%，且大盤估值指標呈現低檔區，具備長線逢低積極加碼優勢。`
    } else if (isMarketHigh) {
      reason = `標的目前季線負乖離達 ${currentBiasPct.toFixed(1)}% 且短線落底雷達已觸發（大盤長線估值仍在偏高區，建議分批逢低加碼）。`
    } else {
      reason = `標的目前季線負乖離達 ${currentBiasPct.toFixed(1)}% 且短線落底雷達已觸發，適合分批逢低積極加碼。`
    }
    return {
      action: 'AGGRESSIVE_ADD',
      multiplier: 2.0,
      actionBadge: '今日建議：2.0x 積極逢低加碼',
      reason,
    }
  }

  if ((currentBiasPct != null && currentBiasPct <= thresholdPct) || isMarketLow) {
    const biasText = currentBiasPct != null ? `${currentBiasPct.toFixed(1)}%` : '合理門檻'
    const reason =
      isMarketLow && (currentBiasPct == null || currentBiasPct > thresholdPct)
        ? `大盤歷史估值已進入低檔區（標的目前季線乖離 ${biasText}），適合適度提高扣款倍率累積低檔部位。`
        : `標的季線負乖離達 ${biasText}，適合提高扣款倍率拉低持股均價。`
    return {
      action: 'MODERATE_ADD',
      multiplier: 1.5,
      actionBadge: '今日建議：1.5x 溫和逢低加碼',
      reason,
    }
  }

  return {
    action: 'STANDARD',
    multiplier: 1.0,
    actionBadge: '今日建議：1.0x 常態定期扣款',
    reason: '目前標的季線乖離適中且大盤無低檔訊號，建議維持預設計畫穩健扣款。',
  }
}
