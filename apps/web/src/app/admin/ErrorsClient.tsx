'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, getJson, SectionPageWrapper } from './_components'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'

interface ErrorLogRow {
  id: number
  category: 'ai_quota' | 'ai_error' | 'slow_api' | 'api_error' | 'rate_limit'
  route: string
  method: string
  status_code: number
  duration_ms: number
  actor_type: 'guest' | 'user'
  user_id: number | null
  user_email: string | null
  client_ip: string | null
  user_agent: string | null
  recovered: number
  error_message: string | null
  created_at: string
}

interface ErrorSummary {
  total: number
  aiQuota: number
  aiError: number
  slowApi: number
  apiError: number
  rateLimit: number
}

const CATEGORY_LABELS: Record<string, { label: string; cls: string }> = {
  ai_quota: { label: 'AI 額度用盡', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  ai_error: { label: 'AI 呼叫失敗', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  slow_api: { label: '慢 API', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  api_error: { label: '系統/資料錯誤', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
  rate_limit: { label: '站內限流', cls: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
}

export function ErrorsClient() {
  const [logs, setLogs] = useState<ErrorLogRow[]>([])
  const [summary, setSummary] = useState<ErrorSummary | null>(null)
  const [category, setCategory] = useState('all')
  const [actor, setActor] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const typo = useTableTypography()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const r = await getJson(`/api/admin/errors?category=${encodeURIComponent(category)}&actor=${encodeURIComponent(actor)}&limit=120`)
    setLoading(false)
    if (r.ok && r.body.success) {
      setLogs(r.body.logs ?? [])
      setSummary(r.body.summary ?? null)
    } else {
      setError(r.body?.error ?? '載入失敗')
    }
  }, [category, actor])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <SectionPageWrapper
      title="錯誤與慢 API 日誌"
      subtitle="追蹤 24 小時與歷史系統錯誤、慢回應（一般 ≥5s / AI分析 ≥25s）、上游 AI 額度耗盡與操作者身分（保留 30 天）。"
    >
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <div className="rounded-xl border border-white/10 bg-[#0d1117] p-3.5">
            <div className="text-xs text-[var(--text-secondary)]">24h 總事件</div>
            <div className="text-xl font-bold text-[var(--text-primary)] mt-1">{summary.total}</div>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5">
            <div className="text-xs text-amber-300">AI 額度用盡</div>
            <div className="text-xl font-bold text-amber-200 mt-1">{summary.aiQuota}</div>
          </div>
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3.5">
            <div className="text-xs text-sky-300">慢 API</div>
            <div className="text-xl font-bold text-sky-200 mt-1">{summary.slowApi}</div>
          </div>
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3.5">
            <div className="text-xs text-red-300">系統 / AI 錯誤</div>
            <div className="text-xl font-bold text-red-200 mt-1">{summary.apiError + summary.aiError}</div>
          </div>
          <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3.5">
            <div className="text-xs text-purple-300">站內限流 (429)</div>
            <div className="text-xl font-bold text-purple-200 mt-1">{summary.rateLimit}</div>
          </div>
        </div>
      )}

      <Card title="事件明細">
        <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-[var(--text-primary)]"
          >
            <option value="all">全部類型</option>
            <option value="ai_quota">AI 額度用盡</option>
            <option value="ai_error">AI 呼叫失敗</option>
            <option value="slow_api">慢 API</option>
            <option value="api_error">系統/資料錯誤</option>
            <option value="rate_limit">站內限流</option>
          </select>

          <select
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-[var(--text-primary)]"
          >
            <option value="all">全部操作者</option>
            <option value="user">已登入會員</option>
            <option value="guest">未登入訪客</option>
          </select>

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="ml-auto rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-[var(--text-primary)] transition"
          >
            {loading ? '載入中…' : '重新整理'}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className={tableClass(typo, 'w-full')}>
            <thead>
              <tr className={headTrClass(typo, 'text-left text-[var(--text-secondary)] uppercase tracking-wide')}>
                <th className="py-2 pr-3">時間</th>
                <th className="py-2 pr-3">類型</th>
                <th className="py-2 pr-3">操作者</th>
                <th className="py-2 pr-3">路由</th>
                <th className="py-2 pr-3 text-right">耗時</th>
                <th className="py-2 pr-3 text-right">狀態</th>
                <th className="py-2">錯誤訊息</th>
              </tr>
            </thead>
            <tbody>
              {error ? (
                <tr>
                  <td colSpan={7} className="py-4 text-[var(--accent-red)]">{error}</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-[var(--text-secondary)]">
                    {loading ? '載入中…' : '目前尚無符合條件的異常紀錄'}
                  </td>
                </tr>
              ) : (
                logs.map((row) => {
                  const badge = CATEGORY_LABELS[row.category] ?? { label: row.category, cls: 'bg-white/10 text-white border-white/20' }
                  return (
                    <tr key={row.id} className="border-t border-white/5 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap text-xs text-[var(--text-secondary)] font-mono">
                        {String(row.created_at).slice(0, 19).replace('T', ' ')}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded border text-[11px] font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                        {row.recovered ? (
                          <span className="ml-1 inline-block px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px]">
                            備援接手
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {row.actor_type === 'user' ? (
                          <div>
                            <div className="text-[var(--text-primary)] font-medium">
                              {row.user_email || `會員 #${row.user_id}`}
                            </div>
                            <div className="text-[10px] text-[var(--text-secondary)] font-mono">
                              {row.client_ip || ''} {row.user_agent ? `· ${row.user_agent}` : ''}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="text-[var(--text-secondary)]">未登入訪客</div>
                            <div className="text-[10px] text-[var(--text-secondary)] font-mono">
                              {row.client_ip || 'unknown'} {row.user_agent ? `· ${row.user_agent}` : ''}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs font-mono text-[var(--text-primary)] whitespace-nowrap">
                        <span className="text-[var(--text-secondary)] mr-1">{row.method}</span>
                        {row.route}
                      </td>
                      <td className="py-2 pr-3 text-right text-xs font-mono whitespace-nowrap">
                        {row.duration_ms >= 1000 ? `${(row.duration_ms / 1000).toFixed(1)}s` : `${row.duration_ms}ms`}
                      </td>
                      <td className="py-2 pr-3 text-right text-xs font-mono">{row.status_code}</td>
                      <td className="py-2 text-xs text-[var(--text-secondary)] max-w-md break-words">
                        {row.error_message || '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </SectionPageWrapper>
  )
}
