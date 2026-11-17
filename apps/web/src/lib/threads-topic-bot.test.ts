import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  getAgentSetting: vi.fn(),
  setAgentSetting: vi.fn(),
  hasSocialPosted: vi.fn(),
  createSocialPost: vi.fn(),
  updateSocialPost: vi.fn(),
  dbQueryFirst: vi.fn(),
  publishThreadsReply: vi.fn(),
  graphPost: vi.fn(),
  waitForContainer: vi.fn(),
  getSocialAccessToken: vi.fn(),
}))

vi.mock('@stock/ai-engine', async () => {
  const actual = await vi.importActual<any>('@stock/ai-engine')
  return {
    ...actual,
    createQuickLLM: () => ({ llm: { generate: mocks.generate }, primary: null, fallbackModel: null }),
    LLMFactory: {
      create: () => ({ generate: mocks.generate }),
    },
    FallbackClient: class {
      constructor(private primary: any, private fallbacks: any[]) {}
      async generate(sys: string, usr: string) {
        try {
          return await this.primary.generate(sys, usr)
        } catch {
          return await this.fallbacks[0].generate(sys, usr)
        }
      }
    },
  }
})

vi.mock('@stock/core', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    loadConfig: () => ({ llmProvider: 'deepseek', quickThinkModel: 'deepseek-chat', temperature: 0.7 }),
  }
})

vi.mock('@stock/database', () => ({
  getAgentSetting: mocks.getAgentSetting,
  setAgentSetting: mocks.setAgentSetting,
  hasSocialPosted: mocks.hasSocialPosted,
  createSocialPost: mocks.createSocialPost,
  updateSocialPost: mocks.updateSocialPost,
  dbQueryFirst: mocks.dbQueryFirst,
}))

vi.mock('./llm-usage', () => ({
  attachLlmUsageRecorder: vi.fn(),
}))

vi.mock('./social-tokens', () => ({
  getSocialAccessToken: mocks.getSocialAccessToken,
}))

vi.mock('./social-publish', () => ({
  graphPost: mocks.graphPost,
  waitForContainer: mocks.waitForContainer,
}))

vi.mock('./threads-reply', () => ({
  publishThreadsReply: mocks.publishThreadsReply,
  resolveThreadsPost: vi.fn(),
}))

import {
  createTopicBotLLM,
  evaluateAndDraftTopicReply,
  parseRssTopicItems,
  runTopicBotCycle,
  validateTopicReplyText,
} from './threads-topic-bot'

