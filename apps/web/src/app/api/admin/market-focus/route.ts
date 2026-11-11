import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentUserFromReq, isAdminUser } from '@/lib/auth'
import { startMarketFocusJob } from '@/lib/market-focus-job'
import { migrate } from '@stock/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * 後台觸發市場焦點：乾跑/發布皆是背景 Job，立即回傳 jobId。
 * 前台 UI 輪詢 GET /api/market-focus/refresh/status?jobId=... 取得結果，
 * 避免同步跑完整管線超過 Azure 240s 網關逾時。
 */
export async function POST(req: NextRequest) {
  await migrate()
  const user = await getCurrentUserFromReq(req)
  if (!user || !(await isAdminUser(user))) {
    return NextResponse.json({ error: '未登入或無管理員權限' }, { status: 401 })
  }
  let body: { mode?: string; alsoSocial?: boolean } = {}
  try {
    body = await req.json()
  } catch {}
  const mode = body.mode === 'publish' ? 'publish' : 'dry'
  try {
    const job = await startMarketFocusJob({ kind: mode, alsoSocial: !!body.alsoSocial })
    return NextResponse.json({
      success: true,
      accepted: true,
      mode,
      jobId: job.jobId,
      status: job.status,
      since: job.startedAt,
      deduplicated: job.deduplicated,
      note: 'background job started; poll GET /api/market-focus/refresh/status?jobId=... for result',
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? 'market-focus 啟動失敗' }, { status: 500 })
  }
}