'use client'

import { TrendingUp, LogOut, User, Zap, Menu, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n/LanguageProvider'
import { localizePath } from '@/i18n/paths'
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher'
import type { Dict } from '@/i18n/dictionaries'
import type { Locale } from '@/i18n/config'

const navItems: { key: keyof Dict['nav']; href: string }[] = [
  { key: 'home', href: '/' },
  { key: 'oddLot', href: '/odd-lot' },
  { key: 'backtest', href: '/backtest' },
  { key: 'cycleEntry', href: '/cycle-entry' },
  { key: 'portfolio', href: '/portfolio' },
  { key: 'analyze', href: '/analyze' },
  { key: 'marketFocus', href: '/market-focus' },
  { key: 'agentArena', href: '/agent-arena' },
  // #44：導覽移除 journal 入口（桌機＋漢堡共用 navItems，一處刪除即兩處生效）。
  // nav.journal i18n 鍵保留（rg 確認僅 header 取用；留鍵避免 Dict 破壞性變更，
  // /journal 頁改用 journal 節文案，直連網址仍可進入，頁面不下線不遷移）。
]

export interface HeaderUser {
  id: number
  displayName: string | null
  email: string | null
  avatarUrl: string | null
  isAdmin?: boolean
}

const hamburgerLabels: Record<Locale, { open: string; close: string }> = {
  'zh-TW': { open: '開啟選單', close: '關閉選單' },
  en: { open: 'Open menu', close: 'Close menu' },
  ja: { open: 'メニューを開く', close: 'メニューを閉じる' },
}

export function Header({ initialUser }: { initialUser: HeaderUser | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const { dict, locale } = useI18n()
  const [user, setUser] = useState<HeaderUser | null>(initialUser)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const hamburgerRef = useRef<HTMLButtonElement>(null)

  const isActiveLink = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(href))

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setMenuOpen(false)
    hamburgerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const refreshQuota = () => {
      fetch('/api/auth/me')
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (cancelled || !data?.success) return
          if (data.user) setUser(data.user)
          if (typeof data.quota?.remaining === 'number') setRemaining(data.quota.remaining)
        })
        .catch(() => {})
    }
    refreshQuota()
    window.addEventListener('quota-updated', refreshQuota)
    return () => {
      cancelled = true
      window.removeEventListener('quota-updated', refreshQuota)
    }
  }, [user?.id])

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      setUser(null)
      setMenuOpen(false)
      setDrawerOpen(false)
      router.refresh()
      hamburgerRef.current?.focus()
    }
  }

  // 抽屜開啟時：ESC 關閉
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen, closeDrawer])

  // 抽屜開啟時：body scroll lock
  useEffect(() => {
    if (!drawerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [drawerOpen])

  // 路由變化時關閉抽屜（換頁不搶 focus）
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  return (
    <>
    <header className="sticky top-0 z-50 bg-[var(--bg-primary)]/80 backdrop-blur-md border-b border-white/5">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href={localizePath(locale, '/')} className="flex items-center gap-2.5 group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand-logo.png"
            alt="Vestential Logo"
            className="w-8 h-8 object-contain transition-transform group-hover:scale-105"
          />
          <span className="text-lg font-bold tracking-tight">Vestential</span>
        </Link>
        <div className="flex items-center gap-1">
          <nav className="hidden md:flex items-center gap-1 mr-2" aria-label="主導覽">
            {navItems.map((item) => {
              const isActive = isActiveLink(item.href)
              return (
                <Link
                  key={item.href}
                  href={localizePath(locale, item.href)}
                  className={`px-3 py-2 text-sm rounded-lg transition ${
                    isActive
                      ? 'text-[var(--text-primary)] bg-white/10'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
                  }`}
                >
                  {dict.nav[item.key]}
                </Link>
              )
            })}
          </nav>

          {/* 桌機才顯示頂列語言切換；手機版收進抽屜（避免 360px 頂列溢出） */}
          <div className="hidden md:block">
            <LanguageSwitcher />
          </div>

          {user ? (
            <div className="relative">
              <button
                onClick={() => setMenuOpen(prev => !prev)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition"
                aria-label="使用者選單"
              >
                {user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.avatarUrl}
                    alt=""
                    className="w-7 h-7 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="w-7 h-7 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] flex items-center justify-center text-xs font-bold">
                    {(user.displayName || user.email || 'U').slice(0, 1).toUpperCase()}
                  </span>
                )}
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-56 bg-[var(--bg-card)] border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/5">
                      <div className="text-sm font-medium truncate">
                        {user.displayName || '未命名使用者'}
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] truncate mt-0.5">
                        {user.email || '未綁定 Email'}
                      </div>
                      {typeof remaining === 'number' && (
                        <div className="flex items-center gap-1 mt-2 text-xs text-[var(--accent)]">
                          <Zap className="w-3.5 h-3.5" />
                          {dict.common.quotaRemaining}{remaining}
                        </div>
                      )}
                    </div>
                    <Link
                      href={localizePath(locale, '/analyze')}
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition"
                    >
                      <User className="w-4 h-4" />
                      {dict.common.myAnalysis}
                    </Link>
                    {user.isAdmin && (
                      <Link
                        href={localizePath(locale, '/admin')}
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition"
                      >
                        <Zap className="w-4 h-4 text-[var(--accent)]" />
                        後台管理
                      </Link>
                    )}
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-white/5 transition"
                    >
                      <LogOut className="w-4 h-4" />
                      {dict.common.logout}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <Link
              href={localizePath(locale, '/login')}
              className="px-3 py-2 text-sm rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90 transition"
            >
              {dict.common.login}
            </Link>
          )}
          <button
            ref={hamburgerRef}
            type="button"
            onClick={() => (drawerOpen ? closeDrawer() : setDrawerOpen(true))}
            className="md:hidden p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition"
            aria-expanded={drawerOpen}
            aria-controls="mobile-nav-drawer"
            aria-label={drawerOpen ? hamburgerLabels[locale].close : hamburgerLabels[locale].open}
          >
            {drawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </header>
    {drawerOpen && (
      <div className="md:hidden">
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={closeDrawer}
          aria-hidden="true"
        />
        <aside
          id="mobile-nav-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={hamburgerLabels[locale].close}
          className="fixed inset-y-0 right-0 z-50 flex h-dvh w-72 max-w-[85vw] flex-col bg-[var(--bg-card)] border-l border-white/10 shadow-xl"
        >
          <div className="flex items-center justify-between px-4 h-14 shrink-0 border-b border-white/5">
            <span className="text-base font-bold tracking-tight">Vestential</span>
            <button
              type="button"
              onClick={closeDrawer}
              className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition"
              aria-label={hamburgerLabels[locale].close}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <nav className="flex flex-col gap-1 p-3 overflow-y-auto" aria-label="主導覽">
            {navItems.map((item) => {
              const isActive = isActiveLink(item.href)
              return (
                <Link
                  key={item.href}
                  href={localizePath(locale, item.href)}
                  onClick={() => setDrawerOpen(false)}
                  className={`block px-3 py-2.5 text-sm rounded-lg transition break-words leading-snug ${
                    isActive
                      ? 'text-[var(--text-primary)] bg-white/10'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
                  }`}
                >
                  {dict.nav[item.key]}
                </Link>
              )
            })}
          </nav>
          <div className="mt-auto shrink-0 border-t border-white/5 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
            <LanguageSwitcher />
            </div>
            {user ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 px-1 py-1 min-w-0">
                  {user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.avatarUrl}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover shrink-0"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="w-8 h-8 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] flex items-center justify-center text-xs font-bold shrink-0">
                      {(user.displayName || user.email || 'U').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {user.displayName || '未命名使用者'}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] truncate">
                      {user.email || '未綁定 Email'}
                    </div>
                  </div>
                </div>
                {typeof remaining === 'number' && (
                  <div className="flex items-center gap-1 px-1 text-xs text-[var(--accent)]">
                    <Zap className="w-3.5 h-3.5" />
                    {dict.common.quotaRemaining}{remaining}
                  </div>
                )}
                <Link
                  href={localizePath(locale, '/analyze')}
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 text-sm rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition"
                >
                  <User className="w-4 h-4" />
                  {dict.common.myAnalysis}
                </Link>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm rounded-lg text-red-400 hover:bg-white/5 transition"
                >
                  <LogOut className="w-4 h-4" />
                  {dict.common.logout}
                </button>
              </div>
            ) : (
              <Link
                href={localizePath(locale, '/login')}
                onClick={() => setDrawerOpen(false)}
                className="block w-full text-center px-3 py-2.5 text-sm rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90 transition"
              >
                {dict.common.login}
              </Link>
            )}
          </div>
        </aside>
      </div>
    )}
    </>
  )
}
