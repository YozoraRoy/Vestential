import { describe, it, expect, vi, beforeEach } from 'vitest'
import { triggerSocialPublish, isSocialEdition } from './social-trigger'

// ─── Issue #62：社群降頻一天一次（僅 00 UTC）＋ admin force 相容 ──────
// social-trigger 的重依賴全部 mock：只斷言 gate／redrive／告警分流，
// 發布本體另由 social-cooldown.test.ts 覆蓋。

const mocks = vi.hoisted(() => ({
  getMarketFocusMeta: vi.fn(),
  getMarketFocus: vi.fn(),
  getAgentSetting: vi.fn(),
  saveSocialCardImage: vi.fn(),
  getSocialCardImage: vi.fn(),
  listDueDeferredSocialPosts: vi.fn(),
  getSocialPost: vi.fn(),
  publishSocialPost: vi.fn(),
  alreadyPosted: vi.fn(),
  republishDeferredPost: vi.fn(),
  sendMarketFocusAlert: vi.fn(),
  generateSocialCaptions: vi.fn(),
  generateMemeConcept: vi.fn(),
  renderSocialCard: vi.fn(),
  generateSocialBackgroundImage: vi.fn(),
  generateSocialArtworkImage: vi.fn(),
}))

vi.mock('@stock/database', () => ({
  getMarketFocusMeta: mocks.getMarketFocusMeta,
  getMarketFocus: mocks.getMarketFocus,
  getAgentSetting: mocks.getAgentSetting,
  saveSocialCardImage: mocks.saveSocialCardImage,
  getSocialCardImage: mocks.getSocialCardImage,
  listDueDeferredSocialPosts: mocks.listDueDeferredSocialPosts,
  getSocialPost: mocks.getSocialPost,
}))

vi.mock('@stock/ai-engine', () => ({
  sleep: async () => {},
  getChainPaceMs: () => 0,
  // 鏡像真實 isSocialEditionTime：UTC 小時 == 0
  isSocialEditionTime: (d: Date = new Date()) => d.getUTCHours() === 0,
}))

vi.mock('@/lib/social', () => ({
  IG_DRIVE_COMMENT: 'drive',
  generateSocialCaptions: mocks.generateSocialCaptions,
  generateMemeConcept: mocks.generateMemeConcept,
}))

vi.mock('@/lib/social-canvas', () => ({
  renderSocialCard: mocks.renderSocialCard,
}))

vi.mock('@/lib/social-ai-image', () => ({
  generateSocialBackgroundImage: mocks.generateSocialBackgroundImage,
  generateSocialArtworkImage: mocks.generateSocialArtworkImage,
}))

vi.mock('@/lib/social-publish', () => ({
  publishSocialPost: mocks.publishSocialPost,
  alreadyPosted: mocks.alreadyPosted,
  postInstagramComment: vi.fn(),
  republishDeferredPost: mocks.republishDeferredPost,
}))

vi.mock('@/lib/threads-reply', () => ({
  publishThreadsReply: vi.fn(async () => ({ replyMediaId: 'r1' })),
}))

vi.mock('@/lib/social-first-reply', () => ({
  generateFirstReplyQuestion: vi.fn(async () => null),
  getFirstReplyMode: vi.fn(async () => 'off'),
  hasFirstReplyPosted: vi.fn(async () => false),
  recordFirstReplyFailed: vi.fn(async () => {}),
  recordFirstReplyPosted: vi.fn(async () => {}),
}))

vi.mock('@/lib/email', () => ({
  sendMarketFocusAlert: mocks.sendMarketFocusAlert,
}))

const AT_00 = new Date('2026-10-13T00:05:00Z')
const AT_06 = new Date('2026-10-13T06:05:00Z')
const AT_12 = new Date('2026-10-13T12:05:00Z')
const AT_18 = new Date('2026-10-13T18:05:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getMarketFocusMeta.mockResolvedValue({ summary: 's', generated_at: '2026-10-13T00:00:00Z' })
  mocks.getMarketFocus.mockResolvedValue([])
  mocks.getAgentSetting.mockResolvedValue('ai')
  mocks.getSocialCardImage.mockResolvedValue(null)
  mocks.saveSocialCardImage.mockResolvedValue(undefined)
  mocks.listDueDeferredSocialPosts.mockResolvedValue([])
  mocks.getSocialPost.mockResolvedValue(null)
  mocks.alreadyPosted.mockResolvedValue(false)
  mocks.publishSocialPost.mockImplementation(async (platform: string) => ({ platform, status: 'published', error: null }))
  mocks.sendMarketFocusAlert.mockResolvedValue(true)
  mocks.generateSocialCaptions.mockResolvedValue({ instagram: 'ig', facebook: 'fb', threads: 'th' })
  mocks.generateMemeConcept.mockResolvedValue(null)
  mocks.renderSocialCard.mockResolvedValue(Buffer.from('img'))
  mocks.generateSocialBackgroundImage.mockResolvedValue(null)
  mocks.generateSocialArtworkImage.mockResolvedValue(null)
})

