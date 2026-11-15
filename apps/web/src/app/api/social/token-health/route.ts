import { NextResponse } from 'next/server'
import { migrate } from '@stock/database'
import { authorizeSync } from '@/lib/sync-auth'
import { sendMarketFocusAlert } from '@/lib/email'
import { ACTIVE_SOCIAL_PLATFORMS, type ActiveSocialPlatform } from '@/lib/social-platforms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TokenCheck {
  platform: ActiveSocialPlatform
  ok: boolean
  configured: boolean
  user?: string | null
  error?: string
}

/**
 * 每日 cron / AI 中控台呼叫：驗證「目前啟用」平台的 token 有效性。
 *
 * 2026-11 起只留 Threads：Instagram／Facebook 已停止發布，token 也不再偵測
 * （平台清單見 lib/social-platforms.ts；恢復 IG／FB 時改該檔即可）。
 * Threads 為長效型 token，驗證有效後順帶呼叫 refresh_access_token 展延 60 天
 * （Ticket #18）；此呼叫失敗不影響健康判定。
 */
export async function GET(req: Request) {
  if (!authorizeSync(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    await migrate()
    const checks: TokenCheck[] = []

    for (const platform of ACTIVE_SOCIAL_PLATFORMS) {
      if (platform === 'threads') checks.push(await checkThreads())
    }

    const broken = checks.filter((c) => !c.ok && c.configured)
    if (broken.length > 0) {
      await sendMarketFocusAlert(
        '社群 Token 失效告警',
        broken.map((c) => `${c.platform}: ${c.error}`).join('\n'),
      )
      return NextResponse.json({ success: false, brokenCount: broken.length, checks }, { status: 503 })
    }

    return NextResponse.json({ success: true, checks })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Failed' }, { status: 500 })
  }
}

async function checkThreads(): Promise<TokenCheck> {
  const token = process.env.THREADS_ACCESS_TOKEN
  if (!token) {
    return { platform: 'threads', ok: false, configured: false, error: 'THREADS_ACCESS_TOKEN 未設定' }
  }
  try {
    const res = await fetch(
      `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(token)}`,
      { headers: { 'Content-Type': 'application/json' } },
    )
    const json = await res.json()
    if (!res.ok || !json?.id) {
      return { platform: 'threads', ok: false, configured: true, error: json?.error?.message || `HTTP ${res.status}` }
    }

    // Ticket #18：驗證有效後嘗試展延 60 天效期（純 log，失敗不影響判定）。
    try {
      const refreshRes = await fetch(
        `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`,
      )
      const refreshJson = await refreshRes.json()
      if (refreshRes.ok && refreshJson?.access_token) {
        console.log(`[Threads] Token 自動展延成功，有效期延長至: ${refreshJson.expires_in} 秒`)
      }
    } catch (err: any) {
      console.warn('[Threads] Token 自動展延嘗試跳過:', err?.message ?? err)
    }

    return { platform: 'threads', ok: true, configured: true, user: json.username ?? null }
  } catch (e: any) {
    return { platform: 'threads', ok: false, configured: true, error: e?.message || 'network error' }
  }
}
