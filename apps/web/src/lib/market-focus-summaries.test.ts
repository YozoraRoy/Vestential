import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  createQuickLLM: vi.fn(),
  loadConfig: vi.fn(),
  attachLlmUsageRecorder: vi.fn(),
  logMarketFocusEvent: vi.fn(),
}))

vi.mock('@stock/ai-engine', () => ({
  createQuickLLM: mocks.createQuickLLM,
  FALLBACK_SAFE_MAX_TOKENS: 1000,
  chunkByOutputBudget: (items: any[]) => {
    const chunks = []
    for (let i = 0; i < items.length; i += 2) chunks.push(items.slice(i, i + 2))
    return chunks
  },
  mergeChunkEntries: (entries: any[]) => entries,
  sleep: async () => {},
  getChainPaceMs: () => 0,
}))

vi.mock('@stock/core', () => ({ loadConfig: mocks.loadConfig }))
vi.mock('@stock/database', () => ({
  getRecentMarketFocusUrls: vi.fn(),
  saveMarketFocusItems: vi.fn(),
  saveMarketFocusMeta: vi.fn(),
  getMarketFocus: vi.fn(),
  logMarketFocusEvent: mocks.logMarketFocusEvent,
}))
vi.mock('@/lib/llm-usage', () => ({ attachLlmUsageRecorder: mocks.attachLlmUsageRecorder }))
vi.mock('@/lib/market-data', () => ({ fetchTaiwanMarketSummary: vi.fn(), fetchMarketNews: vi.fn() }))

import { generateArticleSummaries } from './market-focus'

describe('generateArticleSummaries 單批逾時隔離 (#203)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.MARKET_FOCUS_SUMMARY_CHUNK_TIMEOUT_MS = '30'
    mocks.loadConfig.mockReturnValue({})
    mocks.logMarketFocusEvent.mockResolvedValue(undefined)
  })

  afterEach(() => {
    delete process.env.MARKET_FOCUS_SUMMARY_CHUNK_TIMEOUT_MS
  })

  it('第 1 批卡死逾時 → 第 1 批退回「核心重點：reason」，第 2 批照常產出', async () => {
    const generate = vi.fn()
      .mockImplementationOnce(() => new Promise(() => {})) // 永不回傳，觸發 30ms timeout
      .mockResolvedValueOnce(
        JSON.stringify({
          summaries: [{ index: 0, summary: '第3則正常摘要', impact_direction: 'positive' }],
        }),
      )

    mocks.createQuickLLM.mockReturnValue({ llm: { generate } })

    const out = await generateArticleSummaries([
      { title: '新聞1', source: '來源A', reason: '理由1' },
      { title: '新聞2', source: '來源A', reason: '理由2' },
      { title: '新聞3', source: '來源B', reason: '理由3' },
    ])

    expect(out).toHaveLength(3)
    expect(out[0]?.summary).toBe('核心重點：理由1')
    expect(out[1]?.summary).toBe('核心重點：理由2')
    expect(out[2]?.summary).toBe('第3則正常摘要')
    expect(mocks.logMarketFocusEvent).toHaveBeenCalledTimes(1)
  })
})
