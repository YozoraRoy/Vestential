import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { logApiError, type ApiErrorActorType, type ApiErrorCategory } from '@stock/database'
import { getCurrentUserFromReq } from '@/lib/auth'

export const NORMAL_API_SLOW_MS = 5_000
export const HEAVY_AI_API_SLOW_MS = 25_000

const HEAVY_AI_ROUTE_PREFIXES = [
  '/api/analyze',
  '/api/portfolio/analyze',
  '/api/portfolio/recognize',
  '/api/portfolio/review',
  '/api/backtest/insight',
  '/api/journal/review',
]

export function getSlowThresholdMs(route: string, overrideMs?: number): number {
  if (typeof overrideMs === 'number' && Number.isFinite(overrideMs) && overrideMs > 0) return overrideMs
  if (HEAVY_AI_ROUTE_PREFIXES.some((p) => route.startsWith(p))) return HEAVY_AI_API_SLOW_MS
  return NORMAL_API_SLOW_MS
}

/** 遮罩 IP 末段（IPv4 -> a.b.c.*），兼顧同來源追查與隱私去識別化。 */
export function maskClientIp(rawIp: string | null | undefined): string {
  if (!rawIp) return 'unknown'
  const first = rawIp.split(',')[0]?.trim() || ''
  if (!first) return 'unknown'
  const ipv4 = first.replace(/^::ffff:/i, '')
  const parts = ipv4.split('.')
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.*`
  }
  const v6 = first.split(':')
  if (v6.length >= 3) {
    return `${v6.slice(0, 3).join(':')}::*`
  }
  return 'masked'
}

/** 由 User-Agent 萃取簡短裝置與瀏覽器標籤（如 Mobile/Chrome）。 */
export function parseDeviceLabel(ua: string | null | undefined): string {
  if (!ua) return 'Unknown'
  const s = ua.toLowerCase()
  if (/curl|python|axios|node-fetch|postman|bot|spider|crawler/.test(s)) return 'Bot/CLI'
  const device = /mobile|iphone|android/.test(s) ? 'Mobile' : 'Desktop'
  let browser = 'Browser'
  if (s.includes('edg/')) browser = 'Edge'
  else if (s.includes('chrome/') && !s.includes('edg/')) browser = 'Chrome'
  else if (s.includes('safari/') && !s.includes('chrome/')) browser = 'Safari'
  else if (s.includes('firefox/')) browser = 'Firefox'
  return `${device}/${browser}`
}

export function isAiQuotaText(text: string): boolean {
  return /(resource_exhausted|quota|rate.?limit|too many requests|429|insufficient_quota|tokens per minute|tpm|rpd)/i.test(
    text,
  )
}

export function isAiFailureText(text: string): boolean {
  return /(gemini|groq|deepseek|openai|llm|ai.?engine|model|generate)/i.test(text)
}

export async function extractActor(req: Request | NextRequest): Promise<{
  actorType: ApiErrorActorType
  userId: number | null
  userEmail: string | null
  clientIp: string
  userAgent: string
}> {
  const fwd = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip')
  const clientIp = maskClientIp(fwd)
  const userAgent = parseDeviceLabel(req.headers.get('user-agent'))
  try {
    const user = await getCurrentUserFromReq(req as NextRequest)
    if (user?.id) {
      return {
        actorType: 'user',
        userId: user.id,
        userEmail: user.email ?? null,
        clientIp,
        userAgent,
      }
    }
  } catch {
    // 讀不到 session 時退回訪客
  }
  return { actorType: 'guest', userId: null, userEmail: null, clientIp, userAgent }
}

/** 包裝 API Route Handler，自動記錄 5xx、429（區分 AI 額度用盡 vs 站內限流）與分級慢 API。 */
export async function withApiAudit<T extends Response>(
  req: Request | NextRequest,
  route: string,
  handler: () => Promise<T>,
  opts?: { slowMs?: number },
): Promise<T | NextResponse> {
  const startMs = Date.now()
  const slowMs = getSlowThresholdMs(route, opts?.slowMs)
  const method = req.method || 'GET'

  try {
    const res = await handler()
    const durationMs = Date.now() - startMs
    const status = res.status

    if (status >= 500 || status === 429 || durationMs >= slowMs) {
      const actor = await extractActor(req)
      let bodyMsg = ''
      if (status >= 400) {
        try {
          const cloned = res.clone()
          const txt = await cloned.text()
          try {
            const j = JSON.parse(txt)
            bodyMsg = String(j?.error || j?.message || txt)
          } catch {
            bodyMsg = txt
          }
        } catch {
          bodyMsg = `HTTP ${status}`
        }
      }

      let category: ApiErrorCategory = 'slow_api'
      if (status === 429) {
        category = isAiQuotaText(bodyMsg) && isAiFailureText(bodyMsg) ? 'ai_quota' : 'rate_limit'
      } else if (status >= 500) {
        if (isAiQuotaText(bodyMsg)) category = 'ai_quota'
        else if (isAiFailureText(bodyMsg)) category = 'ai_error'
        else category = 'api_error'
      }

      void logApiError({
        category,
        route,
        method,
        statusCode: status,
        durationMs,
        actorType: actor.actorType,
        userId: actor.userId,
        userEmail: actor.userEmail,
        clientIp: actor.clientIp,
        userAgent: actor.userAgent,
        recovered: false,
        errorMessage: bodyMsg || (category === 'slow_api' ? `回應耗時 ${durationMs}ms (門檻 ${slowMs}ms)` : `HTTP ${status}`),
      })
    }

    return res
  } catch (err: any) {
    const durationMs = Date.now() - startMs
    const msg = String(err?.message || err || 'Unhandled API error')
    const actor = await extractActor(req)
    const category: ApiErrorCategory = isAiQuotaText(msg)
      ? 'ai_quota'
      : isAiFailureText(msg)
        ? 'ai_error'
        : 'api_error'

    void logApiError({
      category,
      route,
      method,
      statusCode: 500,
      durationMs,
      actorType: actor.actorType,
      userId: actor.userId,
      userEmail: actor.userEmail,
      clientIp: actor.clientIp,
      userAgent: actor.userAgent,
      recovered: false,
      errorMessage: msg,
    })

    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
