'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, getJson, SectionPageWrapper } from './_components'

interface AgentReport {
  agent: string
  callCount: number
  models: Record<string, number>
  fallbackCalls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

interface LlmReport {
  from: string
  to: string
  agents: AgentReport[]
  total: {
    callCount: number
    fallbackCalls: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

interface DailyAgentRow {
  agent: string
  callCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

interface DailyDay {
  date: string
  agents: DailyAgentRow[]
  total: { callCount: number; promptTokens: number; completionTokens: number; totalTokens: number }
}

interface DailyReport {
  from: string
  to: string
  days: DailyDay[]
  grandTotal: { callCount: number; promptTokens: number; completionTokens: number; totalTokens: number }
}

interface MinuteBucket {
  minute: string
  totalTokens: number
  callCount: number
  overThreshold: boolean
}

interface MinuteReport {
  day: string
  otpmLimit: number
  alertThreshold: number
  estimated: boolean
  buckets: MinuteBucket[]
  peak: MinuteBucket | null
  overMinutes: string[]
}

function todayStr(): string {
  const now = new Date(Date.now() + 8 * 3600 * 1000)
  return now.toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number): string {
  // 台北午夜瞬時＋整日遞進，再還原台北日曆日（直接取 UTC 分量會差一天）。
  const ms = new Date(`${dateStr}T00:00:00+08:00`).getTime() + days * 86_400_000
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

const PRESETS: Array<{ label: string; from: string | null; to: string | null }> = [
  { label: '今日', from: null, to: null },
  { label: '近 7 天', from: null, to: null },
  { label: '近 30 天', from: null, to: null },
]

/** 日報明細分頁大小（前端分頁；後端單次最多讀 20000 筆原始記錄）。 */
const DAILY_PAGE_SIZE = 50
/** 分鐘級最多渲染列數（分鐘只保留有呼叫者，實務遠小於此）。 */
const MINUTE_RENDER_LIMIT = 500

export function LlmUsageClient() {
  const [from, setFrom] = useState(() => todayStr())
  const [to, setTo] = useState(() => todayStr())
  const [report, setReport] = useState<LlmReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const applyPreset = useCallback((label: string) => {
    const today = todayStr()
    const from = label === '今日' ? today : label === '近 7 天' ? addDays(today, -6) : addDays(today, -29)
    setFrom(from)
    setTo(today)
  }, [])

  const load = useCallback(async (fromDate: string, toDate: string) => {
    setLoading(true)
    setError('')
    try {
      const q = new URLSearchParams()
      if (fromDate) q.set('from', fromDate)
      if (toDate) q.set('to', toDate)
      const r = await getJson(`/api/admin/llm-usage?${q.toString()}`)
      if (r.ok && r.body && r.body.success) {
        setReport(r.body as LlmReport)
      } else {
        setReport(null)
        setError(r.body?.error ?? '載入失敗')
      }
    } catch (e: any) {
      setReport(null)
      setError(e?.message ?? '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(from, to)
  }, [load, from, to])

  // ── #45 日報表＋分鐘級 OTPM（既有 summary 區段不動，之下擴充） ──
  const [daily, setDaily] = useState<DailyReport | null>(null)
  const [dailyError, setDailyError] = useState('')
  const [dailyLoading, setDailyLoading] = useState(false)
  const [dailyPage, setDailyPage] = useState(0)
  const [trend, setTrend] = useState<DailyReport | null>(null)
  const [minuteDay, setMinuteDay] = useState(() => todayStr())
  const [minute, setMinute] = useState<MinuteReport | null>(null)
  const [minuteError, setMinuteError] = useState('')
  const [minuteLoading, setMinuteLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setDailyLoading(true)
    setDailyError('')
    setDailyPage(0)
    const q = new URLSearchParams({ view: 'daily', from, to })
    getJson(`/api/admin/llm-usage?${q.toString()}`).then((r) => {
      if (!alive) return
      setDailyLoading(false)
      if (r.ok && r.body && r.body.success) setDaily(r.body as DailyReport)
      else {
        setDaily(null)
        setDailyError(r.body?.error ?? '日報載入失敗')
      }
    })
    return () => {
      alive = false
    }
  }, [from, to])

  useEffect(() => {
    let alive = true
    const today = todayStr()
    const q = new URLSearchParams({ view: 'daily', from: addDays(today, -6), to: today })
    getJson(`/api/admin/llm-usage?${q.toString()}`).then((r) => {
      if (!alive) return
      if (r.ok && r.body && r.body.success) setTrend(r.body as DailyReport)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    setMinuteLoading(true)
    setMinuteError('')
    const q = new URLSearchParams({ view: 'minute', day: minuteDay })
    getJson(`/api/admin/llm-usage?${q.toString()}`).then((r) => {
      if (!alive) return
      setMinuteLoading(false)
      if (r.ok && r.body && r.body.success) setMinute(r.body as MinuteReport)
      else {
        setMinute(null)
        setMinuteError(r.body?.error ?? '分鐘級載入失敗')
      }
    })
    return () => {
      alive = false
    }
  }, [minuteDay])

  const dailyRows = (daily?.days ?? []).flatMap((d) =>
    d.agents.map((a) => ({ date: d.date, ...a })),
  )
  const trendMax = Math.max(0, ...(trend?.days.map((d) => d.total.totalTokens) ?? [0]))
  const minuteShown = (minute?.buckets ?? []).slice(0, MINUTE_RENDER_LIMIT)
  const minuteTruncated = (minute?.buckets.length ?? 0) > MINUTE_RENDER_LIMIT

  const total = report?.total
  const fallbackRatio = total && total.callCount > 0 ? Math.round((total.fallbackCalls / total.callCount) * 100) : 0

  return (
    <SectionPageWrapper
      title="LLM 用量報表"
      subtitle="各 LLM Agent 的呼叫次數、實際服務模型與 token 消耗。Arena 八大 agent 與市場焦點／社群路徑的每次成功 LLM 呼叫皆會記錄。"
    >
      <Card title="期間篩選">
        <div className="flex flex-wrap items-end gap-3">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.label)}
              className="px-3 py-1.5 text-sm rounded-lg border border-white/10 text-[var(--text-secondary)] hover:border-[var(--accent)]/50 hover:text-[var(--text-primary)] transition"
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-2 text-sm">
            <label className="text-[var(--text-secondary)]">從</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[var(--text-primary)]"
            />
            <label className="text-[var(--text-secondary)]">至</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[var(--text-primary)]"
            />
          </div>
        </div>
      </Card>

      {total && (
        <Card title="期間總計">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-[var(--text-secondary)]">呼叫次數</div>
              <div className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{total.callCount}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-secondary)]">total tokens</div>
              <div className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{fmtTokens(total.totalTokens)}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-secondary)]">備援呼叫（non-primary）</div>
              <div className="mt-1 text-2xl font-bold text-[var(--text-primary)]">
                {total.fallbackCalls}
                <span className="ml-2 text-sm text-[var(--text-secondary)]">{fallbackRatio}%</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-secondary)]">Prompt / Completion</div>
              <div className="mt-1 text-2xl font-bold text-[var(--text-primary)]">
                {fmtTokens(total.promptTokens)}
                <span className="mx-1 text-sm text-[var(--text-secondary)]">/</span>
                {fmtTokens(total.completionTokens)}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card title="依 Agent 聚合">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-secondary)] uppercase tracking-wide">
                <th className="py-2 pr-4">Agent</th>
                <th className="py-2 pr-4 text-right">呼叫</th>
                <th className="py-2 pr-4">模型分佈</th>
                <th className="py-2 pr-4 text-right">Prompt</th>
                <th className="py-2 pr-4 text-right">Completion</th>
                <th className="py-2 text-right">合計</th>
              </tr>
            </thead>
            <tbody>
              {error ? (
                <tr>
                  <td colSpan={6} className="py-4 text-[var(--accent-red)]">{error}</td>
                </tr>
              ) : report === null && loading ? (
                <tr>
                  <td colSpan={6} className="py-4 text-[var(--text-secondary)]">載入中…</td>
                </tr>
              ) : !report || report.agents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-4 text-[var(--text-secondary)]">
                    此區間無 LLM 呼叫紀錄。Arena 分析或市場焦點排程執行後才會產生資料。
                  </td>
                </tr>
              ) : (
                report.agents.map((a) => (
                  <tr key={a.agent} className="border-t border-white/5">
                    <td className="py-2 pr-4">
                      <span className="text-[var(--text-primary)]">{a.agent}</span>
                      {a.fallbackCalls > 0 && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-[var(--accent)]/15 text-[var(--accent)]">備援</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right text-[var(--text-primary)]">{a.callCount}</td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(a.models).map(([model, count]) => (
                          <span key={model} className="px-1.5 py-0.5 rounded text-xs bg-white/5 text-[var(--text-secondary)]">
                            {model} ×{count}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-right">{fmtTokens(a.promptTokens)}</td>
                    <td className="py-2 pr-4 text-right">{fmtTokens(a.completionTokens)}</td>
                    <td className="py-2 text-right font-medium text-[var(--text-primary)]">{fmtTokens(a.totalTokens)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="每日明細（per-agent × 日）">
        <p className="mb-3 text-xs text-[var(--text-secondary)]">
          日界為 Asia/Taipei；跟隨上方期間篩選。後端區間上限 31 天、單次最多讀取 20000 筆原始記錄（超過請縮小範圍）。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-secondary)] uppercase tracking-wide">
                <th className="py-2 pr-4">日期</th>
                <th className="py-2 pr-4">Agent</th>
                <th className="py-2 pr-4 text-right">呼叫</th>
                <th className="py-2 pr-4 text-right">Prompt（in）</th>
                <th className="py-2 pr-4 text-right">Completion（out）</th>
                <th className="py-2 text-right">合計</th>
              </tr>
            </thead>
            <tbody>
              {dailyError ? (
                <tr>
                  <td colSpan={6} className="py-4 text-[var(--accent-red)]">{dailyError}</td>
                </tr>
              ) : daily === null && dailyLoading ? (
                <tr>
                  <td colSpan={6} className="py-4 text-[var(--text-secondary)]">載入中…</td>
                </tr>
              ) : dailyRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-4 text-[var(--text-secondary)]">此區間無 LLM 呼叫紀錄。</td>
                </tr>
              ) : (
                dailyRows
                  .slice(dailyPage * DAILY_PAGE_SIZE, (dailyPage + 1) * DAILY_PAGE_SIZE)
                  .map((r) => (
                    <tr key={`${r.date}|${r.agent}`} className="border-t border-white/5">
                      <td className="py-2 pr-4 text-[var(--text-secondary)]">{r.date}</td>
                      <td className="py-2 pr-4 text-[var(--text-primary)]">{r.agent}</td>
                      <td className="py-2 pr-4 text-right">{r.callCount}</td>
                      <td className="py-2 pr-4 text-right">{r.promptTokens.toLocaleString('zh-TW')}</td>
                      <td className="py-2 pr-4 text-right">{r.completionTokens.toLocaleString('zh-TW')}</td>
                      <td className="py-2 text-right font-medium text-[var(--text-primary)]">{r.totalTokens.toLocaleString('zh-TW')}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
        {dailyRows.length > DAILY_PAGE_SIZE && (
          <div className="mt-3 flex items-center gap-3 text-sm text-[var(--text-secondary)]">
            <button
              onClick={() => setDailyPage((p) => Math.max(0, p - 1))}
              disabled={dailyPage === 0}
              className="px-3 py-1 rounded-lg border border-white/10 disabled:opacity-40"
            >
              上一頁
            </button>
            <span>
              第 {dailyPage + 1}／{Math.ceil(dailyRows.length / DAILY_PAGE_SIZE)} 頁（共 {dailyRows.length} 列）
            </span>
            <button
              onClick={() => setDailyPage((p) => Math.min(Math.ceil(dailyRows.length / DAILY_PAGE_SIZE) - 1, p + 1))}
              disabled={(dailyPage + 1) * DAILY_PAGE_SIZE >= dailyRows.length}
              className="px-3 py-1 rounded-lg border border-white/10 disabled:opacity-40"
            >
              下一頁
            </button>
          </div>
        )}
      </Card>

      <Card title="近 7 日趨勢">
        <p className="mb-3 text-xs text-[var(--text-secondary)]">每日 total tokens（Asia/Taipei 日界）。</p>
        {!trend ? (
          <div className="py-4 text-sm text-[var(--text-secondary)]">載入中…</div>
        ) : (
          <div className="space-y-2">
            {trend.days.map((d) => (
              <div key={d.date} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-[var(--text-secondary)]">{d.date}</span>
                <div className="h-4 flex-1 rounded bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded bg-[var(--accent)]/70"
                    style={{ width: `${trendMax > 0 ? Math.max(d.total.totalTokens > 0 ? 2 : 0, (d.total.totalTokens / trendMax) * 100) : 0}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-[var(--text-primary)]">{fmtTokens(d.total.totalTokens)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="分鐘級 OTPM（估算）">
        <p className="mb-3 text-xs text-[var(--text-secondary)]">
          以 llm_usage_logs 時間戳還原每分鐘用量，對照 Groq qwen OTPM 上限 1000。分鐘級數字為估算值、非帳單精確值，驗收以形狀／趨勢為準。
          只列出有呼叫的分鐘。單分鐘用量＞800 標紅，並沿用 #24 告警通道發信（30 分鐘內同內容去重；無 cron，於本頁載入時觸發）。
        </p>
        <div className="mb-3 flex items-center gap-2 text-sm">
          <label className="text-[var(--text-secondary)]">日期</label>
          <input
            type="date"
            value={minuteDay}
            onChange={(e) => setMinuteDay(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[var(--text-primary)]"
          />
        </div>
        {minuteError ? (
          <div className="py-4 text-sm text-[var(--accent-red)]">{minuteError}</div>
        ) : minute === null && minuteLoading ? (
          <div className="py-4 text-sm text-[var(--text-secondary)]">載入中…</div>
        ) : !minute || minute.buckets.length === 0 ? (
          <div className="py-4 text-sm text-[var(--text-secondary)]">此日無 LLM 呼叫紀錄。</div>
        ) : (
          <>
            {(minute.overMinutes.length > 0) && (
              <div className="mb-3 px-3 py-2 rounded-lg text-sm bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/30">
                單分鐘用量超過 {minute.alertThreshold}（近上限 {minute.otpmLimit}）：{minute.overMinutes.join('、')}
                。已透過 #24 告警通道發信（30 分鐘內同內容去重）。
              </div>
            )}
            <div className="mb-3 text-sm text-[var(--text-secondary)]">
              尖峰：
              <span className={minute.peak && minute.peak.overThreshold ? 'text-[var(--accent-red)] font-bold' : 'text-[var(--text-primary)] font-medium'}>
                {minute.peak?.minute}（{minute.peak?.totalTokens.toLocaleString('zh-TW')} tokens／分鐘，上限 {minute.otpmLimit}）
              </span>
              ；共 {minute.buckets.length} 個有呼叫的分鐘
              {minuteTruncated && `（僅顯示前 ${MINUTE_RENDER_LIMIT} 列）`}。
            </div>
            <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1">
              {minuteShown.map((b) => (
                <div key={b.minute} className="flex items-center gap-3 text-sm">
                  <span className={`w-32 shrink-0 ${b.overThreshold ? 'text-[var(--accent-red)] font-medium' : 'text-[var(--text-secondary)]'}`}>
                    {b.minute.slice(11)}
                  </span>
                  <div className="h-3.5 flex-1 rounded bg-white/5 overflow-hidden">
                    <div
                      className={`h-full rounded ${b.overThreshold ? 'bg-[var(--accent-red)]' : 'bg-[var(--accent)]/60'}`}
                      style={{ width: `${Math.min(100, (b.totalTokens / minute.otpmLimit) * 100)}%` }}
                    />
                  </div>
                  <span className={`w-24 shrink-0 text-right ${b.overThreshold ? 'text-[var(--accent-red)] font-bold' : 'text-[var(--text-primary)]'}`}>
                    {b.totalTokens.toLocaleString('zh-TW')}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </SectionPageWrapper>
  )
}