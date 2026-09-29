import { yahooFinanceProvider, fetchBatchQuotes } from '@stock/market-data'
import { searchStocksByName, fuzzySearchStocksByName } from '@stock/database'
import { Converter } from 'opencc-js'

// 簡→繁轉換：OCR 常把繁體讀成簡體（chi_sim），DB（TWSE）名稱是繁體。
// opencc cn→t 會多做區域偏好（臺/羣），TWSE 慣用「台/群」，故再 de-regional 回去。
const ocC2T = Converter({ from: 'cn', to: 't' })
export function toTraditionalZh(text: string): string {
  try {
    return ocC2T(text).replace(/臺/g, '台').replace(/羣/g, '群')
  } catch {
    return text
  }
}

export type Market = 'tw' | 'us'

export interface PortfolioInput {
  market: Market
  symbol: string
  shares: number
  cost: number
  currentPrice: number
  /**
   * #44：股息輸入欄已移除。型別保留 required（DB 不刪欄、舊呼叫相容），但 validate
   * 忽略 body.dividend 一律回 0、寫入一律 0；殖利率改由 TWSE 真源（當年／5 年平均）
   * ＋ Yahoo 參考欄呈現。
   */
  dividend: number
  symbolName?: string
}

function toNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function validatePortfolioInput(body: any): { ok: true; data: PortfolioInput } | { ok: false; error: string } {
  const market: Market | null = body?.market === 'tw' || body?.market === 'us' ? body.market : null
  const symbol = typeof body?.symbol === 'string' ? body.symbol.trim().toUpperCase() : ''
  const shares = toNum(body?.shares)
  const cost = toNum(body?.cost)
  const currentPrice = toNum(body?.currentPrice)
  // #44：股息輸入欄已移除：body.dividend 一律忽略，固定回 0（DB 欄保留不刪）。
  const dividend = 0
  const symbolName = typeof body?.symbolName === 'string' ? body.symbolName : undefined

  if (!market || !symbol) return { ok: false, error: 'market 與 symbol 為必填' }
  if (shares == null || !(shares > 0)) return { ok: false, error: '持有股數需大於 0' }
  if (cost == null || cost < 0) return { ok: false, error: '每股成本需 >= 0' }
  if (currentPrice == null || !(currentPrice > 0)) return { ok: false, error: '每股現價需大於 0' }

  return { ok: true, data: { market, symbol, shares, cost, currentPrice, dividend, symbolName } }
}

export interface PnLInput {
  market: Market
  shares: number
  cost: number
  currentPrice: number
  /** #44：已棄用（保留相容，計算一律忽略，視為 0）。 */
  dividend?: number
}

export interface PnLResult {
  costBasis: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  totalReturn: number
  totalReturnPct: number
  yieldOnCost: number
}

/**
 * #44：totalReturn 改為裸價差（歷史一次性變動，舊數據口徑改變，詳見 docs/features-guide.md §1.1）。
 * - 公式：totalReturn＝unrealizedPnl＝市值−成本（不再＋股息）；
 *   totalReturnPct＝totalReturn／成本×100%。
 * - 選邊：yieldOnCost 固定回 0（手填股息已移除，無分子可算；殖利率改由
 *   TWSE 真源當年／5 年平均＋ Yahoo 參考欄呈現，本函式不碰）。
 * - 稅費淨損益（computeNetPnL）計算不動（本就以裸值為基）。
 */
export function computePnL(input: PnLInput): PnLResult {
  const costBasis = input.shares * input.cost
  const marketValue = input.shares * input.currentPrice
  const unrealizedPnl = marketValue - costBasis
  const totalReturn = unrealizedPnl
  return {
    costBasis,
    marketValue,
    unrealizedPnl,
    unrealizedPnlPct: costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0,
    totalReturn,
    totalReturnPct: costBasis > 0 ? (totalReturn / costBasis) * 100 : 0,
    yieldOnCost: 0,
  }
}

