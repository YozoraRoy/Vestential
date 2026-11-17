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
  resolveThreadsPost: vi.fn(),
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

vi.mock('./threads-reply', () => ({
  publishThreadsReply: mocks.publishThreadsReply,
  resolveThreadsPost: mocks.resolveThreadsPost,
}))

import {
  createTopicBotLLM,
  discoverExternalThreadsUrls,
  discoverExternalThreadsUrlsViaGoogleCse,
  evaluateAndDraftTopicReply,
  filterExternalThreadsUrls,
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

  it('filterExternalThreadsUrls 僅保留他人 /post/ 網址並排除自家 @vestential', () => {
    const filtered = filterExternalThreadsUrls([
      'https://www.threads.net/@vestential/post/ABC123',
      'https://www.threads.com/@investor_tw/post/XYZ789?xmt=1',
      'https://www.threads.net/@investor_tw/post/XYZ789',
      'https://www.threads.net/@someone_only_profile',
    ])
    expect(filtered).toEqual(['https://www.threads.net/@investor_tw/post/XYZ789'])
  })

  it('Google CSE：未設定時明確提示；已設定時自動找他人貼文並以 reply_to_id 回覆', async () => {
    delete process.env.GOOGLE_CSE_API_KEY
    delete process.env.GOOGLE_CSE_ID
    const missing = await discoverExternalThreadsUrlsViaGoogleCse('台股')
    expect(missing.ok).toBe(false)
    expect(missing.cseMissing).toBe(true)

    process.env.GOOGLE_CSE_API_KEY = 'cse_key'
    process.env.GOOGLE_CSE_ID = 'cse_cx'
    mocks.getAgentSetting.mockImplementation(async (k: string) => (k === 'social.topic_bot_enabled' ? 'on' : null))
    mocks.resolveThreadsPost.mockResolvedValueOnce({
      shortcode: 'XYZ789',
      mediaId: '99887766',
      author: 'investor_tw',
      text: '今天台積電又創新高，空手的人心情好複雜',
      permalink: 'https://www.threads.net/@investor_tw/post/XYZ789',
    })
    mocks.generate
      .mockResolvedValueOnce('{"suitable": true, "reason": "台股共鳴"}')
      .mockResolvedValueOnce('猶豫要不要上車的時候，車子已經開到交流道了。')

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { link: 'https://www.threads.net/@vestential/post/SELF1' },
          { link: 'https://www.threads.com/@investor_tw/post/XYZ789' },
        ],
      }),
    } as any)

    const run = await runTopicBotCycle({ dryRun: false })
    fetchSpy.mockRestore()

    expect(run.ok).toBe(true)
    expect(run.results).toHaveLength(1)
    expect(run.results[0]?.published).toBe(true)
    expect(mocks.publishThreadsReply).toHaveBeenCalledWith('猶豫要不要上車的時候，車子已經開到交流道了。', '99887766')
  })

  it('Bright Data SERP 優先；失敗時自動降級至 Google CSE 備選', async () => {
    process.env.BRIGHTDATA_API_KEY = 'bd_key'
    process.env.BRIGHTDATA_ZONE = 'serp_api1'
    process.env.GOOGLE_CSE_API_KEY = 'cse_key'
    process.env.GOOGLE_CSE_ID = 'cse_cx'

    // 1. Bright Data 成功時直接使用 Bright Data 結果
    const fetchSpy1 = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ organic: [{ link: 'https://www.threads.net/@other_user/post/BD001' }] }),
    } as any)
    const okBd = await discoverExternalThreadsUrls('台股')
    fetchSpy1.mockRestore()
    expect(okBd.ok).toBe(true)
    expect(okBd.provider).toBe('brightdata')
    expect(okBd.urls).toEqual(['https://www.threads.net/@other_user/post/BD001'])

    // 2. Bright Data 失敗（例如 403）時自動降級至 Google CSE
    const fetchSpy2 = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'Zone disabled' } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ link: 'https://www.threads.net/@other_user/post/CSE002' }] }),
      } as any)
    const fallbackCse = await discoverExternalThreadsUrls('台股')
    fetchSpy2.mockRestore()
    expect(fallbackCse.ok).toBe(true)
    expect(fallbackCse.provider).toBe('google-cse')
    expect(fallbackCse.urls).toEqual(['https://www.threads.net/@other_user/post/CSE002'])
  })
})
