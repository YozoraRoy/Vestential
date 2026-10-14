'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  btn,
  btnGhost,
  Card,
  getJson,
  Help,
  input,
  money,
  pct,
  post,
  ResultBanner,
  SectionPageWrapper,
  type Result,
} from './_components'
import { MarkdownText } from '@/components/markdown-text'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'

// ── 型別 ───────────────────────────────────────────────────────────
interface ProgressData {
  success: boolean
  roundDate?: string
  season?: { id: number; name?: string } | null
  progress?: Array<{ phase: string; note: string | null; created_at: string | null }>
  leaderboard?: Array<{ agent_id: number; agent_name: string; owner_name: string | null; equity: number; return_pct: number; round_date: string | null; rounds: number }>
}

interface ArenaAgent {
  id: number
  name: string
  division: string
  strategyId: string
  strategyNameZh: string
  tone: string
  toneName: string
  personality: string
  strategyParams: Record<string, unknown> | null
  initialCapital: number
  cash: number
  equity: number
  returnPct: number | null
  rounds: number
  isSystem: boolean
  status: string
  lastRoundDate: string | null
  joinedAt: string | null
  holdings: Array<{ symbol: string; name: string | null; shares: number; avgCost: number }>
}

interface RoundData {
  success: boolean
  roundDate: string
  briefing: { content: string; model: string | null; fallbackUsed: boolean } | null
  discussion: { content: string; model: string | null; fallbackUsed: boolean } | null
  universe: Array<{ symbol: string; name: string | null }>
  intraday: Record<number, { timeLabel: string | null; rows: Array<{ symbol: string; price: number; changePct: number | null }> }>
  standings: Array<{ agentId: number; agentName: string; strategyId: string; tone: string; equity: number; cash: number; returnPct: number | null; roundDate: string | null; rounds: number }>
  equitySeries: Record<number, Array<{ roundDate: string; cash: number; equity: number; returnPct: number }>>
}

interface RoundDecision {
  id: number
  phase: string
  phaseName: string
  slot: number | null
  content: string
  model: string | null
  fallbackUsed: boolean
  createdAt: string | null
}

interface AgentHistoryDetail {
  roundDate: string
  logs: RoundDecision[]
  trades: Array<{
    id: number
    agentId: number
    slot: number | null
    action: string
    symbol: string | null
    symbolName: string | null
    shares: number | null
    price: number | null
    fee: number | null
    tax: number | null
    reason: string | null
    model: string | null
    fallbackUsed: boolean
    error: string | null
  }>
  loading: boolean
  error: string | null
}

const PHASE_HELP: Record<string, string> = {
  premarket: '晨間執行一次：建立今日股票池＋產出市場簡報與各 agent 盤前計畫。',
  slot: '盤中四個時點各決策一次（09:30 / 10:30 / 11:30 / 12:30-13:25），以當下即時價決定買賣。',
  close: '收盤後結算：寫入權益快照（equity／報酬率）並產出收後自評與圓桌討論。',
}

