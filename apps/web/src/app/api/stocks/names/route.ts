import { NextResponse } from 'next/server'
import { normalizeStockCode } from '@stock/core'
import { resolveServerStockNames } from '@/lib/stock-names-server'

export const runtime = 'nodejs'

/**
 * 批次查詢多語系股票名稱（Issue #190 / #192）。
 * GET /api/stocks/names?symbols=2330,0050,AAPL
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const raw = searchParams.get('symbols') ?? ''
  const symbols = raw
    .split(',')
    .map((s) => normalizeStockCode(s))
    .filter(Boolean)
    .slice(0, 100)

  if (!symbols.length) {
    return NextResponse.json({ names: {} })
  }

  const names = await resolveServerStockNames(symbols, {
    syncIfNeeded: false,
    source: 'api_stocks_names',
  }).catch(() => ({}))

  return NextResponse.json({ names })
}
