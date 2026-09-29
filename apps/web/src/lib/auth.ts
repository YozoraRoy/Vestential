import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getUserById, getUserIdentities, type UserRow } from '@stock/database'

export const COOKIE_NAME = 'stock_session'
/**
 * #44：每日 AI 分析額度改為分級制（一般 1 次／管理員 3 次）。
 * DAILY_ANALYSIS_LIMIT 保留為管理員上限（舊引用相容；新程式一律走 getDailyAnalysisLimit）。
 */
export const DAILY_ANALYSIS_LIMIT = 3
/** 一般使用者每日 AI 分析額度（#44 分級；客訴文案須寫清「一般 1／管理員 3」）。 */
export const DAILY_ANALYSIS_LIMIT_REGULAR = 1

/**
 * #44：依身分回傳每日 AI 分析額度（isAdminUser → 3／一般 → 1）。
 * 5 支分析 route（analyze、portfolio/analyze、risk/summary、portfolio/review、
 * journal/review）＋ auth/me 皆走此函式，不再直接寫死 DAILY_ANALYSIS_LIMIT。
 */
export function getDailyAnalysisLimit(isAdmin: boolean): number {
  return isAdmin ? DAILY_ANALYSIS_LIMIT : DAILY_ANALYSIS_LIMIT_REGULAR
}
export const DAILY_RECOGNITION_LIMIT = 10
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days

/**
 * 管理者判定（任一成立即為 admin）：
 * 1. LINE：ADMIN_LINE_USER_IDS（或 fallback display_name === 'roy'）
 * 2. Email：ADMIN_EMAILS（比對 user_identities.provider_email，大小寫不敏感）
 */
export async function isAdminUser(user: UserRow): Promise<boolean> {
  const configuredLineIds = (process.env.ADMIN_LINE_USER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const identities = await getUserIdentities(user.id)

  // LINE 判定
  const lineIdentities = identities.filter(i => i.provider === 'line')
  const isLineAdmin = lineIdentities.some(i =>
    configuredLineIds.length > 0
      ? configuredLineIds.includes(i.provider_user_id)
      : (user.display_name || '').trim().toLowerCase() === 'roy',
  )
  if (isLineAdmin) return true

  // Email 判定（大小寫不敏感）
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  if (adminEmails.length === 0) return false
  return identities.some(i =>
    i.provider_email && adminEmails.includes(i.provider_email.trim().toLowerCase()),
  )
}

/**
 * Route handler 用：解析當前使用者；非登入回 401、登入但非 admin 回 403。
 * @returns 當前 UserRow（已確認是 admin），否則 null（此時已寫入 response）。
 */
export async function requireAdmin(req: NextRequest, res: NextResponse): Promise<UserRow | null> {
  const user = await getCurrentUserFromReq(req)
  if (!user) {
    res = NextResponse.json({ error: '請先登入' }, { status: 401 })
    return null
  }
  if (!(await isAdminUser(user))) {
    res = NextResponse.json({ error: '無管理員權限' }, { status: 403 })
    return null
  }
  return user
}

export function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET || 'dev-only-insecure-secret-change-me'
  return new TextEncoder().encode(secret)
}

export async function signSession(userId: number): Promise<string> {
  return new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecret())
}

export async function verifySession(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return typeof payload.uid === 'number' ? payload.uid : null
  } catch {
    return null
  }
}

/** Taiwan (Asia/Taipei) date as YYYY-MM-DD — quota resets by calendar day in TW time. */
export function getTaiwanDateStr(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(date)
}

export function applySessionCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  return res
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return res
}

/** Resolve the session token from the incoming request. */
function getToken(req: NextRequest): string | null {
  return req.cookies.get(COOKIE_NAME)?.value ?? null
}

/** Resolve the session token from the current server context (route handlers). */
async function getTokenFromCookies(): Promise<string | null> {
  const store = await cookies()
  return store.get(COOKIE_NAME)?.value ?? null
}

/** Returns the logged-in user, or null when unauthenticated / session invalid. */
export async function getCurrentUserFromReq(req: NextRequest): Promise<UserRow | null> {
  const token = getToken(req)
  if (!token) return null
  const uid = await verifySession(token)
  if (!uid) return null
  return getUserById(uid)
}

/** Same as getCurrentUserFromReq but reads from next/headers cookies(). */
export async function getCurrentUserFromCookies(): Promise<UserRow | null> {
  const token = await getTokenFromCookies()
  if (!token) return null
  const uid = await verifySession(token)
  if (!uid) return null
  return getUserById(uid)
}
