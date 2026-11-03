'use client'

import Link from 'next/link'
import { useI18n } from '@/i18n/LanguageProvider'
import { localizePath } from '@/i18n/paths'

/**
 * 工具頁回程連結：「← 股票工作台」→ /workspace（帶語系前綴）。
 * #126：導覽收掉 5 個工具入口後，站內回程靠這個連結與瀏覽器上一頁。
 * 文字已含箭頭，因此不再放 icon；`aria-label` 與可見文字一致，鍵盤可聚焦且有 focus ring。
 */
export function WorkspaceBackLink({ className = '' }: { className?: string }) {
  const { dict, locale } = useI18n()
  const label = dict.workspace.backToWorkspace
  return (
    <Link
      href={localizePath(locale, '/workspace')}
      aria-label={label}
      className={`inline-flex items-center text-sm text-[var(--text-secondary)] hover:text-[var(--accent)] rounded-lg transition focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2 ${className}`}
    >
      {label}
    </Link>
  )
}
