import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Issue #107：`GET /api/quote` 對未知標的不得回 500。
 * 這裡以 route handler 層測試，mock 掉 `@stock/market-data` 的 `registry`
 * （否則會真的打 Yahoo；provider 層不在本單範圍）。
 */
const provider = vi.hoisted(() => ({
  getQuote: vi.fn(),
  getProfile: vi.fn(),
}))

vi.mock('@stock/market-data', () => ({
  registry: { get: vi.fn(() => provider) },
}))

import { GET } from './route'
import type { CompanyProfile, Quote } from '@stock/market-data'

const quote2330: Quote = {
  symbol: '2330.TW',
  price: 2420,
  change: 0,
  changePercent: 0,
  volume: 40787765,
  timestamp: 1792301777667,
}

const profile2330: CompanyProfile = {
  symbol: '2330.TW',
  name: 'Taiwan Semiconductor Manufacturing Company Limited',
  sector: '科技',
  industry: 'Semiconductors',
  exchange: 'TAI',
  quoteType: 'EQUITY',
}

/** ETF：有 name／quoteType（命中），但無 sector（不得被 ETF 桶名污染）。 */
const profile00878: CompanyProfile = {
  symbol: '00878.TW',
  name: 'Cathay Sustainability High Dividend ETF',
  exchange: 'TAI',
  quoteType: 'ETF',
}

/**
 * `getProfile` 查無資料時的**實際**回傳形狀（`yahoo-profile.ts` 的 `emptyProfile`）：
 * 名稱退回輸入代號、其餘欄位全空，且**不拋錯**。route 就是靠這個訊號判定未命中。
 */
function emptyProfile(symbol: string): CompanyProfile {
  return { symbol, name: symbol }
}

function req(symbol?: string, market = 'TW'): Request {
  const url =
    symbol === undefined
      ? `http://localhost/api/quote?market=${market}`
      : `http://localhost/api/quote?symbol=${encodeURIComponent(symbol)}&market=${market}`
  return new Request(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  provider.getQuote.mockResolvedValue(quote2330)
  provider.getProfile.mockResolvedValue(profile2330)
})

describe('GET /api/quote｜參數檢核', () => {
  it('缺 symbol 回 400，且不打 provider', async () => {
    const res = await GET(req())
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Missing symbol' })
    expect(provider.getQuote).not.toHaveBeenCalled()
    expect(provider.getProfile).not.toHaveBeenCalled()
  })

  it('symbol／market 原樣傳給 provider（market 預設 TW）', async () => {
    await GET(req('2330.TW'))
    expect(provider.getQuote).toHaveBeenCalledWith('2330.TW', 'TW')
    expect(provider.getProfile).toHaveBeenCalledWith('2330.TW', 'TW')
    await GET(req('AAPL', 'US'))
    expect(provider.getQuote).toHaveBeenCalledWith('AAPL', 'US')
  })
})

describe('GET /api/quote｜兩者皆命中（成功路徑迴歸不變）', () => {
  it('回 200 { quote, profile }，形狀與內容不變', async () => {
    const res = await GET(req('2330.TW'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ quote: quote2330, profile: profile2330 })
  })

  it('ETF：有 quote、profile.quoteType=ETF 且無 sector', async () => {
    provider.getQuote.mockResolvedValue({ ...quote2330, symbol: '00878.TW', price: 35.53 })
    provider.getProfile.mockResolvedValue(profile00878)
    const res = await GET(req('00878.TW'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.quote.price).toBe(35.53)
    expect(json.profile.quoteType).toBe('ETF')
    expect(json.profile.sector).toBeUndefined()
  })
})

describe('GET /api/quote｜quote 失敗、profile 命中 ⇒ 200 { quote: null, profile }', () => {
  it('getQuote 拋錯（ETF chart 404）時仍回 200 且帶 profile，getProfile 照樣被呼叫', async () => {
    provider.getQuote.mockRejectedValue(new Error('Yahoo Finance API error: 404'))
    provider.getProfile.mockResolvedValue(profile00878)
    const res = await GET(req('00878.TW'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ quote: null, profile: profile00878 })
    // #107 核心：getQuote 先拋不得讓 getProfile 不執行
    expect(provider.getProfile).toHaveBeenCalledTimes(1)
  })

  it('非 Error 的拋出物（字串）一樣只降級 quote，不外洩訊息', async () => {
    provider.getQuote.mockRejectedValue('boom')
    provider.getProfile.mockResolvedValue(profile00878)
    const res = await GET(req('00878.TW'))
    expect(res.status).toBe(200)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('boom')
  })
})

describe('GET /api/quote｜兩者皆未命中 ⇒ 404', () => {
  it('getQuote 拋錯＋getProfile 回 emptyProfile（未命中）→ 404 { error: symbol not found }', async () => {
    provider.getQuote.mockRejectedValue(new Error('Yahoo Finance API error: 404'))
    provider.getProfile.mockResolvedValue(emptyProfile('ZZZZZZ.NOPE'))
    const res = await GET(req('ZZZZZZ.NOPE'))
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'symbol not found' })
  })

  it('兩者皆拋錯 → 404，且不外洩任何 stack／訊息', async () => {
    provider.getQuote.mockRejectedValue(new Error('Yahoo Finance API error: 404'))
    provider.getProfile.mockRejectedValue(new Error('internal stack trace secret'))
    const res = await GET(req('ZZZZZZ.NOPE'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'symbol not found' })
    expect(JSON.stringify(body)).not.toContain('secret')
  })

  it('profile 未命中但 quote 成功 → 仍回 200 { quote, profile }（原形狀）', async () => {
    provider.getProfile.mockResolvedValue(emptyProfile('WEIRD.TW'))
    const res = await GET(req('WEIRD.TW'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.quote).toEqual(quote2330)
    expect(json.profile).toEqual(emptyProfile('WEIRD.TW'))
  })
})

describe('GET /api/quote｜不得 500（各式輸入）', () => {
  const inputs = ['', '   ', 'ZZZZZZ.NOPE', '00687B.TW', '0000', '<script>', '../../etc/passwd']

  it.each(inputs)('symbol=%j 一律非 500', async (symbol) => {
    provider.getQuote.mockRejectedValue(new Error('Yahoo Finance API error: 404'))
    provider.getProfile.mockResolvedValue(emptyProfile(symbol))
    const res = await GET(req(symbol))
    expect(res.status).not.toBe(500)
    expect([200, 400, 404]).toContain(res.status)
  })
})