// ─── #35：當年累計股息 YTD 估算 ───────────────────────────────────
// 實作在 client-safe 的 `./portfolio-dividends`（零 Node/DB 依賴；此處 re-export
// 供 server 端沿用同一實作；不直接寫在此檔是避免 client 值 import 時把
// better-sqlite3/mssql 拉進 browser bundle，見該檔選邊註明）。
export {
  dividendHoldingStartDate,
  estimateDividendYtd,
  type DividendYtdEntry,
  type DividendYtdEstimate,
} from './portfolio-dividends'

// ─── #27：含稅費淨損益（不動 computePnL）─────────────────────
// 單一真相來源在 `./portfolio-net`（client-safe 零 Node/DB 依賴，供試算頁前端純算）。
// 此處 re-export 使 `lib/portfolio.ts` 亦提供 computeNetPnL（server 端沿用同一實作）。
export {
  FEE_RATE,
  MIN_FEE,
  TAX_RATE_TW,
  TAX_RATE_ETF,
  DEFAULT_FEE_DISCOUNT,
  isEtfSymbol,
  computeNetPnL,
  type NetPnLInput,
  type NetPnLResult,
} from './portfolio-net'

/** 依市場解析 Yahoo 代號：台股純數字 → .TW/.TWO，美股直接用代號。 */
export async function resolveYahooSymbol(raw: string, market: Market): Promise<string> {
  const trimmed = raw.trim().toUpperCase()
  if (market === 'us') return trimmed

  if (/^\d{4,6}\.(TW|TWO)$/.test(trimmed)) return trimmed
  // 台股代號：純數字（如 2330）或含字母的 ETF（如 00687B）
  if (/^\d{3,6}[A-Z0-9]{0,2}$/.test(trimmed)) {
    for (const suffix of ['.TW', '.TWO']) {
      try {
        const q = await yahooFinanceProvider.getQuote(`${trimmed}${suffix}`, 'TW')
        if (q.price > 0) return `${trimmed}${suffix}`
      } catch (_) {}
    }
  }
  return trimmed
}

export interface LiveQuote {
  symbol: string
  price: number
  name: string | null
}

/** 抓取即時報價；失敗回 null（呼叫端自行決定是否以手輸值取代）。 */
export async function fetchLiveQuote(rawSymbol: string, market: Market): Promise<LiveQuote | null> {
  try {
    const symbol = await resolveYahooSymbol(rawSymbol, market)
    const quote = await yahooFinanceProvider.getQuote(symbol, market === 'tw' ? 'TW' : 'US')
    if (!quote.price || quote.price <= 0) return null
    let name: string | null = null
    try {
      const profile = await yahooFinanceProvider.getProfile(symbol, market === 'tw' ? 'TW' : 'US')
      name = profile.name && profile.name !== symbol ? profile.name : null
    } catch (_) {}
    return { symbol, price: quote.price, name }
  } catch (e) {
    console.error('[Portfolio] fetchLiveQuote failed:', e)
    return null
  }
}

// ─── #33：持倉現價批量同步＋殖利率參考 ────────────────────────────
// 限流數值（實作註明）：
// - Yahoo v7 批量報價每批 ≤100 檔（fetchBatchQuotes 上限），批間已有 300ms 間隔；
// - 批量未命中才走單檔 fallback，逐檔間隔 SINGLE_GAP_MS＝200ms；
// - 殖利率（quoteSummary）單檔成本高：並行 FUND_CONCURRENCY＝5、批間隔 250ms、單檔超時 8s；
// - 單持有人單次上限 200 筆、排程全掃單次上限 2000 筆（訪客全表量級未知，封頂＋id 分頁）。
export const PORTFOLIO_SYNC_BATCH_SIZE = 100
export const PORTFOLIO_SYNC_SINGLE_GAP_MS = 200
export const PORTFOLIO_SYNC_FUND_CONCURRENCY = 5
export const PORTFOLIO_SYNC_FUND_GAP_MS = 250
export const PORTFOLIO_SYNC_FUND_TIMEOUT_MS = 8000
export const PORTFOLIO_SYNC_MAX_PER_REQUEST = 200
export const PORTFOLIO_SYNC_MAX_PER_RUN = 2000

function syncSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    p.then(
      (v) => { if (timer) clearTimeout(timer); resolve(v) },
      (e) => { if (timer) clearTimeout(timer); reject(e) },
    )
  })
}

/** Yahoo 限流訊號（429／rate limit／too many）；命中時呼叫端記 log＋告警（告警靠 #24 去重 30 分鐘節流）。 */
export function isQuoteRateLimited(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return /429|rate.?limit|too many/i.test(msg)
}

/**
 * #34：殖利率缺值三態原因（UI 以三語顯示，不再空白 —）。
 * - 'no-data'：Yahoo 各欄位皆無值（台股常態）
 * - 'timeout'：quoteSummary 單檔超時（PORTFOLIO_SYNC_FUND_TIMEOUT_MS）
 * - 'rate-limited'：Yahoo 限流（沿用 isQuoteRateLimited 模式）
 */
export type DividendYieldReason = 'no-data' | 'timeout' | 'rate-limited'

export interface DividendYieldResult {
  /** Yahoo 殖利率（小數，如 0.035＝3.5%）；無值為 null。 */
  value: number | null
  /** value 為 null 時的缺值原因；有值時為 null。 */
  reason: DividendYieldReason | null
}

function isYieldTimeout(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return /timeout after \d+ms/i.test(msg)
}

function classifyYieldError(e: unknown): DividendYieldReason {
  if (isQuoteRateLimited(e)) return 'rate-limited'
  if (isYieldTimeout(e)) return 'timeout'
  return 'no-data'
}

