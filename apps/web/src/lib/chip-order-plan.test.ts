import { describe, expect, it } from 'vitest'
import { calcBreakEvenPrice, computeChipOrderPlan, type OrderPlanBar } from './chip-order-plan'

function makeBars(count: number, startClose = 100, step = 0.2): OrderPlanBar[] {
  const baseTs = Date.UTC(2026, 0, 1)
  return Array.from({ length: count }, (_, i) => {
    const close = startClose + i * step
    return {
      timestamp: baseTs + i * 86_400_000,
      open: close - 0.5,
      high: close + 1.5,
      low: close - 1.5,
      close,
      volume: 1000 + i * 10,
    }
  })
}

describe('chip-order-plan', () => {
  it('computes breakEvenPrice within < 0.01 error of manual formula', () => {
    const buyPrice = 1000
    const manual = (buyPrice * (1 + 0.001425)) / (1 - 0.001425 - 0.003)
    const { breakEvenPrice } = calcBreakEvenPrice(buyPrice, 1, false)
    expect(Math.abs(breakEvenPrice - manual)).toBeLessThan(0.01)

    const manualDayTrade = (buyPrice * (1 + 0.001425 * 0.6)) / (1 - 0.001425 * 0.6 - 0.0015)
    const dt = calcBreakEvenPrice(buyPrice, 0.6, true)
    expect(Math.abs(dt.breakEvenPrice - manualDayTrade)).toBeLessThan(0.01)
  })

  it('computes full 60+ day order plan with all target fields', () => {
    const bars = makeBars(70, 500, 1)
    const plan = computeChipOrderPlan('2330', bars)

    expect(plan.symbol).toBe('2330')
    expect(plan.insufficientData).toBe(false)
    expect(plan.barsCount).toBe(70)
    expect(plan.limitBuyPrice).toBeGreaterThan(0)
    expect(plan.chaseStopPrice).toBeGreaterThan(plan.todayVwap)
    expect(plan.stopLossPrice).toBeGreaterThan(0)
    expect(plan.breakEvenPrice).toBeGreaterThan(plan.limitBuyPrice)
    expect(plan.positionSizeSuggestion.riskBudget).toBe(20000)
    expect(plan.positionSizeSuggestion.suggestedShares).toBeGreaterThan(0)
  })

  it('marks insufficientData=true when bars < 60 without crashing', () => {
    const bars = makeBars(25, 80, 0.5)
    const plan = computeChipOrderPlan('6789', bars)

    expect(plan.insufficientData).toBe(true)
    expect(plan.barsCount).toBe(25)
    expect(plan.limitBuyPrice).toBeGreaterThan(0)
    expect(plan.breakEvenPrice).toBeGreaterThan(plan.limitBuyPrice)
  })

  it('flags negativeRiskReward when stopLossPrice exceeds or equals limitBuyPrice', () => {
    // 先飆高再急跌，使 20 日成本區高於當前月線/收盤
    const up = makeBars(50, 100, 2)
    const down = makeBars(15, 190, -5).map((b, idx) => ({
      ...b,
      timestamp: Date.UTC(2026, 2, 1) + idx * 86_400_000,
    }))
    const plan = computeChipOrderPlan('9998', [...up, ...down])
    expect(plan.negativeRiskReward).toBe(true)
  })
})
