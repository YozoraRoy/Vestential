import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { migrate } from '@stock/database'
import { getCurrentUserFromReq, isAdminUser } from '@/lib/auth'
import { triggerSocialPublish } from '@/lib/social-trigger'
import { triggerFestivalPublish } from '@/lib/social-festival-trigger'
import type { SocialPostPlatform } from '@stock/database'
import type { SocialCaptions } from '@/lib/social'
import { ACTIVE_SOCIAL_PLATFORMS, isActiveSocialPlatform } from '@/lib/social-platforms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  await migrate()
  const user = await getCurrentUserFromReq(req)
  if (!user || !(await isAdminUser(user))) {
    return NextResponse.json({ error: '未登入或無管理員權限' }, { status: 401 })
  }
  let body: {
    dryRun?: boolean
    force?: boolean
    festival?: boolean
    dateOverride?: string
    platforms?: string[]
    imageUrl?: string | null
    imageUrls?: Partial<Record<SocialPostPlatform, string | null>>
    captions?: SocialCaptions
  } = {}
  try {
    body = await req.json()
  } catch {}
  // 節慶乾跑：只生成三平台文案＋賀圖預覽，不寫 social_posts、不打外部 API。
  if (body.festival) {
    try {
      const outcome = await triggerFestivalPublish({
        dryRun: true,
        dateOverride: typeof body.dateOverride === 'string' ? body.dateOverride : undefined,
      })
      return NextResponse.json({ success: true, ...outcome })
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e?.message ?? 'festival dry-run 失敗' }, { status: 500 })
    }
  }
  const platforms = (body.platforms ?? [...ACTIVE_SOCIAL_PLATFORMS]).filter(isActiveSocialPlatform)
  try {
    const outcome = await triggerSocialPublish({
      dryRun: !!body.dryRun,
      force: !!body.force,
      platforms,
      imageUrl: body.imageUrl ?? null,
      imageUrls: body.imageUrls,
      captions: body.captions ?? undefined,
    })
    return NextResponse.json({ success: true, ...outcome })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message ?? 'social publish 失敗' }, { status: 500 })
  }
}
