import { NextResponse, type NextRequest } from 'next/server'
import {
  getLendingSignalsForSymbols,
  getSingleSymbolLending,
} from '../../../lib/securities-lending-fetcher'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SYMBOL_RE = /^\d{4,6}[A-Z]?$/
const DISCLAIMER = '借券賣出餘額統計僅為統計參考，非投資建議（資料來源：TWSE）。'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const symbolsParam = (searchParams.get('symbols') ?? '').trim()
    if (symbolsParam) {
      const list = [...new Set(symbolsParam.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 60)
      const batch = await getLendingSignalsForSymbols(list)
      return NextResponse.json(
        {
          success: true,
          asOf: batch.asOf,
          items: batch.results,
          disclaimer: DISCLAIMER,
        },
        { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' } },
      )
    }

    const rawSymbol = (searchParams.get('symbol') ?? '').trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
    if (!rawSymbol || !SYMBOL_RE.test(rawSymbol)) {
      return NextResponse.json(
        { error: '請提供有效的台股代號（例如 2330）' },
        { status: 400 },
      )
    }

    const payload = await getSingleSymbolLending(rawSymbol)
    if (!payload) {
      return NextResponse.json(
        { error: `查無代號 ${rawSymbol} 的借券賣出餘額資料` },
        { status: 404 },
      )
    }

    return NextResponse.json(
      {
        success: true,
        ...payload,
        disclaimer: DISCLAIMER,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' } },
    )
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'securities lending query failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
