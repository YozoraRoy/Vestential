import { NextResponse } from 'next/server'
import { migrate } from '@stock/database'
import { startCycleEntryJob } from '@/lib/cycle-entry-job'
import { authorizeSync } from '@/lib/sync-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 觸發週期進場盤後掃描。整條管線（批次報價→歷史→規則初篩→擬合回測→LLM 評述/總覽→DB）
 * 以背景 Job 執行並立即回傳 jobId，呼叫端透過 GET .../refresh/status 輪詢，
 * 避免同步執行超過 Azure 240s 網關逾時 (504)。
 */
export async function POST(req: Request) {
  if (!authorizeSync(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    await migrate()
    const job = await startCycleEntryJob({ kind: 'refresh' })
    return NextResponse.json({
      success: true,
      accepted: true,
      jobId: job.jobId,
      status: job.status,
      since: job.startedAt,
      deduplicated: job.deduplicated,
      note: 'background job started; poll GET /api/cycle-entry/refresh/status?jobId=... for result',
    })
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? 'Failed to start cycle entry refresh' },
      { status: 500 },
    )
  }
}