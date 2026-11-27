import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  logApiError: vi.fn(),
  getCurrentUserFromReq: vi.fn(),
  isAdminUser: vi.fn(),
  runHealthChecks: vi.fn(),
  getUserUsageReport: vi.fn(),
  getLlmUsageReport: vi.fn(),
  migrate: vi.fn(),
}))

vi.mock('@stock/database', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    logApiError: mocks.logApiError,
    getUserUsageReport: mocks.getUserUsageReport,
    getLlmUsageReport: mocks.getLlmUsageReport,
    migrate: mocks.migrate,
  }
})

vi.mock('@/lib/auth', () => ({
  getCurrentUserFromReq: mocks.getCurrentUserFromReq,
  isAdminUser: mocks.isAdminUser,
}))

vi.mock('@/lib/health', () => ({
  runHealthChecks: mocks.runHealthChecks,
}))

vi.mock('@/lib/server-alert', () => ({
  reportServerError: vi.fn(),
}))

import { GET as healthGet } from '@/app/api/health/route'
import { GET as adminUsageGet } from '@/app/api/admin/usage/route'
import { GET as adminLlmUsageGet } from '@/app/api/admin/llm-usage/route'

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

describe('withApiAudit 五條核心路由契約測試 (Issue #172)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.logApiError.mockResolvedValue(undefined)
    mocks.getCurrentUserFromReq.mockResolvedValue({ id: 1, email: 'admin@example.com' })
    mocks.isAdminUser.mockResolvedValue(true)
    mocks.migrate.mockResolvedValue(undefined)
    mocks.runHealthChecks.mockResolvedValue({ ok: true, build: 'test-build', issues: [] })
    mocks.getUserUsageReport.mockResolvedValue([{ userId: 1, count: 3 }])
    mocks.getLlmUsageReport.mockResolvedValue({ summary: [], totals: { calls: 0 } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('health 正常回應恆為 200 且 payload 形狀不變；fake recorder 拋錯不影響狀態碼與延遲', async () => {
    mocks.logApiError.mockImplementationOnce(() => {
      throw new Error('recorder sync failure')
    })
    const req = new NextRequest('https://vestential.com/api/health')
    const res = await healthGet(req)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, build: 'test-build', issues: [] })
    expect(mocks.logApiError).not.toHaveBeenCalled()

    // 模擬超慢情境觸發寫入，且 fake recorder 非同步 reject，狀態碼仍為 200
    mocks.logApiError.mockRejectedValueOnce(new Error('recorder async failure'))
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(10_000).mockReturnValueOnce(15_200)
    const slowRes = await healthGet(new NextRequest('https://vestential.com/api/health'))
    expect(slowRes.status).toBe(200)
    await expect(slowRes.json()).resolves.toEqual({ ok: true, build: 'test-build', issues: [] })
    expect(mocks.logApiError).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'slow_api', route: 'health', statusCode: 200 }),
    )
  })

  it('admin/usage 與 admin/llm-usage 正常 200 不寫入、500 記為 api_error', async () => {
    const usageOk = await adminUsageGet(new NextRequest('https://vestential.com/api/admin/usage'))
    expect(usageOk.status).toBe(200)
    expect(mocks.logApiError).not.toHaveBeenCalled()

    mocks.getUserUsageReport.mockRejectedValueOnce(new Error('db timeout'))
    const usageErr = await adminUsageGet(new NextRequest('https://vestential.com/api/admin/usage'))
    expect(usageErr.status).toBe(500)
    expect(mocks.logApiError).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'api_error', route: 'admin-usage', statusCode: 500 }),
    )

    mocks.logApiError.mockClear()
    const llmOk = await adminLlmUsageGet(new NextRequest('https://vestential.com/api/admin/llm-usage'))
    expect(llmOk.status).toBe(200)
    expect(mocks.logApiError).not.toHaveBeenCalled()

    mocks.getLlmUsageReport.mockRejectedValueOnce(new Error('db query failed'))
    const llmErr = await adminLlmUsageGet(new NextRequest('https://vestential.com/api/admin/llm-usage'))
    expect(llmErr.status).toBe(500)
    expect(mocks.logApiError).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'api_error', route: 'admin-llm-usage', statusCode: 500 }),
    )
  })

  it.each([
    { route: 'health', slowMs: 5_000 },
    { route: '/api/portfolio/analyze', slowMs: 25_000 },
    { route: '/api/analyze', slowMs: 25_000 },
    { route: 'admin-usage', slowMs: 5_000 },
    { route: 'admin-llm-usage', slowMs: 5_000 },
  ])('$route 契約：成功不寫入、5xx/429/超慢(>=${slowMs}ms) 分類寫入正確', async ({ route, slowMs }) => {
    const req = new Request(`https://vestential.com/${route.replace(/^\//, '')}`)

    // 1. 成功（200 且低於門檻）→ 不寫入
    mocks.logApiError.mockClear()
    const okRes = await withApiAudit(req, route, async () => NextResponse.json({ ok: true }))
    expect(okRes.status).toBe(200)
    expect(mocks.logApiError).not.toHaveBeenCalled()

    // 2. 5xx → api_error
    mocks.logApiError.mockClear()
    const errRes = await withApiAudit(req, route, async () =>
      NextResponse.json({ error: 'internal error' }, { status: 500 }),
    )
    expect(errRes.status).toBe(500)
    expect(mocks.logApiError).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'api_error', route, statusCode: 500 }),
    )

    // 3. 429 → rate_limit
    mocks.logApiError.mockClear()
    const limitRes = await withApiAudit(req, route, async () =>
      NextResponse.json({ error: 'rate limited' }, { status: 429 }),
    )
    expect(limitRes.status).toBe(429)
    expect(mocks.logApiError).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'rate_limit', route, statusCode: 429 }),
    )

    // 4. 超慢（>= slowMs）→ slow_api
    mocks.logApiError.mockClear()
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(100_000).mockReturnValueOnce(100_000 + slowMs)
    const slowRes = await withApiAudit(req, route, async () => NextResponse.json({ ok: true }))
    nowSpy.mockRestore()
    expect(slowRes.status).toBe(200)
    expect(mocks.logApiError).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'slow_api', route, statusCode: 200 }),
    )
  })
})
