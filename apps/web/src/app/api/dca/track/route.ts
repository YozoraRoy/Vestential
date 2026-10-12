import { NextResponse } from 'next/server'
import { getDcaEventStats, logDcaEvent } from '@stock/database'
import { getCurrentUserFromCookies } from '../../../../lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EVENTS = ['dca_page_view', 'dca_simulate', 'dca_plan_save', 'dca_share', 'dca_og_view'] as const
type DcaTrackEvent = (typeof EVENTS)[number]

/**
 * POST /api/dca/track { event, symbol? } — DCA 埋點（page_view／simulate／plan_save／share／og_view）。
 * 口徑（AC10）：新客佔比以 page_view 計、圖卡分享數以 dca_share＋dca_og_view 計；
 * 若埋點另案則以 og 取圖次數（dca_og_view）為驗收證據。
 * GET /api/dca/track — 事件計數（營運觀察用，不需授權）。
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const event = body?.event as DcaTrackEvent
    if (!(EVENTS as readonly string[]).includes(event)) {
      return NextResponse.json({ error: 'invalid event' }, { status: 400 })
    }
    const symbol = typeof body?.symbol === 'string' ? body.symbol.trim().toUpperCase().slice(0, 20) : null
    const user = await getCurrentUserFromCookies().catch(() => null)
    await logDcaEvent(event, { symbol, userId: user ? user.id : null })
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'track failed' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const stats = await getDcaEventStats()
    return NextResponse.json({ success: true, stats })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'stats failed' }, { status: 500 })
  }
}
