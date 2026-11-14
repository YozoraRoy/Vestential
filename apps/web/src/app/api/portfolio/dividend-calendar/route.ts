import { NextResponse } from 'next/server'
import {
  getPortfolioRecords,
  getPortfolioRecordsByGuest,
  getTwseDividendsByYear,
  migrate,
} from '@stock/database'
import { getCurrentUserFromCookies } from '../../../../lib/auth'
import { getCurrentGuestFromCookies } from '../../../../lib/guest'
import { taipeiTodayStr } from '../../../../lib/twse-calendar'
import { getDividendsCacheInfo } from '../../../../lib/twse-dividends'
import {
  buildDividendCalendar,
  type CalendarHoldingInput,
} from '../../../../lib/dividend-calendar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    await migrate()
    const url = new URL(req.url)
    const today = taipeiTodayStr()
    const yearParam = (url.searchParams.get('year') ?? '').trim()
    const year = /^\d{4}$/.test(yearParam) ? Number(yearParam) : Number(today.slice(0, 4))

    const user = await getCurrentUserFromCookies()
    let records: Array<{
      symbol: string
      name?: string | null
      shares?: number | null
      market?: string | null
      cost_basis?: number | null
      market_value?: number | null
    }> = []

    if (user) {
      records = await getPortfolioRecords(user.id, 200)
    } else {
      const gid = await getCurrentGuestFromCookies()
      if (gid) {
        records = await getPortfolioRecordsByGuest(gid, 200)
      }
    }

    const holdings: CalendarHoldingInput[] = records.map((r) => ({
      symbol: r.symbol,
      name: r.name ?? null,
      shares: Number(r.shares) || 0,
      market: r.market ?? 'tw',
      costBasis: r.cost_basis != null ? Number(r.cost_basis) : null,
      marketValue: r.market_value != null ? Number(r.market_value) : null,
    }))

    const dividends = await getTwseDividendsByYear(String(year)).catch(() => [])
    const { cacheAsOf, isTradingDay } = await getDividendsCacheInfo(today)

    const calendar = buildDividendCalendar(holdings, dividends, { today, year })

    return NextResponse.json({
      success: true,
      ...calendar,
      cacheAsOf,
      isTradingDay,
      source: 'TWSE twse_dividends',
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'dividend calendar failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
