import { NextResponse, type NextRequest } from 'next/server'
import { migrate } from '@stock/database'
import { getDailyMoversSnapshot } from '@/lib/daily-movers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await migrate()
    const dateParam = new URL(req.url).searchParams.get('date') ?? undefined
    const { payload, availableDates } = await getDailyMoversSnapshot(dateParam)
    if (!payload) {
      return NextResponse.json(
        { success: false, error: '目前尚無收盤異動日報資料', availableDates },
        { status: 404 },
      )
    }
    return NextResponse.json({
      success: true,
      availableDates,
      ...payload,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'daily-movers read failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
