import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetCurrentUserFromCookies = vi.fn()
const mockGetPortfolioRecords = vi.fn()
const mockDbQueryAll = vi.fn()

vi.mock('../../../../lib/auth', () => ({
  getCurrentUserFromCookies: () => mockGetCurrentUserFromCookies(),
}))

vi.mock('@stock/database', () => ({
  getPortfolioRecords: (...args: unknown[]) => mockGetPortfolioRecords(...args),
  dbQueryAll: (...args: unknown[]) => mockDbQueryAll(...args),
}))

import { GET } from './route'

describe('GET /api/portfolio/concentration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('未登入時回傳 401', async () => {
    mockGetCurrentUserFromCookies.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('已登入但無持股時回傳 200 且 empty=true', async () => {
    mockGetCurrentUserFromCookies.mockResolvedValue({ id: 1, email: 'test@example.com' })
    mockGetPortfolioRecords.mockResolvedValue([])

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      empty: true,
      hhi: 0,
      topWeights: [],
      industryExposure: [],
      flags: [],
    })
  })

  it('已登入且有持股時回傳 200 與完整集中度及產業曝險結構', async () => {
    mockGetCurrentUserFromCookies.mockResolvedValue({ id: 1, email: 'test@example.com' })
    mockGetPortfolioRecords.mockResolvedValue([
      { market: 'tw', symbol: '2330', market_value: 70000 },
      { market: 'tw', symbol: '2881', market_value: 30000 },
    ])
    mockDbQueryAll.mockResolvedValue([
      { stock_id: '2330', industry_name: '半導體業' },
      { stock_id: '2881', industry_name: '金融保險業' },
    ])

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.empty).toBe(false)
    expect(typeof body.hhi).toBe('number')
    expect(Array.isArray(body.topWeights)).toBe(true)
    expect(body.topWeights[0]).toEqual({ market: 'tw', symbol: '2330', weightPct: 70 })
    expect(Array.isArray(body.industryExposure)).toBe(true)
    expect(body.industryExposure).toEqual([
      { industry: '半導體業', weightPct: 70 },
      { industry: '金融保險業', weightPct: 30 },
    ])
    expect(body.flags).toContain('hhiDanger')
    expect(body.flags).toContain('industryDanger')
  })
})