function asYieldValue(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

/**
 * #34：殖利率參考多欄位 fallback：
 * dividendYield → trailingAnnualDividendYield → dividendRate / 現價推算。
 * 有值回 { value, reason: null }；仍無值回 { value: null, reason } 三態原因。
 * #44：僅回傳 Yahoo 參考值，不寫入任何持倉欄位。
 */
export async function fetchDividendYield(rawSymbol: string, market: Market): Promise<DividendYieldResult> {
  let symbol: string
  try {
    symbol = await resolveYahooSymbol(rawSymbol, market)
  } catch (e) {
    return { value: null, reason: classifyYieldError(e) }
  }
  let f: Awaited<ReturnType<typeof yahooFinanceProvider.getFundamentals>> | null = null
  try {
    f = await withTimeout(
      yahooFinanceProvider.getFundamentals(symbol, market === 'tw' ? 'TW' : 'US'),
      PORTFOLIO_SYNC_FUND_TIMEOUT_MS,
    )
  } catch (e) {
    return { value: null, reason: classifyYieldError(e) }
  }
  const direct = asYieldValue(f?.dividendYield) ?? asYieldValue(f?.trailingAnnualDividendYield)
  if (direct != null) return { value: direct, reason: null }
  // 第三順位：dividendRate（每股金額）/ 現價 推算；現價取不到即視為無資料。
  const rate = asYieldValue(f?.dividendRate)
  if (rate != null && rate > 0) {
    try {
      const quote = await withTimeout(
        yahooFinanceProvider.getQuote(symbol, market === 'tw' ? 'TW' : 'US'),
        PORTFOLIO_SYNC_FUND_TIMEOUT_MS,
      )
      const price = asYieldValue(quote?.price)
      if (price != null && price > 0) return { value: rate / price, reason: null }
    } catch (e) {
      return { value: null, reason: classifyYieldError(e) }
    }
  }
  return { value: null, reason: 'no-data' }
}

export interface SyncableHolding {
  id: number
  market: Market
  symbol: string
  shares: number
  cost: number
  /** #44：已棄用（保留相容；同步寫回不再讀取，裸價差重算）。 */
  dividend?: number
}

export interface SyncedHolding {
  id: number
  symbol: string
  price: number
  /** Yahoo 殖利率（小數）；未取／無值為 null。僅參考顯示，不寫 dividend。 */
  dividendYield: number | null
  /** #34：殖利率缺值原因（有值時為 null；UI 以三語顯示）。 */
  dividendYieldReason: DividendYieldReason | null
}

export type SyncFailureReason = 'quote' | 'resolve'

export interface SyncFailure {
  id: number
  symbol: string
  reason: SyncFailureReason
}

export interface PortfolioSyncResult {
  updated: SyncedHolding[]
  failed: SyncFailure[]
  rateLimited: boolean
  /** 本次同步時間（'YYYY-MM-DD HH:mm:ss'）；DB 寫入＋API 回傳共用同一值，重跑冪等＝最後一次為準。 */
  syncedAt: string
}

/**
 * 批量同步現價（逐檔 best-effort：單檔失敗不中斷整批）。
 * - 先批量報價（≤100/批），未命中再單檔 fallback（200ms 間隔）；
 * - includeYield 時才抓殖利率（並行 5，失敗→null），排程全掃傳 false 省配額；
 * - #44：手填股息欄已移除，同步全程不讀不寫 dividend（裸價差重算）。
 */
export async function syncPortfolioPrices(
  holdings: SyncableHolding[],
  opts?: { includeYield?: boolean },
): Promise<PortfolioSyncResult> {
  const syncedAt = new Date().toISOString().replace('T', ' ').substring(0, 19)
  const updated: SyncedHolding[] = []
  const failed: SyncFailure[] = []
  let rateLimited = false
  const markRateLimited = (e: unknown) => { if (isQuoteRateLimited(e)) rateLimited = true }

  // 1) 解析 Yahoo 代號（失敗直接記失敗，不中斷後續）。
  const resolved: Array<{ h: SyncableHolding; yahoo: string }> = []
  for (const h of holdings) {
    try {
      resolved.push({ h, yahoo: await resolveYahooSymbol(h.symbol, h.market) })
    } catch (e) {
      markRateLimited(e)
      failed.push({ id: h.id, symbol: h.symbol, reason: 'resolve' })
    }
  }

  // 2) 批量報價。整批拋錯也不中斷：全部掉到步驟 3 單檔 fallback。
  const priceMap = new Map<string, number>()
  try {
    for (let i = 0; i < resolved.length; i += PORTFOLIO_SYNC_BATCH_SIZE) {
      const chunk = resolved.slice(i, i + PORTFOLIO_SYNC_BATCH_SIZE)
      const batch = await fetchBatchQuotes(chunk.map((r) => r.yahoo))
      for (const q of batch) {
        if (typeof q.price === 'number' && q.price > 0 && q.symbol) {
          priceMap.set(q.symbol.toUpperCase(), q.price)
        }
      }
    }
  } catch (e) {
    markRateLimited(e)
    console.error('[Portfolio] syncPortfolioPrices batch quotes failed, falling back to single quotes:', e)
  }

  // 3) 批量未命中 → 單檔 fallback（fetchLiveQuote 內部已 catch 回 null）。
  for (const r of resolved) {
    if (priceMap.has(r.yahoo.toUpperCase())) continue
    await syncSleep(PORTFOLIO_SYNC_SINGLE_GAP_MS)
    const q = await fetchLiveQuote(r.h.symbol, r.h.market)
    if (q && q.price > 0) priceMap.set(r.yahoo.toUpperCase(), q.price)
  }

  // 4) 有價 → updated；無價 → failed（代碼＋原因碼，UI 以三語顯示）。
  const priced: Array<{ h: SyncableHolding; price: number }> = []
  for (const r of resolved) {
    const price = priceMap.get(r.yahoo.toUpperCase())
    if (typeof price === 'number' && price > 0) priced.push({ h: r.h, price })
    else failed.push({ id: r.h.id, symbol: r.h.symbol, reason: 'quote' })
  }

  // 5) 殖利率參考（僅需要時；失敗→{ value: null, reason }，UI 顯示三語原因）。
  // #44：手填股息欄已移除（只讀傳入相容欄，不回寫）。
  const yieldMap = new Map<number, DividendYieldResult>()
  if (opts?.includeYield && priced.length > 0) {
    for (let i = 0; i < priced.length; i += PORTFOLIO_SYNC_FUND_CONCURRENCY) {
      const chunk = priced.slice(i, i + PORTFOLIO_SYNC_FUND_CONCURRENCY)
      const results = await Promise.all(
        chunk.map(async (p): Promise<DividendYieldResult> => {
          try {
            return await fetchDividendYield(p.h.symbol, p.h.market)
          } catch (e) {
            markRateLimited(e)
            return { value: null, reason: classifyYieldError(e) }
          }
        }),
      )
      chunk.forEach((p, idx) => yieldMap.set(p.h.id, results[idx]))
      if (i + PORTFOLIO_SYNC_FUND_CONCURRENCY < priced.length) await syncSleep(PORTFOLIO_SYNC_FUND_GAP_MS)
    }
  }

  for (const p of priced) {
    const y = yieldMap.get(p.h.id)
    updated.push({
      id: p.h.id,
      symbol: p.h.symbol,
      price: p.price,
      dividendYield: y?.value ?? null,
      dividendYieldReason: y?.value != null ? null : (y?.reason ?? null),
    })
  }
  return { updated, failed, rateLimited, syncedAt }
}

/**
 * 清掉 OCR 誤讀造成的名稱前導雜訊（如 "2星宇航空" → "星宇航空"）。
 * 只在中文字存在時才清理（避免誤傷合法的英文數字名，如 "2U, Inc."）。
 */
export function cleanOcrName(raw: string): string {
  const t = (raw ?? '').trim()
  if (/[\u4e00-\u9fa5]/.test(t)) return t.replace(/^[^\u4e00-\u9fa5A-Za-z]+/u, '')
  return t
}

/** Yahoo 搜尋代號正規化：台股 "2646.TW" → "2646"（App 內以純數字存台股代號），美股保留原案。 */
function normalizeSearchSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/\.(TW|TWO)$/i, '')
}

