import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MARKET_FOCUS_STAGE_TIMEOUTS_MS,
  MarketFocusStageTimeoutError,
  fetchMultiSourceCandidates,
  runPipelineStage,
  type MarketFocusStage,
} from './market-focus'

// ─── mocks（沿 social-first-reply.test.ts 慣例隔離 workspace 相依） ──
const mocks = vi.hoisted(() => ({
  createQuickLLM: vi.fn(),
  getAgentSetting: vi.fn(),
  getMarketFocus: vi.fn(),
  getMarketFocusMeta: vi.fn(),
  loadConfig: vi.fn(),
  logMarketFocusEvent: vi.fn(),
  saveMarketFocus: vi.fn(),
  saveMarketFocusMeta: vi.fn(),
  attachLlmUsageRecorder: vi.fn(),
}))

vi.mock('@stock/ai-engine', () => ({
  createQuickLLM: mocks.createQuickLLM,
  FALLBACK_SAFE_MAX_TOKENS: 1000,
  chunkByOutputBudget: vi.fn(),
  mergeChunkEntries: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
  getChainPaceMs: () => 8,
  getSummaryPaceMs: () => 20,
}))
vi.mock('@stock/core', () => ({ loadConfig: mocks.loadConfig }))
vi.mock('@stock/database', () => ({
  getAgentSetting: mocks.getAgentSetting,
  saveMarketFocus: mocks.saveMarketFocus,
  saveMarketFocusMeta: mocks.saveMarketFocusMeta,
  getMarketFocus: mocks.getMarketFocus,
  getMarketFocusMeta: mocks.getMarketFocusMeta,
  logMarketFocusEvent: mocks.logMarketFocusEvent,
}))
vi.mock('@/lib/llm-usage', () => ({ attachLlmUsageRecorder: mocks.attachLlmUsageRecorder }))

const STAGES: MarketFocusStage[] = ['fetch', 'filter', 'crawl', 'summaries', 'summary']
/** 25 分鐘總看門狗（market-focus-job.ts JOB_TIMEOUT_MS，Issue #39 不動）。 */
const JOB_TIMEOUT_MS = 25 * 60 * 1000

describe('Issue #39 pipeline 分段上限', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('五段皆有明確上限，且總和小於 25 分鐘總看門狗', () => {
    for (const s of STAGES) {
      expect(MARKET_FOCUS_STAGE_TIMEOUTS_MS[s]).toBeGreaterThan(0)
    }
    const total = STAGES.reduce((sum, s) => sum + MARKET_FOCUS_STAGE_TIMEOUTS_MS[s], 0)
    expect(total).toBeLessThan(JOB_TIMEOUT_MS)
  })

  it('上限秒數表符合規格（有依據、非拍腦袋）', () => {
    // 依據：正常 run pipeline 全程約 3~4 分鐘（9/26 實測）；總和 20.5min
    expect(MARKET_FOCUS_STAGE_TIMEOUTS_MS).toEqual({
      fetch: 90_000,
      filter: 240_000,
      crawl: 180_000,
      summaries: 480_000,
      summary: 240_000,
    })
  })

  it('正常完成時回傳值＋印心跳（含段名＋耗時）', async () => {
    const onStage = vi.fn()
    const out = await runPipelineStage('fetch', () => Promise.resolve(42), { timeoutMs: 1000, onStage })
    expect(out).toBe(42)
    expect(onStage).toHaveBeenCalledWith('fetch')
    const logs = (console.log as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))
    expect(logs.some((l) => l.includes('[stage=fetch]') && l.includes('start'))).toBe(true)
    expect(logs.some((l) => l.includes('[stage=fetch]') && l.includes('done in'))).toBe(true)
  })

  it('任一段 hanging 都在上限內失敗並指出段名（ACCEPTANCE #4）', async () => {
    for (const stage of STAGES) {
      const onStage = vi.fn()
      const hanging = new Promise<never>(() => {})
      const started = Date.now()
      await expect(runPipelineStage(stage, () => hanging, { timeoutMs: 50, onStage })).rejects.toThrow(
        `[stage=${stage}]`,
      )
      // 遠小於 5 分鐘總上限內失敗（實測 ~50ms）
      expect(Date.now() - started).toBeLessThan(5000)
      expect(onStage).toHaveBeenCalledWith(stage)
      try {
        await runPipelineStage(stage, () => hanging, { timeoutMs: 1 })
        expect.unreachable('應已超時失敗')
      } catch (e) {
        expect(e).toBeInstanceOf(MarketFocusStageTimeoutError)
        expect((e as MarketFocusStageTimeoutError).stage).toBe(stage)
      }
    }
  }, 15000)

  it('段內同步拋錯原樣傳遞（不誤報為超時）', async () => {
    await expect(
      runPipelineStage('filter', () => Promise.reject(new Error('LLM boom')), { timeoutMs: 1000 }),
    ).rejects.toThrow('LLM boom')
  })
})

describe('Issue #39 抓取來源 timeout（ACCEPTANCE #3）', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('cnyes／udn／yahoo 三來源 fetch 皆帶明確 AbortSignal（不再有無超時裸 fetch）', async () => {
    const seen: { url: string; signal: unknown }[] = []
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      seen.push({ url: String(url), signal: init?.signal })
      return { ok: true, status: 200, url: String(url), text: async () => '<html></html>' } as Response
    }) as typeof fetch

    await fetchMultiSourceCandidates()

    // 三來源（cnyes 3 cat＋udn 2＋yahoo 1）皆被呼叫且皆帶 signal
    expect(seen.length).toBeGreaterThanOrEqual(6)
    expect(seen.some((s) => s.url.includes('news.cnyes.com'))).toBe(true)
    expect(seen.some((s) => s.url.includes('money.udn.com'))).toBe(true)
    expect(seen.some((s) => s.url.includes('tw.stock.yahoo.com'))).toBe(true)
    for (const s of seen) {
      expect(s.signal).toBeInstanceOf(AbortSignal)
    }
  })
})
