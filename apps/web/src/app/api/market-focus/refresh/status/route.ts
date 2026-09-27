import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getMarketFocusJob } from '@/lib/market-focus-job'
import { authorizeSync } from '@/lib/sync-auth'
import { getCurrentUserFromReq, isAdminUser } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

/** 查詢市場焦點背景 Job 的執行結果（GitHub 排程用 SYNC_TOKEN，後台用管理員登入）。 */
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
  const job = getMarketFocusJob(jobId)

  // Job 紀錄只存在於記憶體（單一 web instance）。若實例被回收/重啟（Azure 部署 slot swap、資源回收），
  // job 會直接遺失 → 過去會回 404，讓 GitHub Actions 盲輪詢耗滿 27 分鐘才 failed。
  // 改為回傳終態 failed + 可讀原因，讓 workflow 快速失敗並可直接重新觸發。
  if (!job) {
    return NextResponse.json({
      success: true,
      job: {
        id: jobId,
        kind: 'refresh' as const,
        status: 'failed' as const,
        alsoSocial: true,
        skipSocial: false,
        startedAt: null,
        finishedAt: new Date().toISOString(),
        error: 'job 紀錄已流失（Azure 實例重啟/資源回收），未完成；請重新觸發一次。',
        count: null,
        editionKey: null,
        timestamp: null,
        summary: null,
        items: null,
        socialResults: null,
        stage: null,
      },
    })
  }
  return NextResponse.json({ success: true, job })
}