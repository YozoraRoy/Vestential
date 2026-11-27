import { describe, expect, it } from 'vitest'
import {
  MIN_SAMPLES,
  ODD_LOT_LOOKBACK_DAYS,
  PREMIUM_PCT,
  VOLUME_SPIKE_Z,
  detectOddLotSignals,
} from './odd-lot-signals'

describe('detectOddLotSignals', () => {
  it('匯出正確的集中門檻常數', () => {
    expect(ODD_LOT_LOOKBACK_DAYS).toBe(20)
    expect(VOLUME_SPIKE_Z).toBe(3)
    expect(MIN_SAMPLES).toBe(10)
    expect(PREMIUM_PCT).toBe(2)
  })

  it('態 1：爆量＋高溢價（數值可手算重現）', () => {
    // 10 筆歷史量：5 筆 100、5 筆 200 → mean = 150, std = 50
    // currentVolume = 350 → z = (350 - 150) / 50 = 4.0 >= 3
    // closePrice = 100, currentOddPrice = 103 → premiumPct = +3.0% >= 2%
    const history = [100, 200, 100, 200, 100, 200, 100, 200, 100, 200]
    const sig = detectOddLotSignals({
      currentVolume: 350,
      currentOddPrice: 103,
      historyVolumes: history,
      closePrice: 100,
    })

    expect(sig).toEqual({
      volumeZ: 4,
      premiumPct: 3,
      flags: ['volume-spike', 'premium'],
      insufficientHistory: false,
    })
  })

  it('態 2：正常量價無旗標', () => {
    const history = [100, 200, 100, 200, 100, 200, 100, 200, 100, 200]
    const sig = detectOddLotSignals({
      currentVolume: 175, // z = (175 - 150) / 50 = 0.5
      currentOddPrice: 101, // +1.0% < 2%
      historyVolumes: history,
      closePrice: 100,
    })

    expect(sig).toEqual({
      volumeZ: 0.5,
      premiumPct: 1,
      flags: [],
      insufficientHistory: false,
    })
  })

  it('態 3：歷史樣本 < MIN_SAMPLES → insufficientHistory=true、volumeZ=null、不含 volume-spike', () => {
    const sig = detectOddLotSignals({
      currentVolume: 999999,
      currentOddPrice: 105,
      historyVolumes: [100, 100, 100, 100, 100], // 5 < 10
      closePrice: 100,
    })

    expect(sig.insufficientHistory).toBe(true)
    expect(sig.volumeZ).toBeNull()
    expect(sig.flags).not.toContain('volume-spike')
    expect(sig.premiumPct).toBe(5)
    expect(sig.flags).toContain('premium')
  })

  it('態 4：缺當日收盤價 → premiumPct=null、不含 premium，其餘欄位照常計算', () => {
    const history = [100, 200, 100, 200, 100, 200, 100, 200, 100, 200]
    const sig = detectOddLotSignals({
      currentVolume: 350,
      currentOddPrice: 105,
      historyVolumes: history,
      closePrice: null,
    })

    expect(sig).toEqual({
      volumeZ: 4,
      premiumPct: null,
      flags: ['volume-spike'],
      insufficientHistory: false,
    })
  })
})