export interface StockCandidate {
  symbol: string
  name: string
  market: Market
}

/**
 * 台股名稱搜尋：DB 精準 LIKE 優先，失敗再走 fuzzy（補單字 OCR 誤讀）。
 * fz 標記是否為模糊補救，供自動補齊判斷可否以 DB 正名取代 OCR 名稱。
 */
async function dbSearchTw(query: string): Promise<{ candidates: StockCandidate[]; fuzzy: boolean; ambiguous: boolean }> {
  const conv = toTraditionalZh(query)
  let db = await searchStocksByName(conv)
  let fuzzy = false
  let ambiguous = false
  if (!db.length) {
    const fz = await fuzzySearchStocksByName(conv)
    if (fz.length) {
      // 榜首與第二名距離相同（如「美債」同時貼近正2/反1）→ 無法可靠自動補齊，交給手動。
      ambiguous = fz.length > 1 && fz[0].dist === fz[1].dist
      if (!ambiguous) db = fz
      fuzzy = true
    }
  }
  if (db.length) {
    return {
      candidates: db.map(r => ({ symbol: normalizeSearchSymbol(r.stock_id), name: r.stock_name, market: 'tw' as Market })),
      fuzzy,
      ambiguous,
    }
  }
  return { candidates: [], fuzzy, ambiguous }
}

/**
 * Yahoo `search` 對純台股代號在資料中心 IP 常回空（尤其 OTC/.TWO，如 00687B）。
 * 代號字形時直接 probe v7 批量報價（.TW/.TWO 各一），取的可用候選。
 * 若 .TW 存在（上市）優先於 .TWO（上櫃）。
 */
