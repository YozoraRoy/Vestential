import { NextResponse, type NextRequest } from 'next/server'
import { registry } from '@stock/market-data'
import { getStockNameById, getTwseDividendsByYear, migrate } from '@stock/database'
import { getLastCompletedTradingDay, isTwseTradingDay, taipeiTodayStr } from '../../../lib/twse-calendar'
import { getDividendsCacheInfo } from '../../../lib/twse-dividends'
import {
  analyzeExDividendEvents,
  assetKindLabel,
  classifyAssetKind,
  computeExLastBuyDate,
  computeLiveFillProgress,
  daysUntilEx,
  type ExDividendStats,
  type LiveFillProgress,
} from '../../../lib/ex-dividend-engine'
import {
  alertExDividendFetchFailed,
  alertExLastBuyCountdown,
  alertFillCompleted,
} from '../../../lib/ex-dividend-alerts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Issue #67：未來 30 天上市＋ETF 除權息清單＋每檔填息統計（唯讀）。
 *
 * - 清單源＝TWT48U 預告逐日累積＋本地快取 `twse_dividends`
 *  （沿 `lib/twse-dividends.ts` 模式）；本 route 唯讀不寫表、
 *   不觸發抓取（抓取由同步鈕／16:00 排程順帶做，沿既有語義）；
 * - 歷史事件回溯以 adjclose（Yahoo 全還原）＋本地快取為主
 *   （承接 #69：TWT48U 歷史檔不保留；缺歷史日視為無事件並註「年份不全」）；
 * - TWT48U 異動降級：交易日快取非今日即 degraded＋頁面標註資料時間，
 *   並經既有 `sendMarketFocusAlert` 信件管線告警（讀時順帶、30 分鐘去重）；
 * - 無 DB migration（僅 SELECT 既有 `twse_dividends`）。
 * - GET /api/ex-dividend
 */


interface CachedData {
  payload: any
  cachedAt: number
  date: string
}

let inMemoryCache: CachedData | null = null
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 分鐘快取（Issue #123）

const WINDOW_DAYS = 30
const HISTORY_YEARS = 5
const MAX_SYMBOLS = 100
const HISTORY_CONCURRENCY = 6

