import { NextResponse } from 'next/server'
import { normalizeStockCode } from '@stock/core'
import { registry } from '@stock/market-data'
import { withApiAudit } from '@/lib/api-audit'
import { resolveServerStockNames } from '@/lib/stock-names-server'

export async function GET(req: Request) {
  return withApiAudit(req, '/api/search', () => handleGet(req))
}

async function handleGet(req: Request) {
  const { searchParams } = new URL(req.url)
  const query = searchParams.get('q')
  if (!query) return NextResponse.json({ results: [] })

  try {
    const provider = registry.get('yahoo-finance')
    const rawResults = await provider.searchSymbols(query)
    const yahooNames = new Map<string, string>()
    for (const r of rawResults) {
      const code = normalizeStockCode(r.symbol)
      if (code && r.name) yahooNames.set(code, r.name)
    }
    const namesMap = await resolveServerStockNames(
      rawResults.map((r) => r.symbol),
      { yahooNames, syncIfNeeded: false, source: 'api_search' },
    ).catch(() => ({} as Record<string, unknown>))
    const results = rawResults.map((r) => ({
      ...r,
      names: namesMap[normalizeStockCode(r.symbol)] ?? undefined,
    }))
    return NextResponse.json({ results })
  } catch {
    return NextResponse.json({ results: [] })
  }
}
