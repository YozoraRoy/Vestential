import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET } from './route'

const mocks = vi.hoisted(() => ({
  migrate: vi.fn(),
  authorizeSync: vi.fn(),
  sendMarketFocusAlert: vi.fn(),
  getSocialAccessToken: vi.fn(),
  getSocialTokenMeta: vi.fn(),
  isPermanentSocialToken: vi.fn(),
  saveRefreshedSocialToken: vi.fn(),
}))

vi.mock('@stock/database', () => ({ migrate: mocks.migrate }))
vi.mock('@/lib/sync-auth', () => ({ authorizeSync: mocks.authorizeSync }))
vi.mock('@/lib/email', () => ({ sendMarketFocusAlert: mocks.sendMarketFocusAlert }))
vi.mock('@/lib/social-platforms', () => ({ ACTIVE_SOCIAL_PLATFORMS: ['threads'] }))
vi.mock('@/lib/social-tokens', () => ({
  getSocialAccessToken: mocks.getSocialAccessToken,
  getSocialTokenMeta: mocks.getSocialTokenMeta,
  isPermanentSocialToken: mocks.isPermanentSocialToken,
  saveRefreshedSocialToken: mocks.saveRefreshedSocialToken,
}))

function fakeRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.TOKEN_HEALTH_RETRY_DELAY_MS = '0'
  mocks.migrate.mockResolvedValue(undefined)
  mocks.authorizeSync.mockReturnValue(true)
  mocks.sendMarketFocusAlert.mockResolvedValue(undefined)
  mocks.getSocialAccessToken.mockImplementation(async (platform: string) =>
    platform === 'threads' ? { token: 'th_tok', source: 'db' } : { token: null, source: 'none' },
  )
  mocks.getSocialTokenMeta.mockResolvedValue({
    daysRemaining: 59,
    expiresAt: '2027-01-21T05:45:40.169Z',
    lastRefreshedAt: '2026-11-23T05:00:18.169Z',
  })
  mocks.isPermanentSocialToken.mockReturnValue(false)
})

afterEach(() => {
  delete process.env.TOKEN_HEALTH_RETRY_DELAY_MS
  vi.unstubAllGlobals()
})

describe('GET /api/social/token-health', () => {
  it('Threads API 連續 timeout（暫態錯誤）→ 回 503 且標記 transient=true，不誤發 Token 失效告警信', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('The operation was aborted due to timeout'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await GET(new Request('https://vestential.com/api/social/token-health'))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.success).toBe(false)
    expect(body.checks[0]).toMatchObject({
      platform: 'threads',
      ok: false,
      transient: true,
      error: 'The operation was aborted due to timeout',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(mocks.sendMarketFocusAlert).not.toHaveBeenCalled()
  })

  it('Threads API HTTP 502（暫態錯誤）→ 回 503 且不誤發 Token 失效告警信', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeRes(502, { error: { message: 'Bad Gateway' } }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await GET(new Request('https://vestential.com/api/social/token-health'))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.checks[0].transient).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(mocks.sendMarketFocusAlert).not.toHaveBeenCalled()
  })

  it('Threads API HTTP 400 OAuth 失效 → 立即失敗（不重試）並寄出「社群 Token 失效告警」信', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeRes(400, { error: { code: 190, message: 'Invalid OAuth access token.' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await GET(new Request('https://vestential.com/api/social/token-health'))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.checks[0]).toMatchObject({
      platform: 'threads',
      ok: false,
      transient: false,
      error: 'Invalid OAuth access token.',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mocks.sendMarketFocusAlert).toHaveBeenCalledTimes(1)
    expect(mocks.sendMarketFocusAlert).toHaveBeenCalledWith(
      '社群 Token 失效告警',
      'threads: Invalid OAuth access token.',
    )
  })
})
