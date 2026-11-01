import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  computePercentile,
  computeStandardDeviationBand,
  computeMedian,
  determineLevelStatus,
  parseMarketValuationFromBwibbu,
  getMarketLevelDashboardData,
  MARKET_LEVEL_META,
} from './market-level'

describe('Issue #74 大盤水位演算法與指標計算', () => {
  it('computePercentile：正確計算數值在歷史數列中的分位數', () => {
    const history = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    expect(computePercentile(10, history)).toBe(10.0)
    expect(computePercentile(50, history)).toBe(50.0)
    expect(computePercentile(95, history)).toBe(90.0)
    expect(computePercentile(100, history)).toBe(100.0)
    expect(computePercentile(5, history)).toBe(0.0)
  })

  it('computeMedian：正確計算奇數與偶數長度數列之中位數', () => {
    expect(computeMedian([10, 20, 30])).toBe(20)
    expect(computeMedian([10, 20, 30, 40])).toBe(25)
    expect(computeMedian([])).toBe(0)
  })

  it('computeStandardDeviationBand：計算均線與 ±1σ / ±2σ 河流帶', () => {
    const history = [10, 10, 10, 10]
    const band = computeStandardDeviationBand(history)
    expect(band.mean).toBe(10)
    expect(band.plus1Sigma).toBe(10)
    expect(band.plus2Sigma).toBe(10)

    const normalHistory = [10, 20, 30, 40, 50]
    const band2 = computeStandardDeviationBand(normalHistory)
    expect(band2.mean).toBe(30)
    expect(band2.plus1Sigma).toBeGreaterThan(30)
    expect(band2.plus2Sigma).toBeGreaterThan(band2.plus1Sigma)
    expect(band2.minus1Sigma).toBeLessThan(30)
    expect(band2.minus2Sigma).toBeLessThan(band2.minus1Sigma)
  })

  it('determineLevelStatus：正確映射 5 段燈號', () => {
    expect(determineLevelStatus(15).status).toBe('extreme_cold')
    expect(determineLevelStatus(35).status).toBe('cold')
    expect(determineLevelStatus(50).status).toBe('fair')
    expect(determineLevelStatus(75).status).toBe('warm')
    expect(determineLevelStatus(85).status).toBe('overheated')
    expect(determineLevelStatus(99).status).toBe('overheated')
  })

  it('MARKET_LEVEL_META：包含 5 段燈號完整文案與樣式', () => {
    const statuses = ['extreme_cold', 'cold', 'fair', 'warm', 'overheated'] as const
    for (const s of statuses) {
      const meta = MARKET_LEVEL_META[s]
      expect(meta.label).toBeDefined()
      expect(meta.color).toBeDefined()
      expect(meta.description).toBeDefined()
    }
  })

  it('parseMarketValuationFromBwibbu：過濾異常與缺漏值並取得市場中位數', () => {
    const fixture = [
      { PEratio: '15.5', PBratio: '1.8', DividendYield: '3.5' },
      { PEratio: '25.0', PBratio: '2.5', DividendYield: '2.8' },
      { PEratio: '999.0', PBratio: '80.0', DividendYield: '50.0' }, // 異常值應被過濾
      { PEratio: '-', PBratio: '-', DividendYield: '-' },           // 無效值應被過濾
      { PEratio: '20.0', PBratio: '2.0', DividendYield: '3.0' },
    ]
    const valuation = parseMarketValuationFromBwibbu(fixture)
    expect(valuation.pe).toBe(20.0)
    expect(valuation.pb).toBe(2.0)
    expect(valuation.dividendYield).toBe(3.0)
  })

  it('getMarketLevelDashboardData：回傳當前水位分析與河流圖歷史', async () => {
    const data = await getMarketLevelDashboardData()
    expect(data.current).toBeDefined()
    expect(data.current.tradeDate).toBeDefined()
    expect(data.current.levelStatus).toBeDefined()
    expect(data.current.peBand).toBeDefined()
    expect(data.current.pbBand).toBeDefined()
    expect(data.history.length).toBeGreaterThan(0)
  })
})
