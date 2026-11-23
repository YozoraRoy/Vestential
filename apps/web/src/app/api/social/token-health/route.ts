import { NextResponse } from 'next/server'
import { migrate } from '@stock/database'
import { authorizeSync } from '@/lib/sync-auth'
import { sendMarketFocusAlert } from '@/lib/email'
import { ACTIVE_SOCIAL_PLATFORMS, type ActiveSocialPlatform } from '@/lib/social-platforms'
import {
  getSocialAccessToken,
  getSocialTokenMeta,
  isPermanentSocialToken,
  saveRefreshedSocialToken,
} from '@/lib/social-tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TokenCheck {
  platform: ActiveSocialPlatform | 'instagram' | 'facebook'
  ok: boolean
  configured: boolean
  /** 暫態網路/逾時/5xx/429 錯誤（非 Token 本身失效，不觸發 Token 失效告警信）。 */
  transient?: boolean
  user?: string | null
  error?: string
  daysRemaining?: number | null
  expiresAt?: string | null
  lastRefreshedAt?: string | null
  isPermanent?: boolean
  canRefresh?: boolean
  refreshed?: boolean
  tokenSource?: 'db' | 'env' | 'none'
}

/**
 * 每日 cron / AI 中控台呼叫：驗證「目前啟用」平台的 token 有效性並持久化自動展延。
 *
 * - Threads：驗證有效後呼叫 refresh_access_token?grant_type=th_refresh_token，
 *   並將新 token 與 expires_in 寫回 agent_settings（DB 持久化），不因重啟遺失。
 * - IG / FB：如使用 EAA*（FB Page / System User Token）則為長期有效 (`isPermanent: true`)；
 *   若未來使用 IGAA* 60 天 Token 亦支援 ig_refresh_token 持久化。
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
    const invalid = broken.filter((c) => !c.transient)
    if (invalid.length > 0) {
      await sendMarketFocusAlert(
        '社群 Token 失效告警',
        invalid.map((c) => `${c.platform}: ${c.error}`).join('\n'),
      )
    } else if (broken.length > 0) {
      console.warn(
        `[TokenHealth] 暫態錯誤略過 Token 失效告警發信：${broken.map((c) => `${c.platform}: ${c.error}`).join('; ')}`,
      )
    }
    if (broken.length > 0) {
      return NextResponse.json({ success: false, brokenCount: broken.length, checks }, { status: 503 })
    }

    const igResolved = await getSocialAccessToken('instagram')
    const igPermanent = igResolved.token ? isPermanentSocialToken('instagram', igResolved.token) : null

    return NextResponse.json({
      success: true,
      igTokenMode: igResolved.token ? (igPermanent ? 'permanent_fb_page' : 'igaa_60d') : 'unconfigured',
      checks,
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Failed' }, { status: 500 })
  }
}

async function checkThreads(): Promise<TokenCheck> {
  const resolved = await getSocialAccessToken('threads')
  const token = resolved.token
  if (!token) {
    return {
      platform: 'threads',
      ok: false,
      configured: false,
      error: 'THREADS_ACCESS_TOKEN 未設定',
      daysRemaining: null,
      isPermanent: false,
      canRefresh: false,
      tokenSource: 'none',
    }
  }
  try {
    const retryDelayMs = Number(process.env.TOKEN_HEALTH_RETRY_DELAY_MS ?? '1500')
    let res: Response | null = null
    let json: any = null
    let lastErr: unknown = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        res = await fetch(
          `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(token)}`,
          { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000) },
        )
        json = await res.json().catch(() => ({}))
        const isTransientHttp = res.status >= 500 || res.status === 429
        if (!isTransientHttp || attempt === 3) break
      } catch (err) {
        lastErr = err
        res = null
        if (attempt === 3) break
      }
      if (retryDelayMs > 0) {
        await new Promise((r) => setTimeout(r, retryDelayMs))
      }
    }
    if (!res) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? 'Threads API timeout'))
    if (!res.ok || !json?.id) {
      const isTransientHttp = res.status >= 500 || res.status === 429
      return {
        platform: 'threads',
        ok: false,
        configured: true,
        transient: isTransientHttp,
        error: json?.error?.message || `HTTP ${res.status}`,
        isPermanent: false,
        canRefresh: false,
        tokenSource: resolved.source,
      }
    }

    let meta = await getSocialTokenMeta('threads')
    let refreshed = false
    let tokenSource = resolved.source

    try {
      const refreshRes = await fetch(
        `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(10_000) },
      )
      const refreshJson = await refreshRes.json()
      if (refreshRes.ok && typeof refreshJson?.access_token === 'string' && refreshJson.access_token.trim()) {
        meta = await saveRefreshedSocialToken('threads', {
          accessToken: refreshJson.access_token,
          expiresInSeconds: Number(refreshJson.expires_in) || 60 * 86_400,
        })
        refreshed = true
        tokenSource = 'db'
        console.log(`[Threads] Token 自動展延並持久化成功，剩餘 ${meta.daysRemaining ?? 60} 天`)
      }
    } catch (err: any) {
      console.warn('[Threads] Token 自動展延嘗試跳過:', err?.message ?? err)
    }

    return {
      platform: 'threads',
      ok: true,
      configured: true,
      user: json.username ?? null,
      daysRemaining: meta.daysRemaining,
      expiresAt: meta.expiresAt,
      lastRefreshedAt: meta.lastRefreshedAt,
      isPermanent: false,
      canRefresh: true,
      refreshed,
      tokenSource,
    }
  } catch (e: any) {
    return {
      platform: 'threads',
      ok: false,
      configured: true,
      transient: true,
      error: e?.message || 'network error',
      isPermanent: false,
      canRefresh: false,
      tokenSource: resolved.source,
    }
  }
}
