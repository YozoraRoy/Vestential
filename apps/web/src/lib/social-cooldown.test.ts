import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  publishSocialPost,
  republishDeferredPost,
  checkContentPublishingLimit,
  logMetaUsage,
  resetMetaCallPaceForTest,
} from './social-publish'

// ─── Issue #62：IG 2207051 冷卻延後＋社群降頻 ────────────────────────
// ai-engine 以「可控的等價行為」mock（0 間隔；分類器鏡像真實實作：
// code=4＋subcode=2207051 才是 spam，含 wrapped 雙層 error.error；
// 其餘 code=4 維持限流、-1／Fatal 維持暫態，分類器全集另由 budget.test.ts 斷言）。

const db = vi.hoisted(() => ({ rows: new Map<string, any>(), seq: 1 }))
const dbKey = (platform: string, edition: string) => `${platform}::${edition}`

vi.mock('@stock/database', () => ({
  hasSocialPosted: vi.fn(async (platform: string, editionKey: string) => {
    const r = db.rows.get(dbKey(platform, editionKey))
    return !!r && r.status === 'published'
  }),
  createSocialPost: vi.fn(async (input: { platform: string; editionKey: string; content: string; imageUrl?: string | null }) => {
    const k = dbKey(input.platform, input.editionKey)
    const existing = db.rows.get(k)
    if (existing) return existing
    const row = {
      id: db.seq++,
      platform: input.platform,
      edition_key: input.editionKey,
      content: input.content,
      image_url: input.imageUrl ?? null,
      status: 'pending',
      container_id: null,
      external_id: null,
      error: null,
      published_at: null,
      comment_status: null,
      comment_external_id: null,
      comment_error: null,
      next_retry_at: null,
      retry_count: 0,
      first_error: null,
      created_at: '2026-10-12 00:00:00',
    }
    db.rows.set(k, row)
    return row
  }),
  updateSocialPost: vi.fn(async (id: number, patch: Record<string, unknown>) => {
    for (const r of db.rows.values()) {
      if (r.id === id) {
        Object.assign(r, patch)
        return
      }
    }
  }),
  deleteSocialPostByEdition: vi.fn(async (platform: string, editionKey: string) => {
    db.rows.delete(dbKey(platform, editionKey))
  }),
  getSocialPost: vi.fn(async (platform: string, editionKey: string) => db.rows.get(dbKey(platform, editionKey))),
  listDueDeferredSocialPosts: vi.fn(async (nowIso: string) =>
    [...db.rows.values()]
      .filter((r) => r.status === 'deferred' && r.next_retry_at != null && r.next_retry_at <= nowIso)
      .sort((a, b) => (a.next_retry_at < b.next_retry_at ? -1 : 1)),
  ),
}))

function unwrapCode(body: any): { code: number | null; subcode: number | null } {
  let node = body?.error
  for (let i = 0; i < 4 && node && typeof node === 'object'; i++) {
    if (node.error && typeof node.error === 'object') node = node.error
    else break
  }
  return {
    code: typeof node?.code === 'number' ? node.code : null,
    subcode: typeof node?.error_subcode === 'number' ? node.error_subcode : null,
  }
}

vi.mock('@stock/ai-engine', () => ({
  getMetaPaceMs: () => 0,
  getMetaBackoffMs: () => 0,
  isMetaRateLimit: (status: number, body?: any | null) => {
    if (status === 429) return true
    return unwrapCode(body).code === 4
  },
  isMetaTransient: (status: number, body?: any | null) => {
    if (status >= 500 && status <= 599) return true
    const { code } = unwrapCode(body)
    if (code === -1) return true
    if (body?.error?.is_transient === true) return true
    return /fatal/i.test(body?.error?.message ?? '')
  },
  // 鏡像真實 isMetaSpamSuspected：code=4＋subcode=2207051（含 wrapped）
  isMetaSpamSuspected: (_status: number, body?: any | null) => {
    const { code, subcode } = unwrapCode(body)
    return code === 4 && subcode === 2207051
  },
  extractMetaError: (body?: any | null) => {
    const { code, subcode } = unwrapCode(body)
    let node = body?.error
    for (let i = 0; i < 4 && node && typeof node === 'object'; i++) {
      if (node.error && typeof node.error === 'object') node = node.error
      else break
    }
    return { code, subcode, message: typeof node?.message === 'string' ? node.message : '' }
  },
  MetaSpamSuspectedError: class MetaSpamSuspectedError extends Error {
    readonly subcode = 2207051
    constructor(message: string) {
      super(message)
      this.name = 'MetaSpamSuspectedError'
    }
  },
  getNextSocialEditionAt: (from: Date = new Date()) => {
    const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0, 0))
    if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1)
    return next
  },
  META_RETRY_MAX_ATTEMPTS: 3,
}))

