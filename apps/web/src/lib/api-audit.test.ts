import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  logApiError: vi.fn(),
  getCurrentUserFromReq: vi.fn(),
}))

vi.mock('@stock/database', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    logApiError: mocks.logApiError,
  }
})

vi.mock('@/lib/auth', () => ({
  getCurrentUserFromReq: mocks.getCurrentUserFromReq,
}))

import {
  getSlowThresholdMs,
  HEAVY_AI_API_SLOW_MS,
  maskClientIp,
  NORMAL_API_SLOW_MS,
  parseDeviceLabel,
  withApiAudit,
} from './api-audit'

describe('api-audit (Issue #162 錯誤與慢 API 追蹤)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.logApiError.mockResolvedValue(undefined)
    mocks.getCurrentUserFromReq.mockResolvedValue(null)
  })

  it('慢 API 門檻分級：一般路由 5s、AI 分析/OCR 路由 25s', () => {
    expect(getSlowThresholdMs('/api/quote')).toBe(NORMAL_API_SLOW_MS)
    expect(getSlowThresholdMs('/api/analyze')).toBe(HEAVY_AI_API_SLOW_MS)
    expect(getSlowThresholdMs('/api/portfolio/recognize')).toBe(HEAVY_AI_API_SLOW_MS)
  })

  it('遮罩訪客 IP 末段並萃取精簡裝置標籤', () => {
    expect(maskClientIp('203.0.113.45, 10.0.0.1')).toBe('203.0.113.*')
    expect(maskClientIp('::ffff:192.168.1.99')).toBe('192.168.1.*')
    expect(parseDeviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Safari/604.1')).toBe('Mobile/Safari')
    expect(parseDeviceLabel('curl/8.5.0')).toBe('Bot/CLI')
  })

  it('未登入訪客觸及站內限流 429 記為 rate_limit + guest', async () => {
    const req = new Request('https://vestential.com/api/quote', {
      headers: { 'x-forwarded-for': '114.32.10.88', 'user-agent': 'Mozilla/5.0 Chrome/126.0' },
    })
    const res = await withApiAudit(req, '/api/quote', async () =>
      NextResponse.json({ error: '今日查詢次數已達上限' }, { status: 429 }),
    )
    expect(res.status).toBe(429)
    expect(mocks.logApiError).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'rate_limit',
        actorType: 'guest',
        clientIp: '114.32.10.*',
        userAgent: 'Desktop/Chrome',
        statusCode: 429,
      }),
    )
  })

  it('已登入會員遭遇上游 AI 額度耗盡記為 ai_quota + user email', async () => {
    mocks.getCurrentUserFromReq.mockResolvedValue({ id: 7, email: 'roy@example.com' })
    const req = new Request('https://vestential.com/api/analyze', { method: 'POST' })
    const res = await withApiAudit(req, '/api/analyze', async () => {
      throw new Error('Gemini RESOURCE_EXHAUSTED 429 quota exceeded')
    })
    expect(res.status).toBe(500)
    expect(mocks.logApiError).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'ai_quota',
        actorType: 'user',
        userId: 7,
        userEmail: 'roy@example.com',
        statusCode: 500,
      }),
    )
  })

  it('一般 API 回應超過門檻記為 slow_api', async () => {
    const req = new Request('https://vestential.com/api/search')
    const res = await withApiAudit(
      req,
      '/api/search',
      async () => {
        await new Promise((r) => setTimeout(r, 15))
        return NextResponse.json({ results: [] })
      },
      { slowMs: 5 },
    )
    expect(res.status).toBe(200)
    expect(mocks.logApiError).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'slow_api',
        route: '/api/search',
        statusCode: 200,
      }),
    )
  })
})
