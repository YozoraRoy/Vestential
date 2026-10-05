import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  graphPost,
  MetaRateLimitError,
  metaEndpointForLog,
  resetMetaCallPaceForTest,
} from './social-publish'

// ─── Issue #58：Meta 節流行為單測 ＋ Issue #59：暫態退避 ───────────────
// graphFetch 是唯一的 Meta choke point：錯峰（META_PACE_MS）＋限流／暫態退避重打
// （META_RETRY_BASE_MS×2^n）。ai-engine 以「可控的等價行為」mock（0 間隔預設），
// 限流判定只認「HTTP 429 或 code=4」；暫態判定鏡像真實分類器
// （HTTP 5xx／code -1／Fatal 訊息／is_transient=true，分類器全集另由 ai-engine budget.test.ts 斷言）。

vi.mock('@stock/database', () => ({
  hasSocialPosted: vi.fn(),
  createSocialPost: vi.fn(),
  updateSocialPost: vi.fn(),
  deleteSocialPostByEdition: vi.fn(),
}))

vi.mock('@/lib/social', () => ({
  IG_DRIVE_COMMENT: '更多資訊 → https://vestential.com/market-focus',
}))

vi.mock('@stock/ai-engine', () => ({
  getMetaPaceMs: () => Number(process.env.META_PACE_MS ?? '0'),
  getMetaBackoffMs: (attempt: number) => Number(process.env.META_RETRY_BASE_MS ?? '0') * 2 ** attempt,
  isMetaRateLimit: (status: number, body?: { error?: { code?: number } } | null) =>
    status === 429 || body?.error?.code === 4,
  // 鏡像真實 isMetaTransient（Issue #59）：HTTP 5xx／code -1／Fatal／is_transient=true
  isMetaTransient: (
    status: number,
    body?: { error?: { code?: number; message?: string; is_transient?: boolean } } | null,
  ) =>
    (status >= 500 && status <= 599) ||
    body?.error?.code === -1 ||
    body?.error?.is_transient === true ||
    /fatal/i.test(body?.error?.message ?? ''),
  META_RETRY_MAX_ATTEMPTS: 3,
}))

/** 假 Meta 回應（ok／status／headers.get／json／clone 皆具備 graphFetch 所需形狀）。 */
function fakeRes(status: number, body: unknown, retryAfter?: string) {
  const json = async () => body
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k: string) => (k.toLowerCase() === 'retry-after' && retryAfter !== undefined ? retryAfter : null),
    },
    json,
    clone: () => ({ json }),
  }
}

const RATE_LIMIT_BODY = { error: { code: 4, message: 'Application request limit reached' } }

beforeEach(() => {
  vi.restoreAllMocks()
  resetMetaCallPaceForTest()
  process.env.META_PACE_MS = '0'
  process.env.META_RETRY_BASE_MS = '0'
})

afterEach(() => {
  delete process.env.META_PACE_MS
  delete process.env.META_RETRY_BASE_MS
  vi.unstubAllGlobals()
})

