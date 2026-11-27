export const ODD_LOT_LOOKBACK_DAYS = 20
export const VOLUME_SPIKE_Z = 3
export const MIN_SAMPLES = 10
export const PREMIUM_PCT = 2

export type OddLotSignalFlag = 'volume-spike' | 'premium'

export interface OddLotSignal {
  volumeZ: number | null
  premiumPct: number | null
  flags: OddLotSignalFlag[]
  insufficientHistory: boolean
}

export interface DetectOddLotSignalsInput {
  currentVolume: number | null | undefined
  currentOddPrice: number | null | undefined
  historyVolumes: number[]
  closePrice?: number | null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 零股訊號引擎純函式（零 DB、零網路、無隨機性）：
 * - 歷史樣本數 < MIN_SAMPLES → insufficientHistory=true, volumeZ=null, 不含 volume-spike
 * - 缺當日收盤價或零股價格 → premiumPct=null, 不含 premium
 */
export function detectOddLotSignals(input: DetectOddLotSignalsInput): OddLotSignal {
  const validHistory = (input.historyVolumes ?? [])
    .filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
    .slice(0, ODD_LOT_LOOKBACK_DAYS)

  const flags: OddLotSignalFlag[] = []
  let insufficientHistory = false
  let volumeZ: number | null = null

  if (validHistory.length < MIN_SAMPLES) {
    insufficientHistory = true
  } else if (
    typeof input.currentVolume === 'number' &&
    Number.isFinite(input.currentVolume) &&
    input.currentVolume >= 0
  ) {
    const n = validHistory.length
    const mean = validHistory.reduce((sum, v) => sum + v, 0) / n
    const variance = validHistory.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n
    const std = Math.sqrt(variance)

    if (std > 0) {
      volumeZ = round2((input.currentVolume - mean) / std)
      if (volumeZ >= VOLUME_SPIKE_Z) {
        flags.push('volume-spike')
      }
    } else if (input.currentVolume === mean) {
      volumeZ = 0
    }
  }

  let premiumPct: number | null = null
  if (
    typeof input.closePrice === 'number' &&
    Number.isFinite(input.closePrice) &&
    input.closePrice > 0 &&
    typeof input.currentOddPrice === 'number' &&
    Number.isFinite(input.currentOddPrice) &&
    input.currentOddPrice > 0
  ) {
    premiumPct = round2(((input.currentOddPrice - input.closePrice) / input.closePrice) * 100)
    if (premiumPct >= PREMIUM_PCT) {
      flags.push('premium')
    }
  }

  return {
    volumeZ,
    premiumPct,
    flags,
    insufficientHistory,
  }
}
