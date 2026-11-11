import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCycleEntryJob } from '@/lib/cycle-entry-job'
import { authorizeSync } from '@/lib/sync-auth'
import { getCurrentUserFromReq, isAdminUser } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

/** 查詢週期進場背景 Job 的執行結果（GitHub 排程用 SYNC_TOKEN，後台用管理員登入）。 */
export async function GET(req: NextRequest) {
  const syncOk = authorizeSync(req)
  let adminOk = false
  if (!syncOk) {
    try {
      const user = await getCurrentUserFromReq(req)
      adminOk = !!(user && (await isAdminUser(user)))
    } catch {}
  }
  if (!syncOk && !adminOk) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('jobId') ?? ''
  if (!jobId) {
    return NextResponse.json({ success: false, error: '缺少 jobId' }, { status: 400 })
  }

  // Issue #146：job 狀態改存 DB（sync_jobs），跨 container 重啟仍查得到；
  // 執行實例被回收時會回終態 failed（附原因），不再出現「404 盲輪詢到 timeout」。
  const job = await getCycleEntryJob(jobId)
  if (!job) {
    return NextResponse.json(
      { success: false, code: 'JOB_NOT_FOUND', error: `job ${jobId} 不存在` },
      { status: 404 },
    )
  }
  return NextResponse.json({ success: true, job })
}
