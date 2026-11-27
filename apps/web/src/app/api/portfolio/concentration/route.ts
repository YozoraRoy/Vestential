import { NextResponse } from 'next/server'
import { dbQueryAll, getPortfolioRecords } from '@stock/database'
import { getCurrentUserFromCookies } from '../../../../lib/auth'
import {
  computeConcentration,
  type ConcentrationPosition,
} from '../../../../lib/portfolio-concentration'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/portfolio/concentration — 登入使用者持股集中度與產業曝險報告（唯讀，不寫 DB）。
 */
export async function GET() {
  try {
    const user = await getCurrentUserFromCookies()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const records = await getPortfolioRecords(user.id, 200)
    const latest = new Map<string, (typeof records)[number]>()
    for (const r of records) {
      const market = r.market === 'us' ? 'us' : 'tw'
      const symbol = String(r.symbol ?? '').trim().toUpperCase()
      if (!symbol) continue
      const key = `${market}:${symbol}`
      if (!latest.has(key)) latest.set(key, r)
    }

    const positions: ConcentrationPosition[] = [...latest.values()].map((r) => ({
      market: r.market === 'us' ? 'us' : 'tw',
      symbol: String(r.symbol ?? '').trim().toUpperCase(),
      marketValue: Number(r.market_value),
    }))

    if (positions.length === 0) {
      return NextResponse.json(computeConcentration([]))
    }

    const industryRows = await dbQueryAll<{
      stock_id: string
      industry_name: string | null
    }>('SELECT stock_id, industry_name FROM stock_industry')

    const industryBySymbol: Record<string, string | null> = {}
    for (const row of industryRows) {
      const id = String(row.stock_id ?? '').trim().toUpperCase()
      if (id) {
        industryBySymbol[`tw:${id}`] = row.industry_name
      }
    }

    const report = computeConcentration(positions, industryBySymbol)
    return NextResponse.json(report)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : '集中度計算失敗'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