describe('threads-topic-bot (第 2 小編)', () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...savedEnv }
    mocks.getAgentSetting.mockResolvedValue(null)
    mocks.setAgentSetting.mockResolvedValue(undefined)
    mocks.hasSocialPosted.mockResolvedValue(false)
    mocks.dbQueryFirst.mockResolvedValue({ n: 0 })
    mocks.createSocialPost.mockResolvedValue({ id: 99 })
    mocks.updateSocialPost.mockResolvedValue(undefined)
    mocks.publishThreadsReply.mockResolvedValue({ replyMediaId: 'reply_123', permalink: 'https://www.threads.net/t/reply_123' })
  })

  afterEach(() => {
    process.env = savedEnv
  })

  it('validateTopicReplyText 嚴格把關 15~30 字、禁廣告與禁 AI 味／中國用語', () => {
    expect(validateTopicReplyText('領薪水那天最開心，隔天繳完房租就醒了。').ok).toBe(true)
    expect(validateTopicReplyText('太短了').ok).toBe(false)
    expect(validateTopicReplyText('這是一段超過三十五個字元的超級長回覆，用來測試系統是否會自動把過長像論文一樣的句子擋下來。').ok).toBe(false)
    expect(validateTopicReplyText('歡迎追蹤我看更多分析 https://vestential.com').ok).toBe(false)
    expect(validateTopicReplyText('值得注意的是，這個視頻質量真的很高。').ok).toBe(false)
  })

  it('createTopicBotLLM 支援偵測 FALLBACK2 + FALLBACK 雙免費 Groq Key，未設定則為 paid-only', () => {
    delete process.env.TOPIC_BOT_FREE_LLM_API_KEY
    delete process.env.GROQ_API_KEY
    delete process.env.TOPIC_BOT_FREE_GOOGLE_API_KEY
    delete process.env.FALLBACK_LLM_API_KEY
    delete process.env.FALLBACK_QUICK_LLM_API_KEY
    delete process.env.FALLBACK2_LLM_API_KEY
    delete process.env.FALLBACK2_QUICK_LLM_API_KEY
    expect(createTopicBotLLM().mode).toBe('paid-only')

    process.env.FALLBACK2_QUICK_LLM_API_KEY = 'gsk_free_2'
    process.env.FALLBACK_QUICK_LLM_API_KEY = 'gsk_free_1'
    const res = createTopicBotLLM()
    expect(res.mode).toBe('free-first')
    expect(res.freeLabel).toContain('groq2/')
    expect(res.freeLabel).toContain('groq1/')
  })

  it('evaluateAndDraftTopicReply 在貼文不適合時跳過擬稿', async () => {
    mocks.generate.mockResolvedValueOnce('{"suitable": false, "reason": "純廣告抽獎文"}')
    const res = await evaluateAndDraftTopicReply({
      id: '101',
      username: 'someone',
      text: '按讚分享抽最新手機',
      permalink: 'https://www.threads.net/t/101',
    })
    expect(res.suitable).toBe(false)
    expect(res.replyText).toBe('')
    expect(mocks.generate).toHaveBeenCalledTimes(1)
  })

  it('evaluateAndDraftTopicReply 適合時產出合格 15~30 字回覆', async () => {
    mocks.generate
      .mockResolvedValueOnce('{"suitable": true, "reason": "上班族薪水共鳴"}')
      .mockResolvedValueOnce('「薪水進帳那一秒我也是大富翁，五分鐘後恢復原廠設定。」')

    const res = await evaluateAndDraftTopicReply({
      id: '102',
      username: 'worker_tw',
      text: '剛領薪水帳單就來了，心情好複雜',
      permalink: 'https://www.threads.net/t/102',
    })
    expect(res.suitable).toBe(true)
    expect(res.replyText).toBe('薪水進帳那一秒我也是大富翁，五分鐘後恢復原廠設定。')
  })

  it('runTopicBotCycle 在開關關閉時安全略過，開啟並手動測試時可正常執行', async () => {
    const skipped = await runTopicBotCycle({ dryRun: false })
    expect(skipped.skipped).toContain('關閉')

    mocks.getAgentSetting.mockImplementation(async (k: string) => {
      if (k === 'social.topic_bot_enabled') return 'on'
      return null
    })
    mocks.generate
      .mockResolvedValueOnce('{"suitable": true, "reason": "ETF討論"}')
      .mockResolvedValueOnce('存股存到最後，發現自己其實是在存心酸跟耐心。')

    const run = await runTopicBotCycle({
      dryRun: false,
      manualPost: {
        id: '2001',
        username: 'etf_fan',
        text: '買高股息ETF到底要抱多久才有感？',
        permalink: 'https://www.threads.net/t/2001',
      },
    })
    expect(run.ok).toBe(true)
    expect(run.results).toHaveLength(1)
    expect(run.results[0]?.published).toBe(true)
    expect(mocks.publishThreadsReply).toHaveBeenCalledWith('存股存到最後，發現自己其實是在存心酸跟耐心。', '2001')
  })

  it('parseRssTopicItems 可正確解析 CDATA 與 HTML entity 並產生穩定去重 ID', () => {
    const xml = `<rss><channel>
      <item><title><![CDATA[台積電早盤創高 &amp; 散戶喊不敢追]]></title><link>https://tw.stock.yahoo.com/news/1</link></item>
      <item><title>太短</title><link>https://tw.stock.yahoo.com/news/2</link></item>
    </channel></rss>`
    const items = parseRssTopicItems(xml, 'Yahoo股市', 5)
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toMatch(/^rss-[0-9a-f]{12}$/)
    expect(items[0]?.text).toBe('台積電早盤創高 & 散戶喊不敢追')
    expect(items[0]?.postType).toBe('rss-post')
  })

  it('方案 2：無佇列網址時自動抓取 RSS 並以 @vestential 發布獨立短串文', async () => {
    process.env.THREADS_USER_ID = 'th_user_1'
    mocks.getSocialAccessToken.mockResolvedValue({ token: 'THAA_TOKEN', source: 'db' })
    mocks.graphPost
      .mockResolvedValueOnce({ id: 'container_1' })
      .mockResolvedValueOnce({ id: 'pub_999' })
    mocks.waitForContainer.mockResolvedValue(undefined)
    mocks.getAgentSetting.mockImplementation(async (k: string) => (k === 'social.topic_bot_enabled' ? 'on' : null))
    mocks.generate
      .mockResolvedValueOnce('{"suitable": true, "reason": "台股話題"}')
      .mockResolvedValueOnce('每次猶豫要不要上車，股價就開走了。')

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<rss><channel><item><title>台積電早盤再創波段新高，成交量放大</title><link>https://tw.stock.yahoo.com/news/9</link></item></channel></rss>',
    } as any)

    const run = await runTopicBotCycle({ dryRun: false })
    fetchSpy.mockRestore()

    expect(run.ok).toBe(true)
    expect(run.results).toHaveLength(1)
    expect(run.results[0]?.postType).toBe('rss-post')
    expect(run.results[0]?.published).toBe(true)
    expect(mocks.graphPost).toHaveBeenCalledWith(
      expect.stringContaining('/th_user_1/threads'),
      expect.objectContaining({ media_type: 'TEXT', text: '每次猶豫要不要上車，股價就開走了。' }),
    )
  })
})