async function probeTwSymbolById(id: string): Promise<StockCandidate[]> {
  try {
    const candidates = [`${id}.TW`, `${id}.TWO`]
    const batch = await fetchBatchQuotes(candidates)
    const hit =
      batch.find((r) => r.symbol?.toUpperCase() === `${id}.TW`) ??
      batch.find((r) => r.symbol?.toUpperCase() === `${id}.TWO`)
    if (hit) {
      return [{ symbol: normalizeSearchSymbol(hit.symbol), name: hit.name || hit.symbol, market: 'tw' as Market }]
    }
  } catch {
    // v7 報價需要 crumb/cookie，雲端 IP 可能被擋 → 掉到底下 chart 報價 probe。
  }

  try {
    const yahooSymbol = await resolveYahooSymbol(id, 'tw')
    if (!/\.(TW|TWO)$/.test(yahooSymbol)) return []
    let name = id
    try {
      const profile = await yahooFinanceProvider.getProfile(yahooSymbol, 'tw')
      const pn = profile?.name?.trim()
      if (pn && pn.toUpperCase() !== yahooSymbol.toUpperCase()) name = pn
    } catch {}
    return [{ symbol: normalizeSearchSymbol(yahooSymbol), name, market: 'tw' as Market }]
  } catch {
    return []
  }
}

/**
 * 依名稱或代號搜尋股票候選清單（供自動補齊與前端手動搜尋共用）。
 * - 台股：以本地 DB（TWSE 零股交易/股東會紀念品）的中文名稱查詢為主，
 *   Yahoo 對中文名稱搜尋極不可靠（實測 "星宇航空" 回空）；DB 沒有結果才 fallback 到 Yahoo。
 * - 美股：Yahoo searchSymbols。
 */
export async function searchStockCandidates(q: string, market: Market): Promise<StockCandidate[]> {
  const query = q.trim()
  if (!query) return []
  try {
    if (market === 'tw') {
      const { candidates } = await dbSearchTw(query)
      if (candidates.length) return candidates

      // 純台股代號字形：先 probe 報價端（比 Yahoo search 對 OTC 代號可靠），再掉回 search。
      if (/^\d{4}[A-Z0-9]{0,2}$/i.test(query)) {
        const probed = await probeTwSymbolById(query)
        if (probed.length) return probed
      }

      const y = await yahooFinanceProvider.searchSymbols(query)
      const tw = y.filter(r => /\.(TW|TWO)$/i.test(r.symbol))
      if (tw.length) return tw.map(r => ({ symbol: normalizeSearchSymbol(r.symbol), name: r.name, market: 'tw' as Market }))
      return []
    }
    const y = await yahooFinanceProvider.searchSymbols(query)
    return y.map(r => ({ symbol: r.symbol, name: r.name, market: 'us' as Market })).slice(0, 10)
  } catch {
    return []
  }
}

/** 依名稱搜尋 Yahoo 股票代號（回傳最相關一筆，供自動補齊）。 */
async function findSymbolByName(
  name: string,
  market: Market,
): Promise<{ symbol: string; name: string; fuzzy: boolean; ambiguous: boolean } | null> {
  if (market === 'tw') {
    const { candidates, fuzzy, ambiguous } = await dbSearchTw(name)
    if (!candidates.length) return null
    return { symbol: candidates[0].symbol, name: candidates[0].name, fuzzy, ambiguous }
  }
  const candidates = await searchStockCandidates(name, 'us')
  if (!candidates.length) return null
  return { symbol: candidates[0].symbol, name: candidates[0].name, fuzzy: false, ambiguous: false }
}

/** 可供補齊的辨識部位（欄位皆可缺，補齊後仍回傳同一型別）。 */
export interface EnrichablePosition {
  market: Market
  symbol: string
  symbolName?: string
  shares: number
  cost: number
  currentPrice?: number
  /** #44：已棄用（辨識不再輸出股息；保留相容，寫入一律 0）。 */
  dividend?: number
}

export interface EnrichmentSummary {
  names: number
  symbols: number
  prices: number
}

/**
 * 辨識結果自動補齊：用 Yahoo 搜尋/報價把空缺欄位填好。
 * - symbol 空缺但有名稱 → searchSymbols 依名稱找代號
 * - symbolName 空缺但有代號 → getProfile 取名稱
 * - currentPrice 缺漏 → fetchLiveQuote 抓即時報價
 * 全程 best-effort：任何一步失敗都保留原值，不影響辨識主流程。
 */
