import { NextResponse } from 'next/server'
import { getGiftCalendarData, type GiftEligibility } from '@/lib/gift-map'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COMPLIANCE_DISCLAIMER =
  '【合規警語與免責聲明】本攻略所載股東會紀念品品名、最後買進日與發放領取資格，' +
  '係彙整自公開資訊觀測站（MOPS）與各公司歷史股東會公告。各公司紀念品發放條件、零股是否發放、' +
  '是否須以電子投票行使表決權及實際領取地點，概以各公司正式寄發之「股東會開會通知書」及最新公告為準。' +
  '證券投資具市場風險，投資人買賣證券應審慎評估並自負盈虧。'

/**
 * Issue #118 股東會紀念品最後買進倒數 API
 *
 * GET /api/gifts/calendar
 * Query Params:
 * - view: 'active' | 'review' (預設 'active')
 * - q: 股票代號或名稱
 * - eligibility: 'ONE_SHARE' | 'VOTE_REQUIRED' | 'MEETING_ONLY' | 'NO_GIFT' | 'UNKNOWN' | 'ALL'
 * - limit: 筆數上限 (預設 100)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const view = (url.searchParams.get('view') as 'active' | 'review') || 'active'
    const q = url.searchParams.get('q') || undefined
    const eligibility = (url.searchParams.get('eligibility') as GiftEligibility | 'ALL') || undefined
    const limit = Number(url.searchParams.get('limit') || '100')

    const data = await getGiftCalendarData({ view, q, eligibility, limit })

    return NextResponse.json({
      success: true,
      ...data,
      disclaimer: COMPLIANCE_DISCLAIMER,
      timestamp: new Date().toISOString(),
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'failed to fetch gift calendar'
    console.error('[GiftCalendar] API error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