export function ArenaClient() {
  const [result, setResult] = useState<Result>(null)
  const [progress, setProgress] = useState<ProgressData | null>(null)
  const [agents, setAgents] = useState<ArenaAgent[]>([])
  const [personalityPresets, setPersonalityPresets] = useState<Array<{ id: string; nameZh: string; trait: string }>>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<number, { personality: string }>>({})
  const [saveId, setSaveId] = useState<number | null>(null)

  const [roundDate, setRoundDate] = useState<string>('')
  const [round, setRound] = useState<RoundData | null>(null)
  const [agentDetail, setAgentDetail] = useState<Record<number, AgentHistoryDetail>>({})
  const [openHistory, setOpenHistory] = useState<Record<number, boolean>>({})
  const typo = useTableTypography()

interface LeaderRow {
  agent_id: number
  agent_name: string
  owner_name: string | null
  equity: number
  return_pct: number | null
  round_date: string | null
  rounds: number
}

const lbById = useMemo(() => {
  const m = new Map<number, LeaderRow>()
  for (const a of progress?.leaderboard ?? []) m.set(a.agent_id, a)
  return m
}, [progress])

  const activeDate = roundDate || progress?.roundDate || ''

  const loadRound = async (rd: string) => {
    const r = await getJson(`/api/admin/arena/round?round_date=${encodeURIComponent(rd)}`)
    if (r.ok && r.body.success) setRound(r.body)
  }

  const loadAgentHistory = async (agentId: number) => {
    const rd = activeDate
    if (!rd) return
    setAgentDetail((d) => ({ ...d, [agentId]: { roundDate: rd, logs: d[agentId]?.logs ?? [], trades: d[agentId]?.trades ?? [], loading: true, error: null } }))
    const r = await getJson(`/api/admin/arena/decisions?round_date=${encodeURIComponent(rd)}&agent_id=${agentId}`)
    if (r.ok && r.body.success) {
      setAgentDetail((d) => ({
        ...d,
        [agentId]: { roundDate: rd, logs: r.body.perAgent?.[agentId] ?? [], trades: r.body.trades ?? [], loading: false, error: null },
      }))
    } else {
      setAgentDetail((d) => ({
        ...d,
        [agentId]: { ...(d[agentId] ?? { roundDate: rd, logs: [], trades: [] }), loading: false, error: r.body?.error ?? '載入失敗' },
      }))
    }
  }

  const load = async (rd?: string) => {
    const date = rd ?? roundDate
    const [p, g] = await Promise.all([
      getJson('/api/admin/arena/progress'),
      getJson('/api/admin/arena/agents'),
    ])
    if (p.ok && p.body.success) {
      setProgress(p.body)
      if (!date) setRoundDate(p.body.roundDate ?? '')
    }
    if (g.ok && g.body.success) {
      setAgents(g.body.agents ?? [])
      if (Array.isArray(g.body.personalityPresets) && g.body.personalityPresets.length > 0) setPersonalityPresets(g.body.personalityPresets)
    }
    if (date) loadRound(date)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickRound = async (rd: string) => {
    setRoundDate(rd)
    setRound(null)
    setOpenHistory({})
    setAgentDetail({})
    loadRound(rd)
  }

  const run = async (phase: 'premarket' | 'slot' | 'close', slot?: number, force = false) => {
    const label = `${phase}${slot != null ? ` slot${slot}` : ''}`
    setBusy(`${phase}${slot ?? ''}`)
    try {
      const r = await post('/api/admin/arena/tick', { phase, slot, force })
      if (!r.ok || !r.body?.success || !r.body?.jobId) {
        setResult({ ok: false, message: `${label} 失敗：${r.body?.error ?? '無法建立 job'}` })
        return
      }
      const jobId = r.body.jobId
      const phaseKey = r.body.phase ?? phase
      setResult({ ok: true, message: `${phaseKey} 已啟動（job #${jobId}），執行中…` })

      // 輪詢 status：三態分流；job 層去重回傳同一 jobId，不會並發。
      let final: { status?: string; result?: any; error?: string } | null = null
      for (let i = 0; i < 150; i++) {
        await new Promise((res) => setTimeout(res, 10_000))
        const s = await getJson(`/api/agent-arena/tick/status?jobId=${jobId}`)
        if (s.ok && s.body?.status) {
          if (s.body.status === 'done' || s.body.status === 'failed') {
            final = s.body
            break
          }
        }
      }
      if (!final) {
        setResult({ ok: false, message: `${phaseKey} 逾時（job #${jobId} 超過輪詢上限），請稍後以狀態頁確認` })
      } else if (final.status === 'done') {
        const res = final.result ?? {}
        setResult({
          ok: true,
          message: `${phaseKey} 完成：processed=${res.processed ?? 0} trades=${res.trades ?? 0} errors=${JSON.stringify(res.errors ?? [])}${res.alreadyRun ? '（已跑過）' : ''}`,
        })
      } else {
        setResult({ ok: false, message: `${phaseKey} 失敗：${final.error ?? '未知錯誤'}` })
      }
    } catch (e) {
      setResult({ ok: false, message: `${label} 失敗：${e instanceof Error ? e.message : '發生錯誤'}` })
    } finally {
      setBusy(null)
    }
    setOpenHistory({})
    setAgentDetail({})
    await load(roundDate || undefined)
  }

  const saveAgent = async (id: number) => {
    setSaveId(id)
    const personality = edits[id]?.personality ?? ''
    const r = await post('/api/admin/arena/agents', { id, personality })
    setSaveId(null)
    setResult(r.ok && r.body.success ? { ok: true, message: `已更新 agent #${id}` } : { ok: false, message: `更新失敗：${r.body?.error ?? ''}` })
    const g = await getJson('/api/admin/arena/agents')
    if (g.ok && g.body.success) {
      setAgents(g.body.agents ?? [])
      if (Array.isArray(g.body.personalityPresets) && g.body.personalityPresets.length > 0) setPersonalityPresets(g.body.personalityPresets)
    }
  }

  return (
    <SectionPageWrapper title="競技場管理" subtitle="依序執行 盤前 → 盤中四次 → 收盤結算；每 agent 可看決策歷程與權益">
      <ResultBanner result={result} onDismiss={() => setResult(null)} />

      <Card title="當前輪次">
        <p className="text-sm text-[var(--text-secondary)] mb-4">
          輪次 <code className="text-[var(--accent)]">{progress?.roundDate ?? '—'}</code>
          {progress?.season?.name ? `・${progress.season.name}` : ''}
        </p>
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-2">
          <div className="flex flex-wrap gap-2">
            <button className={btn} onClick={() => run('premarket')} disabled={!!busy}>
              跑 Pre-market
            </button>
            {[0, 1, 2, 3].map((s) => (
              <button key={s} className={btnGhost} onClick={() => run('slot', s)} disabled={!!busy}>
                Slot {s}
              </button>
            ))}
            <button className={btnGhost} onClick={() => run('close')} disabled={!!busy}>
              收盤結算
            </button>
          </div>
          <div className="flex items-center gap-1">
            <Help text={`${PHASE_HELP.premarket}\n\n${PHASE_HELP.slot}\n\n${PHASE_HELP.close}`} />
          </div>
        </div>

        <div className="mt-5">
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2 uppercase tracking-wide">階段進度</h3>
          {(progress?.progress?.length ?? 0) === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">今日無階段完成紀錄</p>
          ) : (
            <ul className="text-sm space-y-1">
              {progress!.progress!.map((p) => (
                <li key={p.phase}>
                  <code className="text-[var(--accent)]">{p.phase}</code>{' '}
                  <span className="text-[var(--text-secondary)]">— {p.note ?? ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5">
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2 uppercase tracking-wide">排行榜（最新輪次）</h3>
          <div className="overflow-x-auto">
            <table className={tableClass(typo, 'w-full')}>
              <thead>
                <tr className={headTrClass(typo, 'text-left text-[var(--text-secondary)] uppercase tracking-wide')}>
                  <th className="py-2 pr-4">Agent</th>
                  <th className="py-2 pr-4">擁有者</th>
                  <th className="py-2 pr-4 text-right">權益</th>
                  <th className="py-2 text-right">報酬率</th>
                </tr>
              </thead>
              <tbody>
                {(progress?.leaderboard?.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-[var(--text-secondary)]">尚無資料</td>
                  </tr>
                ) : (
                  progress!.leaderboard!.map((a) => (
                    <tr key={a.agent_id} className="border-t border-white/5">
                      <td className="py-2 pr-4 text-[var(--text-primary)]">{a.agent_name}</td>
                      <td className="py-2 pr-4 text-[var(--text-secondary)]">{a.owner_name ?? '—'}</td>
                      <td className="py-2 pr-4 text-right text-[var(--text-primary)]">{money(a.equity)}</td>
                      <td className={`py-2 text-right ${Number(a.return_pct) >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>{pct(a.return_pct)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <Card title="Agent 清單（點擊展開編輯）">
        {agents.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">載入中…</p>
        ) : (
          <div className="space-y-3">
            {agents.map((a) => {
              const lb = lbById.get(a.id)
              return (
                <details key={a.id} className="group rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="font-medium text-[var(--text-primary)]">{a.name}</span>
                    <span className="text-xs text-[var(--text-secondary)]">
                      {a.division === 'season' ? '季賽' : '公開'}・{a.strategyNameZh}・{a.toneName}
                    </span>
                    <span className="ml-auto text-xs">
                      權益 <b className={lb?.return_pct != null && Number(lb.return_pct) >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}>{money(a.equity)}</b>{' '}
                      <span className="text-[var(--text-secondary)]">（{pct(lb?.return_pct ?? a.returnPct)}・{a.rounds} 輪）</span>
                    </span>
                  </summary>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Personality / 決策 Prompt</label>
                      <div className="flex gap-2">
                        <textarea
                          className={input + ' min-h-[88px]'}
                          value={edits[a.id]?.personality ?? a.personality ?? ''}
                          onChange={(e) => setEdits((d) => ({ ...d, [a.id]: { personality: e.target.value } }))}
                          aria-label={`agent ${a.name} personality`}
                        />
                        <button className={btnGhost + ' shrink-0 self-start'} onClick={() => saveAgent(a.id)} disabled={saveId === a.id}>
                          存
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">strategy_params：{a.strategyParams ? JSON.stringify(a.strategyParams) : '—'}</p>
                      <details className="mt-1 text-xs text-[var(--text-secondary)]">
                        <summary className="cursor-pointer hover:text-[var(--accent)]">內建人格預設（可直接貼 id 或自行描述）</summary>
                        <ul className="mt-2 space-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                          {personalityPresets.map((p) => (
                            <li key={p.id}>
                              <code className="text-[var(--accent)]">{p.id}</code>＝{p.nameZh}：{p.trait}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                    {a.holdings.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-2 uppercase tracking-wide">目前持股</h4>
                        <ul className="text-sm space-y-1">
                          {a.holdings.map((h) => (
                            <li key={h.symbol} className="text-[var(--text-secondary)]">
                              {h.name ?? h.symbol}（{h.symbol}）· {h.shares} 股 · 成本 {h.avgCost}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {a.holdings.length === 0 && <p className="text-sm text-[var(--text-secondary)]">無持股</p>}
                  </div>
                </details>
              )
            })}
          </div>
        )}
      </Card>

      <Card title="輪次資料" hint="預設看今日；可輸入其他交易日查看歷史輪次。">
        <div className="flex items-center gap-2 mb-4">
          <label htmlFor="round-picker" className="text-sm text-[var(--text-secondary)]">交易日</label>
          <input
            id="round-picker"
            type="date"
            className={input + ' max-w-[180px]'}
            value={roundDate}
            onChange={(e) => {
              if (e.target.value) pickRound(e.target.value)
              else setRoundDate('')
            }}
          />
          <Help text="選擇過往交易日回顧該輪的當輪結果、每 agent 決策歷程與權益曲線。" />
        </div>

        {round && (
          <div className="space-y-6">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--accent)] mb-2">當輪簡報（briefing）</h3>
                {round.briefing?.content ? (
                  <div className="max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-[var(--text-secondary)] leading-relaxed">
                    <MarkdownText text={round.briefing.content} />
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-secondary)]">尚未產出（先跑 Pre-market）</p>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--accent)] mb-2">收盤討論（discussion）</h3>
                {round.discussion?.content ? (
                  <div className="max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-[var(--text-secondary)] leading-relaxed">
                    <MarkdownText text={round.discussion.content} />
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-secondary)]">尚未產出（先跑收盤結算）</p>
                )}
              </div>
            </div>

            {Object.keys(round.intraday).length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-[var(--accent)] mb-2">盤中時點（intraday）</h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {Object.entries(round.intraday).map(([slot, s]) => (
                    <div key={slot} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                      <div className="mb-1 text-xs text-[var(--text-secondary)]">slot {slot} {s.timeLabel ?? ''}</div>
                      <ul className="space-y-0.5">
                        {s.rows.slice(0, 6).map((r) => (
                          <li key={r.symbol} className="text-[var(--text-primary)]">
                            {r.symbol} {r.price}
                            {r.changePct != null ? `（${pct(r.changePct)}）` : ''}
                          </li>
                        ))}
                        {s.rows.length > 6 && <li className="text-xs text-[var(--text-secondary)]">…共 {s.rows.length} 檔</li>}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {round.standings.length > 0 && (
              <EquityCards standings={round.standings} series={round.equitySeries} />
            )}
          </div>
        )}
      </Card>

      <Card title="每 Agent 決策歷程" hint="展開任一 agent 即按需載入該輪的決策與成交明細，避免一次撈全部資料卡住頁面。">
        {agents.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">載入中…</p>
        ) : !activeDate ? (
          <p className="text-sm text-[var(--text-secondary)]">尚未建立輪次（先跑 Pre-market）</p>
        ) : (
          <div className="space-y-3">
            {agents.map((a) => {
              const det = agentDetail[a.id]
              return (
                <details
                  key={a.id}
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  open={!!openHistory[a.id]}
                  onToggle={(e) => {
                    const isOpen = (e.target as HTMLDetailsElement).open
                    setOpenHistory((o) => ({ ...o, [a.id]: isOpen }))
                    if (isOpen && (!det || det.roundDate !== activeDate)) loadAgentHistory(a.id)
                  }}
                >
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                    {a.name}
                    {det?.loading ? (
                      <span className="text-xs font-normal text-[var(--text-secondary)]">載入中…</span>
                    ) : det && !det.error ? (
                      <span className="ml-auto text-xs font-normal text-[var(--text-secondary)]">
                        {det.logs.length} 筆決策・{det.trades.length} 筆成交
                      </span>
                    ) : null}
                  </summary>
                  <div className="mt-3">
                    {det?.loading ? (
                      <p className="text-sm text-[var(--text-secondary)]">載入中…</p>
                    ) : det?.error ? (
                      <p className="text-sm text-[var(--accent-red)]">
                        {det.error}
                        <button className={btnGhost + ' ml-2 !py-1'} onClick={() => loadAgentHistory(a.id)}>重試</button>
                      </p>
                    ) : det ? (
                      <AgentHistoryBody logs={det.logs} trades={det.trades} />
                    ) : (
                      <p className="text-sm text-[var(--text-secondary)]">尚未載入（展開後自動撈取）</p>
                    )}
                  </div>
                </details>
              )
            })}
          </div>
        )}
      </Card>
    </SectionPageWrapper>
  )
}

function AgentHistoryBody({ logs, trades }: { logs: RoundDecision[]; trades: AgentHistoryDetail['trades'] }) {
  const typo = useTableTypography()
  if (logs.length === 0 && trades.length === 0) {
    return <p className="text-sm text-[var(--text-secondary)]">此輪無決策／交易紀錄</p>
  }
  return (
    <div className="space-y-4 text-sm">
      <div>
        <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-2 uppercase tracking-wide">決策紀錄</h4>
        {logs.length === 0 ? (
          <p className="text-[var(--text-secondary)]">無紀錄</p>
        ) : (
          <ul className="space-y-2">
            {logs.map((l) => (
              <li key={l.id} className="rounded-lg border border-white/10 bg-white/5 p-3.5 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs border-b border-white/5 pb-2">
                  <code className="text-[var(--accent)] font-semibold">{l.phaseName}</code>
                  {l.fallbackUsed && <span className="text-[var(--accent-violet)] bg-purple-500/10 px-1.5 py-0.5 rounded text-[11px]">fallback</span>}
                  <span className="text-[var(--text-secondary)]">{l.model ?? ''}{l.createdAt ? `・${l.createdAt}` : ''}</span>
                </div>
                <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  <MarkdownText text={l.content} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-2 uppercase tracking-wide">成交明細</h4>
        {trades.length === 0 ? (
          <p className="text-[var(--text-secondary)]">無成交</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass(typo, 'w-full')}>
              <thead>
                <tr className={headTrClass(typo, 'text-left text-[var(--text-secondary)] uppercase tracking-wide')}>
                  <th className="py-1 pr-3">動作</th>
                  <th className="py-1 pr-3">標的</th>
                  <th className="py-1 pr-3 text-right">股數</th>
                  <th className="py-1 pr-3 text-right">價格</th>
                  <th className="py-1 pr-3">理由</th>
                  <th className="py-1">模型</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className="border-t border-white/5">
                    <td className={`py-1.5 pr-3 ${t.action === 'BUY' ? 'text-[var(--accent-green)]' : t.action === 'SELL' ? 'text-[var(--accent-red)]' : ''}`}>{t.action}</td>
                    <td className="py-1.5 pr-3 text-[var(--text-primary)]">{t.symbolName ?? t.symbol ?? '—'}（{t.symbol ?? '—'}）</td>
                    <td className="py-1.5 pr-3 text-right">{t.shares ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-right">{t.price ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{t.reason ?? '—'}</td>
                    <td className="py-1.5 text-xs text-[var(--text-secondary)]">{t.model ?? ''}{t.error ? `（${t.error}）` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function EquityCards({ standings, series }: { standings: RoundData['standings']; series: RoundData['equitySeries'] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--accent)] mb-2">權益曲線</h3>
      {standings.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">尚無資料</p>
      ) : (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {standings.map((s) => (
              <div key={s.agentId} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-[var(--text-primary)]">{s.agentName}</span>
                  <span className={`text-sm ${Number(s.returnPct) >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>{pct(s.returnPct)}</span>
                </div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">
                  權益 {money(s.equity)}・{s.rounds} 輪
                </div>
                <EquitySparkline points={(series[s.agentId] ?? []).map((p) => p.equity)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** 純 CSS 長條 sparkline：以每個 round 的 equity 高度視覺化走勢。 */
function EquitySparkline({ points }: { points: number[] }) {
  if (points.length === 0) return <p className="mt-2 text-xs text-[var(--text-secondary)]">尚無快照</p>
  const max = Math.max(...points, 1)
  return (
    <div className="mt-3 flex items-end gap-1 h-12" role="img" aria-label="權益走勢">
      {points.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-t bg-[var(--accent)]/70"
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}