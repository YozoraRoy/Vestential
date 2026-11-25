import { NextRequest, NextResponse } from 'next/server'
import { getAnalysisRecords } from '@stock/database'
import { getCurrentUserFromReq, isAdminUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const limitParam = searchParams.get('limit')
    const symbolParam = searchParams.get('symbol') || searchParams.get('q') || undefined
    const limit = limitParam ? parseInt(limitParam, 10) : 20

    const [records, currentUser] = await Promise.all([
      getAnalysisRecords(limit, symbolParam),
      getCurrentUserFromReq(req).catch(() => null),
    ])
    const isAdmin = currentUser ? await isAdminUser(currentUser).catch(() => false) : false

    const enriched = (records || []).map((r) => {
      const isMine = !!(currentUser && r.user_id != null && r.user_id === currentUser.id)
      return {
        ...r,
        is_mine: isMine,
        can_delete: isAdmin || isMine,
      }
    })
    return NextResponse.json({ success: true, records: enriched })
  } catch (error: any) {
    console.error('[API/Analysis-Records] Failed to fetch analysis records:', error)
    return NextResponse.json({ success: true, records: [] })
  }
}
