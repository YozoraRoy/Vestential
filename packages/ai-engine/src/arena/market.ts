import { loadConfig } from '@stock/core'
import { registry } from '@stock/market-data'
import { DEFAULT_ARENA_UNIVERSE, type ArenaDayOhlc, type ArenaHistory, type ArenaPrice, type ArenaUniverseItem } from './types.js'

/** 移植自 engine.ts 的台股代號解析：純數字代號依序試 .TW / .TWO。 */
const resolvedCache = new Map<string, string>()

export async function resolveTwSymbol(raw: string): Promise<string> {
  const trimmed = raw.trim().toUpperCase()
  if (trimmed.endsWith('.TW') || trimmed.endsWith('.TWO')) return trimmed
  if (!/^\d{4,6}$/.test(trimmed)) return trimmed

  const cached = resolvedCache.get(trimmed)
  if (cached) return cached

  const provider = registry.get('yahoo-finance')
  for (const suffix of ['TW', 'TWO']) {
    try {
      const q = await provider.getQuote(`${trimmed}.${suffix}`, 'TW')
      if (q && q.price > 0) {
        const hit = `${trimmed}.${suffix}`
        resolvedCache.set(trimmed, hit)
        return hit
      }
    } catch {
      /* try next */
    }
  }
  resolvedCache.set(trimmed, trimmed)
  return trimmed
}

