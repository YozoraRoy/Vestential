'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { useI18n } from '@/i18n/LanguageProvider'
import { localizePath } from '@/i18n/paths'

const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41.4 35.9 44 30.5 44 24c0-1.3-.1-2.6-.4-3.9z" />
  </svg>
)

const LineIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
    <path d="M12 2C6.5 2 2 5.9 2 10.8c0 2.8 1.5 5.3 3.9 7-.2 1-.8 2.7-1.2 3.2-.1.2-.1.3 0 .4.1.1.2.1.3 0 1.3-.7 3.3-1.8 3.9-2.2.4.1.8.1 1.1.1 5.5 0 10-3.9 10-8.8S17.5 2 12 2zm4.3 9.3c0 .2-.2.4-.4.4h-2.2l-1.2 1.5c-.1.1-.2.2-.4.1-.1 0-.2-.1-.2-.3v-1.3H9.7c-.2 0-.4-.2-.4-.4V9.1c0-.2.2-.4.4-.4h1.2v2.2h2.8v-.5c0-.2.2-.4.4-.4s.4.2.4.4v2.9z" />
  </svg>
)

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { dict, locale } = useI18n()
  const redirect = searchParams.get('redirect') || '/'
  const safeRedirect = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'

  const errorCode = searchParams.get('error')
  const providerParam = searchParams.get('provider')
  const errorProvider = providerParam === 'google' || providerParam === 'line' ? providerParam : null
  const errorMessage =
    errorCode === 'state_mismatch' ? dict.login.errorStateMismatch
      : errorCode === 'provider_denied' ? dict.login.errorProviderDenied
        : errorCode === 'callback_failed' ? dict.login.errorCallbackFailed
          : null

  const [checking, setChecking] = useState(true)
  const [devLoggingIn, setDevLoggingIn] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data?.success) router.replace(safeRedirect)
      })
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [router, safeRedirect])

  const loginUrl = (provider: 'google' | 'line') =>
    `/api/auth/login/${provider}?redirect=${encodeURIComponent(safeRedirect)}`

  const handleDevLogin = async () => {
    setDevLoggingIn(true)
    try {
      const res = await fetch('/api/auth/dev-login', { method: 'POST' })
      if (res.ok) {
        router.replace(safeRedirect)
      } else {
        const body = await res.json().catch(() => ({}))
        setCheckError(body.error || dict.login.devLoginError)
      }
    } catch (e: any) {
      setCheckError(e.message || dict.login.devLoginError)
    } finally {
      setDevLoggingIn(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-sm text-[var(--text-secondary)]">
        {dict.login.checking}
      </div>
    )
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-[var(--bg-card)] rounded-2xl border border-white/5 p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-1">{dict.login.title}</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {dict.login.subtitle}
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm leading-relaxed text-red-300"
          >
            <p>{errorMessage}</p>
            {errorProvider && (
              <a
                href={loginUrl(errorProvider)}
                className="mt-2 inline-block text-xs font-medium text-[var(--accent)] hover:underline"
              >
                {dict.login.retry}
              </a>
            )}
          </div>
        )}

        <div className="space-y-3">
          <a
            href={loginUrl('google')}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white text-gray-800 font-medium text-sm hover:bg-gray-100 transition"
          >
            <GoogleIcon />
            {dict.login.google}
          </a>
          <a
            href={loginUrl('line')}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-[#06C755] text-white font-medium text-sm hover:bg-[#05b84d] transition"
          >
            <LineIcon />
            {dict.login.line}
          </a>
          {process.env.NODE_ENV === 'development' && (
            <button
              type="button"
              onClick={handleDevLogin}
              disabled={devLoggingIn}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white/10 text-white font-medium text-sm hover:bg-white/15 border border-white/10 transition"
            >
              <span>{dict.login.devLogin}</span>
            </button>
          )}
        </div>

        <p className="mt-6 text-xs text-center text-[var(--text-secondary)]">
          {dict.login.note1}<br />
          {dict.login.note2}
        </p>
        {checkError && (
          <div className="mt-4 text-center text-xs text-red-400">{checkError}</div>
        )}
        <div className="mt-4 text-center">
          <Link href={localizePath(locale, '/')} className="text-xs text-[var(--accent)] hover:underline">
            {dict.common.backToHome}
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const { dict } = useI18n()
  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex items-center justify-center text-sm text-[var(--text-secondary)]">
        {dict.common.loading}
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
