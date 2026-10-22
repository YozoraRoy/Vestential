import { NextResponse } from 'next/server'
import { migrate } from '@stock/database'
import { startMarketFocusJob } from '@/lib/market-focus-job'
import { authorizeSync } from '@/lib/sync-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 觸發市場焦點 refresh。整個管線（抓新聞→AI→摘要→總覽→email→社群）
 * 改為背景執行並立即回傳 jobId，呼叫端透過 GET .../refresh/status 輪詢，
 * 徹底避免同步執行超過 Azure 240s 網關逾時 (504)。
 *
 * POST body (JSON):
 *   - skipSocial: true → 跳過社群發布（排程自動化用，縮短 pipeline）
 */
export async function POST(req: Request) {
  if (!authorizeSync(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  let skipSocial = false
  let kind: 'refresh' | 'dry' = 'refresh'
  try {
    const body = await req.json().catch(() => ({}))
    skipSocial = body.skipSocial === true
    // 只開放 refresh/dry；publish 僅限後台管理員。
    if (body.kind === 'dry') kind = 'dry'
  } catch {}
  try {
    await migrate()
    const job = startMarketFocusJob({ kind, skipSocial })
    return NextResponse.json({
      success: true,
      accepted: true,
      jobId: job.id,
      status: job.status,
      since: job.startedAt,
      note: 'background job started; poll GET /api/market-focus/refresh/status?jobId=... for result',
    })
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? 'Failed to start market focus refresh' },
      { status: 500 },
    )
  }
}