export interface LoadedArenaPrice extends ArenaPrice {
  /** 已解析的 Yahoo 代號（含後綴），寫交易日誌用。 */
  resolvedSymbol?: string
  /** 當日 OHLC + 前日收盤（供合成盤中路徑與盤前統計）。 */
  day?: ArenaDayOhlc
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++
      results[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * 抓取股票池本輪報價與近 N 日歷史走勢。
 * @param universe 股票池（symbol 為無後綴代號）
 * @param roundDate YYYY-MM-DD（當日或歷史重播日）
 * @param lookbackDays 每檔回推的歷史天數
 * @param gapMs 兩次 Yahoo 呼叫間隔，避免觸發限流
 */
export async function fetchArenaMarket(
  universe: ArenaUniverseItem[],
  roundDate: string,
  lookbackDays = 10,
  gapMs = 120,
): Promise<{ prices: Record<string, LoadedArenaPrice>; history: Record<string, ArenaHistory> }> {
  const provider = registry.get('yahoo-finance')
  const prices: Record<string, LoadedArenaPrice> = {}
  const history: Record<string, ArenaHistory> = {}

  const entries = await mapConcurrent(universe, 5, async (item) => {
    await sleep(gapMs)
    const resolved = await resolveTwSymbol(item.symbol)
    const hist: ArenaHistory = []
    try {
      const data = await provider.getHistory(resolved, 'TW', undefined, undefined)
      const rounds = data
        .filter((r) => r.timestamp <= Date.now())
        .sort((a, b) => b.timestamp - a.timestamp)

      const around = new Date(`${roundDate}T00:00:00`)
      const target = around.getTime() + 23 * 3600_000 + 59 * 60_000 + 59_000
      const snap = rounds.find((r) => {
        const d = new Date(r.timestamp)
        return d.toISOString().slice(0, 10) === roundDate
      })

      const lookbackStart = around.getTime() - (lookbackDays + 8) * 86_400_000
      const recent = rounds
        .filter((r) => r.timestamp <= target && r.timestamp >= lookbackStart)
        .sort((a, b) => a.timestamp - b.timestamp)
      for (const r of recent) {
        hist.push({
          date: new Date(r.timestamp).toISOString().slice(0, 10),
          close: r.close,
          open: r.open || undefined,
          high: r.high || undefined,
          low: r.low || undefined,
        })
      }

      const px = snap ?? recent[recent.length - 1]
      if (!px) return null

      let pct: number | undefined = undefined
      if (recent.length >= 2) {
        const prev = recent[recent.length - 2].close
        pct = prev > 0 ? Math.round(((recent[recent.length - 1].close - prev) / prev) * 10000) / 100 : 0
      }

      const day: ArenaDayOhlc = {
        date: new Date(px.timestamp).toISOString().slice(0, 10),
        open: px.open > 0 ? px.open : px.close,
        high: px.high > 0 ? px.high : px.close,
        low: px.low > 0 ? px.low : px.close,
        close: px.close,
        prevClose: recent.length >= 2 ? recent[recent.length - 2].close : undefined,
      }

      return {
        resolved,
        price: Math.round(px.close * 100) / 100,
        open: Math.round(day.open * 100) / 100,
        high: Math.round(day.high * 100) / 100,
        low: Math.round(day.low * 100) / 100,
        changePct: pct !== undefined ? Math.round(pct * 100) / 100 : undefined,
        day,
        history: hist,
      }
    } catch {
      return null
    }
  })

  entries.forEach((entry, i) => {
    const item = universe[i]
    if (!entry) return
    prices[item.symbol] = {
      symbol: item.symbol,
      symbolName: item.name,
      price: entry.price,
      open: entry.open,
      high: entry.high,
      low: entry.low,
      changePct: entry.changePct,
      date: entry.history[entry.history.length - 1].date,
      resolvedSymbol: entry.resolved,
      day: entry.day,
    }
    history[item.symbol] = entry.history
  })

  return { prices, history }
}

export function parseArenaUniverse(raw: string | undefined): ArenaUniverseItem[] {
  if (!raw?.trim()) return DEFAULT_ARENA_UNIVERSE
  const items: ArenaUniverseItem[] = []
  for (const part of raw.split(',')) {
    const m = part.trim().match(/^(\d{4,6})\s*([^\s,]*)$/)
    if (m) items.push({ symbol: m[1], name: m[2] || m[1] })
  }
  return items.length > 0 ? items : DEFAULT_ARENA_UNIVERSE
}

export interface LiveQuoteMap {
  bySymbol: Record<string, number>
  byResolved: Record<string, string>
}

/**
 * 抓取每個股票池符號的 Yahoo 即時報價（含尾綴解析），供「盤中真實決策窗」使用。
 * @param universe 股票池（symbol 為無後綴代號，如 2330）
 * @returns bySymbol: 無後綴代號 → 即時價；byResolved: 無後綴代號 → 已解析 Yahoo 尾綴。
 */
export async function fetchArenaLivePrices(universe: ArenaUniverseItem[]): Promise<LiveQuoteMap> {
  const provider = registry.get('yahoo-finance')
  if (!provider.getBatchQuotes || universe.length === 0) return { bySymbol: {}, byResolved: {} }

  const resolvedList: Array<{ bare: string; yahoo: string }> = []
  for (const item of universe) {
    const bare = item.symbol.trim()
    if (/^\d{4,6}/.test(bare)) resolvedList.push({ bare, yahoo: `${bare}.TW` })
    else resolvedList.push({ bare, yahoo: bare })
  }

  const bySymbol: Record<string, number> = {}
  const byResolved: Record<string, string> = {}
  try {
    const quotes = await provider.getBatchQuotes(resolvedList.map((r) => r.yahoo))
    const priceBySym = new Map(quotes.map((q) => [q.symbol, q.price]))
    const bareByYahoo = new Map<string, string>()
    for (const r of resolvedList) {
      if (!bareByYahoo.has(r.yahoo)) bareByYahoo.set(r.yahoo, r.bare)
    }
    for (const y of bareByYahoo.keys()) {
      const px = priceBySym.get(y)
      if (px && px > 0) {
        bySymbol[bareByYahoo.get(y)!] = Math.round(px * 100) / 100
        byResolved[bareByYahoo.get(y)!] = y
      }
    }
  } catch (err) {
    console.warn('[Arena] fetchArenaLivePrices failed:', (err as Error).message)
  }
  return { bySymbol, byResolved }
}

export function loadArenaConfig() {
  return loadConfig()
}