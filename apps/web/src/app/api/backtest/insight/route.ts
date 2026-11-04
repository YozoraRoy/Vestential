import { NextResponse } from 'next/server'
import { registry } from '@stock/market-data'
import { runGridSearch, MA_PERIOD } from '@stock/backtest'
import { resolveYahooSymbol } from '@/lib/portfolio'

export const dynamic = 'force-dynamic'

export interface InsightResult {
  symbol: string
  bestThreshold: number | null
  currentBias: number | null
  latestBias: number | null
  latestClose: number | null
  livePriceBias: number | null
  ma60: number | null
  livePrice: number | null
  asOf: number | null
  targetPrice: number | null
  /** 目前乖離是否已達到最佳進場閾值（乖離 ≤ 閾值）。 */
  inEntryZone: boolean
  distanceToTargetPct: number | null
}

const cache = new Map<string, { at: number; data: InsightResult }>()
const TTL_MS = 30 * 60 * 1000

function parseNum(v: string | null, fallback: number, min: number, max: number): number {
  if (v == null || v.trim() === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol')?.trim()
  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })
  }

  // 比照實際回測：使用表單參數與相同年份窗口，確保預覽閾值與 /api/backtest 一致。
  const holdingDays = parseNum(searchParams.get('holdingDays'), 252, 1, 252)
  const targetPct = parseNum(searchParams.get('target'), 25, 1, 100)
  const stopPct = parseNum(searchParams.get('stop'), 12, 1, 100)
  const years = parseNum(searchParams.get('years'), 15, 1, 15)

  const cacheKey = `${symbol}|${holdingDays}|${targetPct}|${stopPct}|${years}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json(hit.data)
  }

  try {
    const provider = registry.get('yahoo-finance')
    const yahooSymbol = await resolveYahooSymbol(symbol, 'tw')

    const end = new Date()
    const start = new Date(end)
    start.setFullYear(start.getFullYear() - years)

    const history = await provider.getHistory(
      yahooSymbol,
      'TW',
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10),
    )

    if (history.length < MA_PERIOD) {
      const data: InsightResult = {
        symbol: yahooSymbol,
        bestThreshold: null,
        currentBias: null,
        latestBias: null,
        latestClose: null,
        livePriceBias: null,
        ma60: null,
        livePrice: null,
        asOf: null,
        targetPrice: null,
        inEntryZone: false,
        distanceToTargetPct: null,
      }
      cache.set(cacheKey, { at: Date.now(), data })
      return NextResponse.json(data)
    }

    let bestThreshold: number | null = null
    try {
      const maxTheoreticalTrades = Math.max(1, Math.floor((years * 250) / holdingDays))
      const minTrades = Math.min(10, Math.max(2, Math.floor(maxTheoreticalTrades * 0.25)))

      const g = runGridSearch(history, {
        minTrades,
        params: {
          holdingDays,
          targetProfit: targetPct / 100,
          maxDrawdown: stopPct / 100,
        },
      })
      // 乖離率閾值搜尋範圍全為負值（-3% ~ -15%）；若 bestThreshold 為 0 或無交易紀錄表示樣本不足無有效最佳閾值
      bestThreshold = g.bestThreshold != null && g.bestThreshold < 0 && g.totalTrades > 0 ? g.bestThreshold : null
    } catch (_) {
      bestThreshold = null
    }

    const closes = history.map((v) => v.close)
    const ma60 = closes.slice(-MA_PERIOD).reduce((s, c) => s + c, 0) / MA_PERIOD
    const latestClose = closes[closes.length - 1]
    const latestBias = ma60 > 0 ? latestClose / ma60 - 1 : null

    let livePrice: number | null = null
    let livePriceBias: number | null = null
    try {
      const quote = await provider.getQuote(yahooSymbol, 'TW')
      livePrice = quote.price > 0 ? quote.price : null
      if (livePrice != null && ma60 > 0) livePriceBias = livePrice / ma60 - 1
    } catch (_) {}

    // 目前乖離：預設以前一期收盤價為基準；僅在無收盤資料時才退回即時盤中價。
    const currentBias = latestBias ?? livePriceBias
    const inEntryZone = currentBias != null && bestThreshold != null && currentBias <= bestThreshold / 100
    const distanceToTargetPct =
      currentBias != null && bestThreshold != null ? (currentBias - bestThreshold / 100) * 100 : null
    const targetPrice =
      bestThreshold != null && ma60 > 0 ? ma60 * (1 + bestThreshold / 100) : null

    const data: InsightResult = {
      symbol: yahooSymbol,
      bestThreshold,
      currentBias,
      latestBias,
      latestClose,
      livePriceBias,
      ma60,
      livePrice,
      asOf: history[history.length - 1].timestamp,
      targetPrice,
      inEntryZone,
      distanceToTargetPct,
    }
    cache.set(cacheKey, { at: Date.now(), data })
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? '計算失敗' }, { status: 500 })
  }
}