describe('graphPost｜Issue #58 節流', () => {
  it('成功直返：只打一次', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeRes(200, { id: 'c1' }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await graphPost('https://graph.example/me', { access_token: 't' })

    expect(out).toEqual({ id: 'c1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('429 後退避再打、不立即重打：第二次成功即回傳', async () => {
    process.env.META_RETRY_BASE_MS = '60'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeRes(429, RATE_LIMIT_BODY))
      .mockResolvedValueOnce(fakeRes(200, { id: 'c2' }))
    vi.stubGlobal('fetch', fetchMock)

    const t0 = Date.now()
    const out = await graphPost('https://graph.example/me', { access_token: 't' })
    const elapsed = Date.now() - t0

    expect(out).toEqual({ id: 'c2' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // 退避 60ms 才重打（非立即）：留 10ms 餘裕防 flake
    expect(elapsed).toBeGreaterThanOrEqual(50)
  })

  it('持續限流：最多打 3 次（首次＋退避×2），用罄拋 MetaRateLimitError', async () => {
    process.env.META_RETRY_BASE_MS = '10'
    const fetchMock = vi.fn().mockResolvedValue(fakeRes(429, RATE_LIMIT_BODY))
    vi.stubGlobal('fetch', fetchMock)

    await expect(graphPost('https://graph.example/me', { access_token: 't' })).rejects.toBeInstanceOf(
      MetaRateLimitError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('非限流錯誤：不重試、直接拋既有訊息', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeRes(400, { error: { code: 190, message: 'bad token' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(graphPost('https://graph.example/me', { access_token: 't' })).rejects.toThrow(
      'Graph POST fail: bad token (190)',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('錯峰：連續兩次呼叫間隔 ≥ META_PACE_MS', async () => {
    process.env.META_PACE_MS = '40'
    const fetchMock = vi.fn().mockResolvedValue(fakeRes(200, { id: 'x' }))
    vi.stubGlobal('fetch', fetchMock)

    const t0 = Date.now()
    await graphPost('https://graph.example/a', {})
    await graphPost('https://graph.example/b', {})
    const elapsed = Date.now() - t0

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(elapsed).toBeGreaterThanOrEqual(35)
  })

  it('Retry-After 優先：照標頭秒數等待再打', async () => {
    process.env.META_RETRY_BASE_MS = '9999'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeRes(429, RATE_LIMIT_BODY, '1'))
      .mockResolvedValueOnce(fakeRes(200, { id: 'c3' }))
    vi.stubGlobal('fetch', fetchMock)

    const t0 = Date.now()
    const out = await graphPost('https://graph.example/me', { access_token: 't' })
    const elapsed = Date.now() - t0

    expect(out).toEqual({ id: 'c3' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Retry-After: 1s（base 9999ms 被蓋過，證明標頭優先）
    expect(elapsed).toBeGreaterThanOrEqual(900)
  })

  // ─── Issue #59：暫態錯誤亦退避重打 ────────────────────────────────
  it('暫態 code -1：重試且最終成功（只多打 1 次）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeRes(400, { error: { code: -1, message: 'Fatal' } }))
      .mockResolvedValueOnce(fakeRes(200, { id: 't1' }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await graphPost('https://graph.example/me', { access_token: 't' })

    expect(out).toEqual({ id: 't1' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('暫態 message 含 Fatal：重試且最終成功', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeRes(400, { error: { code: 1, message: 'Fatal error occurred' } }))
      .mockResolvedValueOnce(fakeRes(200, { id: 't2' }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await graphPost('https://graph.example/me', { access_token: 't' })

    expect(out).toEqual({ id: 't2' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('暫態 HTTP 500：重試且最終成功', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeRes(500, { error: { message: 'Internal error' } }))
      .mockResolvedValueOnce(fakeRes(200, { id: 't3' }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await graphPost('https://graph.example/me', { access_token: 't' })

    expect(out).toEqual({ id: 't3' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('暫態 is_transient=true：重試且最終成功', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeRes(400, { error: { code: 1, message: 'busy', is_transient: true } }))
      .mockResolvedValueOnce(fakeRes(200, { id: 't4' }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await graphPost('https://graph.example/me', { access_token: 't' })

    expect(out).toEqual({ id: 't4' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('真 4xx（code 190）：不重試直接失敗（fetch 只打 1 次）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(fakeRes(400, { error: { code: 190, message: 'Invalid OAuth access token' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(graphPost('https://graph.example/me', { access_token: 't' })).rejects.toThrow(
      'Graph POST fail: Invalid OAuth access token (190)',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('重試用罄：錯誤訊息保留原文（-1／Fatal／5xx detail 可見）', async () => {
    const cases: Array<{ body: unknown; status: number; detail: string }> = [
      { status: 400, body: { error: { code: -1, message: 'Fatal' } }, detail: 'Fatal' },
      { status: 400, body: { error: { code: 1, message: 'Fatal error occurred' } }, detail: 'Fatal error occurred' },
      { status: 500, body: { error: { message: 'Internal error' } }, detail: 'Internal error' },
    ]
    for (const c of cases) {
      resetMetaCallPaceForTest()
      const fetchMock = vi.fn().mockResolvedValue(fakeRes(c.status, c.body))
      vi.stubGlobal('fetch', fetchMock)

      const err = await graphPost('https://graph.example/me', { access_token: 't' }).catch((e) => e)
      expect(err).toBeInstanceOf(MetaRateLimitError)
      expect(String(err?.message)).toContain(c.detail)
      expect(fetchMock).toHaveBeenCalledTimes(3)
    }
  })

  // ─── Issue #61：保留首次 403 根因＋warn 加 endpoint/subcode ────────
  describe('Issue #61｜首次根因保留＋warn 可觀測欄位', () => {
    it('首次 403 code=4 → 末次 400 code=-1：用罄訊息同時含兩者＋已退避重打 2 次', async () => {
      const firstBody = {
        error: { code: 4, error_subcode: 100, message: 'Application request limit reached' },
      }
      const lastBody = { error: { code: -1, message: 'Fatal downstream error' } }
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(fakeRes(403, firstBody))
        .mockResolvedValueOnce(fakeRes(400, lastBody))
        .mockResolvedValueOnce(fakeRes(400, lastBody))
      vi.stubGlobal('fetch', fetchMock)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const err = await graphPost('https://graph.example/me', { access_token: 't' }).catch((e) => e)

      expect(err).toBeInstanceOf(MetaRateLimitError)
      const msg = String(err?.message)
      // 首次根因在前、末次在後
      expect(msg).toContain('首次 HTTP 403 code=4')
      expect(msg).toContain('Application request limit reached')
      expect(msg).toContain('subcode=100')
      expect(msg).toContain('末次 HTTP 400 code=-1')
      expect(msg).toContain('Fatal downstream error')
      expect(msg.indexOf('首次')).toBeLessThan(msg.indexOf('末次'))
      expect(msg).toContain('已退避重打 2 次')
      expect(fetchMock).toHaveBeenCalledTimes(3)
      // 各次 warn 均可區分 attempt（2 次 warn：attempt 1/3、2/3）
      const warns = warnSpy.mock.calls.map((c) => String(c[0]))
      expect(warns).toHaveLength(2)
      expect(warns[0]).toContain('attempt 1/3')
      expect(warns[1]).toContain('attempt 2/3')
      warnSpy.mockRestore()
    })

    it('warn 含 endpoint（僅 origin＋pathname）／status／code／subcode，不含 access_token 明文', async () => {
      const url = 'https://graph.instagram.com/v21.0/12345/media?access_token=SECRET_TOKEN&fields=id'
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          fakeRes(403, { error: { code: 4, error_subcode: 200, message: 'Application request limit reached' } }),
        )
        .mockResolvedValueOnce(fakeRes(200, { id: 'ok' }))
      vi.stubGlobal('fetch', fetchMock)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const out = await graphPost(url, { access_token: 't' })

      expect(out).toEqual({ id: 'ok' })
      expect(warnSpy).toHaveBeenCalledTimes(1)
      const warn = String(warnSpy.mock.calls[0]?.[0])
      expect(warn).toContain('endpoint=https://graph.instagram.com/v21.0/12345/media')
      expect(warn).toContain('HTTP 403')
      expect(warn).toContain('code=4')
      expect(warn).toContain('subcode=200')
      expect(warn).toContain('限流')
      expect(warn).toContain('attempt 1/3')
      expect(warn).not.toContain('SECRET_TOKEN')
      expect(warn).not.toContain('access_token')
      warnSpy.mockRestore()
    })

    it('metaEndpointForLog 只留 origin＋pathname（去 query／錨點，access_token 絕不進 log）', () => {
      expect(metaEndpointForLog('https://graph.facebook.com/v21.0/me/accounts?access_token=SECRET')).toBe(
        'https://graph.facebook.com/v21.0/me/accounts',
      )
      expect(metaEndpointForLog('https://graph.threads.net/v1.0/123/threads_publish?foo=1#frag')).toBe(
        'https://graph.threads.net/v1.0/123/threads_publish',
      )
      // 非 URL 字串不斷言報錯、照樣去 query
      expect(metaEndpointForLog('not-a-url?access_token=x')).toBe('not-a-url')
    })

    it('無 subcode／非 JSON body 時省略不報錯（warn 照樣退避、用罄訊息無 subcode 段）', async () => {
      const badJson = {
        ok: false,
        status: 500,
        headers: { get: () => null },
        json: async () => ({ id: 'unrelated' }),
        clone: () => ({
          json: async () => {
            throw new Error('not json')
          },
        }),
      }
      const fetchMock = vi.fn().mockResolvedValue(badJson)
      vi.stubGlobal('fetch', fetchMock)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const err = await graphPost('https://graph.example/me', { access_token: 't' }).catch((e) => e)

      expect(err).toBeInstanceOf(MetaRateLimitError)
      expect(String(err?.message)).toContain('HTTP 500')
      expect(String(err?.message)).not.toContain('subcode=')
      expect(String(err?.message)).toContain('已退避重打 2 次')
      expect(warnSpy).toHaveBeenCalledTimes(2)
      expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain('subcode=')
      warnSpy.mockRestore()
    })
  })
})
