'use client'

import { useEffect, useState } from 'react'
import { Card, getJson, Help, SectionPageWrapper } from './_components'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'

interface UsageUser {
  userId: number
  displayName: string | null
  email: string | null
  createdAt: string | null
  apiUsageCount: number
  recognitionCount: number
  arenaAgentCount: number
}

export function UsageClient() {
  const [users, setUsers] = useState<UsageUser[]>([])
  const [error, setError] = useState('')
  const typo = useTableTypography()

  useEffect(() => {
    let alive = true
    getJson('/api/admin/usage').then((r) => {
      if (!alive) return
      if (r.ok && r.body.success) setUsers(r.body.users ?? [])
      else setError(r.body?.error ?? '載入失敗')
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <SectionPageWrapper title="使用者用量報表" subtitle="各使用者的 API 呼叫與照片辨識次數。辨識＝照片辨識（OCR）。">
      <Card title="用量">
        <div className="overflow-x-auto">
          <table className={tableClass(typo, 'w-full')}>
            <thead>
              <tr className={headTrClass(typo, 'text-left text-[var(--text-secondary)] uppercase tracking-wide')}>
                <th className="py-2 pr-4">ID</th>
                <th className="py-2 pr-4">名稱</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4 text-right">API 次數</th>
                <th className="py-2 pr-4 text-right">
                  <span className="mr-2">辨識</span>
                  <Help text="照片辨識（OCR）：計算用戶上傳股東會紀念品／配股息照片並以 OCR 辨識成分股或息值的次數。" />
                </th>
                <th className="py-2 text-right">競技場 Agent</th>
              </tr>
            </thead>
            <tbody>
              {error ? (
                <tr>
                  <td colSpan={6} className="py-4 text-[var(--accent-red)]">{error}</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-4 text-[var(--text-secondary)]">載入中…</td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.userId} className="border-t border-white/5">
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">{u.userId}</td>
                    <td className="py-2 pr-4 text-[var(--text-primary)]">{u.displayName ?? '—'}</td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">{u.email ?? '—'}</td>
                    <td className="py-2 pr-4 text-right">{u.apiUsageCount}</td>
                    <td className="py-2 pr-4 text-right">{u.recognitionCount}</td>
                    <td className="py-2 text-right">{u.arenaAgentCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </SectionPageWrapper>
  )
}