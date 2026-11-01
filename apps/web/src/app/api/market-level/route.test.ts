import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST } from './route'

const dbMock = vi.hoisted(() => ({
  getMarketLevels: vi.fn(),
  upsertMarketLevel: vi.fn(),
  getMarketLevelByDate: vi.fn(),
}))

vi.mock('@stock/database', () => ({
  getMarketLevels: dbMock.getMarketLevels,
  upsertMarketLevel: dbMock.upsertMarketLevel,
  getMarketLevelByDate: dbMock.getMarketLevelByDate,
}))

describe('Issue #74 /api/market-level route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.getMarketLevels.mockResolvedValue([
      {
        trade_date: '2026-10-30',
        taiex: 45211.83,
        pe_ratio: 22.1,
        pb_ratio: 2.52,
        dividend_yield: 2.85,
        pe_percentile: 73.0,
        pb_percentile: 72.0,
        composite_percentile: 72.5,
        level_status: 'warm',
      },
    ])
  })

  it('GET /api/market-level：回傳成功並包含合規警語與分析資料', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.current).toBeDefined()
    expect(json.current.levelStatus).toBe('warm')
    expect(json.disclaimer).toContain('合規警語與免責聲明')
    expect(json.history).toBeDefined()
  })

  it('POST /api/market-level：未帶 SYNC_TOKEN 回 401', async () => {
    const req = new Request('http://localhost/api/market-level', { method: 'POST' })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.success).toBe(false)
  })

  it('POST /api/market-level：帶合法 SYNC_TOKEN 執行同步成功', async () => {
    const validToken = 'test-sync-token-123456789'
    process.env.SYNC_TOKEN = validToken
    const req = new Request('http://localhost/api/market-level', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}` },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.action).toBe('synced')
    expect(dbMock.upsertMarketLevel).toHaveBeenCalled()
  })
})
