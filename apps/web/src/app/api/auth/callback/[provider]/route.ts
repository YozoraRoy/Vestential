import { NextRequest, NextResponse } from 'next/server'
import { findOrCreateUser } from '@stock/database'
import type { AuthProvider } from '@stock/database'
import { applySessionCookie, signSession } from '../../../../../lib/auth'
import {
  exchangeProviderCode, fetchProviderProfile, getAuthBaseUrl,
  OAUTH_COOKIE, parseOAuthCookie, safeRedirectPath,
} from '../../../../../lib/oauth'

/**
 * 失敗一律導回 /login（附 error key 與 provider），讓登入頁顯示人話並提供「再試一次」，
 * 不再回裸 JSON 給使用者。
 */
function loginErrorRedirect(
  baseUrl: string,
  opts: { error: string; provider: AuthProvider; redirect: string },
): NextResponse {
  const search = new URLSearchParams({
    error: opts.error,
    provider: opts.provider,
    redirect: opts.redirect,
  })
  const res = NextResponse.redirect(new URL(`/login?${search.toString()}`, baseUrl), 302)
  res.cookies.delete(OAUTH_COOKIE)
  return res
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params
  if (provider !== 'google' && provider !== 'line') {
    return NextResponse.json({ success: false, error: 'unsupported provider' }, { status: 400 })
  }
  const authProvider = provider as AuthProvider
  const baseUrl = getAuthBaseUrl(req)
  const searchParams = req.nextUrl.searchParams

  const rawCookie = req.cookies.get(OAUTH_COOKIE)?.value
  const oauthState = parseOAuthCookie(rawCookie)
  const stateParam = searchParams.get('state')
  const errorParam = searchParams.get('error')
  // cookie 內的 redirect 才是本次登入真正的目的地；cookie 遺失時退回 query。
  const redirect = safeRedirectPath(oauthState?.redirect ?? searchParams.get('redirect'))

  // 使用者按「取消授權」時 provider 不會回 state 配對結果，必須先於 state 驗證處理。
  if (errorParam) {
    console.warn('[API/Auth/Callback] provider returned error', {
      provider: authProvider,
      error: errorParam,
      host: req.headers.get('host') ?? null,
    })
    return loginErrorRedirect(baseUrl, { error: 'provider_denied', provider: authProvider, redirect })
  }

  const stateMatch = Boolean(oauthState && stateParam && oauthState.state === stateParam)
  if (!oauthState || !stateParam || !stateMatch) {
    console.warn('[API/Auth/Callback] state check failed', {
      host: req.headers.get('host') ?? null,
      hasCookie: Boolean(rawCookie),
      stateMatch,
      ua: req.headers.get('user-agent') ?? null,
    })
    // 只在第一次失敗時自動重跑登入（重新種 cookie）；已重試過就不再繞圈，直接回人話錯誤頁。
    const alreadyRetried = oauthState?.retried === true || searchParams.get('retry') === '1'
    if (alreadyRetried) {
      return loginErrorRedirect(baseUrl, { error: 'state_mismatch', provider: authProvider, redirect })
    }
    const retryParams = new URLSearchParams({ redirect, retry: '1' })
    const res = NextResponse.redirect(
      new URL(`/api/auth/login/${authProvider}?${retryParams.toString()}`, baseUrl),
      302,
    )
    res.cookies.delete(OAUTH_COOKIE)
    return res
  }

  const code = searchParams.get('code')
  if (!code) {
    console.warn('[API/Auth/Callback] missing authorization code', { provider: authProvider })
    return loginErrorRedirect(baseUrl, { error: 'callback_failed', provider: authProvider, redirect })
  }

  try {
    const redirectUri = `${baseUrl}/api/auth/callback/${authProvider}`
    const { accessToken, idToken } = await exchangeProviderCode(authProvider, {
      code,
      redirectUri,
      codeVerifier: oauthState.codeVerifier,
    })
    const profile = await fetchProviderProfile(authProvider, accessToken, idToken)
    const user = await findOrCreateUser({
      provider: authProvider,
      providerUserId: profile.providerUserId,
      email: profile.email ?? undefined,
      displayName: profile.displayName ?? undefined,
      avatarUrl: profile.avatarUrl ?? undefined,
      mergeByEmail: authProvider === 'google',
    })
    if (!user) {
      throw new Error('failed to create or find user')
    }
    const token = await signSession(user.id)

    const target = new URL(safeRedirectPath(oauthState.redirect), baseUrl).toString()
    const res = NextResponse.redirect(target)
    applySessionCookie(res, token)
    res.cookies.delete(OAUTH_COOKIE)
    return res
  } catch (error) {
    console.error('[API/Auth/Callback] Failed:', error)
    return loginErrorRedirect(baseUrl, { error: 'callback_failed', provider: authProvider, redirect })
  }
}
