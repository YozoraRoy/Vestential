import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'

const marketDataMock = vi.hoisted(() => ({
  getHistory: vi.fn(),
}))

vi.mock('@stock/market-data', () => ({
  registry: {
    get: () => ({
      getHistory: marketDataMock.getHistory,
    }),
  },
}))

vi.mock('@/lib/portfolio', () => ({
  resolveYahooSymbol: vi.fn().mockResolvedValue('0050.TW'),
}))

vi.mock('@/lib/market-level', () => ({
  getMarketLevelDashboardData: vi.fn().mockResolvedValue({
    current: {
      level_status: 'fair_low',
      composite_percentile: 35.0,
    },
  }),
}))

vi.mock('@/lib/bottom-radar', () => ({
  getBottomRadarDashboardData: vi.fn().mockResolvedValue({
    triggered: false,
    score: 1,
  }),
}))

describe('/api/backtest/dca route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // 模擬 100 天 K 線資料
    const startMs = Date.UTC(2023, 0, 1)
    const history = []
    for (let i = 0; i < 100; i++) {
      history.push({
        timestamp: startMs + i * 86400 * 1000,
        open: 100,
        high: 105,
        low: 95,
        close: 100,
        volume: 5000,
      })
    }
    marketDataMock.getHistory.mockResolvedValue(history)
  })

  it('回傳 200 並包含雙軌回測結果與今日加碼訊號', async () => {
    const req = new Request('http://localhost/api/backtest/dca?symbol=0050&monthlyAmount=10000')
    const res = await GET(req)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.symbol).toBe('0050')
    expect(json.todaySignal).toBeDefined()
    expect(json.todaySignal.multiplier).toBeDefined()
    expect(json.dca).toBeDefined()
    expect(json.dca.standard).toBeDefined()
    expect(json.dca.smart).toBeDefined()
    expect(json.dca.chartData.length).toBe(100)
  })

  it('歷史資料少於 20 根時回傳 422', async () => {
    marketDataMock.getHistory.mockResolvedValue([{ timestamp: 1, close: 100 }])
    const req = new Request('http://localhost/api/backtest/dca?symbol=0050')
    const res = await GET(req)
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toContain('歷史資料不足')
  })
})
