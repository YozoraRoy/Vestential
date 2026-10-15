import type { MarketDataProvider } from '../provider.js'
import type { OHLCV, Quote, Fundamentals, CompanyProfile, BatchQuote } from '../types.js'
import { MarketDataError } from '@stock/core'
import { TTLCache } from '../cache.js'

/** 歷史日線快取：盤中資料不劇烈變動，擋掉重複請求避免觸發 Yahoo Rate Limit。 */
const historyCache = new TTLCache<OHLCV[]>(15 * 60 * 1000)

/** 標的類型（ETF / EQUITY）快取：很少變動，重用避免重複呼叫 Yahoo。 */
const assetTypeCache = new TTLCache<string>(60 * 60 * 1000)

/** v7 finance/quote 的 crumb：連同 cookie 一起取得，2 小時 TTL。 */
const crumbCache = new TTLCache<{ cookies: string; crumb: string }>(2 * 60 * 60 * 1000)

interface YahooResult {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; regularMarketVolume?: number; symbol?: string }
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          open?: number[]
          high?: number[]
          low?: number[]
          close?: number[]
          volume?: number[]
        }>
        adjclose?: Array<{ adjclose?: number[] }>
      }
    }>
  }
}

const CHROME_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'

async function yahooFetch(path: string): Promise<any> {
  // Issue #88：query1 被擋時換 query2 重試一次（10s timeout 不變；錯誤形狀不變）。
  let lastErr: unknown = null
  for (const host of ['query1', 'query2']) {
    const url = `https://${host}.finance.yahoo.com/v8/finance${path}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
        },
        signal: controller.signal,
      })
      if (!res.ok) throw new MarketDataError(`Yahoo Finance API error: ${res.status}`)
      return await res.json()
    } catch (err: any) {
      lastErr = err?.name === 'AbortError' ? new MarketDataError(`Yahoo Finance request timeout for ${path}`) : err
    } finally {
      clearTimeout(timeoutId)
    }
  }
  throw lastErr
}

/**
 * 偵測標的類型（"ETF" / "EQUITY" / ...），使用 Yahoo search 的 quoteType 欄位。
 * 用 search 而非 chart 或 quoteSummary，因為 ETF 的 quoteSummary modules（如 price）常回 404。
 * 有 1 小時 TTL 快取；查無結果回空白字串。
 */
async function detectQuoteType(symbol: string): Promise<string> {
  const cached = assetTypeCache.get(symbol)
  if (cached !== undefined) return cached

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=3`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const data: any = await res.json()
    const match = (data?.quotes ?? []).find(
      (q: any) => (q.symbol ?? '').toUpperCase() === symbol.toUpperCase(),
    )
    const quoteType: string = match?.quoteType ?? ''
    assetTypeCache.set(symbol, quoteType)
    return quoteType
  } catch (_) {
    return ''
  }
}

/** 取得 v7 quote 所需的 crumb + cookie（快取 2 小時）。 */
async function getCrumb(): Promise<{ cookies: string; crumb: string }> {
  const cached = crumbCache.get('crumb')
  if (cached) return cached
  const agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
  const fc = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': agent } })
  const setCookies = (fc.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
    || (fc.headers.get('set-cookie') ?? '')
  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': agent, Cookie: setCookies, Accept: 'text/plain' },
  })
  const crumb = (await crumbRes.text()).trim()
  const value = { cookies: setCookies, crumb }
  if (crumb) crumbCache.set('crumb', value)
  return value
}

