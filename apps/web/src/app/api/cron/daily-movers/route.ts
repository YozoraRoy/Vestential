import { NextResponse } from 'next/server'
import { migrate } from '@stock/database'
import { authorizeSync } from '@/lib/sync-auth'
import { refreshAndSaveDailyMovers, rowToPayload } from '@/lib/daily-movers'
import { sendDailyMoversDigest } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request) {
  if (!authorizeSync(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: { dryRun?: boolean; forceEmail?: boolean } = {}
  try {
    body = await req.json().catch(() => ({}))
  } catch {}

  try {
    await migrate()
    const row = await refreshAndSaveDailyMovers()
    const payload = rowToPayload(row)
    const newPunish = payload.punish.filter((p) => p.isNew)

    let emailSent = false
    if (!body.dryRun && (newPunish.length > 0 || body.forceEmail === true)) {
      emailSent = await sendDailyMoversDigest(
        {
          tradeDate: payload.tradeDate,
          summaryText: payload.summaryText,
          limitUpCount: payload.breadth.limitUp,
          limitDownCount: payload.breadth.limitDown,
          newPunish: newPunish.map((p) => ({ code: p.code, name: p.name, reason: p.reason })),
          topLimitUp: payload.limitUp,
          topVolume: payload.volumeSurge,
        },
        body.forceEmail === true,
      )
    }

    return NextResponse.json({
      success: true,
      tradeDate: payload.tradeDate,
      newPunishCount: newPunish.length,
      emailSent,
      breadth: payload.breadth,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'daily-movers cron failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
