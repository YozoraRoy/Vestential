import type { NextResponse } from 'next/server'
import type { AuthProvider } from '@stock/database'

export const OAUTH_COOKIE = 'stock_oauth'
const OAUTH_MAX_AGE = 30 * 60

export interface OAuthState {
  state: string
  codeVerifier: string
  redirect: string
  /** 上次 callback 已因 state 驗證失敗而重跑過一次登入（避免無限重試迴圈）。 */
  retried?: boolean
}

export function serializeOAuthCookie(data: OAuthState): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url')
}

export function parseOAuthCookie(value: string | undefined): OAuthState | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as OAuthState
    if (typeof parsed.state !== 'string' || typeof parsed.codeVerifier !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function applyOAuthCookie(res: NextResponse, data: OAuthState): NextResponse {
  res.cookies.set({
    name: OAUTH_COOKIE,
    value: serializeOAuthCookie(data),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: OAUTH_MAX_AGE,
  })
  return res
}

/** 只接受站內相對路徑，避免開放轉址（`//evil.com`、`/\evil.com` 一律回退）。 */
export function safeRedirectPath(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback
  return raw
}

export interface OAuthProfile {
  provider: AuthProvider
  providerUserId: string
  email: string | null
  displayName: string | null
  avatarUrl: string | null
}

export interface ProviderConfig {
  clientId: string
  clientSecret: string
  authorizeUrl: string
  tokenUrl: string
}

const GOOGLE_CONFIG: ProviderConfig = {
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
}

const LINE_CONFIG: ProviderConfig = {
  clientId: process.env.LINE_CLIENT_ID || '',
  clientSecret: process.env.LINE_CLIENT_SECRET || '',
  authorizeUrl: 'https://access.line.me/oauth2/v2.1/authorize',
  tokenUrl: 'https://api.line.me/oauth2/v2.1/token',
}

function configFor(provider: AuthProvider): ProviderConfig {
  return provider === 'google' ? GOOGLE_CONFIG : LINE_CONFIG
}

export function isProviderConfigured(provider: AuthProvider): boolean {
  const cfg = configFor(provider)
  return Boolean(cfg.clientId && cfg.clientSecret)
}

/** Base URL used to build OAuth redirect_uri (AUTH_BASE_URL overrides request-derived origin). */
export function getAuthBaseUrl(req?: { headers: Headers }): string {
  if (process.env.AUTH_BASE_URL) return process.env.AUTH_BASE_URL.replace(/\/$/, '')
  if (req) {
    const proto = req.headers.get('x-forwarded-proto') || 'http'
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
    if (host) return `${proto}://${host}`
  }
  return process.env.NODE_ENV === 'production' ? 'https://vestential.com' : 'http://localhost:3000'
}

function base64UrlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomString(len = 32): string {
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return base64UrlEncode(arr)
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(digest)
}

export function buildProviderAuthUrl(
  provider: AuthProvider,
  opts: { redirectUri: string; state: string; codeChallenge: string },
): string {
  const cfg = configFor(provider)
  const url = new URL(cfg.authorizeUrl)
  const common: Record<string, string> = {
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  }
  for (const [k, v] of Object.entries(common)) url.searchParams.set(k, v)
  if (provider === 'google') {
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('access_type', 'online')
    url.searchParams.set('prompt', 'select_account')
  } else {
    url.searchParams.set('scope', 'openid profile email')
  }
  return url.toString()
}

export async function exchangeProviderCode(
  provider: AuthProvider,
  opts: { code: string; redirectUri: string; codeVerifier: string },
): Promise<{ accessToken: string; idToken?: string }> {
  const cfg = configFor(provider)
  const body = new URLSearchParams({
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: opts.codeVerifier,
    grant_type: 'authorization_code',
  })
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OAuth token exchange failed (${res.status}): ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { access_token?: string; id_token?: string }
  if (!json.access_token) throw new Error('OAuth token exchange returned no access_token')
  return { accessToken: json.access_token, idToken: json.id_token }
}

/** 解碼 OpenID Connect ID token (JWT) 的 payload，取回 email 等 claim。非嚴謹驗證，僅用於讀取 provider 回傳的 email。 */
function decodeIdTokenPayload(idToken?: string): Record<string, unknown> | null {
  if (!idToken) return null
  try {
    const parts = idToken.split('.')
    if (parts.length !== 3) return null
    const json = Buffer.from(parts[1], 'base64url').toString('utf8')
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function fetchProviderProfile(
  provider: AuthProvider,
  accessToken: string,
  idToken?: string,
): Promise<OAuthProfile> {
  if (provider === 'google') {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw new Error(`Google userinfo failed (${res.status})`)
    const j = (await res.json()) as {
      sub?: string; email?: string; name?: string; picture?: string
    }
    if (!j.sub) throw new Error('Google userinfo missing sub')
    return {
      provider,
      providerUserId: String(j.sub),
      email: j.email ?? null,
      displayName: j.name ?? null,
      avatarUrl: j.picture ?? null,
    }
  }
  const res = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`LINE profile failed (${res.status})`)
  const j = (await res.json()) as { userId?: string; displayName?: string; pictureUrl?: string }
  if (!j.userId) throw new Error('LINE profile missing userId')
  let email: string | null = null
  // 開關：LINE_EMAIL_ENABLED='false' 時完全不讀取 LINE email（即使 Console 已核准）。
  // 預設啟用，並以「實際 ID token 是否有 email」為準，自動偵測，不需手動切換。
  if (process.env.LINE_EMAIL_ENABLED !== 'false') {
    const payload = decodeIdTokenPayload(idToken)
    const decoded = typeof payload?.email === 'string' ? payload.email : null
    email = decoded ? decoded : null
    if (decoded) {
      console.log('[OAuth] LINE email received from ID token. Console Email permission is confirmed granted.')
    } else {
      console.error('[OAuth] LINE email NOT in ID token. If Email permission was just approved, ensure LINE Channel verification status is "verified" and permission is granted.')
    }
  } else {
    console.error('[OAuth] LINE email reading is disabled via LINE_EMAIL_ENABLED=false')
  }
  return {
    provider,
    providerUserId: String(j.userId),
    email,
    displayName: j.displayName ?? null,
    avatarUrl: j.pictureUrl ?? null,
  }
}
