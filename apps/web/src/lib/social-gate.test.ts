import { describe, it, expect, vi, beforeEach } from 'vitest'
import { triggerSocialPublish, isSocialEdition, getSocialDayStartUtcWall } from './social-trigger'

// ─── Issue #79：社群降頻改走 DB gate（當日 UTC 有 published 即跳過） ───
// social-trigger 的重依賴全部 mock：只斷言 gate／redrive／告警分流，
// SQL 時間窗行為另由 packages/database/test/social-gate-db.test.ts（真 SQLite）覆蓋，
// 發布本體另由 social-cooldown.test.ts 覆蓋。

const mocks = vi.hoisted(() => ({
  getMarketFocusMeta: vi.fn(),
  getMarketFocus: vi.fn(),
  getAgentSetting: vi.fn(),
  saveSocialCardImage: vi.fn(),
  getSocialCardImage: vi.fn(),
  listDueDeferredSocialPosts: vi.fn(),
  getSocialPost: vi.fn(),
  hasAnySocialPublishedSince: vi.fn(),
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
  hasAnySocialPublishedSince: mocks.hasAnySocialPublishedSince,
}))

vi.mock('@stock/ai-engine', () => ({
  sleep: async () => {},
  getChainPaceMs: () => 0,
  // social-trigger 仍 import 舊 hour gate（deprecated 墊片不斷鏈），此處保留鏡像
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
// Issue #79：重現 2026-10-14 場景——表定 00:00 的班次 03:02 才執行
const AT_0302_DELAYED = new Date('2026-10-14T03:02:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getMarketFocusMeta.mockResolvedValue({ summary: 's', generated_at: '2026-10-13T00:00:00Z' })
  mocks.getMarketFocus.mockResolvedValue([])
  mocks.getAgentSetting.mockResolvedValue('ai')
  mocks.getSocialCardImage.mockResolvedValue(null)
  mocks.saveSocialCardImage.mockResolvedValue(undefined)
  mocks.listDueDeferredSocialPosts.mockResolvedValue([])
  mocks.getSocialPost.mockResolvedValue(null)
  mocks.hasAnySocialPublishedSince.mockResolvedValue(false)
  mocks.alreadyPosted.mockResolvedValue(false)
  mocks.publishSocialPost.mockImplementation(async (platform: string) => ({ platform, status: 'published', error: null }))
  mocks.sendMarketFocusAlert.mockResolvedValue(true)
  mocks.generateSocialCaptions.mockResolvedValue({ instagram: 'ig', facebook: 'fb', threads: 'th' })
  mocks.generateMemeConcept.mockResolvedValue(null)
  mocks.renderSocialCard.mockResolvedValue(Buffer.from('img'))
  mocks.generateSocialBackgroundImage.mockResolvedValue(null)
  mocks.generateSocialArtworkImage.mockResolvedValue(null)
})

describe('getSocialDayStartUtcWall｜UTC 日曆日邊界', () => {
  it('同日任意時刻皆歸到當日 00:00:00 wall-clock', () => {
    expect(getSocialDayStartUtcWall(new Date('2026-10-14T03:02:00Z'))).toBe('2026-10-14 00:00:00')
    expect(getSocialDayStartUtcWall(new Date('2026-10-14T00:00:00.000Z'))).toBe('2026-10-14 00:00:00')
    expect(getSocialDayStartUtcWall(new Date('2026-10-14T23:59:59Z'))).toBe('2026-10-14 00:00:00')
  })

  it('跨日切換：昨日 23:59 與今日 00:00 歸屬不同日', () => {
    expect(getSocialDayStartUtcWall(new Date('2026-10-13T23:59:59Z'))).toBe('2026-10-13 00:00:00')
    expect(getSocialDayStartUtcWall(new Date('2026-10-14T00:00:00Z'))).toBe('2026-10-14 00:00:00')
  })
})

describe('DB gate｜延遲執行仍會發（10/14 重現）', () => {
  it('03:02 非 00 時＋當日無 published → triggered=true，各平台照發', async () => {
    const out = await triggerSocialPublish({ now: AT_0302_DELAYED })

    expect(out.triggered).toBe(true)
    expect(mocks.hasAnySocialPublishedSince).toHaveBeenCalledWith('2026-10-14 00:00:00')
    expect(mocks.publishSocialPost).toHaveBeenCalledTimes(3)
  })

  it('非 00 時（06 UTC）＋當日未發 → 會發（舊 hour gate 跳過斷言按新語義改寫）', async () => {
    const out = await triggerSocialPublish({ now: AT_06 })

    expect(out.triggered).toBe(true)
    expect(mocks.hasAnySocialPublishedSince).toHaveBeenCalledWith('2026-10-13 00:00:00')
    expect(mocks.publishSocialPost).toHaveBeenCalled()
  })

  it('00 UTC＋當日未發 → 照常發布且跑 redrive', async () => {
    const out = await triggerSocialPublish({ now: AT_00 })

    expect(out.triggered).toBe(true)
    expect(mocks.listDueDeferredSocialPosts).toHaveBeenCalledTimes(1)
    expect(mocks.publishSocialPost).toHaveBeenCalledTimes(3)
  })

  it('dryRun 不受 gate 影響（06 UTC 照樣預覽，不讀 DB gate）', async () => {
    const out = await triggerSocialPublish({ dryRun: true, now: AT_06 })

    expect(out.triggered).toBe(true)
    expect(out.dryRun).toBe(true)
    expect(mocks.hasAnySocialPublishedSince).not.toHaveBeenCalled()
    expect(mocks.publishSocialPost).not.toHaveBeenCalled()
  })
})

describe('DB gate｜同日第二跑跳過（一天一次）', () => {
  it('當日已有 published → triggered=false skipped，不發文、不告警、不跑 redrive', async () => {
    mocks.hasAnySocialPublishedSince.mockResolvedValue(true)

    const out = await triggerSocialPublish({ now: AT_0302_DELAYED })

    expect(out.triggered).toBe(false)
    expect(out.skipped).toBe(true)
    expect(mocks.publishSocialPost).not.toHaveBeenCalled()
    expect(mocks.listDueDeferredSocialPosts).not.toHaveBeenCalled()
    expect(mocks.sendMarketFocusAlert).not.toHaveBeenCalled()
  })
})

describe('DB gate｜failed／deferred 不阻擋＋跨日', () => {
  it('當日僅 failed／deferred（無 published，gate 回 false）→ 照發', async () => {
    mocks.hasAnySocialPublishedSince.mockResolvedValue(false)

    const out = await triggerSocialPublish({ now: AT_0302_DELAYED })

    expect(out.triggered).toBe(true)
    expect(mocks.publishSocialPost).toHaveBeenCalledTimes(3)
  })

  it('昨日有 published、今日無（gate 以今日 dayStart 查回 false）→ 今日照發', async () => {
    mocks.hasAnySocialPublishedSince.mockResolvedValue(false)

    const out = await triggerSocialPublish({ now: new Date('2026-10-14T00:30:00Z') })

    expect(mocks.hasAnySocialPublishedSince).toHaveBeenCalledWith('2026-10-14 00:00:00')
    expect(out.triggered).toBe(true)
    expect(mocks.publishSocialPost).toHaveBeenCalled()
  })
})

describe('redrive 語意｜gate 通過＋非 force＋非 dryRun 才跑', () => {
  it('gate 通過 → listDueDeferredSocialPosts 跑 1 次', async () => {
    await triggerSocialPublish({ now: AT_0302_DELAYED })

    expect(mocks.listDueDeferredSocialPosts).toHaveBeenCalledTimes(1)
  })

  it('gate 跳過（當日已發）→ 不跑 redrive', async () => {
    mocks.hasAnySocialPublishedSince.mockResolvedValue(true)

    await triggerSocialPublish({ now: AT_0302_DELAYED })

    expect(mocks.listDueDeferredSocialPosts).not.toHaveBeenCalled()
  })

  it('force → 不跑 redrive', async () => {
    await triggerSocialPublish({ force: true, now: AT_06 })

    expect(mocks.listDueDeferredSocialPosts).not.toHaveBeenCalled()
  })
})

describe('alreadyPosted 去重不受 DB gate 破壞', () => {
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
  it('06 UTC＋force：跳過 DB gate 照發、不查 gate、不跑 redrive', async () => {
    const out = await triggerSocialPublish({ force: true, now: AT_06 })

    expect(out.triggered).toBe(true)
    expect(mocks.hasAnySocialPublishedSince).not.toHaveBeenCalled()
    expect(mocks.publishSocialPost).toHaveBeenCalled()
    expect(mocks.listDueDeferredSocialPosts).not.toHaveBeenCalled()
  })
})

describe('舊函式去留｜deprecated 墊片不斷鏈', () => {
  it('isSocialEdition 仍匯出（hour gate 語義凍結，gate 本體已改走 DB）', () => {
    expect(isSocialEdition(AT_00)).toBe(true)
    expect(isSocialEdition(AT_06)).toBe(false)
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
