import { NextRequest, NextResponse } from 'next/server'
import { APP_LOCALE_COOKIE, defaultLocale, isLocale, type Locale } from '@/i18n/config'

/**
 * 多語系路徑支援（Next.js 16：middleware 已更名為 proxy）。
 *
 * 流程：
 *   1. 從路徑前綴（/en、/ja、/zh-TW）偵測語系
 *   2. 沒有路徑語系時讀 cookie，再退回瀏覽器 Accept-Language
 *   3. 設定 x-locale request header（供 server 以此語系渲染）
 *   4. 把 /en/...、/ja/...、/zh-TW/... rewrite 回無前綴路徑
 */
const pathLocales = ['en', 'ja', 'zh-TW'] as const

function resolveFromAcceptLanguage(headers: Headers): Locale {
  const accept = headers.get('accept-language') ?? ''
  const lower = accept.toLowerCase()
  if (lower.startsWith('zh')) return 'zh-TW'
  if (lower.startsWith('ja')) return 'ja'
  if (lower.startsWith('en')) return 'en'
  return defaultLocale
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const url = req.nextUrl.clone()

  // 取出路徑語系
  const segments = pathname.split('/').filter(Boolean)
  let locale: Locale | null = null
  if (segments.length > 0 && isLocale(segments[0])) {
    locale = segments[0] as Locale
  }
  // /zh-TW 視為預設語系（strip 前綴），但可允許
  const match = pathname.match(/^\/(en|ja|zh-TW)(\/|$)/)
  if (match) {
    locale = match[1] as Locale
  }

  const cookie = req.cookies.get(APP_LOCALE_COOKIE)?.value

  const resolved: Locale = locale ?? (cookie && isLocale(cookie) ? (cookie as Locale) : resolveFromAcceptLanguage(req.headers))

  // 建立改寫後無前綴的路徑，避免多層語系前綴（/ja/ja/en/...）導致 404
  let nextPathname = pathname
  let prefixCount = 0
  while (prefixCount < segments.length && (pathLocales as readonly string[]).includes(segments[prefixCount])) prefixCount++
  if (prefixCount > 0) nextPathname = prefixCount === segments.length ? '/' : `/${segments.slice(prefixCount).join('/')}`

  // 設定 x-locale header，供後端以 resolved 語系渲染
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-locale', resolved)
  const response = NextResponse.rewrite(new URL(nextPathname || '/', url), {
    request: { headers: requestHeaders },
  })

  // 更新語系 cookie（供後續 request 使用）
  response.cookies.set(APP_LOCALE_COOKIE, resolved, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })

  return response
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
}
