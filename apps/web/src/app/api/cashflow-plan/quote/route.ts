import { NextResponse, type NextRequest } from 'next/server'
import { yahooFinanceProvider } from '@stock/market-data'
import { getStockNameById, getTwseDividendsByYear, migrate, taipeiTodayStr } from '@stock/database'
import { buildAssetProfile } from '@/lib/cashflow-plan'
import { syncFinMindDividendsForSymbols } from '@/lib/finmind-dividends'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const raw = (new URL(req.url).searchParams.get('symbol') ?? '').trim().toUpperCase()
    const clean = raw.replace(/\.(TW|TWO)$/i, '')
    if (!clean || !/^[A-Z0-9]{2,10}$/.test(clean)) {
      return NextResponse.json({ success: false, error: '請輸入有效台股代號' }, { status: 400 })
    }

    await migrate()
    const today = taipeiTodayStr()
    const currentYear = Number(today.slice(0, 4))

    // 取報價（先 .TW，失敗試 .TWO）
    let price = 0
    for (const ticker of [`${clean}.TW`, `${clean}.TWO`]) {
      try {
        const q = await yahooFinanceProvider.getQuote(ticker, 'TW')
        if (q.price > 0) {
          price = q.price
          break
        }
      } catch {}
    }

    if (price <= 0) {
      return NextResponse.json({ success: false, error: `查無 ${clean} 之最新報價` }, { status: 404 })
    }

    const loadRows = async () => {
      const rows: Array<{ symbol: string; ex_date: string; cash_dividend: number; pay_date?: string | null }> = []
      for (const y of [String(currentYear - 1), String(currentYear)]) {
        const list = await getTwseDividendsByYear(y).catch(() => [])
        for (const r of list) {
          if (r.symbol.toUpperCase() === clean) rows.push(r)
        }
      }
      return rows
    }

    let rows = await loadRows()
    const written = await syncFinMindDividendsForSymbols([clean], rows, today).catch(() => 0)
    if (written > 0) rows = await loadRows()

    const name = (await getStockNameById(clean).catch(() => null)) || clean
    const profile = buildAssetProfile({
      symbol: clean,
      name,
      price,
      rawDividends: rows,
      today,
    })

    return NextResponse.json({ success: true, profile })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'cashflow quote failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