describe('isSocialEdition｜僅 00 UTC', () => {
  it('00 UTC 回 true；06／12／18 UTC 回 false', () => {
    expect(isSocialEdition(AT_00)).toBe(true)
    expect(isSocialEdition(AT_06)).toBe(false)
    expect(isSocialEdition(AT_12)).toBe(false)
    expect(isSocialEdition(AT_18)).toBe(false)
  })
})

describe('降頻 gate｜06／12／18 UTC 跳過', () => {
  it.each([
    ['06 UTC', AT_06],
    ['12 UTC', AT_12],
    ['18 UTC', AT_18],
  ])('%s：回傳 skip，不呼叫 publish、不寫列、不發告警、不跑 redrive', async (_label, at) => {
    const out = await triggerSocialPublish({ now: at })

    expect(out.triggered).toBe(false)
    expect(out.skipped).toBe(true)
    expect(out.message).toContain('skip')
    expect(mocks.publishSocialPost).not.toHaveBeenCalled()
    expect(mocks.listDueDeferredSocialPosts).not.toHaveBeenCalled()
    expect(mocks.sendMarketFocusAlert).not.toHaveBeenCalled()
  })

  it('00 UTC：照常發布且跑 redrive', async () => {
    const out = await triggerSocialPublish({ now: AT_00 })

    expect(out.triggered).toBe(true)
    expect(mocks.listDueDeferredSocialPosts).toHaveBeenCalledTimes(1)
    expect(mocks.publishSocialPost).toHaveBeenCalledTimes(3)
  })

  it('dryRun 不受 gate 影響（06 UTC 照樣預覽）', async () => {
    const out = await triggerSocialPublish({ dryRun: true, now: AT_06 })

    expect(out.triggered).toBe(true)
    expect(out.dryRun).toBe(true)
    expect(mocks.publishSocialPost).not.toHaveBeenCalled()
  })
})

describe('alreadyPosted 去重不受降頻破壞', () => {
  it('同 edition 已 published 重跑 → 不重發（維持既有去重）', async () => {
    mocks.alreadyPosted.mockResolvedValue(true)

    const out = await triggerSocialPublish({ now: AT_00 })

    expect(out.triggered).toBe(false)
    expect(out.skipped).toBe(true)
    expect(mocks.publishSocialPost).not.toHaveBeenCalled()
    expect(mocks.sendMarketFocusAlert).not.toHaveBeenCalled()
  })
})

describe('admin force 相容', () => {
  it('06 UTC＋force：跳過 gate 照發、不跑 redrive', async () => {
    const out = await triggerSocialPublish({ force: true, now: AT_06 })

    expect(out.triggered).toBe(true)
    expect(mocks.publishSocialPost).toHaveBeenCalled()
    expect(mocks.listDueDeferredSocialPosts).not.toHaveBeenCalled()
  })
})

describe('告警分流｜deferred 冷卻 vs 終態 force', () => {
  it('deferred 結果 → 冷卻告警（含 spam suspected, subcode 2207051），不走部分失敗口徑', async () => {
    mocks.publishSocialPost.mockImplementation(async (platform: string) =>
      platform === 'instagram'
        ? { platform, status: 'deferred', error: 'IG suspected spam (spam suspected, subcode 2207051): HTTP 403' }
        : { platform, status: 'published', error: null },
    )
    mocks.getSocialPost.mockResolvedValue({ next_retry_at: '2026-10-14T00:00:00.000Z' })

    await triggerSocialPublish({ now: AT_00 })

    const topics = mocks.sendMarketFocusAlert.mock.calls.map((c) => String(c[0]))
    const bodies = mocks.sendMarketFocusAlert.mock.calls.map((c) => String(c[1]))
    expect(topics.some((t) => t.includes('冷卻'))).toBe(true)
    expect(topics.some((t) => t.includes('部分失敗'))).toBe(false)
    expect(bodies.join('\n')).toContain('spam suspected, subcode 2207051')
  })

  it('redrive 終態 → 另發「等人工 force」信', async () => {
    mocks.listDueDeferredSocialPosts.mockResolvedValue([
      { id: 7, platform: 'instagram', edition_key: '2026-10-12T00:00:00Z', status: 'deferred', next_retry_at: '2026-10-13T00:00:00.000Z' },
    ])
    mocks.republishDeferredPost.mockResolvedValue({ platform: 'instagram', status: 'deferred', error: 'second bang' })

    await triggerSocialPublish({ now: AT_00 })

    expect(mocks.republishDeferredPost).toHaveBeenCalledTimes(1)
    const topics = mocks.sendMarketFocusAlert.mock.calls.map((c) => String(c[0]))
    const bodies = mocks.sendMarketFocusAlert.mock.calls.map((c) => String(c[1]))
    expect(topics.some((t) => t.includes('force'))).toBe(true)
    expect(bodies.join('\n')).toContain('force')
  })
})