vi.mock('@/lib/social', () => ({
  IG_DRIVE_COMMENT: 'drive comment',
}))

/** 假 Meta 回應（graphFetch 所需形狀：ok／status／headers.get／json／clone）。 */
function fakeRes(status: number, body: unknown, headers?: Record<string, string>) {
  const json = async () => body
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers ?? {})) lower[k.toLowerCase()] = v
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
    json,
    clone: () => ({ json }),
  }
}

const SPAM_BODY = { error: { code: 4, error_subcode: 2207051, message: 'The publishing action is suspected to be spam' } }
const WRAPPED_SPAM_BODY = { error: { error: { code: 4, error_subcode: 2207051, message: 'suspected spam' } } }
const HEALTHY_LIMIT = { data: [{ quota_total: 50, quota_used: 3 }] }

function fetchMockWith(scenarios: Array<{ match: (url: string, init?: RequestInit) => boolean; res: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    for (const s of scenarios) {
      if (s.match(url, init)) return s.res
    }
    throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${url}`)
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}

const isPost = (_url: string, init?: RequestInit) => init?.method === 'POST'
const urlHas = (part: string) => (url: string) => url.includes(part)

function nextEditionIsoNow(): string {
  const from = new Date()
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0, 0))
  if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString()
}

beforeEach(() => {
  vi.clearAllMocks()
  resetMetaCallPaceForTest()
  db.rows.clear()
  db.seq = 1
  process.env.IG_ACCESS_TOKEN = 'test-token'
  process.env.IG_USER_ID = '999'
})

afterEach(() => {
  delete process.env.IG_ACCESS_TOKEN
  delete process.env.IG_USER_ID
  vi.unstubAllGlobals()
})

describe('2207051 分流為冷卻型（不進熱重試）', () => {
  it('media POST 命中 2207051 → deferred，POST 只打 1 次', async () => {
    const { fn, calls } = fetchMockWith([
      { match: urlHas('content_publishing_limit'), res: fakeRes(200, HEALTHY_LIMIT) },
      { match: (u, i) => isPost(u, i) && u.includes('/media'), res: fakeRes(403, SPAM_BODY) },
    ])

    const out = await publishSocialPost('instagram', 'ed-1', 'content', 'https://img/x.jpg')

    expect(out.status).toBe('deferred')
    expect(out.error).toContain('spam suspected, subcode 2207051')
    const mediaPosts = calls.filter((c) => isPost(c.url, c.init) && c.url.includes('/media'))
    expect(mediaPosts).toHaveLength(1)
    expect(fn).toHaveBeenCalledTimes(2) // limit GET＋media POST，不熱重試
  })

  it('wrapped 雙層 error.error 照樣判 spam（不熱重試）', async () => {
    const { calls } = fetchMockWith([
      { match: urlHas('content_publishing_limit'), res: fakeRes(200, HEALTHY_LIMIT) },
      { match: (u, i) => isPost(u, i) && u.includes('/media'), res: fakeRes(403, WRAPPED_SPAM_BODY) },
    ])

    const out = await publishSocialPost('instagram', 'ed-wrapped', 'content', 'https://img/x.jpg')

    expect(out.status).toBe('deferred')
    expect(out.error).toContain('spam suspected, subcode 2207051')
    expect(calls.filter((c) => isPost(c.url, c.init))).toHaveLength(1)
  })

  it('首次 deferred 記 next_retry_at＝下一個 00 UTC、retry_count＋1、first_error 留根因', async () => {
    fetchMockWith([
      { match: urlHas('content_publishing_limit'), res: fakeRes(200, HEALTHY_LIMIT) },
      { match: (u, i) => isPost(u, i) && u.includes('/media'), res: fakeRes(403, SPAM_BODY) },
    ])

    await publishSocialPost('instagram', 'ed-2', 'content', 'https://img/x.jpg')

    const row = db.rows.get(dbKey('instagram', 'ed-2'))
    expect(row.status).toBe('deferred')
    expect(row.next_retry_at).toBe(nextEditionIsoNow())
    expect(row.retry_count).toBe(1)
    expect(row.first_error).toContain('2207051')
    expect(row.error).toContain('spam suspected, subcode 2207051')
  })
})

describe('冷卻到期重打 exactly once（single-shot）', () => {
  async function seedDeferred(edition: string, firstError = 'first 2207051 boom') {
    fetchMockWith([
      { match: urlHas('content_publishing_limit'), res: fakeRes(200, HEALTHY_LIMIT) },
      { match: (u, i) => isPost(u, i) && u.includes('/media'), res: fakeRes(403, SPAM_BODY) },
    ])
    await publishSocialPost('instagram', edition, 'content', 'https://img/x.jpg')
    const row = db.rows.get(dbKey('instagram', edition))
    row.first_error = firstError
    row.next_retry_at = '2020-01-01T00:00:00.000Z' // 已到期
    return row
  }

  it('到期重打成功 → published（media POST 只打 1 次）', async () => {
    const row = await seedDeferred('ed-retry-ok')
    const { calls } = fetchMockWith([
      { match: urlHas('content_publishing_limit'), res: fakeRes(200, HEALTHY_LIMIT) },
      { match: (u, i) => isPost(u, i) && u.includes('/media') && !u.includes('media_publish'), res: fakeRes(200, { id: 'c1' }) },
      { match: (u, i) => !isPost(u, i) && u.includes('c1?fields='), res: fakeRes(200, { status_code: 'FINISHED' }) },
      { match: (u, i) => isPost(u, i) && u.includes('media_publish'), res: fakeRes(200, { id: 'pub1' }) },
      { match: (u, i) => isPost(u, i) && u.includes('/comments'), res: fakeRes(200, { id: 'cm1' }) },
    ])

    const out = await republishDeferredPost(row)

    expect(out.status).toBe('published')
    const mediaPosts = calls.filter(
      (c) => isPost(c.url, c.init) && c.url.includes('/999/media') && !c.url.includes('media_publish'),
    )
    expect(mediaPosts).toHaveLength(1)
    expect(db.rows.get(dbKey('instagram', 'ed-retry-ok')).status).toBe('published')
  })

  it('重打再失敗 → 終態 deferred（next_retry_at=null、retry_count＋1、first_error 保留首次）', async () => {
    const row = await seedDeferred('ed-retry-fail')
    fetchMockWith([
      { match: urlHas('content_publishing_limit'), res: fakeRes(200, HEALTHY_LIMIT) },
      {
        match: (u, i) => isPost(u, i) && u.includes('/media'),
        res: fakeRes(403, { error: { code: 4, error_subcode: 2207051, message: 'second 2207051 bang' } }),
      },
    ])

    const out = await republishDeferredPost(row)

    expect(out.status).toBe('deferred')
    const after = db.rows.get(dbKey('instagram', 'ed-retry-fail'))
    expect(after.status).toBe('deferred')
    expect(after.next_retry_at).toBeNull()
    expect(after.retry_count).toBe(2)
    expect(after.first_error).toBe('first 2207051 boom')
    expect(after.error).toContain('second 2207051 bang')
  })
})

describe('發前 content_publishing_limit 檢查', () => {
  it('額度不足 → 直接 deferred（POST 0 次）', async () => {
    const { calls } = fetchMockWith([
      { match: urlHas('content_publishing_limit'), res: fakeRes(200, { data: [{ quota_total: 50, quota_used: 50 }] }) },
    ])

    const out = await publishSocialPost('instagram', 'ed-quota', 'content', 'https://img/x.jpg')

    expect(out.status).toBe('deferred')
    expect(out.error).toContain('content_publishing_limit')
    expect(calls.filter((c) => isPost(c.url, c.init))).toHaveLength(0)
    const row = db.rows.get(dbKey('instagram', 'ed-quota'))
    expect(row.status).toBe('deferred')
    expect(row.retry_count).toBe(1)
  })

  it('端點異常（HTTP 500）→ fail-open 照發', async () => {
    const { calls } = fetchMockWith([
      { match: urlHas('content_publishing_limit'), res: fakeRes(500, { error: { message: 'boom' } }) },
      { match: (u, i) => isPost(u, i) && u.includes('/media') && !u.includes('media_publish'), res: fakeRes(200, { id: 'c2' }) },
      { match: (u, i) => !isPost(u, i) && u.includes('c2?fields='), res: fakeRes(200, { status_code: 'FINISHED' }) },
      { match: (u, i) => isPost(u, i) && u.includes('media_publish'), res: fakeRes(200, { id: 'pub2' }) },
      { match: (u, i) => isPost(u, i) && u.includes('/comments'), res: fakeRes(200, { id: 'cm2' }) },
    ])
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const out = await publishSocialPost('instagram', 'ed-failopen', 'content', 'https://img/x.jpg')

    expect(out.status).toBe('published')
    expect(
      calls.filter((c) => isPost(c.url, c.init) && c.url.includes('/999/media') && !c.url.includes('media_publish')),
    ).toHaveLength(1)
    expect(warnSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('fail-open')
    warnSpy.mockRestore()
  })

  it('格式未預期 → fail-open 照發', async () => {
    const check = await (async () => {
      fetchMockWith([{ match: urlHas('content_publishing_limit'), res: fakeRes(200, { weird: true }) }])
      return checkContentPublishingLimit('999', 'tok')
    })()
    expect(check.ok).toBe(true)
  })
})

describe('header 可觀測 logMetaUsage', () => {
  it('有 x-app-usage header → 記 [MetaUsage]；無 header → 不打擾', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    logMetaUsage(
      'https://graph.instagram.com/v21.0/999/media',
      fakeRes(200, { id: 'x' }, { 'x-app-usage': '{"call_count":3}', 'x-business-use-case-usage': '{"used":1}' }) as unknown as Response,
    )
    logMetaUsage('https://graph.instagram.com/v21.0/999/media', fakeRes(200, { id: 'x' }) as unknown as Response)

    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(String(infoSpy.mock.calls[0]?.[0])).toContain('[MetaUsage]')
    infoSpy.mockRestore()
  })
})

describe('2207085 維持 #59 行為（熱重試，不走冷卻）', () => {
  it('code -1／Fatal 後成功 → 只多打 1 次且 published', async () => {
    let mediaAttempts = 0
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url.includes('content_publishing_limit')) return fakeRes(200, HEALTHY_LIMIT)
        if ((init?.method ?? 'GET') === 'POST' && url.includes('/999/media') && !url.includes('media_publish')) {
          mediaAttempts++
          if (mediaAttempts === 1) return fakeRes(400, { error: { code: -1, message: 'Fatal' } })
          return fakeRes(200, { id: 'c9' })
        }
        if (url.includes('c9?fields=')) return fakeRes(200, { status_code: 'FINISHED' })
        if (url.includes('media_publish')) return fakeRes(200, { id: 'pub9' })
        if (url.includes('/comments')) return fakeRes(200, { id: 'cm9' })
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )

    const out = await publishSocialPost('instagram', 'ed-7085', 'content', 'https://img/x.jpg')

    expect(out.status).toBe('published')
    expect(mediaAttempts).toBe(2)
  })
})
