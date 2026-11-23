import { NextResponse } from 'next/server'
import { resolveStockDisplayName } from '@stock/core'
import { getTwseDividendsByYear, migrate, taipeiTodayStr } from '@stock/database'
import { resolveServerStockNames } from '@/lib/stock-names-server'
import { authorizeSync } from '@/lib/sync-auth'
import { computeExLastBuyDate } from '@/lib/ex-dividend-engine'
import { alertExLastBuyCountdown } from '@/lib/ex-dividend-alerts'
import { isTwseTradingDay } from '@/lib/twse-calendar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 除權息最後買進日早盤提醒（週一至週五早上 09:00 CST 由 VM systemd timer 觸發）。
 * 僅讀取 DB 既有除息快取（不抓 5 年歷史 K 線），找出今日為 ex_last_buy_date 的標的並寄發提醒信。
 */
export async function POST(req: Request) {
  if (!authorizeSync(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: { dryRun?: boolean } = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch {}

  try {
    await migrate()
    const today = taipeiTodayStr()
    if (!isTwseTradingDay(today)) {
      return NextResponse.json({ success: true, skipped: 'non-trading-day', today, count: 0 })
    }

    const todayYear = Number(today.slice(0, 4))
    const nextYear = today.slice(5, 7) === '12' ? [String(todayYear), String(todayYear + 1)] : [String(todayYear)]
    const upcomingBySymbol = new Map<string, string>()

    for (const y of nextYear) {
      const list = await getTwseDividendsByYear(y).catch(() => [])
      for (const r of list) {
        if (r.ex_date <= today) continue
        const prev = upcomingBySymbol.get(r.symbol)
        if (!prev || r.ex_date < prev) {
          upcomingBySymbol.set(r.symbol, r.ex_date)
        }
      }
    }

    const matchedSymbols: { symbol: string; ex_date: string; ex_last_buy_date: string }[] = []
    for (const [symbol, exDate] of upcomingBySymbol.entries()) {
      const lastBuy = computeExLastBuyDate(exDate, isTwseTradingDay)
      if (lastBuy === today) {
        matchedSymbols.push({ symbol, ex_date: exDate, ex_last_buy_date: lastBuy })
      }
    }

    const namesMap = await resolveServerStockNames(
      matchedSymbols.map((m) => m.symbol),
      { marketHint: 'TW', source: 'cron_ex_dividend_remind' },
    ).catch(() => ({} as Record<string, { nameZh?: string | null; nameEn?: string | null; nameJa?: string | null; market?: string | null }>))

    const matched: { symbol: string; name: string | null; ex_date: string; ex_last_buy_date: string }[] = matchedSymbols.map((m) => {
      const resolved = resolveStockDisplayName(m.symbol, namesMap[m.symbol.toUpperCase()], 'zh-TW')
      return {
        ...m,
        name: resolved && resolved !== m.symbol ? resolved : null,
      }
    })

    matched.sort((a, b) => a.symbol.localeCompare(b.symbol))

    if (!body.dryRun && matched.length > 0) {
      await alertExLastBuyCountdown(matched)
    }

    return NextResponse.json({
      success: true,
      today,
      dryRun: body.dryRun === true,
      count: matched.length,
      items: matched,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'ex-dividend-remind failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
