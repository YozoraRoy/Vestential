import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  graphPost,
  MetaRateLimitError,
  resetMetaCallPaceForTest,
} from './social-publish'

// ─── Issue #58：Meta 節流行為單測 ────────────────────────────────────
// graphFetch 是唯一的 Meta choke point：錯峰（META_PACE_MS）＋限流退避重打
// （META_RETRY_BASE_MS×2^n）。ai-engine 以「可控的等價行為」mock（0 間隔預設），
// 限流判定只認「HTTP 429 或 code=4」（分類器全集另由 ai-engine budget.test.ts 斷言）。

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
})
