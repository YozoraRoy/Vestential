import { describe, expect, it } from 'vitest'
import { INDUSTRY_BOND_ETF } from './industry'
import { computeEtfMetrics } from './etf-metrics'

describe('computeEtfMetrics', () => {
  it('空價格陣列時回傳 null 欄位且不產生 NaN', () => {
    const res = computeEtfMetrics({ symbol: '0050', bars: [] })
    expect(res.latestClose).toBeNull()
    expect(res.bias60Pct).toBeNull()
    expect(res.bias240Pct).toBeNull()
    expect(res.annualVolatilityPct).toBeNull()
    expect(res.maxDrawdownPct).toBeNull()
    expect(res.trailingYieldPct).toBeNull()
    expect(res.subtype).toBe('broad')
  })

  it('正確計算 MA60/MA240 乖離率、MDD、波動度與高股息判定', () => {
    // 250 天從 100 緩步上升至 120，中間有一次 10% 回檔
    const bars = Array.from({ length: 250 }, (_, i) => {
      let close = 100 + (i / 249) * 20
      if (i === 180) close = 100 // 製造明顯回撤
      return { close, volume: 10000 }
    })

    const res = computeEtfMetrics({
      symbol: '00878',
      name: '國泰永續高股息',
      bars,
      dividendCash1y: 1.8,
      dividendCount1y: 4,
    })

    expect(res.subtype).toBe('dividend')
    expect(res.latestClose).toBe(120)
    expect(res.ma60).not.toBeNull()
    expect(res.bias60Pct).toBeGreaterThan(2)
    expect(res.ma240).not.toBeNull()
    expect(res.bias240Pct).toBeGreaterThan(0)
    expect(res.trendState).toBe('bull')
    expect(res.maxDrawdownPct).toBeGreaterThan(10)
    expect(res.annualVolatilityPct).toBeGreaterThan(0)
    expect(res.avgVolume20d).toBe(10000)
    expect(res.trailingYieldPct).toBe(1.5)
  })

  it('依據 stock_industry 債券 ETF 分類識別為 bond 子類型', () => {
    const res = computeEtfMetrics({
      symbol: '00679B',
      industryName: INDUSTRY_BOND_ETF,
      bars: [
        { close: 30, volume: 5000 },
        { close: 30.1, volume: 5100 },
        { close: 29.9, volume: 4900 },
        { close: 30.0, volume: 5000 },
        { close: 30.2, volume: 5200 },
      ],
    })
    expect(res.subtype).toBe('bond')
    expect(res.maxDrawdownPct).not.toBeNull()
  })
})
