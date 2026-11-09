import { NextResponse } from 'next/server'
import { migrate } from '@stock/database'
import { authorizeSync } from '@/lib/sync-auth'
import { triggerSocialPublish } from '@/lib/social-trigger'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * 社群小編主發布端點（手動/補發）。
 * - 同 edition 逐平台去重，只發布未發過的平台。
 * - ?dryRun=true 只生成文案＋圖卡＋寫紀錄，不動 Meta API。
 * - ?platforms=instagram,threads 指定平台（預設兩者）。
 */
export async function POST(req: Request) {
  if (!authorizeSync(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const dryRun = searchParams.get('dryRun') === 'true'
  const force = searchParams.get('force') === 'true'
  const platforms = (searchParams.get('platforms') ?? 'instagram,threads')
    .split(',')
    .map((p) => p.trim() as 'instagram' | 'threads' | 'facebook')
    .filter((p) => p === 'instagram' || p === 'threads' || p === 'facebook')

  try {
    await migrate()
    const outcome = await triggerSocialPublish({ dryRun, force, platforms })
    return NextResponse.json({ success: true, ...outcome })
  } catch (error: any) {
    console.error('[API/social/publish] Failed:', error)
    return NextResponse.json({ success: false, error: error.message || 'Failed to publish' }, { status: 500 })
  }
}