import { NextResponse } from 'next/server'
import { getCurrentUserFromCookies } from '../../../lib/auth'
import { applyGuestCookie, getCurrentGuestFromCookies, newGuestUid } from '../../../lib/guest'
import { computePnL, validatePortfolioInput, type PortfolioInput } from '../../../lib/portfolio'
import { savePortfolioRecord } from '@stock/database'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = validatePortfolioInput(body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const { market, symbol, shares, cost, currentPrice, dividend, symbolName } = parsed.data
    // #44：股息欄已移除（parsed.data.dividend 恆為 0；DB 欄保留，寫入 0）。
    const pnl = computePnL(parsed.data as PortfolioInput)

    // user 有登入 → 存 user_id;否則以訪客 guest_uid 存（用戶資料與訪客資料完全隔離）。
    const user = await getCurrentUserFromCookies()
    let guestUid: string | null = null
    let createdGuest = false
    if (!user) {
      guestUid = await getCurrentGuestFromCookies()
      if (!guestUid) {
        guestUid = newGuestUid()
        createdGuest = true
      }
    }

    const id = await savePortfolioRecord({
      user_id: user?.id ?? 0,
      guestUid,
      market,
      symbol,
      symbolName,
      shares,
      cost,
      currentPrice,
      dividend,
      costBasis: pnl.costBasis,
      marketValue: pnl.marketValue,
      unrealizedPnl: pnl.unrealizedPnl,
      unrealizedPnlPct: pnl.unrealizedPnlPct,
      totalReturn: pnl.totalReturn,
      totalReturnPct: pnl.totalReturnPct,
      yieldOnCost: pnl.yieldOnCost,
    })

    const res = NextResponse.json({
      success: true,
      record: {
        id, market, symbol, symbolName, shares, cost, currentPrice, dividend,
        ...pnl,
      },
    })
    if (createdGuest && guestUid) await applyGuestCookie(res, guestUid)
    return res
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}