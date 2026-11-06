import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

const marketLevelMock = vi.hoisted(() => ({
  syncMarketLevel: vi.fn(),
  getMarketLevelDashboardData: vi.fn(),
}))

vi.mock('@/lib/market-level', () => ({
  syncMarketLevel: marketLevelMock.syncMarketLevel,
  getMarketLevelDashboardData: marketLevelMock.getMarketLevelDashboardData,
}))

vi.mock('@/lib/bottom-radar', () => ({
  getBottomRadarDashboardData: vi.fn().mockResolvedValue({
    overallSignal: { triggeredCount: 3, label: '訊號浮現' },
  }),
}))

describe('POST /api/market-level/refresh｜手動更新按鈕專用路由', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    marketLevelMock.syncMarketLevel.mockResolvedValue({
      today: '2026-11-06',
      updated: {
        current: {
          tradeDate: '2026-11-06',
          taiex: 23150.5,
          levelStatus: 'fair',
          compositePercentile: 52.4,
        },
        history: [],
      },
      bottomRadar: { overallSignal: { triggeredCount: 3 } },
    })
    marketLevelMock.getMarketLevelDashboardData.mockResolvedValue({
      current: {
        tradeDate: '2026-11-06',
        taiex: 23150.5,
        levelStatus: 'fair',
        compositePercentile: 52.4,
      },
      history: [],
    })
  })

  it('第一次呼叫觸發同步並回傳最新大盤水位與落底資料', async () => {
    const res = await POST()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.current).toBeDefined()
    expect(json.bottomRadar).toBeDefined()
    expect(json.disclaimer).toContain('合規警語與免責聲明')
  })

  it('60 秒內重複呼叫觸發節流，回傳 throttled: true 且不重複呼叫 syncMarketLevel', async () => {
    // 第一次呼叫
    await POST()
    marketLevelMock.syncMarketLevel.mockClear()

    // 立即第二次呼叫（處於 60 秒節流窗口）
    const res = await POST()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.throttled).toBe(true)
    expect(json.message).toContain('60 秒內')
    expect(marketLevelMock.syncMarketLevel).not.toHaveBeenCalled()
  })
})
