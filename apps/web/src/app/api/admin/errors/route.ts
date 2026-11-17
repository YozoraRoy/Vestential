import { NextResponse, type NextRequest } from 'next/server'
import { listApiErrorLogs, migrate, type ApiErrorActorType, type ApiErrorCategory } from '@stock/database'
import { getCurrentUserFromReq, isAdminUser } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await migrate()
  const user = await getCurrentUserFromReq(req)
  if (!user || !(await isAdminUser(user))) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const rawCat = sp.get('category') || 'all'
  const rawActor = sp.get('actor') || 'all'
  const limit = Number(sp.get('limit') || '100')

  const validCats = new Set(['all', 'ai_quota', 'ai_error', 'slow_api', 'api_error', 'rate_limit'])
  const validActors = new Set(['all', 'guest', 'user'])

  const data = await listApiErrorLogs({
    category: (validCats.has(rawCat) ? rawCat : 'all') as ApiErrorCategory | 'all',
    actorType: (validActors.has(rawActor) ? rawActor : 'all') as ApiErrorActorType | 'all',
    limit: Number.isFinite(limit) ? limit : 100,
  })

  return NextResponse.json({ success: true, ...data })
}
