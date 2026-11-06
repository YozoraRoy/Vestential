import { describe, it, expect } from 'vitest'
import { runDcaBacktest } from '../src/dca'
import type { OHLCV } from '../src/index'

describe('runDcaBacktest', () => {
  it('throws on empty data', () => {
    expect(() => runDcaBacktest({ data: [], monthlyAmount: 10000 })).toThrow('Data array cannot be empty')
  })

  it('runs standard DCA when no dip triggered (e.g. steady uptrend)', () => {
    // 構造 90 天平穩上漲資料，每天均價從 100 漲到 190
    const startMs = Date.UTC(2023, 0, 1) // 2023-01-01
    const data: OHLCV[] = []
    for (let i = 0; i < 90; i++) {
      const ts = startMs + i * 86400 * 1000
      data.push({
        timestamp: ts,
        open: 100 + i,
        high: 100 + i + 1,
        low: 100 + i - 1,
        close: 100 + i,
        volume: 1000,
      })
    }

    const res = runDcaBacktest({
      data,
      monthlyAmount: 10000,
      investDay: 6,
      smartDipThresholdPct: -10, // 設定一個難以觸發的門檻
    })

    // 跨越 1, 2, 3 月，共 3 次常態扣款
    expect(res.meta.monthsCount).toBe(3)
    expect(res.standard.totalInvested).toBe(30000)
    expect(res.smart.totalInvested).toBe(30000)
    expect(res.smart.dipTriggerCount).toBe(0)
    expect(res.standard.finalValue).toBeGreaterThan(res.standard.totalInvested)
    expect(res.chartData.length).toBe(90)
  })

  it('triggers smart dip on negative bias and lowers average cost', () => {
    // 構造先平穩 60 天（形成 60MA 約 100），第 61-75 天急速下跌至 80（產生深幅負乖離），隨後反彈回 110
    const startMs = Date.UTC(2023, 0, 1) // 2023-01-01
    const data: OHLCV[] = []

    // 0..59 天：100 元
    for (let i = 0; i < 60; i++) {
      data.push({
        timestamp: startMs + i * 86400 * 1000,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000,
      })
    }
    // 60..70 天：跌至 80 元（bias60MA 約 -15%~-20%）
    for (let i = 60; i < 75; i++) {
      data.push({
        timestamp: startMs + i * 86400 * 1000,
        open: 80,
        high: 81,
        low: 79,
        close: 80,
        volume: 2000,
      })
    }
    // 75..120 天：反彈至 110 元
    for (let i = 75; i < 120; i++) {
      data.push({
        timestamp: startMs + i * 86400 * 1000,
        open: 110,
        high: 111,
        low: 109,
        close: 110,
        volume: 1500,
      })
    }

    const res = runDcaBacktest({
      data,
      monthlyAmount: 10000,
      investDay: 6,
      smartDipThresholdPct: -8, // 季線負乖離 <= -8% 觸發加碼
      smartDipMultiplier: 2.0, // 2.0x 加碼
      smartDipMaxTimesPerMonth: 1,
    })

    // 應該觸發了加碼事件
    expect(res.smart.dipTriggerCount).toBeGreaterThan(0)
    expect(res.dipEvents.length).toBe(res.smart.dipTriggerCount)

    // B 軌投入金額應多於 A 軌
    expect(res.smart.totalInvested).toBeGreaterThan(res.standard.totalInvested)

    // B 軌在低點 80 元大幅加碼，每股平均成本應低於 A 軌！
    expect(res.smart.avgCostPerShare).toBeLessThan(res.standard.avgCostPerShare)
    expect(res.smart.costReductionPct).toBeGreaterThan(0)

    // 反彈至 110 元後，B 軌期末總市值高於 A 軌
    expect(res.smart.finalValue).toBeGreaterThan(res.standard.finalValue)
    expect(res.smart.extraReturn).toBeGreaterThan(0)
  })
})
