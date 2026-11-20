import { NextResponse } from 'next/server'
import { yahooFinanceProvider } from '@stock/market-data'
import { withApiAudit } from '@/lib/api-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FX_TTL_MS = 30 * 60 * 1000
let fxCache: { rate: number; asOf: string; expiresAt: number } | null = null

/**
 * GET /api/portfolio/fx — 取得即時 USD/TWD 匯率（Yahoo `TWD=X`，30 分鐘快取）。
 * 失敗時誠實回傳 `rate: null`（絕不回傳寫死假匯率）。
 */
export async function GET(req: Request) {
  return withApiAudit(req, '/api/portfolio/fx', async () => {
    const now = Date.now()
    if (fxCache && fxCache.expiresAt > now) {
      return NextResponse.json({
        success: true,
        pair: 'USD/TWD',
        rate: fxCache.rate,
        asOf: fxCache.asOf,
        cached: true,
      })
    }

    try {
      const q = await yahooFinanceProvider.getQuote('TWD=X', 'US')
      const rate = typeof q?.price === 'number' && Number.isFinite(q.price) && q.price > 10 && q.price < 100
        ? Math.round(q.price * 1000) / 1000
        : null

      if (rate != null) {
        const asOf = new Date().toISOString()
        fxCache = { rate, asOf, expiresAt: now + FX_TTL_MS }
        return NextResponse.json({
          success: true,
          pair: 'USD/TWD',
          rate,
          asOf,
          cached: false,
        })
      }
    } catch {
      // 失敗由下方誠實降級回 null
    }

    return NextResponse.json({
      success: true,
      pair: 'USD/TWD',
      rate: null,
      asOf: new Date().toISOString(),
      cached: false,
    })
  })
}