function addDaysStr(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00+08:00`) + n * 86400000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

function toTaipeiDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

export interface ExDividendItem {
  symbol: string
  name: string | null
  ex_date: string
  ex_last_buy_date: string
  days_to_ex: number | null
  cash_dividend: number
  yield_pct: number | null
  quote_type: string
  asset_kind: 'etf' | 'stock' | 'unknown'
  asset_label: string
  stats: (ExDividendStats & { years_incomplete: boolean; history_since: string | null }) | null
  stats_reason: 'ok' | 'insufficient' | 'no-history'
}

/** Issue #93：進行中填息進度追蹤項目 */
export interface ExDividendTrackingItem {
  symbol: string
  name: string | null
  ex_date: string
  cash_dividend: number
  prev_close: number
  reference_price: number
  current_price: number
  progress_pct: number
  status: 'filled' | 'filling' | 'discount'
  status_label: string
  filled_in_days: number | null
  days_since_ex: number
  asset_kind: 'etf' | 'stock' | 'unknown'
  asset_label: string
  avg_fill_days: number | null
  fill_score: number | null
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i]!)
    }
  })
  await Promise.all(workers)
  return out
}

export async function GET(req: NextRequest) {
  try {
    const today = taipeiTodayStr()
    const { searchParams } = new URL(req.url)
    const forceRefresh = searchParams.get('refresh') === '1' || searchParams.get('refresh') === 'true'

    if (!forceRefresh && inMemoryCache && inMemoryCache.date === today && (Date.now() - inMemoryCache.cachedAt < CACHE_TTL_MS)) {
      return NextResponse.json(
        { ...inMemoryCache.payload, from_cache: true },
        { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' } },
      )
    }

    await migrate()
    const windowEnd = addDaysStr(today, WINDOW_DAYS)
    const todayYear = Number(today.slice(0, 4))

    const { cacheAsOf, isTradingDay } = await getDividendsCacheInfo(today)

    // 讀取窗內年份快取（跨年窗含次年；唯讀）。
    const readYears = [String(todayYear)]
    if (windowEnd.slice(0, 4) !== String(todayYear)) readYears.push(windowEnd.slice(0, 4))
    const upcomingBySymbol = new Map<string, { ex_date: string; cash_dividend: number }>()
    const coverage: Array<{ year: string; rows: number; missing: boolean }> = []
    for (const y of readYears) {
      const list = await getTwseDividendsByYear(y).catch(() => [])
      coverage.push({ year: y, rows: list.length, missing: list.length === 0 })
      for (const r of list) {
        if (r.ex_date < today || r.ex_date > windowEnd) continue
        const prev = upcomingBySymbol.get(r.symbol)
        if (!prev || r.ex_date < prev.ex_date) {
          upcomingBySymbol.set(r.symbol, { ex_date: r.ex_date, cash_dividend: r.cash_dividend })
        }
      }
    }

    // 過去 HISTORY_YEARS 年歷史事件（同表回溯；缺年由 coverage 揭露）。
    const histYears: string[] = []
    for (let i = HISTORY_YEARS - 1; i >= 0; i--) histYears.push(String(todayYear - i))
    const historyBySymbol = new Map<string, { ex_date: string; cash_dividend: number }[]>()
    const histCoverage: Array<{ year: string; rows: number; missing: boolean }> = []
    for (const y of histYears) {
      if (readYears.includes(y)) {
        // 當年已讀過（重用 coverage 資訊；仍需全量列做歷史事件）。
        const list = await getTwseDividendsByYear(y).catch(() => [])
        for (const r of list) {
          if (r.ex_date >= today) continue
          const arr = historyBySymbol.get(r.symbol) ?? []
          arr.push({ ex_date: r.ex_date, cash_dividend: r.cash_dividend })
          historyBySymbol.set(r.symbol, arr)
        }
        continue
      }
      const list = await getTwseDividendsByYear(y).catch(() => [])
      histCoverage.push({ year: y, rows: list.length, missing: list.length === 0 })
      for (const r of list) {
        if (r.ex_date >= today) continue
        const arr = historyBySymbol.get(r.symbol) ?? []
        arr.push({ ex_date: r.ex_date, cash_dividend: r.cash_dividend })
        historyBySymbol.set(r.symbol, arr)
      }
    }

    // 依除息日由近到遠排序（最近要除息的排前面），同日者依代號排序
    const symbols = [...upcomingBySymbol.keys()].sort((a, b) => {
      const da = upcomingBySymbol.get(a)?.ex_date ?? ''
      const db = upcomingBySymbol.get(b)?.ex_date ?? ''
      if (da !== db) return da.localeCompare(db)
      return a.localeCompare(b)
    })
    const truncated = symbols.length > MAX_SYMBOLS
    const picked = symbols.slice(0, MAX_SYMBOLS)

    // TWT48U 降級判定：以最近已完成交易日為基準（交易日 16:00 前以昨交易日為準，16:00 後才要求今日快取）。
    const expectedTradingDay = getLastCompletedTradingDay()
    const degraded = !cacheAsOf || cacheAsOf < expectedTradingDay
    const degradedReason = degraded ? 'stale-cache' : null
    if (degraded) {
      void alertExDividendFetchFailed(`快取停留於 ${cacheAsOf ?? '無紀錄'}（預期最新交易日為 ${expectedTradingDay}）`)
    }

    const provider = registry.get('yahoo-finance')
    const yahooSymbols = picked.map((s) => `${s}.TW`)

    // quoteType＋名稱一批查（v7 batch；失敗即 unknown，不擋主流程）。
    const quoteMap = new Map<string, { quoteType: string; name: string | null }>()
    try {
      const batch = await provider.getBatchQuotes?.(yahooSymbols)
      for (const q of batch ?? []) {
        const base = (q.symbol ?? '').toUpperCase().replace(/\.TW$/, '')
        quoteMap.set(base, { quoteType: q.quoteType ?? '', name: q.name ?? null })
      }
    } catch (e) {
      console.error('[ExDividend] batch quotes failed (non-blocking):', e)
    }

    const fiveYearsAgo = `${todayYear - HISTORY_YEARS}-${today.slice(5)}`
    const items = await mapPool(picked, HISTORY_CONCURRENCY, async (symbol): Promise<ExDividendItem> => {
      const upcoming = upcomingBySymbol.get(symbol)!
      const q = quoteMap.get(symbol.toUpperCase())
      const quoteType = q?.quoteType ?? ''
      let displayName = q?.name ?? null
      try {
        const zh = await getStockNameById(symbol)
        if (zh) displayName = zh
      } catch {}
      const assetKind = classifyAssetKind(quoteType, symbol, displayName)
      const yahooSymbol = `${symbol}.TW`
      const start = `${todayYear - HISTORY_YEARS}-${today.slice(5)}`
      let bars: { date: string; close: number }[] = []
      try {
        const history = await provider.getHistory(yahooSymbol, 'TW', start, today)
        const byDate = new Map<string, number>()
        for (const h of history) {
          if (!Number.isFinite(h.close) || h.close <= 0) continue
          byDate.set(toTaipeiDate(h.timestamp), h.close)
        }
        bars = [...byDate.entries()]
          .map(([date, close]) => ({ date, close }))
          .sort((a, b) => (a.date < b.date ? -1 : 1))
      } catch (e) {
        console.error(`[ExDividend] history failed for ${symbol} (non-blocking):`, e)
      }

      const latestClose = bars.length > 0 ? bars[bars.length - 1]!.close : null
      const histEvents = (historyBySymbol.get(symbol) ?? [])
        .filter((r) => r.ex_date < today)
        .map((r) => ({ exDate: r.ex_date, cashDividend: r.cash_dividend }))

      let stats: ExDividendItem['stats'] = null
      let statsReason: ExDividendItem['stats_reason'] = 'no-history'
      if (bars.length > 0 && histEvents.length > 0) {
        const s = analyzeExDividendEvents(bars, histEvents)
        stats = {
          ...s,
          years_incomplete: bars[0]!.date > fiveYearsAgo,
          history_since: bars[0]!.date,
        }
        statsReason = s.insufficient ? 'insufficient' : 'ok'
      }

      return {
        symbol,
        name: displayName,
        ex_date: upcoming.ex_date,
        ex_last_buy_date: computeExLastBuyDate(upcoming.ex_date, isTwseTradingDay),
        days_to_ex: daysUntilEx(today, upcoming.ex_date),
        cash_dividend: upcoming.cash_dividend,
        yield_pct:
          latestClose != null && latestClose > 0 && upcoming.cash_dividend > 0
            ? Math.round((upcoming.cash_dividend / latestClose) * 10000) / 100
            : null,
        quote_type: quoteType,
        asset_kind: assetKind,
        asset_label: assetKindLabel(assetKind),
        stats,
        stats_reason: statsReason,
      }
    })

    items.sort((a, b) => (a.ex_date < b.ex_date ? -1 : a.ex_date > b.ex_date ? 1 : a.symbol.localeCompare(b.symbol)))

    // 讀時順帶通知（皆 best-effort＋30 分鐘去重，不新增渠道／cron）：
    // - 最後買進日倒數：ex_last_buy_date 即今日者；
    // - 填息完成：近 10 天除息事件已達標者。
    const countdown = items
      .filter((i) => i.ex_last_buy_date === today)
      .map((i) => ({ symbol: i.symbol, name: i.name, ex_date: i.ex_date, ex_last_buy_date: i.ex_last_buy_date }))
    if (countdown.length > 0) void alertExLastBuyCountdown(countdown)
    const tenDaysAgo = addDaysStr(today, -10)
    const completed: { symbol: string; name?: string | null; ex_date: string; daysToFill: number }[] = []
    for (const i of items) {
      for (const e of i.stats?.events ?? []) {
        if (e.exDate >= tenDaysAgo && e.exDate < today && e.filled && e.daysToFill != null) {
          completed.push({ symbol: i.symbol, name: i.name, ex_date: e.exDate, daysToFill: e.daysToFill })
        }
      }
    }
    if (completed.length > 0) void alertFillCompleted(completed)

    // Issue #93：計算過去 60 天內剛除息標的的填息進度追蹤
    const sixtyDaysAgo = addDaysStr(today, -60)
    const recentEvents: { symbol: string; ex_date: string; cash_dividend: number; prev_close: number | null }[] = []
    for (const y of readYears) {
      const list = await getTwseDividendsByYear(y).catch(() => [])
      for (const r of list) {
        if (r.ex_date >= sixtyDaysAgo && r.ex_date <= today && r.cash_dividend > 0) {
          recentEvents.push({
            symbol: r.symbol,
            ex_date: r.ex_date,
            cash_dividend: r.cash_dividend,
            prev_close: r.prev_close ?? null,
          })
        }
      }
    }

    recentEvents.sort((a, b) => (a.ex_date > b.ex_date ? -1 : 1))
    const trackingPicked = recentEvents.slice(0, 30)

    const trackingResults = await mapPool(
      trackingPicked,
      HISTORY_CONCURRENCY,
      async (ev): Promise<ExDividendTrackingItem | null> => {
        try {
          const yahooSymbol = `${ev.symbol}.TW`
          const history = await provider.getHistory(yahooSymbol, 'TW', addDaysStr(ev.ex_date, -10), today).catch(() => [])
          const byDate = new Map<string, number>()
          for (const h of history) {
            if (Number.isFinite(h.close) && h.close > 0) {
              byDate.set(toTaipeiDate(h.timestamp), h.close)
            }
          }
          const bars = [...byDate.entries()]
            .map(([date, close]) => ({ date, close }))
            .sort((a, b) => (a.date < b.date ? -1 : 1))

          if (bars.length === 0) return null

          const currentPrice = bars[bars.length - 1]!.close

          let prevClose = ev.prev_close
          if (prevClose == null || prevClose <= 0) {
            for (let i = 0; i < bars.length; i++) {
              if (bars[i]!.date < ev.ex_date) prevClose = bars[i]!.close
            }
          }
          if (!prevClose || prevClose <= 0) prevClose = currentPrice

          const barsAfterEx = bars.filter((b) => b.date >= ev.ex_date)
          const progress = computeLiveFillProgress(prevClose, ev.cash_dividend, currentPrice, barsAfterEx)

          let displayName = quoteMap.get(ev.symbol)?.name ?? null
          try {
            const zh = await getStockNameById(ev.symbol)
            if (zh) displayName = zh
          } catch {}

          const q = quoteMap.get(ev.symbol)
          const assetKind = classifyAssetKind(q?.quoteType ?? '', ev.symbol, displayName)

          const histEvents = (historyBySymbol.get(ev.symbol) ?? [])
            .filter((r) => r.ex_date < ev.ex_date)
            .map((r) => ({ exDate: r.ex_date, cashDividend: r.cash_dividend }))
          let avgFillDays: number | null = null
          let fillScore: number | null = null
          if (bars.length > 0 && histEvents.length >= 3) {
            const st = analyzeExDividendEvents(bars, histEvents)
            if (!st.insufficient) {
              avgFillDays = st.avgFillDays
              fillScore = st.fillScore
            }
          }

          return {
            symbol: ev.symbol,
            name: displayName,
            ex_date: ev.ex_date,
            cash_dividend: ev.cash_dividend,
            prev_close: progress.prevClose,
            reference_price: progress.referencePrice,
            current_price: progress.currentPrice,
            progress_pct: progress.progressPct,
            status: progress.status,
            status_label: progress.statusLabel,
            filled_in_days: progress.filledInDays,
            days_since_ex: progress.daysSinceEx,
            asset_kind: assetKind,
            asset_label: assetKindLabel(assetKind),
            avg_fill_days: avgFillDays,
            fill_score: fillScore,
          }
        } catch {
          return null
        }
      },
    )

    const validTrackingItems = trackingResults.filter((t): t is ExDividendTrackingItem => t != null)

    const payload = {
      success: true,
      today,
      window_end: windowEnd,
      cache_as_of: cacheAsOf,
      is_trading_day: isTradingDay,
      degraded,
      degraded_reason: degradedReason,
      notice: 'TWT48U 為除權除息「預告」性質，可能異動；本頁以頁面載入時快取為準，請以 TWSE 公告為準。',
      source: 'TWSE TWT48U 除權除息預告（上市＋ETF；上櫃標的不含）＋本地快取',
      coverage: [...coverage, ...histCoverage],
      truncated,
      total: symbols.length,
      tracking_items: validTrackingItems,
      items,
      cached_at: new Date().toISOString(),
    }

    inMemoryCache = { payload, cachedAt: Date.now(), date: today }

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'ex-dividend read failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // 供排程主動預熱與刷新快取（Issue #123）
  return GET(req)
}

