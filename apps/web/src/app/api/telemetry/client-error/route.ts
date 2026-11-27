import { NextResponse, type NextRequest } from 'next/server'
import { countRecentClientErrors, logApiError, migrate, type ApiErrorCategory } from '@stock/database'
import { extractActor, isAiQuotaText } from '@/lib/api-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CLIENT_ERROR_WINDOW_MS = 60_000
const MAX_REPORTS_PER_WINDOW = 10

export async function POST(req: NextRequest) {
  await migrate()
  const actor = await extractActor(req)
  const recentCount = await countRecentClientErrors(actor.clientIp, CLIENT_ERROR_WINDOW_MS)
  if (recentCount >= MAX_REPORTS_PER_WINDOW) {
    return NextResponse.json({ success: false, error: 'Too many reports' }, { status: 429 })
  }

  let body: { route?: string; statusCode?: number; durationMs?: number; errorMessage?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const msg = String(body.errorMessage || 'Client fetch error').slice(0, 500)
  const status = Number(body.statusCode || 504)
  const durationMs = Math.max(0, Math.round(Number(body.durationMs || 0)))
  const category: ApiErrorCategory = isAiQuotaText(msg)
    ? 'ai_quota'
    : status === 429
      ? 'rate_limit'
      : status === 504 || durationMs >= 15_000
        ? 'slow_api'
        : 'api_error'

  await logApiError({
    category,
    route: String(body.route || '/').slice(0, 120),
    method: 'CLIENT',
    statusCode: status,
    durationMs,
    actorType: actor.actorType,
    userId: actor.userId,
    userEmail: actor.userEmail,
    clientIp: actor.clientIp,
    userAgent: actor.userAgent,
    recovered: false,
    errorMessage: msg,
  })

  return NextResponse.json({ success: true })
}
