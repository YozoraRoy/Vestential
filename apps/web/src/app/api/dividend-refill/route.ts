import { NextResponse, type NextRequest } from 'next/server'
import { registry } from '@stock/market-data'
import { getStockNameById, getTwseDividendsByYear, migrate } from '@stock/database'
import { taipeiTodayStr } from '../../../lib/twse-calendar'
import {
  analyzeExDividendEvents,
  assetKindLabel,
  classifyAssetKind,
  computeFillDaysHistogram,
} from '../../../lib/ex-dividend-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 30 * 60 * 1000
const HISTORY_YEARS = 10
const MIN_COMPLETE_YEARS = 5
const SYMBOL_RE = /^\d{4,6}[A-Z]?$/

interface CachedRefill {
  payload: Record<string, unknown>
  cachedAt: number
}

const refillCache = new Map<string, CachedRefill>()

function toTaipeiDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

const DISCLAIMER_TEXT =
  '歷史填息統計僅供參考（Yahoo Finance 還原收盤價 adjclose 與 TWSE 除息資料計算，填息定義＝除息後 40 個交易日內收盤 ≥ 除息前一日收盤），過去表現不代表未來表現，亦不構成任何投資建議。'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const rawSymbol = (searchParams.get('symbol') ?? '').trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
    if (!rawSymbol || !SYMBOL_RE.test(rawSymbol)) {
      return NextResponse.json(
        { error: '請提供有效的台股或 ETF 代號（例如 0056、2330）' },
        { status: 400 },
      )
    }

    const today = taipeiTodayStr()
    const forceRefresh = searchParams.get('refresh') === '1' || searchParams.get('refresh') === 'true'
    const cacheKey = `${today}:${rawSymbol}`
    const cached = refillCache.get(cacheKey)
    if (!forceRefresh && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return NextResponse.json(
        { ...cached.payload, from_cache: true },
        { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' } },
      )
    }

    await migrate()
    const todayYear = Number(today.slice(0, 4))
    const startYear = todayYear - (HISTORY_YEARS - 1)
    const startDate = `${startYear}-01-01`
    const fiveYearsAgo = `${todayYear - MIN_COMPLETE_YEARS}-${today.slice(5)}`

    // 1. 讀取近 10 年 twse_dividends 歷史除息事件（唯讀）
    const histEvents: Array<{ exDate: string; cashDividend: number }> = []
    const missingDividendYears: string[] = []
    for (let y = startYear; y <= todayYear; y++) {
      const yStr = String(y)
      const list = await getTwseDividendsByYear(yStr).catch(() => [])
      if (list.length === 0 && y >= todayYear - MIN_COMPLETE_YEARS && y < todayYear) {
        missingDividendYears.push(yStr)
      }
      for (const r of list) {
        if (r.symbol.toUpperCase() !== rawSymbol) continue
        if (r.ex_date >= today) continue
        if (r.cash_dividend <= 0) continue
        histEvents.push({ exDate: r.ex_date, cashDividend: r.cash_dividend })
      }
    }

    // 2. 取得名稱、quoteType 與還原股價 bars（先 .TW，無資料再試 .TWO）
    const provider = registry.get('yahoo-finance')
    let displayName: string | null = null
    try {
      displayName = await getStockNameById(rawSymbol)
    } catch {
      displayName = null
    }

    let quoteType = ''
    let bars: Array<{ date: string; close: number }> = []
    for (const suffix of ['.TW', '.TWO']) {
      const yahooSym = `${rawSymbol}${suffix}`
      try {
        const batch = await provider.getBatchQuotes?.([yahooSym])
        const q = batch?.[0]
        if (q) {
          if (!quoteType && q.quoteType) quoteType = q.quoteType
          if (!displayName && q.name) displayName = q.name
        }
      } catch {}

      try {
        const history = await provider.getHistory(yahooSym, 'TW', startDate, today)
        if (history.length > 0) {
          const byDate = new Map<string, number>()
          for (const h of history) {
            if (!Number.isFinite(h.close) || h.close <= 0) continue
            byDate.set(toTaipeiDate(h.timestamp), h.close)
          }
          bars = [...byDate.entries()]
            .map(([date, close]) => ({ date, close }))
            .sort((a, b) => (a.date < b.date ? -1 : 1))
          if (bars.length > 0) break
        }
      } catch {}
    }

    if (bars.length === 0 && histEvents.length === 0 && !displayName) {
      return NextResponse.json(
        { error: `查無代號 ${rawSymbol} 的行情或除息資料` },
        { status: 400 },
      )
    }

    const assetKind = classifyAssetKind(quoteType, rawSymbol, displayName)
    const stats = analyzeExDividendEvents(bars, histEvents)
    const histogram = computeFillDaysHistogram(stats.events)

    const historySince = bars.length > 0 ? bars[0]!.date : null
    const yearsIncomplete =
      historySince == null || historySince > fiveYearsAgo || missingDividendYears.length > 0

    const payload = {
      symbol: rawSymbol,
      name: displayName,
      asset_kind: assetKind,
      asset_label: assetKindLabel(assetKind),
      stats: stats.insufficient
        ? {
            ...stats,
            fillScore: null,
            fillRateD1: null,
            fillRateD5: null,
            fillRateD10: null,
            fillRateD20: null,
            fillRateD40: null,
            expiryFillRate: null,
          }
        : stats,
      histogram: stats.insufficient
        ? { ...histogram, fillRate: null }
        : histogram,
      years_incomplete: yearsIncomplete,
      history_since: historySince,
      data_period: {
        from: historySince ?? startDate,
        to: today,
        missing_dividend_years: missingDividendYears,
      },
      disclaimer: DISCLAIMER_TEXT,
      from_cache: false,
    }

    refillCache.set(cacheKey, { payload, cachedAt: Date.now() })

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'dividend refill query failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
