import { describe, it, expect } from 'vitest'
import {
  computeUsFxBreakdown,
  computeUsPositionMetrics,
  computeUsTradeFee,
  DEFAULT_OVERSEAS_CONFIG,
  DEFAULT_SUBBROKERAGE_CONFIG,
  simulateUsAverageDown,
  simulateUsSell,
  summarizeUsPortfolio,
} from './portfolio-us'

describe('computeUsTradeFee', () => {
  it('海外券商手續費為 0', () => {
    expect(computeUsTradeFee(10000, DEFAULT_OVERSEAS_CONFIG)).toBe(0)
  })

  it('台灣複委託低消套用 minFeeUsd，大額依比例計算', () => {
    // 1000 * 0.15% = 1.5 < 15 => 收低消 15
    expect(computeUsTradeFee(1000, DEFAULT_SUBBROKERAGE_CONFIG)).toBe(15)
    // 20000 * 0.15% = 30 > 15 => 收 30
    expect(computeUsTradeFee(20000, DEFAULT_SUBBROKERAGE_CONFIG)).toBe(30)
  })
})

describe('computeUsPositionMetrics', () => {
  it('計算複委託含費淨損益、匯率折算與 30% 稅後年股息', () => {
    const m = computeUsPositionMetrics({
      shares: 100,
      cost: 100,
      currentPrice: 120,
      dividendRate: 2.0,
      config: DEFAULT_SUBBROKERAGE_CONFIG,
      fxRate: 32.5,
    })
    // cost = 10000 (buyFee = 15), mv = 12000 (sellFee = 18), grossPnl = 2000, netPnl = 1967
    expect(m.estimatedFeesUsd).toBe(33)
    expect(m.netPnlUsd).toBe(1967)
    expect(m.marketValueTwd).toBe(12000 * 32.5)
    // annual div gross = 200, 30% tax => net = 140
    expect(m.annualDividendGrossUsd).toBe(200)
    expect(m.annualDividendNetUsd).toBe(140)
    expect(m.annualDividendNetTwd).toBe(Math.round(140 * 32.5))
  })

  it('缺匯率時折合台幣欄位回傳 null（不塞假值）', () => {
    const m = computeUsPositionMetrics({
      shares: 10,
      cost: 200,
      currentPrice: 220,
      config: DEFAULT_OVERSEAS_CONFIG,
      fxRate: null,
    })
    expect(m.marketValueTwd).toBeNull()
    expect(m.netPnlTwd).toBeNull()
  })

  it('支援切換 15% 愛爾蘭 ETF 預扣稅率', () => {
    const m = computeUsPositionMetrics({
      shares: 50,
      cost: 100,
      currentPrice: 100,
      dividendYieldPct: 2.0,
      config: { ...DEFAULT_OVERSEAS_CONFIG, dividendTaxRate: 0.15 },
    })
    expect(m.annualDividendGrossUsd).toBe(100)
    expect(m.annualDividendNetUsd).toBe(85)
  })
})

describe('computeUsFxBreakdown', () => {
  it('正確拆解股價價差損益與匯率損益', () => {
    const res = computeUsFxBreakdown({
      costBasisUsd: 10000,
      marketValueUsd: 11000,
      buyFxRate: 30,
      currentFxRate: 32,
    })
    // costTwd = 300000, mvTwd = 352000, total = 52000
    // pricePnl = 1000 * 32 = 32000, fxPnl = 20000
    expect(res).not.toBeNull()
    expect(res!.totalPnlTwd).toBe(52000)
    expect(res!.pricePnlTwd).toBe(32000)
    expect(res!.fxPnlTwd).toBe(20000)
  })
})

describe('simulateUsAverageDown & simulateUsSell', () => {
  it('加碼攤平正確計算新均價、降幅與回本所需漲幅', () => {
    const res = simulateUsAverageDown({
      existingShares: 10,
      existingAvgCost: 200,
      addShares: 10,
      addPrice: 100,
      config: DEFAULT_OVERSEAS_CONFIG,
      fxRate: 32,
    })
    expect(res.newTotalShares).toBe(20)
    expect(res.newAvgCostUsd).toBe(150)
    expect(res.avgCostChangePct).toBe(-25)
    // 現價 100 漲回 150 需要 +50%
    expect(res.breakevenRallyPct).toBe(50)
    expect(res.addTotalOutlayTwd).toBe(32000)
  })

  it('賣出試算驗證不超賣並正確扣除手續費', () => {
    const ok = simulateUsSell({
      existingShares: 20,
      avgCost: 100,
      sellShares: 10,
      sellPrice: 150,
      config: DEFAULT_SUBBROKERAGE_CONFIG,
    })
    expect(ok.valid).toBe(true)
    expect(ok.sellFeeUsd).toBe(15)
    expect(ok.netProceedsUsd).toBe(1485)
    expect(ok.realizedPnlUsd).toBe(485)
    expect(ok.remainingShares).toBe(10)

    const overSell = simulateUsSell({
      existingShares: 5,
      avgCost: 100,
      sellShares: 10,
      sellPrice: 150,
      config: DEFAULT_OVERSEAS_CONFIG,
    })
    expect(overSell.valid).toBe(false)
  })
})

describe('summarizeUsPortfolio', () => {
  it('空持倉安全歸零且不 NaN', () => {
    const s = summarizeUsPortfolio([], 32)
    expect(s.holdingCount).toBe(0)
    expect(s.totalNetPnlPct).toBe(0)
    expect(s.totalMarketValueTwd).toBe(0)
  })
})
