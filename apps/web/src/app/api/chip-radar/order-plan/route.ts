import { NextResponse, type NextRequest } from 'next/server'
import { yahooFinanceProvider, type OHLCV } from '@stock/market-data'
import { computeChipOrderPlan } from '@/lib/chip-order-plan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HISTORY_CACHE_TTL_MS = 10 * 60 * 1000
const historyCache = new Map<string, { expiresAt: number; bars: OHLCV[] }>()

async function loadTwHistory(symbol: string): Promise<OHLCV[]> {
  const cached = historyCache.get(symbol)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.bars
  }

  const end = new Date().toISOString().slice(0, 10)
  const startDate = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10)

  const candidates = symbol.includes('.') ? [symbol] : [`${symbol}.TW`, `${symbol}.TWO`]
  for (const ticker of candidates) {
    try {
      const bars = await yahooFinanceProvider.getHistory(ticker, 'TW', startDate, end)
      const valid = bars.filter((b) => Number.isFinite(b.close) && b.close > 0)
      if (valid.length > 0) {
        historyCache.set(symbol, { expiresAt: Date.now() + HISTORY_CACHE_TTL_MS, bars: valid })
        return valid
      }
    } catch {
      // 嘗試下一個市場後綴（.TW -> .TWO）
    }
  }
  return []
}

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams
    const rawSymbol = (sp.get('symbol') ?? '').trim().toUpperCase()
    if (!rawSymbol || !/^[A-Z0-9.]{2,12}$/.test(rawSymbol)) {
      return NextResponse.json(
        { success: false, error: '請提供有效的台股代號（symbol）' },
        { status: 400 },
      )
    }

    const feeDiscountRaw = Number(sp.get('feeDiscount') ?? '1')
    const feeDiscount =
      Number.isFinite(feeDiscountRaw) && feeDiscountRaw > 0 && feeDiscountRaw <= 1 ? feeDiscountRaw : 1
    const dayTrade = sp.get('dayTrade') === 'true'
    const capitalRaw = Number(sp.get('capital') ?? '1000000')
    const capital = Number.isFinite(capitalRaw) && capitalRaw > 0 ? capitalRaw : 1_000_000

    const bars = await loadTwHistory(rawSymbol)
    if (bars.length === 0) {
      return NextResponse.json(
        { success: false, error: `找不到 ${rawSymbol} 的歷史價格資料` },
        { status: 404 },
      )
    }

    const plan = computeChipOrderPlan(rawSymbol, bars, { feeDiscount, dayTrade, capital })
    return NextResponse.json({
      success: true,
      ...plan,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'order-plan calculation failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
