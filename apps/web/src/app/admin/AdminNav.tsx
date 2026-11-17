'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/admin', label: '總覽', icon: '◈' },
  { href: '/admin/market-focus', label: '市場焦點', icon: '✦' },
  { href: '/admin/cycle-entry', label: '週期進場', icon: '⌁' },
  { href: '/admin/social', label: '社群小編', icon: '❖' },
  { href: '/admin/subscribers', label: '訂閱名單', icon: '✉' },
  { href: '/admin/arena', label: '競技場', icon: '⚔' },
  { href: '/admin/usage', label: '用量報表', icon: '▤' },
  { href: '/admin/llm-usage', label: 'LLM 用量', icon: '∑' },
  { href: '/admin/errors', label: '錯誤日誌', icon: '⚠' },
  { href: '/admin/settings', label: 'Agent 設定', icon: '⚙' },
]

export function AdminNav() {
  const pathname = usePathname()
  return (
    <>
      {/* 桌面：固定左側深色側欄 */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col bg-[#0d1117] border-r border-white/5 px-4 py-6 z-30">
        <Link href="/admin" className="px-2 mb-6 text-lg font-bold text-[var(--text-primary)]">
          Vestential <span className="text-[var(--accent)]">Admin</span>
        </Link>
        <nav aria-label="後台導覽" className="space-y-1">
          {LINKS.map((l) => {
            const active = l.href === '/admin' ? pathname === '/admin' : pathname.startsWith(l.href)
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                  active ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-medium' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
                }`}
              >
                <span aria-hidden>{l.icon}</span>
                {l.label}
              </Link>
            )
          })}
        </nav>
        <a href="/" className="mt-auto px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)]">
          ← 回前台
        </a>
      </aside>

      {/* 行動版：頂部橫幅導覽 */}
      <div className="lg:hidden sticky top-0 z-30 bg-[#0d1117]/95 backdrop-blur border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/admin" className="font-bold text-[var(--text-primary)]">
            Vestential <span className="text-[var(--accent)]">Admin</span>
          </Link>
          <a href="/" className="text-xs text-[var(--text-secondary)]">← 前台</a>
        </div>
        <nav aria-label="後台導覽" className="flex gap-1 overflow-x-auto px-3 pb-3">
          {LINKS.map((l) => {
            const active = l.href === '/admin' ? pathname === '/admin' : pathname.startsWith(l.href)
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition ${
                  active ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-medium' : 'text-[var(--text-secondary)] bg-white/5'
                }`}
              >
                {l.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </>
  )
}