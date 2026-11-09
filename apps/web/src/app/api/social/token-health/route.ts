import { NextResponse } from 'next/server'
import { migrate } from '@stock/database'
import { authorizeSync } from '@/lib/sync-auth'
import { sendMarketFocusAlert } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TokenCheck {
  platform: 'instagram' | 'threads' | 'facebook'
  ok: boolean
  configured: boolean
  user?: string | null
  error?: string
}

/**
 * 每日 cron 呼叫：以 read-only /me 驗證各平台 token 仍有效。
 * IG/Threads 皆為「長效型 token」（IGAA/THAA，不設到期日；
 * debug_token 也無法解析此格式），故只驗證可存取性。
 * FB（system user）以 graph.facebook.com /me 驗證。
 * 任一平台無法驗證 → sendMarketFocusAlert 告警。
 */
export async function GET(req: Request) {
  if (!authorizeSync(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    await migrate()
    const checks: TokenCheck[] = []

    const igToken = process.env.IG_ACCESS_TOKEN
    const igUserId = process.env.IG_USER_ID
    if (igToken) {
      checks.push(await checkIg(igToken, igUserId))
    } else {
      checks.push({ platform: 'instagram', ok: false, configured: false, error: 'IG_ACCESS_TOKEN 未設定' })
    }

    const thToken = process.env.THREADS_ACCESS_TOKEN
    if (thToken) {
      checks.push(await checkUser('threads', 'https://graph.threads.net/v1.0/me', thToken))
    } else {
      checks.push({ platform: 'threads', ok: false, configured: false, error: 'THREADS_ACCESS_TOKEN 未設定' })
    }

    const fbToken = process.env.FB_ACCESS_TOKEN
    const fbPageId = process.env.FB_PAGE_ID
    if (fbToken) {
      checks.push(await checkFb(fbToken, fbPageId))
    } else {
      checks.push({ platform: 'facebook', ok: false, configured: false, error: 'FB_ACCESS_TOKEN 未設定' })
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

async function checkIg(token: string, igUserId?: string): Promise<TokenCheck> {
  // 1. 若有設定 IG_USER_ID，優先以 Meta Graph API 檢驗專業帳號（適用 Page Access Token）
  if (igUserId) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(igUserId)}?fields=id,username&access_token=${encodeURIComponent(token)}`,
        { headers: { 'Content-Type': 'application/json' } },
      )
      const json = await res.json()
      if (res.ok && json?.id) {
        return { platform: 'instagram', ok: true, configured: true, user: json.username ?? null }
      }
    } catch {
      // 容錯嘗試 fallback
    }
  }

  // 2. Fallback: Instagram Basic Display API (適用 IGAA 開頭個人 Token)
  return checkUser('instagram', 'https://graph.instagram.com/v21.0/me', token)
}

async function checkUser(platform: 'instagram' | 'threads', url: string, token: string): Promise<TokenCheck> {
  try {
    const res = await fetch(`${url}?fields=id,username&access_token=${encodeURIComponent(token)}`, {
      headers: { 'Content-Type': 'application/json' },
    })
    const json = await res.json()
    if (!res.ok || !json?.id) {
      return { platform, ok: false, configured: true, error: json?.error?.message || `HTTP ${res.status}` }
    }

    // Ticket #18：若 Threads 驗證有效，嘗試調用 refresh_access_token 自動延長 60 天效期
    if (platform === 'threads') {
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
    }

    return { platform, ok: true, configured: true, user: json.username ?? null }
  } catch (e: any) {
    return { platform, ok: false, configured: true, error: e?.message || 'network error' }
  }
}

/** FB：同時支援 Page Access Token（/me 直接回傳粉專自身）與 System User Token（/me/accounts 換粉專）。 */
async function checkFb(fbToken: string, fbPageId?: string): Promise<TokenCheck> {
  try {
    // 1. 先檢驗是否為粉專自身 Page Access Token
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(fbToken)}`,
      { headers: { 'Content-Type': 'application/json' } },
    )
    const meJson = await meRes.json()
    if (meRes.ok && meJson?.id) {
      if (!fbPageId || String(meJson.id) === String(fbPageId)) {
        return { platform: 'facebook', ok: true, configured: true, user: meJson.name ?? null }
      }
    }

    // 2. 若非 Page Access Token，嘗試以 System User Token 查詢 /me/accounts
    const res = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name&access_token=${encodeURIComponent(fbToken)}`,
      { headers: { 'Content-Type': 'application/json' } },
    )
    const json = await res.json()
    if (!res.ok || !Array.isArray(json?.data)) {
      return { platform: 'facebook', ok: false, configured: true, error: meJson?.error?.message || json?.error?.message || `HTTP ${res.status}` }
    }
    if (fbPageId) {
      const page = json.data.find((p: any) => String(p?.id) === String(fbPageId))
      if (!page) {
        return {
          platform: 'facebook',
          ok: false,
          configured: true,
          error: `FB_PAGE_ID ${fbPageId} 不在可存取清單中（可用: ${json.data.map((p: any) => p.name).join(', ')}）`,
        }
      }
      return { platform: 'facebook', ok: true, configured: true, user: page.name ?? null }
    }
    return { platform: 'facebook', ok: true, configured: true, user: json.data.map((p: any) => p.name).join(', ') }
  } catch (e: any) {
    return { platform: 'facebook', ok: false, configured: true, error: e?.message || 'network error' }
  }
}