/** 以 v7 finance/quote 一次抓多檔（每批 ≤100）的市值/價格/名稱/類型。批次數多就循序避限流。 */
export async function fetchBatchQuotes(symbols: string[]): Promise<BatchQuote[]> {
  const agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
  const { cookies, crumb } = await getCrumb()
  const out: BatchQuote[] = []

  for (let i = 0; i < symbols.length; i += 100) {
    const chunk = symbols.slice(i, i + 100)
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}&crumb=${encodeURIComponent(crumb)}&lang=en-US&region=US`
    const res = await fetch(url, {
      headers: { 'User-Agent': agent, Cookie: cookies, Accept: 'application/json' },
    })
    if (!res.ok) throw new MarketDataError(`Yahoo batch quote error: ${res.status}`)
    const data: any = await res.json()
    for (const q of data?.quoteResponse?.result ?? []) {
      out.push({
        symbol: q.symbol,
        marketCap: typeof q.marketCap === 'number' && q.marketCap > 0 ? q.marketCap : undefined,
        price: typeof q.regularMarketPrice === 'number' ? q.regularMarketPrice : undefined,
        name: q.shortName ?? q.longname,
        quoteType: q.quoteType,
      })
    }
    if (i + 100 < symbols.length) await new Promise((r) => setTimeout(r, 300))
  }
  return out
}

/** Issue #88：v11 quoteSummary 取數本體（crumb 優先、裸 fetch 兜底；全失敗回 null 由呼叫端三態）。 */
async function fetchFundamentalsRaw(symbol: string): Promise<any | null> {
  const base = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${symbol}?modules=price,summaryDetail`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { cookies, crumb } = await getCrumb()
      if (!crumb) break
      const res = await fetch(`${base}&crumb=${encodeURIComponent(crumb)}`, {
        headers: { 'User-Agent': CHROME_AGENT, Cookie: cookies, Accept: 'application/json' },
      })
      if (res.status === 401 || res.status === 403) {
        crumbCache.clear()
        continue
      }
      if (!res.ok) break
      const data: any = await res.json()
      if (data?.quoteSummary?.result?.[0]) return data
      break
    } catch {
      break
    }
  }
  try {
    const res = await fetch(base, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export const yahooFinanceProvider: MarketDataProvider = {
  name: 'yahoo-finance',

  async getQuote(symbol: string): Promise<Quote> {
    const data: YahooResult = await yahooFetch(`/chart/${symbol}?range=1d&interval=1d`)
    const result = data.chart?.result?.[0]
    const meta = result?.meta
    if (!meta) throw new MarketDataError(`No quote data for ${symbol}`)

    return {
      symbol: meta.symbol ?? symbol,
      price: meta.regularMarketPrice ?? 0,
      change: 0,
      changePercent: 0,
      volume: meta.regularMarketVolume ?? 0,
      timestamp: Date.now(),
    }
  },

  async getHistory(symbol: string, _market: string, start?: string, end?: string): Promise<OHLCV[]> {
    const cacheKey = `${symbol}|${start ?? ''}|${end ?? ''}`
    const cached = historyCache.get(cacheKey)
    if (cached) return cached

    // start/end 為 ISO 日期字串（YYYY-MM-DD）；未給時維持預設 range=1y。
    let query = 'range=1y&interval=1d'
    if (start) {
      const p1 = Math.floor(new Date(start).getTime() / 1000)
      // Issue #87：Yahoo period2 為 exclusive 上界；舊寫法取 end 當日 00:00，
      // 當日整根被排除（每日掃描永遠少一天，如 cycle 顯示前收）。改 +86400 含入 end 當日全天。
      const p2 = end ? Math.floor(new Date(end).getTime() / 1000) + 86400 : ''
      query = `period1=${p1}${p2 ? `&period2=${p2}` : ''}&interval=1d`
    }

    const data: YahooResult = await yahooFetch(`/chart/${symbol}?${query}`)

    const result = data.chart?.result?.[0]
    if (!result?.timestamp || !result.indicators?.quote?.[0]) return []

    const quote = result.indicators.quote[0]
    const adjclose = result.indicators.adjclose?.[0]?.adjclose

    // 全域等比例還原：Ratio = AdjClose / Close，將 Open/High/Low 全乘上 Ratio，
    // 確保回傳序列是完全還原價格（引擎只吃全還原數據）。
    const rows: OHLCV[] = result.timestamp
      .map((ts, i) => {
        const rawClose = quote.close?.[i] ?? 0
        const adj = adjclose?.[i] ?? rawClose
        const ratio = rawClose > 0 ? adj / rawClose : 1
        return {
          timestamp: ts * 1000,
          open: (quote.open?.[i] ?? 0) * ratio,
          high: (quote.high?.[i] ?? 0) * ratio,
          low: (quote.low?.[i] ?? 0) * ratio,
          close: adj,
          volume: quote.volume?.[i] ?? 0,
        }
      })
      .filter((v) => v.timestamp && v.close > 0)

    if (rows.length > 0) historyCache.set(cacheKey, rows)
    return rows
  },

  async getFundamentals(symbol: string): Promise<Fundamentals> {
    // Issue #88：v11 quoteSummary 無 crumb 易被擋（裸 fetch 常回空）；
    // 先走 crumb 流程（401/403 清快取換新 crumb 重試一次），仍失敗才降級舊裸 fetch。
    const data = await fetchFundamentalsRaw(symbol)
    const price = data?.quoteSummary?.result?.[0]?.price ?? {}
    const summary = data?.quoteSummary?.result?.[0]?.summaryDetail ?? {}

    const num = (v: any): number | undefined => {
      const raw = typeof v === 'object' && v !== null ? v.raw : v
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
    }
    return {
      symbol,
      marketCap: num(price.marketCap) ?? num(summary.marketCap),
      peRatio: num(summary.trailingPE) ?? num(summary.forwardPE),
      eps: num(summary.trailingEps),
      dividendYield: num(summary.dividendYield),
      // #34：fallback 用既有 summaryDetail 欄位（trailingAnnualDividendYield 小數／dividendRate 每股金額）；
      // Yahoo 未回傳即 undefined，由 fetchDividendYield 走缺值三態。
      trailingAnnualDividendYield: num(summary.trailingAnnualDividendYield),
      dividendRate: num(summary.dividendRate),
      sector: price.sector,
      industry: price.industry,
    }
  },

  async getProfile(symbol: string): Promise<CompanyProfile> {
    const url = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${symbol}?modules=assetProfile`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const data: any = await res.json()

    const profile = data?.quoteSummary?.result?.[0]?.assetProfile
    return {
      symbol,
      name: profile?.companyName ?? symbol,
      sector: profile?.sector,
      industry: profile?.industry,
      exchange: profile?.exchange,
      description: profile?.longBusinessSummary,
      quoteType: await detectQuoteType(symbol),
    }
  },

  async searchSymbols(query: string): Promise<Array<{ symbol: string; name: string; market: string; quoteType?: string }>> {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const data: any = await res.json()
    return (data.quotes ?? []).map((q: any) => ({
      symbol: q.symbol,
      name: q.shortname ?? q.longname ?? q.symbol,
      market: q.exchange ?? 'US',
      quoteType: q.quoteType,
    }))
  },

  async getBatchQuotes(symbols: string[]): Promise<BatchQuote[]> {
    return fetchBatchQuotes(symbols)
  },
}
