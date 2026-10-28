import { NextRequest, NextResponse } from 'next/server'
import type { AuthProvider } from '@stock/database'
import {
  applyOAuthCookie, buildProviderAuthUrl, getAuthBaseUrl, isProviderConfigured,
  pkceChallenge, randomString, safeRedirectPath,
} from '../../../../../lib/oauth'
import { firstHeaderValue, resolveOAuthEntryRedirect } from '../../../../../lib/oauth-redirect'

function redirectNoStore(target: string): NextResponse {
  const res = NextResponse.redirect(target, 301)
  // 導流規則若被瀏覽器 301 永久快取，日後調整白名單會卡到使用者，因此一律 no-store。
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  // 先導流再談 provider：cookie 種錯 host 的話，後面的 OAuth 流程一定失敗。
  const redirectTarget = resolveOAuthEntryRedirect({
    host: firstHeaderValue(req.headers.get('x-forwarded-host')) || req.headers.get('host') || req.nextUrl.host,
    protocol: firstHeaderValue(req.headers.get('x-forwarded-proto')) || req.nextUrl.protocol.replace(':', ''),
    pathname: req.nextUrl.pathname,
    search: req.nextUrl.search,
  })
  if (redirectTarget) {
    return redirectNoStore(redirectTarget)
  }

  const { provider } = await params
  if (provider !== 'google' && provider !== 'line') {
    return NextResponse.json({ success: false, error: 'unsupported provider' }, { status: 400 })
  }
  const authProvider = provider as AuthProvider
  if (!isProviderConfigured(authProvider)) {
    return NextResponse.json({ success: false, error: 'provider not configured' }, { status: 503 })
  }

  const baseUrl = getAuthBaseUrl(req)
  const redirectUri = `${baseUrl}/api/auth/callback/${authProvider}`
  const state = randomString(32)
  const codeVerifier = randomString(64)
  const codeChallenge = await pkceChallenge(codeVerifier)
  const redirect = safeRedirectPath(req.nextUrl.searchParams.get('redirect'))
  // retry=1 代表這是 callback 失敗後自動重跑的一次，記進 cookie 讓下一次失敗能收斂成錯誤頁。
  const retried = req.nextUrl.searchParams.get('retry') === '1'

  const authorizeUrl = buildProviderAuthUrl(authProvider, { redirectUri, state, codeChallenge })
  const res = NextResponse.redirect(authorizeUrl)
  return applyOAuthCookie(res, { state, codeVerifier, redirect, retried })
}
