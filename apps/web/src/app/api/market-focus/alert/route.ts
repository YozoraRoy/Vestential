import { NextResponse } from 'next/server'
import { sendMarketFocusAlert } from '@/lib/email'
import { authorizeSync } from '@/lib/sync-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 排程器（Azure Logic App）失敗告警入口。
 * 只给 SYNC_TOKEN 持有者使用；沿用既有 Gmail 告警信管線，不新增寄信憑證。
 *
 * POST body (JSON): { subject: string, message?: string }
 */
export async function POST(req: Request) {
  if (!authorizeSync(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({} as { subject?: unknown; message?: unknown }))
  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 200) : ''
  const message = typeof body.message === 'string' ? body.message.slice(0, 4000) : ''

  if (!subject) {
    return NextResponse.json({ success: false, error: 'subject required' }, { status: 400 })
  }

  try {
    const ok = await sendMarketFocusAlert(subject, message || '(no detail)')
    return NextResponse.json({ success: ok }, { status: ok ? 200 : 502 })
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? 'alert send failed' },
      { status: 500 },
    )
  }
}
