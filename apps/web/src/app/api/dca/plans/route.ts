import { NextResponse } from 'next/server'
import { getDcaPlans, logDcaEvent, saveDcaPlan } from '@stock/database'
import { getCurrentUserFromCookies } from '../../../../lib/auth'
import { applyGuestCookie, getCurrentGuestFromCookies, newGuestUid } from '../../../../lib/guest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/dca/plans — 取我的存股計畫（登入 user_id／訪客 guest_uid 隔離）。
 * POST /api/dca/plans — 儲存計畫（寫獨立 dca_plans 表，不碰 portfolio_records 真實持倉）。
 */
export async function GET() {
  try {
    const user = await getCurrentUserFromCookies().catch(() => null)
    if (user) {
      const plans = await getDcaPlans({ userId: user.id, limit: 50 })
      return NextResponse.json({ success: true, plans, mode: 'user' })
    }
    let gid = await getCurrentGuestFromCookies().catch(() => null)
    if (!gid) gid = newGuestUid()
    const plans = await getDcaPlans({ guestUid: gid, limit: 50 })
    const res = NextResponse.json({ success: true, plans, mode: 'guest' })
    await applyGuestCookie(res, gid)
    return res
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '讀取計畫失敗' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const symbol = typeof body?.symbol === 'string' ? body.symbol.trim().toUpperCase() : ''
    const monthlyAmount = Number(body?.monthlyAmount)
    const years = Math.floor(Number(body?.years))
    const dividendMode = body?.dividendMode === 'cash' ? 'cash' : 'reinvest'
    const includeFees = body?.includeFees !== false
    const symbolName = typeof body?.symbolName === 'string' ? body.symbolName.slice(0, 100) : null
    if (!/^\d{4,6}[A-Z0-9]{0,2}$/.test(symbol)) {
      return NextResponse.json({ error: 'invalid symbol' }, { status: 400 })
    }
    if (!Number.isFinite(monthlyAmount) || monthlyAmount < 1000 || monthlyAmount > 1000000) {
      return NextResponse.json({ error: 'monthlyAmount must be 1000~1000000' }, { status: 400 })
    }
    if (![1, 3, 5, 10].includes(years)) {
      return NextResponse.json({ error: 'years must be one of 1,3,5,10' }, { status: 400 })
    }

    const user = await getCurrentUserFromCookies().catch(() => null)
    let gid = await getCurrentGuestFromCookies().catch(() => null)
    if (!user && !gid) gid = newGuestUid()
    const id = await saveDcaPlan({
      userId: user ? user.id : 0,
      guestUid: user ? null : gid,
      symbol,
      symbolName,
      monthlyAmount,
      years,
      dividendMode,
      includeFees,
    })
    void logDcaEvent('dca_plan_save', { symbol, userId: user ? user.id : null }).catch(() => {})
    const res = NextResponse.json({ success: true, id })
    if (!user && gid) await applyGuestCookie(res, gid)
    return res
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '儲存計畫失敗' }, { status: 500 })
  }
}
