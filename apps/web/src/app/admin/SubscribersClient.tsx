'use client'

import { useEffect, useState } from 'react'
import { btnGhost, Card, getJson, post, ResultBanner, SectionPageWrapper, type Result } from './_components'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'

interface Subscriber {
  id: number
  email: string
  status: string
  created_at: string
  updated_at: string
  unsubscribed_at: string | null
}

interface Stats {
  total: number
  active: number
  pending: number
  unsubscribed: number
}

type ListResponse = { success?: boolean; subscribers?: Subscriber[]; stats?: Stats; error?: string }

function fmt(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('zh-TW') + ' ' + d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
}

export function SubscribersClient() {
  const [rows, setRows] = useState<Subscriber[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, pending: 0, unsubscribed: 0 })
  const [result, setResult] = useState<Result>(null)
  const [busy, setBusy] = useState(false)
  const typo = useTableTypography()

  const refresh = async () => {
    const r = await getJson('/api/admin/subscribers')
    if (r.ok && (r.body as ListResponse).success) {
      const b = r.body as ListResponse
      setRows(b.subscribers ?? [])
      setStats(b.stats ?? { total: 0, active: 0, pending: 0, unsubscribed: 0 })
    } else {
      setResult({ ok: false, message: (r.body as ListResponse)?.error ?? '載入失敗' })
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const act = async (action: 'cancel' | 'restore' | 'delete', sub: Subscriber) => {
    setBusy(true)
    const r = await post('/api/admin/subscribers', { action, id: sub.id })
    setBusy(false)
    if (r.ok && (r.body as ListResponse).success) {
      const b = r.body as ListResponse
      setRows(b.subscribers ?? [])
      setStats(b.stats ?? { total: 0, active: 0, pending: 0, unsubscribed: 0 })
      const label = action === 'delete' ? '已刪除' : action === 'restore' ? '已核准/恢復訂閱' : '已取消訂閱'
      setResult({ ok: true, message: `${sub.email} ${label}` })
    } else {
      setResult({ ok: false, message: (r.body as ListResponse)?.error ?? '操作失敗' })
    }
  }

  return (
    <SectionPageWrapper title="訂閱名單" subtitle="市場焦點電子報的訂閱者管理：查看、核准待驗證、取消訂閱、恢復或刪除。" >
      <ResultBanner result={result} onDismiss={() => setResult(null)} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card title="總訂閱">
          <p className="text-3xl font-bold text-[var(--text-primary)]">{stats.total}</p>
        </Card>
        <Card title="有效訂閱">
          <p className="text-3xl font-bold text-[var(--accent-green)]">{stats.active}</p>
        </Card>
        <Card title="待驗證">
          <p className="text-3xl font-bold text-amber-300">{stats.pending}</p>
        </Card>
        <Card title="已退訂">
          <p className="text-3xl font-bold text-[var(--text-secondary)]">{stats.unsubscribed}</p>
        </Card>
      </div>
      <Card title="名單">
        <div className="overflow-x-auto">
          <table className={tableClass(typo, 'w-full')}>
            <thead>
              <tr className={headTrClass(typo, 'text-left text-[var(--text-secondary)] uppercase tracking-wide')}>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">狀態</th>
                <th className="py-2 pr-4">訂閱時間</th>
                <th className="py-2 pr-4">退訂時間</th>
                <th className="py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-[var(--text-secondary)]">尚無訂閱者。</td>
                </tr>
              ) : (
                rows.map((s) => (
                  <tr key={s.id} className="border-t border-white/5">
                    <td className="py-2 pr-4 text-[var(--text-primary)]">{s.email}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          s.status === 'active'
                            ? 'bg-[var(--accent-green)]/10 text-[var(--accent-green)]'
                            : s.status === 'pending'
                              ? 'bg-amber-400/10 text-amber-300'
                              : 'bg-[var(--accent-red)]/10 text-[var(--accent-red)]'
                        }`}
                      >
                        {s.status === 'active' ? '訂閱中' : s.status === 'pending' ? '待驗證' : '已退訂'}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">{fmt(s.created_at)}</td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">{fmt(s.unsubscribed_at)}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {s.status === 'active' ? (
                        <button className={btnGhost} disabled={busy} onClick={() => act('cancel', s)}>
                          取消訂閱
                        </button>
                      ) : (
                        <button className={btnGhost} disabled={busy} onClick={() => act('restore', s)}>
                          {s.status === 'pending' ? '核准' : '恢復訂閱'}
                        </button>
                      )}
                      <button className={`${btnGhost} ml-2 hover:!border-[var(--accent-red)] hover:!text-[var(--accent-red)]`} disabled={busy} onClick={() => act('delete', s)}>
                        刪除
                      </button>
                    </td>
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