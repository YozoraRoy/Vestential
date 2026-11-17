import { NextResponse, type NextRequest } from 'next/server'
import { logApiError, migrate, type ApiErrorCategory } from '@stock/database'
import { extractActor, isAiQuotaText } from '@/lib/api-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 單一遮罩 IP 每分鐘最多上報 10 筆，防止惡意灌爆資料庫
const rateBuckets = new Map<string, { count: number; resetAt: number }>()
const MAX_PER_MIN = 10

function allowReport(key: string): boolean {
  const now = Date.now()
  const cur = rateBuckets.get(key)
  if (!cur || now > cur.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 })
    if (rateBuckets.size > 500) rateBuckets.clear()
    return true
  }
  if (cur.count >= MAX_PER_MIN) return false
  cur.count += 1
  return true
}

export async function POST(req: NextRequest) {
  await migrate()
  const actor = await extractActor(req)
  if (!allowReport(actor.clientIp)) {
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
