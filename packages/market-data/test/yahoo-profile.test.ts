import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  SECTOR_ZH_MAP,
  toZhSector,
  pickSearchQuote,
  buildProfileFromSearch,
} from '../src/providers/yahoo-profile.js'
import { yahooFinanceProvider } from '../src/providers/yahoo-finance.js'

// Issue #105：getProfile 的資料來源由已下架的 v11/v10 quoteSummary（404／401 Invalid Crumb）
// 改為 v1/finance/search。本檔驗證：
// 1. search 回應解析（精確比對、缺欄位、查無、請求失敗）——全為純函式或假 fetch，零真網路。
// 2. sector zh-TW 對照（11 大類＋未知值原樣）。
// 3. getProfile 的三態降級（回空值、不拋錯）＋快取（成功不快打、失敗負面快取）。

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

/** 假造一次 search 回應。 */
function stubFetch(payload: unknown, init?: { ok?: boolean; status?: number }) {
  const ok = init?.ok ?? true
  const fn = vi.fn().mockResolvedValue({
    ok,
    status: init?.status ?? (ok ? 200 : 500),
    json: async () => payload,
  })
  globalThis.fetch = fn as unknown as typeof fetch
  return fn
}

function stubFetchReject(err: unknown) {
  const fn = vi.fn().mockRejectedValue(err)
  globalThis.fetch = fn as unknown as typeof fetch
  return fn
}

describe('toZhSector — Yahoo sector zh-TW 對照', () => {
  it('11 大類逐一對照', () => {
    expect(SECTOR_ZH_MAP).toEqual({
      Technology: '科技',
      'Financial Services': '金融',
      Healthcare: '醫療保健',
      'Consumer Cyclical': '消費循環',
      'Consumer Defensive': '民生消費',
      Industrials: '工業',
      Energy: '能源',
      Utilities: '公用事業',
      'Real Estate': '房地產',
      'Basic Materials': '原物料',
      'Communication Services': '通訊',
    })
    expect(Object.keys(SECTOR_ZH_MAP)).toHaveLength(11)
    expect(toZhSector('Technology')).toBe('科技')
    expect(toZhSector('Financial Services')).toBe('金融')
    expect(toZhSector('Healthcare')).toBe('醫療保健')
    expect(toZhSector('Consumer Cyclical')).toBe('消費循環')
    expect(toZhSector('Consumer Defensive')).toBe('民生消費')
    expect(toZhSector('Industrials')).toBe('工業')
    expect(toZhSector('Energy')).toBe('能源')
    expect(toZhSector('Utilities')).toBe('公用事業')
    expect(toZhSector('Real Estate')).toBe('房地產')
    expect(toZhSector('Basic Materials')).toBe('原物料')
    expect(toZhSector('Communication Services')).toBe('通訊')
  })

  it('未知值原樣回傳英文、空值回 undefined（不硬湊）', () => {
    expect(toZhSector('Semiconductors')).toBe('Semiconductors')
    expect(toZhSector('  Industrials  ')).toBe('工業')
    expect(toZhSector('')).toBeUndefined()
    expect(toZhSector('   ')).toBeUndefined()
    expect(toZhSector(undefined)).toBeUndefined()
    expect(toZhSector(null)).toBeUndefined()
    expect(toZhSector(123)).toBeUndefined()
  })
})

describe('pickSearchQuote — search 回應精確比對', () => {
  it('取 symbol 完全比對的那筆（大小寫不敏感）', () => {
    const payload = {
      quotes: [
        { symbol: '2330.TW', quoteType: 'EQUITY', sector: 'Technology', industry: 'Semiconductors', longname: '台積電' },
        { symbol: '2330.TWO', quoteType: 'EQUITY' },
      ],
    }
    expect(pickSearchQuote('2330.TW', payload)?.longname).toBe('台積電')
    expect(pickSearchQuote('2330.tw', payload)?.symbol).toBe('2330.TW')
    expect(pickSearchQuote(' 2330.TWO ', payload)?.symbol).toBe('2330.TWO')
  })

  it('找不到精確 symbol 回 undefined（不拿第一筆頂替）', () => {
    const payload = { quotes: [{ symbol: '00878B.TW', quoteType: 'ETF' }] }
    expect(pickSearchQuote('00878.TW', payload)).toBeUndefined()
  })

  it('缺欄位／回應形狀異常一律 undefined，不拋錯', () => {
    expect(pickSearchQuote('AAPL', {})).toBeUndefined()
    expect(pickSearchQuote('AAPL', { quotes: null })).toBeUndefined()
    expect(pickSearchQuote('AAPL', { quotes: 'nope' })).toBeUndefined()
    expect(pickSearchQuote('AAPL', null)).toBeUndefined()
    expect(pickSearchQuote('AAPL', undefined)).toBeUndefined()
    expect(pickSearchQuote('', { quotes: [{ symbol: '' }] })).toBeUndefined()
    // symbol 非字串者不得命中
    expect(pickSearchQuote('123', { quotes: [{ symbol: 123 }] })).toBeUndefined()
  })
})

