import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchTrumpNews,
  fetchMultiSourceCandidates,
  sanitizeTrumpWind,
  NO_TRUMP_WIND,
  SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
} from './market-focus'

// ─── mocks（沿 market-focus-stages.test.ts 慣例隔離 workspace 相依） ──
const mocks = vi.hoisted(() => ({
  createQuickLLM: vi.fn(),
  getAgentSetting: vi.fn(),
  getMarketFocus: vi.fn(),
  getMarketFocusMeta: vi.fn(),
  saveMarketFocus: vi.fn(),
  saveMarketFocusMeta: vi.fn(),
  saveMarketFocusWind: vi.fn(),
  getMarketFocusWind: vi.fn(),
  loadConfig: vi.fn(),
  logMarketFocusEvent: vi.fn(),
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
  saveMarketFocusWind: mocks.saveMarketFocusWind,
  getMarketFocusWind: mocks.getMarketFocusWind,
  logMarketFocusEvent: mocks.logMarketFocusEvent,
}))
vi.mock('@/lib/llm-usage', () => ({ attachLlmUsageRecorder: mocks.attachLlmUsageRecorder }))

const realFetch = globalThis.fetch

function rssItems(n: number, titlePrefix: string): string {
  const items = Array.from(
    { length: n },
    (_, i) =>
      `<item><title>${titlePrefix} Trump tariff news ${i}</title><link>https://example.com/trump/${i}</link><pubDate>Mon, 29 Sep 2026 08:00:00 GMT</pubDate></item>`,
  ).join('')
  return `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`
}

describe('Issue #49 川普風向燈', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('fetchTrumpNews：獨立上限 8 則＋tag=trump＋英文關鍵字過濾', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      url: 'https://news.google.com/rss/search',
      text: async () => rssItems(10, 'Breaking'),
    })) as unknown as typeof fetch

    const out = await fetchTrumpNews()
    // 4 組查詢各回 10 則同 URL（去重）→ 上限 8 則
    expect(out.length).toBeLessThanOrEqual(8)
    expect(out.length).toBeGreaterThan(0)
    for (const c of out) expect(c.tag).toBe('trump')
  })

  it('fetchTrumpNews：無關鍵字的新聞被擋掉；全失敗回 []（當天無燈，不擋主流程）', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      url: 'https://news.google.com/rss/search',
      text: async () =>
        `<?xml version="1.0"?><rss><channel><item><title>Local weather today</title><link>https://example.com/w</link><pubDate>Mon, 29 Sep 2026 08:00:00 GMT</pubDate></item></channel></rss>`,
    })) as unknown as typeof fetch
    expect(await fetchTrumpNews()).toEqual([])

    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    expect(await fetchTrumpNews()).toEqual([])
  })

  it('fetchMultiSourceCandidates：Trump 池併入但不擠掉台股池預算', async () => {
    const twRss = (tag: string) =>
      `<?xml version="1.0"?><rss><channel>${Array.from(
        { length: 30 },
        (_, i) =>
          `<item><title>台股新聞${tag}-${i}台積電法說</title><link>https://example.com/tw/${tag}/${i}</link><pubDate>Mon, 29 Sep 2026 08:00:00 GMT</pubDate></item>`,
      ).join('')}</channel></rss>`
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url)
      if (u.includes('news.google.com/rss/search')) {
        return { ok: true, status: 200, url: u, text: async () => rssItems(10, 'Breaking') }
      }
      if (u.includes('news.cnyes.com')) return { ok: true, status: 200, url: u, text: async () => '<html></html>' }
      return { ok: true, status: 200, url: u, text: async () => twRss(u.includes('udn') ? 'udn' : 'yahoo') }
    }) as unknown as typeof fetch

    const pool = await fetchMultiSourceCandidates()
    const tw = pool.filter((c) => c.tag !== 'trump')
    const trump = pool.filter((c) => c.tag === 'trump')
    // 台股池維持原 60 預算（不被擠掉），trump 另計上限 8 則
    expect(tw.length).toBeLessThanOrEqual(60)
    expect(trump.length).toBeLessThanOrEqual(8)
    expect(trump.length).toBeGreaterThan(0)
  })

  it('sanitizeTrumpWind：方向非四選一／無 note → none（頁面不渲染）', () => {
    expect(sanitizeTrumpWind({ direction: 'bullish', note: '關稅暫緩，短線壓力降溫' })).toEqual({
      direction: 'bullish',
      note: '關稅暫緩，短線壓力降溫',
    })
    expect(sanitizeTrumpWind({ direction: 'mooning', note: 'xxx' })).toEqual(NO_TRUMP_WIND)
    expect(sanitizeTrumpWind({ direction: 'bullish', note: '' })).toEqual(NO_TRUMP_WIND)
    expect(sanitizeTrumpWind(undefined)).toEqual(NO_TRUMP_WIND)
    // note 超過 30 字截斷
    const long = sanitizeTrumpWind({ direction: 'bearish', note: '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五' })
    expect(long.note.length).toBeLessThanOrEqual(30)
  })

  it('PROMPT：遴選規則含美國政策具體內容門檻；總覽規則含 trump_wind 同呼叫一欄＋繁中', () => {
    expect(SYSTEM_PROMPT).toContain('美國政策')
    expect(SYSTEM_PROMPT).toContain('重複轉述')
    expect(SUMMARY_SYSTEM_PROMPT).toContain('trump_wind')
    expect(SUMMARY_SYSTEM_PROMPT).toContain('繁體中文')
  })
})
