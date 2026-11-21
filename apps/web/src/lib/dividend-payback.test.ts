import { describe, it, expect } from 'vitest'
import {
  computeDividendPayback,
  computeRollingAvgDividendsFromEvents,
  pickRateForWindow,
} from './dividend-payback'

describe('computeRollingAvgDividendsFromEvents', () => {
  it('從台股逐筆除息事件正確算出近 1 / 2 / 3 年滾動年均配息', () => {
    const events = [
      { ex_date: '2026-06-15', cash_dividend: 2.0 },
      { ex_date: '2025-06-15', cash_dividend: 3.0 },
      { ex_date: '2024-06-15', cash_dividend: 4.0 },
    ]
    const res = computeRollingAvgDividendsFromEvents(events, '2026-11-21')
    expect(res).not.toBeNull()
    expect(res!.avg1y).toBe(2.0)
    // 2024-11-21..2026-11-21 內含 2026(2) + 2025(3) = 5 / 2 = 2.5
    expect(res!.avg2y).toBe(2.5)
    // 2023-11-21..2026-11-21 內含 2+3+4 = 9，但跨度約 2.4 年
    expect(res!.avg3y).toBeGreaterThan(3)
  })
})

describe('computeDividendPayback', () => {
  it('計算套牢時補平虧損年數與零成本年數', () => {
    // 成本 100、現價 80、1000 股（虧損 20,000），年配息 5 元（年領 5,000）
    const res = computeDividendPayback({
      shares: 1000,
      cost: 100,
      currentPrice: 80,
      annualDivPerShare: 5,
      taxRate: 0,
      currentYear: 2026,
    })
    expect(res.hasDividend).toBe(true)
    expect(res.alreadyRecovered).toBe(false)
    expect(res.lossPaybackYears).toBe(4)
    expect(res.estimatedLossRecoveryYear).toBe(2030)
    expect(res.principalPaybackYears).toBe(20)
    expect(res.estimatedZeroCostYear).toBe(2046)
  })

  it('支援扣減已累計領回股息與美股 30% 預扣稅', () => {
    // 成本 100、現價 70、10 股（虧損 300），已領 100 → 剩餘 200
    // 年息 $10 × 10 = $100，扣 30% 稅後 = $70/年 → 200/70 = 2.9 年
    const res = computeDividendPayback({
      shares: 10,
      cost: 100,
      currentPrice: 70,
      annualDivPerShare: 10,
      taxRate: 0.3,
      receivedDividendsSoFar: 100,
      currentYear: 2026,
    })
    expect(res.remainingLossToRecover).toBe(200)
    expect(res.lossPaybackYears).toBe(2.9)
    expect(res.estimatedLossRecoveryYear).toBe(2029)
  })

  it('無配息或零股數不回傳 NaN', () => {
    const noDiv = computeDividendPayback({
      shares: 10,
      cost: 50,
      currentPrice: 30,
      annualDivPerShare: null,
    })
    expect(noDiv.hasDividend).toBe(false)
    expect(noDiv.lossPaybackYears).toBeNull()

    const zeroShares = computeDividendPayback({
      shares: 0,
      cost: 50,
      currentPrice: 30,
      annualDivPerShare: 2,
    })
    expect(zeroShares.hasDividend).toBe(false)
  })
})

describe('pickRateForWindow', () => {
  it('歷史跨度不足 3 年時標記 isPartialHistory=true', () => {
    const res = pickRateForWindow({ avg1y: 7.5, avg2y: 6.8, avg3y: 6.8, spanYears: 1.8 }, 3)
    expect(res.rate).toBe(6.8)
    expect(res.isPartialHistory).toBe(true)
  })
})