describe('buildProfileFromSearch — search 那筆 → CompanyProfile', () => {
  it('正常：sector 中文化、name 取 longname、industry／quoteType／exchange 原樣', () => {
    expect(buildProfileFromSearch('2330.TW', {
      symbol: '2330.TW',
      quoteType: 'EQUITY',
      sector: 'Technology',
      industry: 'Semiconductors',
      longname: 'Taiwan Semiconductor Manufacturing Company Limited',
      shortname: '台積電',
      exchange: 'TAI',
    })).toEqual({
      symbol: '2330.TW',
      name: 'Taiwan Semiconductor Manufacturing Company Limited',
      sector: '科技',
      industry: 'Semiconductors',
      exchange: 'TAI',
      quoteType: 'EQUITY',
    })
  })

  it('缺 longname 時退回 shortname，兩者皆缺退回代號', () => {
    expect(buildProfileFromSearch('00878.TW', { symbol: '00878.TW', quoteType: 'ETF', sector: '', shortname: '國泰永續高股息' }).name)
      .toBe('國泰永續高股息')
    expect(buildProfileFromSearch('00878.TW', { symbol: '00878.TW', quoteType: 'ETF' }).name).toBe('00878.TW')
    expect(buildProfileFromSearch('00878.TW', undefined).name).toBe('00878.TW')
  })

  it('缺欄位：sector 空字串 → undefined（ETF 由風險層另行歸類）', () => {
    const p = buildProfileFromSearch('00878.TW', { symbol: '00878.TW', quoteType: 'ETF', sector: '' })
    expect(p.sector).toBeUndefined()
    expect(p.industry).toBeUndefined()
    expect(p.exchange).toBeUndefined()
    expect(p.quoteType).toBe('ETF')
  })
})

describe('getProfile — search 端點（假 fetch，零真網路）', () => {
  it('打 v1/finance/search（不再呼叫 quoteSummary），取出 sector/name/quoteType', async () => {
    const fn = stubFetch({
      quotes: [
        { symbol: 'FAKE1.TW', quoteType: 'EQUITY', sector: 'Industrials', industry: 'Marine Shipping', longname: 'Fake Shipping Co' },
      ],
    })

    const profile = await yahooFinanceProvider.getProfile('FAKE1.TW', 'TW')

    expect(fn).toHaveBeenCalledTimes(1)
    const url = String(fn.mock.calls[0][0])
    expect(url).toContain('/v1/finance/search?q=FAKE1.TW')
    expect(url).toContain('quotesCount=3')
    expect(url).not.toContain('quoteSummary')
    expect(profile).toMatchObject({
      symbol: 'FAKE1.TW',
      name: 'Fake Shipping Co',
      sector: '工業',
      industry: 'Marine Shipping',
      quoteType: 'EQUITY',
    })
  })

  it('成功結果進快取：同 symbol 再問不打第二次 search', async () => {
    const fn = stubFetch({ quotes: [{ symbol: 'FAKE2.TW', quoteType: 'EQUITY', sector: 'Technology', longname: 'Fake Tech' }] })

    await yahooFinanceProvider.getProfile('FAKE2.TW', 'TW')
    const again = await yahooFinanceProvider.getProfile('FAKE2.TW', 'TW')

    expect(fn).toHaveBeenCalledTimes(1)
    expect(again.sector).toBe('科技')
  })

  it('找不到精確 symbol → 回空值（name 退回代號）且不拋錯', async () => {
    stubFetch({ quotes: [{ symbol: 'SOMETHING.ELSE', quoteType: 'ETF' }] })

    const profile = await yahooFinanceProvider.getProfile('FAKE3.TW', 'TW')

    expect(profile.sector).toBeUndefined()
    expect(profile.quoteType).toBeUndefined()
    expect(profile.name).toBe('FAKE3.TW')
  })

  it('search 失敗（HTTP 500）→ 回空值且不拋錯，並寫入負面快取（短期不重打）', async () => {
    const fn = stubFetch({}, { ok: false, status: 500 })

    const profile = await yahooFinanceProvider.getProfile('FAKE4.TW', 'TW')
    const again = await yahooFinanceProvider.getProfile('FAKE4.TW', 'TW')

    expect(profile).toEqual({ symbol: 'FAKE4.TW', name: 'FAKE4.TW' })
    expect(again).toEqual({ symbol: 'FAKE4.TW', name: 'FAKE4.TW' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('search 逾時／網路錯誤（fetch reject）→ 回空值且不拋錯', async () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' })
    stubFetchReject(err)

    await expect(yahooFinanceProvider.getProfile('FAKE5.TW', 'TW')).resolves.toEqual({
      symbol: 'FAKE5.TW',
      name: 'FAKE5.TW',
    })
  })

  it('回應不是 JSON（json() 拋錯）→ 回空值且不拋錯', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })
    globalThis.fetch = fn as unknown as typeof fetch

    await expect(yahooFinanceProvider.getProfile('FAKE6.TW', 'TW')).resolves.toEqual({
      symbol: 'FAKE6.TW',
      name: 'FAKE6.TW',
    })
  })

  it('空字串 symbol 不打網路', async () => {
    const fn = stubFetch({ quotes: [] })

    const profile = await yahooFinanceProvider.getProfile('   ', 'TW')

    expect(fn).not.toHaveBeenCalled()
    expect(profile.name).toBe('   ')
  })
})
