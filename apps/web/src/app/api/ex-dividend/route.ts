import { NextResponse } from 'next/server'
import { registry } from '@stock/market-data'
import { getTwseDividendsByYear, migrate } from '@stock/database'
import { isTwseTradingDay, taipeiTodayStr } from '../../../lib/twse-calendar'
import { getDividendsCacheInfo } from '../../../lib/twse-dividends'
import {
  analyzeExDividendEvents,
  assetKindLabel,
  classifyAssetKind,
  computeExLastBuyDate,
  daysUntilEx,
  type ExDividendStats,
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

const WINDOW_DAYS = 30
const HISTORY_YEARS = 5
const MAX_SYMBOLS = 60
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

export async function GET() {
  try {
    await migrate()
    const today = taipeiTodayStr()
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

    const symbols = [...upcomingBySymbol.keys()].sort()
    const truncated = symbols.length > MAX_SYMBOLS
    const picked = symbols.slice(0, MAX_SYMBOLS)

    // TWT48U 降級判定：交易日但快取非今日＝預告可能異動／同步缺檔。
    const degraded = isTradingDay && cacheAsOf !== today
    const degradedReason = !isTradingDay
      ? null
      : cacheAsOf !== today
        ? 'stale-cache'
        : null
    if (degraded) {
      void alertExDividendFetchFailed(`快取停留於 ${cacheAsOf ?? '無紀錄'}（今日 ${today} 為交易日）`)
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
      const assetKind = classifyAssetKind(quoteType)
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
        name: q?.name ?? null,
        ex_date: upcoming.ex_date,
        ex_last_buy_date: computeExLastBuyDate(upcoming.ex_date, isTwseTradingDay),
        days_to_ex: daysUntilEx(today, upcoming.ex_date),
        cash_dividend: upcoming.cash_dividend,
        yield_pct:
          latestClose != null && latestClose > 0
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
      .map((i) => ({ symbol: i.symbol, ex_date: i.ex_date, ex_last_buy_date: i.ex_last_buy_date }))
    if (countdown.length > 0) void alertExLastBuyCountdown(countdown)
    const tenDaysAgo = addDaysStr(today, -10)
    const completed: { symbol: string; ex_date: string; daysToFill: number }[] = []
    for (const i of items) {
      for (const e of i.stats?.events ?? []) {
        if (e.exDate >= tenDaysAgo && e.exDate < today && e.filled && e.daysToFill != null) {
          completed.push({ symbol: i.symbol, ex_date: e.exDate, daysToFill: e.daysToFill })
        }
      }
    }
    if (completed.length > 0) void alertFillCompleted(completed)

    return NextResponse.json({
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
      items,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'ex-dividend read failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
