import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getCurrentUserFromReq, isAdminUser } from '@/lib/auth'
import { migrate, listCycleEntryEditions, getCycleEntrySignalsByEdition } from '@stock/database'
import type { CycleEntrySignalRow, CycleEntryMetaRow } from '@stock/database'
import { startCycleEntryJob } from '@/lib/cycle-entry-job'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function isAdminUserOr401(req: NextRequest): Promise<boolean> {
  const user = await getCurrentUserFromReq(req)
  return !!(user && (await isAdminUser(user)))
}

/** GET：歷史版次清單；?edition=YYYY-MM-DD 時回傳該版次明細。 */
export async function GET(req: NextRequest) {
  await migrate()
  if (!(await isAdminUserOr401(req))) {
    return NextResponse.json({ error: '未登入或無管理員權限' }, { status: 401 })
  }
  try {
    const { searchParams } = new URL(req.url)
    const edition = searchParams.get('edition') ?? ''
    if (edition) {
      const signals = await getCycleEntrySignalsByEdition(edition)
      return NextResponse.json({ success: true, edition, signals: signals as CycleEntrySignalRow[] })
    }
    const editions = await listCycleEntryEditions(30)
    return NextResponse.json({ success: true, editions })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? '讀取失敗' }, { status: 500 })
  }
}

/**
 * POST：後台手動觸發掃描。
 * body: { action: 'dry' } → 乾跑預覽（不寫 DB）；
 *       { action: 'refresh' } → 正式寫入 DB。
 * 皆以背景 Job 執行並回傳 jobId。
 */
export async function POST(req: NextRequest) {
  await migrate()
  if (!(await isAdminUserOr401(req))) {
    return NextResponse.json({ error: '未登入或無管理員權限' }, { status: 401 })
  }
  let body: { action?: string } = {}
  try {
    body = await req.json()
  } catch {}
  const action = body.action
  if (action !== 'dry' && action !== 'refresh') {
    return NextResponse.json({ success: false, error: '未知 action（需為 dry 或 refresh）' }, { status: 400 })
  }
  try {
    const job = await startCycleEntryJob({ kind: action })
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
    return NextResponse.json({ success: false, error: e?.message ?? '啟動失敗' }, { status: 500 })
  }
}