export async function enrichRecognizedPositions<P extends EnrichablePosition>(
  positions: P[],
): Promise<{ positions: P[]; enriched: EnrichmentSummary }> {
  const enriched: EnrichmentSummary = { names: 0, symbols: 0, prices: 0 }
  const out = await Promise.all(
    positions.map(async (p) => {
      const next: EnrichablePosition = { ...p }

      const cleanName = p.symbolName ? cleanOcrName(p.symbolName) : ''
      if (cleanName && cleanName !== p.symbolName) {
        next.symbolName = cleanName
        enriched.names++
      }

      if (!next.symbol && cleanName) {
        const found = await findSymbolByName(cleanName, p.market)
        if (found && !found.ambiguous) {
          next.symbol = found.symbol
          enriched.symbols++
          // DB/TWSE 名稱比 OCR 讀出更可靠；簡繁等效或模糊命中（單字誤讀）時以正名取代。
          if (p.market === 'tw' && found.name && (toTraditionalZh(found.name) === toTraditionalZh(cleanName) || found.fuzzy)) {
            next.symbolName = found.name
            enriched.names++
          } else if (!next.symbolName) {
            next.symbolName = found.name
          }
        }
      }

      // 台股代號若含英文字母（如 OCR 誤讀 "IR0230"）視為雜訊，改用名稱重新解析。
      const badTwSymbol = p.market === 'tw' && !!next.symbol && !/^\d{4,6}$/.test(next.symbol)
      if ((!next.symbol || badTwSymbol) && cleanName) {
        const found = await findSymbolByName(cleanName, p.market)
        if (found && !found.ambiguous) {
          next.symbol = found.symbol
          enriched.symbols++
          // DB/TWSE 名稱比 OCR 讀出更可靠；簡繁等效或模糊命中（單字誤讀）時以正名取代。
          if (p.market === 'tw' && found.name && (toTraditionalZh(found.name) === toTraditionalZh(cleanName) || found.fuzzy)) {
            next.symbolName = found.name
            enriched.names++
          } else if (!next.symbolName) {
            next.symbolName = found.name
          }
        } else if (badTwSymbol) {
          // 誤讀代號 + 名稱也查無 → 清掉，讓使用者手動搜尋補齊（避免存下錯誤代號）。
          next.symbol = ''
        }
      }

      if (next.symbol && !next.symbolName) {
        try {
          const yahooSymbol = await resolveYahooSymbol(next.symbol, p.market)
          const profile = await yahooFinanceProvider.getProfile(yahooSymbol, p.market === 'tw' ? 'TW' : 'US')
          // Yahoo 的台股 profile 常回傳代號本身（如 "2646.TW"）而非中文名，不算有效名稱。
          if (profile.name && profile.name.trim().toUpperCase() !== yahooSymbol.trim().toUpperCase()) {
            next.symbolName = profile.name
            enriched.names++
          }
        } catch {}
      }

      if (next.symbol && (next.currentPrice == null || next.currentPrice <= 0)) {
        const q = await fetchLiveQuote(next.symbol, p.market)
        if (q && q.price > 0) {
          next.currentPrice = q.price
          enriched.prices++
        }
      }

      return next
    }),
  )
  return { positions: out as P[], enriched }
}

/** 給 AI 用的市場上下文簡述。 */
export async function buildMarketContext(rawSymbol: string, market: Market): Promise<string> {
  try {
    const symbol = await resolveYahooSymbol(rawSymbol, market)
    const quote = await yahooFinanceProvider.getQuote(symbol, market === 'tw' ? 'TW' : 'US')
    const profile = await yahooFinanceProvider.getProfile(symbol, market === 'tw' ? 'TW' : 'US').catch(() => null)
    const lines = [
      `即時報價 ${symbol}: ${quote.price}（成交量 ${quote.volume}）`,
      profile?.name ? `公司名稱: ${profile.name}` : '',
      profile?.sector ? `產業: ${profile.sector}${profile.industry ? ` / ${profile.industry}` : ''}` : '',
      profile?.description ? `公司簡介: ${profile.description.slice(0, 800)}` : '',
    ].filter(Boolean)
    return lines.join('\n')
  } catch (e) {
    console.error('[Portfolio] buildMarketContext failed:', e)
    return ''
  }
}