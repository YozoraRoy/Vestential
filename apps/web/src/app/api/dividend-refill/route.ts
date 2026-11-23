import { NextResponse, type NextRequest } from 'next/server'
import { resolveStockDisplayName, type StockMultilingualName } from '@stock/core'
import { registry } from '@stock/market-data'
import { getTwseDividendsByYear, migrate } from '@stock/database'
import { resolveServerStockNames } from '@/lib/stock-names-server'
import { getTaxable54cRatio } from '@/lib/etf-dividend-composition'
import { syncFinMindDividendsForSymbols } from '@/lib/finmind-dividends'
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
    const cacheKey = `v2:${today}:${rawSymbol}`
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

    // 1. 讀取近 10 年 twse_dividends 歷史與已公告除息事件（若近兩年無紀錄則嘗試 FinMind 補齊）
    const collectEvents = async () => {
      const hist: Array<{ exDate: string; payDate: string | null; cashDividend: number }> = []
      const upcoming: Array<{ exDate: string; payDate: string | null; cashDividend: number }> = []
      const missing: string[] = []
      for (let y = startYear; y <= todayYear; y++) {
        const yStr = String(y)
        const list = await getTwseDividendsByYear(yStr).catch(() => [])
        if (list.length === 0 && y >= todayYear - MIN_COMPLETE_YEARS && y < todayYear) {
          missing.push(yStr)
        }
        for (const r of list) {
          if (r.symbol.toUpperCase() !== rawSymbol) continue
          if (r.cash_dividend <= 0) continue
          const ev = { exDate: r.ex_date, payDate: r.pay_date ?? null, cashDividend: r.cash_dividend }
          if (r.ex_date >= today) upcoming.push(ev)
          else hist.push(ev)
        }
      }
      return { hist, upcoming, missing }
    }

    let { hist: histEvents, upcoming: upcomingEvents, missing: missingDividendYears } = await collectEvents()
    const recentRows = [...histEvents, ...upcomingEvents]
      .filter((e) => e.exDate >= `${todayYear - 1}-01-01`)
      .map((e) => ({ symbol: rawSymbol, ex_date: e.exDate, cash_dividend: e.cashDividend }))
    const syncedCount = await syncFinMindDividendsForSymbols([rawSymbol], recentRows, today).catch(() => 0)
    if (syncedCount > 0) {
      ;({ hist: histEvents, upcoming: upcomingEvents, missing: missingDividendYears } = await collectEvents())
    }

    // 2. 取得名稱、quoteType 與還原股價 bars（先 .TW，無資料再試 .TWO）
    const provider = registry.get('yahoo-finance')
    let yahooName: string | null = null
    let quoteType = ''
    let bars: Array<{ date: string; close: number }> = []
    for (const suffix of ['.TW', '.TWO']) {
      const yahooSym = `${rawSymbol}${suffix}`
      try {
        const batch = await provider.getBatchQuotes?.([yahooSym])
        const q = batch?.[0]
        if (q) {
          if (!quoteType && q.quoteType) quoteType = q.quoteType
          if (!yahooName && q.name) yahooName = q.name
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

    const namesMap = await resolveServerStockNames([rawSymbol], {
      yahooNames: { [rawSymbol]: yahooName },
      marketHint: 'TW',
      source: 'dividend_refill',
    }).catch(() => ({} as Record<string, StockMultilingualName>))
    const names = namesMap[rawSymbol]
    const displayName = names ? resolveStockDisplayName(rawSymbol, names, 'zh-TW') : yahooName

    if (bars.length === 0 && histEvents.length === 0 && !displayName) {
      return NextResponse.json(
        { error: `查無代號 ${rawSymbol} 的行情或除息資料` },
        { status: 400 },
      )
    }

    const assetKind = classifyAssetKind(quoteType, rawSymbol, displayName)
    const stats = analyzeExDividendEvents(bars, histEvents)
    const histogram = computeFillDaysHistogram(stats.events)

    // 3. 彙整股利政策摘要（配息頻率、常見除息月、近 12 個月現金股利與殖利率、54C 稅制口徑、近 5 年年度合計）
    const allDividendEvents = [...histEvents, ...upcomingEvents].sort((a, b) =>
      a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0,
    )
    const oneYearAgo = `${todayYear - 1}${today.slice(4)}`
    const ttmEvents = histEvents.filter((e) => e.exDate >= oneYearAgo && e.exDate < today)
    const ttmCashDividend = Math.round(ttmEvents.reduce((s, e) => s + e.cashDividend, 0) * 10_000) / 10_000
    const latestClose = bars.length > 0 ? bars[bars.length - 1]!.close : null
    const ttmYieldPct =
      latestClose != null && latestClose > 0 && ttmCashDividend > 0
        ? Math.round((ttmCashDividend / latestClose) * 10_000) / 100
        : null

    const freqCount = ttmEvents.length
    const frequency: 'monthly' | 'quarterly' | 'semi-annual' | 'annual' | 'irregular' | 'unknown' =
      freqCount >= 10
        ? 'monthly'
        : freqCount >= 4
        ? 'quarterly'
        : freqCount === 2
        ? 'semi-annual'
        : freqCount === 1
        ? 'annual'
        : allDividendEvents.length > 0
        ? 'irregular'
        : 'unknown'

    const exMonths = [
      ...new Set(
        allDividendEvents
          .filter((e) => e.exDate >= `${todayYear - 2}-01-01`)
          .map((e) => Number(e.exDate.slice(5, 7)))
          .filter((m) => m >= 1 && m <= 12),
      ),
    ].sort((a, b) => a - b)

    const yearAgg = new Map<string, { totalCash: number; count: number }>()
    for (const e of allDividendEvents) {
      const y = e.exDate.slice(0, 4)
      const prev = yearAgg.get(y) ?? { totalCash: 0, count: 0 }
      prev.totalCash = Math.round((prev.totalCash + e.cashDividend) * 10_000) / 10_000
      prev.count += 1
      yearAgg.set(y, prev)
    }
    const annualTotals = [...yearAgg.entries()]
      .sort((a, b) => (a[0] > b[0] ? -1 : 1))
      .slice(0, 5)
      .map(([year, v]) => ({ year, totalCash: v.totalCash, count: v.count }))

    const taxInfo = getTaxable54cRatio(rawSymbol)
    const dividendPolicy = {
      frequency,
      exMonths,
      ttmCashDividend,
      ttmYieldPct,
      latestClose,
      taxable54cRatio: taxInfo.ratio,
      taxFreeRatio: Math.max(0, Math.round((1 - taxInfo.ratio) * 10_000) / 10_000),
      taxNote: taxInfo.note ?? null,
      upcoming: [...upcomingEvents].sort((a, b) => (a.exDate < b.exDate ? -1 : 1)).slice(0, 4),
      annualTotals,
    }

    const historySince = bars.length > 0 ? bars[0]!.date : null
    const yearsIncomplete =
      historySince == null || historySince > fiveYearsAgo || missingDividendYears.length > 0

    const payload = {
      symbol: rawSymbol,
      name: displayName,
      names,
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
      dividend_policy: dividendPolicy,
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
