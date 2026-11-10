import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { migrate } from '@stock/database'
import type { SocialPostPlatform } from '@stock/database'
import { getCurrentUserFromReq, isAdminUser } from '@/lib/auth'
import { getFirstReplyState, recordFirstReplyVerdict, type FirstReplyVerdict } from '@/lib/social-first-reply'
import { ACTIVE_SOCIAL_PLATFORMS } from '@/lib/social-platforms'

// ─── Issue #31 驗證協議：首回覆狀態查詢＋驗證記錄（後台限定） ─────────
// 首發 2 小時後人工查 @meta.ai 有無回覆，再用 POST 留下執行記錄：
// verdict=keep_tag（有回，常駐，開關維持 on）｜downgraded（無回，後台開關切 editor 降級去 tag 版）。

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PLATFORMS: SocialPostPlatform[] = [...ACTIVE_SOCIAL_PLATFORMS]

export async function GET(req: NextRequest) {
  await migrate()
  const user = await getCurrentUserFromReq(req)
  if (!user || !(await isAdminUser(user))) {
    return NextResponse.json({ error: '未登入或無管理員權限' }, { status: 401 })
  }
  const url = new URL(req.url)
  const editionKey = (url.searchParams.get('editionKey') ?? '').trim()
  if (!editionKey) return NextResponse.json({ error: '缺少 editionKey' }, { status: 400 })
  const states = []
  for (const platform of PLATFORMS) {
    states.push(await getFirstReplyState(platform, editionKey))
  }
  return NextResponse.json({ success: true, editionKey, states })
}

export async function POST(req: NextRequest) {
  await migrate()
  const user = await getCurrentUserFromReq(req)
  if (!user || !(await isAdminUser(user))) {
    return NextResponse.json({ error: '未登入或無管理員權限' }, { status: 401 })
  }
  let body: { editionKey?: string; platform?: string; verdict?: string; note?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid json' }, { status: 400 })
  }
  const editionKey = (body.editionKey ?? '').trim()
  const platform = (body.platform ?? '').trim() as SocialPostPlatform
  const verdict = (body.verdict ?? '').trim() as FirstReplyVerdict
  if (!editionKey) return NextResponse.json({ success: false, error: '缺少 editionKey' }, { status: 400 })
  if (!PLATFORMS.includes(platform)) {
    return NextResponse.json({ success: false, error: 'platform 僅支援 threads' }, { status: 400 })
  }
  if (verdict !== 'keep_tag' && verdict !== 'downgraded') {
    return NextResponse.json({ success: false, error: 'verdict 僅支援 keep_tag｜downgraded' }, { status: 400 })
  }
  try {
    await recordFirstReplyVerdict(platform, editionKey, verdict, (body.note ?? '').trim() || undefined)
    const state = await getFirstReplyState(platform, editionKey)
    return NextResponse.json({ success: true, state })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? '記錄驗證結果失敗' }, { status: 500 })
  }
}
