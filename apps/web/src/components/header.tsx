'use client'

import { ChevronDown, LogOut, User, Zap, Menu, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n/LanguageProvider'
import { localizePath } from '@/i18n/paths'
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher'
import type { Locale } from '@/i18n/config'

export interface HeaderUser {
  id: number
  displayName: string | null
  email: string | null
  avatarUrl: string | null
  isAdmin?: boolean
}

interface NavChildItem {
  href: string
  label: string
  desc: string
}

interface NavEntry {
  id: string
  label: string
  href?: string
  highlight?: boolean
  children?: NavChildItem[]
  matchPrefixes: string[]
}

const NAV_COPY: Record<Locale, NavEntry[]> = {
  'zh-TW': [
    {
      id: 'market-rhythm',
      label: '市場節奏',
      matchPrefixes: ['/market-level', '/cycle-entry', '/backtest'],
      children: [
        { href: '/market-level', label: '大盤水位與乖離率', desc: '加權指數歷史分位、五段燈號與底部雷達' },
        { href: '/cycle-entry', label: '今日週期進場候選', desc: '量化篩選低基期與技術面轉強候選標的' },
        { href: '/backtest', label: '策略回測實驗室', desc: '驗證歷年進出場勝率、報酬率與最大回撤' },
      ],
    },
    {
      id: 'stock-research',
      label: '個股研究',
      matchPrefixes: ['/analyze', '/odd-lot', '/workspace', '/chip-radar', '/daily-movers'],
      children: [
        { href: '/analyze', label: '12 AI 智能體個股分析', desc: '基本面、籌碼面與新聞多維度深度報告' },
        { href: '/odd-lot', label: '零股盤中即時情報', desc: '小資熱門零股排行與大戶／散戶價差監控' },
        { href: '/workspace', label: '全功能股票工作台', desc: '一覽所有量化研究、存股與回測工具箱' },
      ],
    },
    {
      id: 'portfolio',
      label: '投資組合 🔥',
      href: '/portfolio',
      highlight: true,
      matchPrefixes: ['/portfolio', '/cashflow-plan', '/ex-dividend', '/dividend-refill', '/gift-map'],
    },
    {
      id: 'agent-arena',
      label: 'AI 競技場',
      href: '/agent-arena',
      matchPrefixes: ['/agent-arena'],
    },
    {
      id: 'market-focus',
      label: '市場焦點',
      href: '/market-focus',
      matchPrefixes: ['/market-focus'],
    },
  ],
  en: [
    {
      id: 'market-rhythm',
      label: 'Market Rhythm',
      matchPrefixes: ['/market-level', '/cycle-entry', '/backtest'],
      children: [
        { href: '/market-level', label: 'Market Valuation Level', desc: 'TAIEX valuation percentiles & 5-stage gauge' },
        { href: '/cycle-entry', label: 'Cycle Entry Screener', desc: 'Daily quantitative cycle entry stock picks' },
        { href: '/backtest', label: 'Backtest Lab', desc: 'Verify historical win rate, CAGR & max drawdown' },
      ],
    },
    {
      id: 'stock-research',
      label: 'Stock Research',
      matchPrefixes: ['/analyze', '/odd-lot', '/workspace', '/chip-radar', '/daily-movers'],
      children: [
        { href: '/analyze', label: '12-Agent AI Stock Analysis', desc: 'Multi-agent fundamental, technical & news report' },
        { href: '/odd-lot', label: 'Odd-Lot Intraday Radar', desc: 'Most active odd-lot rankings & spread monitor' },
        { href: '/workspace', label: 'Full Stock Workspace', desc: 'All quantitative research & dividend tools' },
      ],
    },
    {
      id: 'portfolio',
      label: 'Portfolio P&L 🔥',
      href: '/portfolio',
      highlight: true,
      matchPrefixes: ['/portfolio', '/cashflow-plan', '/ex-dividend', '/dividend-refill', '/gift-map'],
    },
    {
      id: 'agent-arena',
      label: 'AI Arena',
      href: '/agent-arena',
      matchPrefixes: ['/agent-arena'],
    },
    {
      id: 'market-focus',
      label: 'Market Focus',
      href: '/market-focus',
      matchPrefixes: ['/market-focus'],
    },
  ],
  ja: [
    {
      id: 'market-rhythm',
      label: '市場リズム',
      matchPrefixes: ['/market-level', '/cycle-entry', '/backtest'],
      children: [
        { href: '/market-level', label: '市場水準・乖離率', desc: '台湾加権指数の水準判定とバリュエーション' },
        { href: '/cycle-entry', label: '周期エントリー候補', desc: '日次クオンツスクリーニング候補銘柄' },
        { href: '/backtest', label: 'バックテスト実験室', desc: '過去データによる勝率・リターン検証' },
      ],
    },
    {
      id: 'stock-research',
      label: '銘柄リサーチ',
      matchPrefixes: ['/analyze', '/odd-lot', '/workspace', '/chip-radar', '/daily-movers'],
      children: [
        { href: '/analyze', label: '12 AI 銘柄分析', desc: 'ファンダメンタル・需給・ニュースの多角的分析' },
        { href: '/odd-lot', label: '単元未満株（零股）情報', desc: '人気の少額投資ランキングと価格差モニター' },
        { href: '/workspace', label: '株式ワークスペース', desc: '全クオンツ・配当管理ツール一覧' },
      ],
    },
    {
      id: 'portfolio',
      label: 'ポートフォリオ 🔥',
      href: '/portfolio',
      highlight: true,
      matchPrefixes: ['/portfolio', '/cashflow-plan', '/ex-dividend', '/dividend-refill', '/gift-map'],
    },
    {
      id: 'agent-arena',
      label: 'AI アリーナ',
      href: '/agent-arena',
      matchPrefixes: ['/agent-arena'],
    },
    {
      id: 'market-focus',
      label: '市場フォーカス',
      href: '/market-focus',
      matchPrefixes: ['/market-focus'],
    },
  ],
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
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)
  const hamburgerRef = useRef<HTMLButtonElement>(null)

  const navEntries = NAV_COPY[locale] ?? NAV_COPY['zh-TW']
  const barePathname = pathname?.replace(/^\/(en|ja|zh-TW)(?=\/|$)/, '') || '/'

  const isEntryActive = (entry: NavEntry) =>
    entry.matchPrefixes.some(
      (prefix) => barePathname === prefix || barePathname.startsWith(`${prefix}/`),
    )

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setMenuOpen(false)
    setOpenDropdownId(null)
    hamburgerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const refreshQuota = () => {
      fetch('/api/auth/me')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
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

  useEffect(() => {
    if (!drawerOpen && !openDropdownId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (openDropdownId) setOpenDropdownId(null)
        if (drawerOpen) closeDrawer()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen, openDropdownId, closeDrawer])

  useEffect(() => {
    if (!drawerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [drawerOpen])

  useEffect(() => {
    setDrawerOpen(false)
    setOpenDropdownId(null)
  }, [pathname])

  return (
    <>
      <header className="sticky top-0 z-50 bg-[var(--bg-primary)]/85 backdrop-blur-md border-b border-white/5">
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
              {navEntries.map((entry) => {
                const isActive = isEntryActive(entry)
                if (entry.children && entry.children.length > 0) {
                  const isOpen = openDropdownId === entry.id
                  return (
                    <div
                      key={entry.id}
                      className="relative"
                      onMouseEnter={() => setOpenDropdownId(entry.id)}
                      onMouseLeave={() => setOpenDropdownId((prev) => (prev === entry.id ? null : prev))}
                    >
                      <button
                        type="button"
                        onClick={() => setOpenDropdownId(isOpen ? null : entry.id)}
                        aria-expanded={isOpen}
                        className={`inline-flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition cursor-pointer ${
                          isActive
                            ? 'text-[var(--text-primary)] bg-white/10 font-medium'
                            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
                        }`}
                      >
                        <span>{entry.label}</span>
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        />
                      </button>
                      {isOpen && (
                        <div className="absolute left-0 top-full pt-1.5 w-64 z-50">
                          <div className="rounded-xl border border-white/10 bg-[var(--bg-card)] shadow-2xl p-1.5 space-y-0.5">
                            {entry.children.map((child) => (
                              <Link
                                key={child.href}
                                href={localizePath(locale, child.href)}
                                onClick={() => setOpenDropdownId(null)}
                                className="block rounded-lg px-3 py-2 hover:bg-white/5 transition"
                              >
                                <div className="text-xs font-semibold text-[var(--text-primary)]">
                                  {child.label}
                                </div>
                                <div className="text-[11px] text-[var(--text-secondary)] mt-0.5 leading-snug">
                                  {child.desc}
                                </div>
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                }

                return (
                  <Link
                    key={entry.id}
                    href={localizePath(locale, entry.href!)}
                    className={`px-3 py-2 text-sm rounded-lg transition ${
                      entry.highlight
                        ? isActive
                          ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 font-semibold'
                          : 'text-emerald-300 hover:bg-emerald-500/15 font-medium'
                        : isActive
                          ? 'text-[var(--text-primary)] bg-white/10 font-medium'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
                    }`}
                  >
                    {entry.label}
                  </Link>
                )
              })}
            </nav>

            <div className="hidden md:block">
              <LanguageSwitcher />
            </div>

            {user ? (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((prev) => !prev)}
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
                          {user.displayName || (locale === 'en' ? 'Unnamed User' : locale === 'ja' ? '名称未設定' : '未命名使用者')}
                        </div>
                        <div className="text-xs text-[var(--text-secondary)] truncate mt-0.5">
                          {user.email || (locale === 'en' ? 'No Email Linked' : locale === 'ja' ? 'メール未連携' : '未綁定 Email')}
                        </div>
                        {typeof remaining === 'number' && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-[var(--accent)]">
                            <Zap className="w-3.5 h-3.5" />
                            {dict.common.quotaRemaining}
                            {remaining}
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
                          {locale === 'en' ? 'Admin Console' : locale === 'ja' ? '管理コンソール' : '後台管理'}
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
            <nav className="flex flex-col gap-2 p-3 overflow-y-auto" aria-label="主導覽">
              {navEntries.map((entry) => {
                if (entry.children && entry.children.length > 0) {
                  return (
                    <div key={entry.id} className="space-y-1">
                      <div className="px-3 py-1 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                        {entry.label}
                      </div>
                      {entry.children.map((child) => (
                        <Link
                          key={child.href}
                          href={localizePath(locale, child.href)}
                          onClick={() => setDrawerOpen(false)}
                          className="block px-3 py-2 text-sm rounded-lg text-[var(--text-primary)] hover:bg-white/5 transition"
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )
                }
                return (
                  <Link
                    key={entry.id}
                    href={localizePath(locale, entry.href!)}
                    onClick={() => setDrawerOpen(false)}
                    className={`block px-3 py-2.5 text-sm rounded-lg transition ${
                      entry.highlight
                        ? 'text-emerald-300 font-semibold bg-emerald-500/10 border border-emerald-500/30'
                        : 'text-[var(--text-primary)] hover:bg-white/5'
                    }`}
                  >
                    {entry.label}
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
                      {dict.common.quotaRemaining}
                      {remaining}
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
