'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  X,
  Loader2,
  AlertTriangle,
  LineChart as LineChartIcon,
  Table2,
  BookOpen,
  Sparkles,
} from 'lucide-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts'
import type { CycleEntrySignalRow } from '@stock/database'
import {
  computeWilsonScoreInterval,
  type EntryStats,
  type OHLCV,
  type SeriesEval,
  type TradeRecord,
  type RuleKey,
} from '@stock/cycle-entry'
import {
  formatWinRate,
  fmt,
  ruleList,
  shortSymbol,
  yahooQuoteUrl,
  type CycleEntryDict,
} from './cycle-entry-view'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'

interface DetailResponse {
  success: boolean
  editionDate: string
  signal: CycleEntrySignalRow & { name: string }
  stats: EntryStats
  trades: TradeRecord[]
  history: OHLCV[]
  lastEval: SeriesEval | null
  error?: string
}

interface Props {
  signal: CycleEntrySignalRow | null
  dict: CycleEntryDict
  onClose: () => void
}

type Tab = 'chart' | 'trades' | 'rules'
type ChartTab = 'price' | 'equity'

const RULE_ORDER: RuleKey[] = ['R1', 'R2', 'R3', 'R4', 'R5']

const RULE_LABEL: Record<RuleKey, keyof CycleEntryDict> = {
  R1: 'ruleR1',
  R2: 'ruleR2',
  R3: 'ruleR3',
  R4: 'ruleR4',
  R5: 'ruleR5',
}

function formatChartDate(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })
}

function formatFullDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toISOString().slice(0, 10)
}

function fmtPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—'
  const v = pct * 100
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

function smaSeries(closes: number[], windowLen: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null)
  let sum = 0
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i]
    if (i >= windowLen) sum -= closes[i - windowLen]
    if (i >= windowLen - 1) out[i] = sum / windowLen
  }
  return out
}

export function CycleEntryDetailModal({ signal, dict, onClose }: Props) {
  const typo = useTableTypography()
  const [tab, setTab] = useState<Tab>('chart')
  const [chartTab, setChartTab] = useState<ChartTab>('price')
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const selectedSymbol = signal?.symbol ?? null

  useEffect(() => {
    if (!selectedSymbol) return
    let cancelled = false
    setLoading(true)
    setError(false)
    setDetail(null)
    fetch(`/api/cycle-entry/detail?symbol=${encodeURIComponent(selectedSymbol)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<DetailResponse>
      })
      .then((d) => {
        if (!cancelled) {
          setDetail(d)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedSymbol])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!selectedSymbol) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [selectedSymbol, handleClose])

  const chartData = useMemo(() => {
    if (!detail) return []
    const closes = detail.history.map((h) => h.close)
    const ma20 = smaSeries(closes, 20)
    const ma60 = smaSeries(closes, 60)
    const entryByDate = new Map(detail.trades.map((t) => [t.entryDate, t.entryPrice]))
    return detail.history.map((h, i) => ({
      date: h.timestamp,
      close: h.close,
      ma20: ma20[i],
      ma60: ma60[i],
      entry: entryByDate.get(new Date(h.timestamp).toISOString().slice(0, 10)) ?? null,
    }))
  }, [detail])

  const equityData = useMemo(() => {
    if (!detail || detail.trades.length === 0) return []
    const closedTrades = detail.trades.filter((t) => t.outcome !== 'open')
    if (closedTrades.length === 0) return []
    const points: { date: number; value: number }[] = [
      { date: new Date(closedTrades[0].entryDate).getTime(), value: 0 },
    ]
    let acc = 1
    for (const t of closedTrades) {
      acc *= 1 + (t.netReturnPct ?? t.returnPct ?? 0)
      points.push({
        date: new Date(t.exitDate ?? t.entryDate).getTime(),
        value: (acc - 1) * 100,
      })
    }
    return points
  }, [detail])

  const resolvedName = signal ? `${shortSymbol(signal.symbol)} ${signal.name ?? ''}`.trim() : ''

  const decided = (signal?.btWins ?? detail?.stats.wins ?? 0) + (signal?.btLosses ?? detail?.stats.losses ?? 0)
  const wilsonCi = useMemo(() => {
    const wins = signal?.btWins ?? detail?.stats.wins ?? 0
    return computeWilsonScoreInterval(wins, decided)
  }, [signal, detail, decided])

  if (!signal) return null

  const matchedSet = new Set<RuleKey>(detail?.lastEval?.matchedRules ?? [])
  const showTrades = detail && !loading && !error

  const tabBtn = (key: Tab, label: string, Icon: typeof LineChartIcon) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
        tab === key
          ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
          : 'bg-white/5 text-[var(--text-secondary)] hover:bg-white/10'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label={dict.detailTitle}
    >
      <div
        className="w-full max-w-3xl rounded-2xl bg-[var(--bg-card)] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 標頭 */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-[var(--accent-green)]/10 text-[var(--accent-green)] shrink-0">
              <LineChartIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold truncate">{resolvedName}</h2>
              <p className="text-xs text-[var(--text-secondary)]">{dict.detailSubtitle}</p>
              {/* Issue #81：改連 Yahoo 股市報價（另開新頁）；回測實驗室入口留給頁面底部大卡片 */}
              <a
                href={yahooQuoteUrl(signal.symbol)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline"
              >
                {dict.openYahooQuote} ↗
              </a>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-white/5 text-[var(--text-secondary)] transition shrink-0 cursor-pointer"
            aria-label={dict.detailClose}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="py-16 text-center space-y-2 text-[var(--text-secondary)]">
              <Loader2 className="w-6 h-6 mx-auto animate-spin text-[var(--accent)]" />
              <p className="text-sm">{dict.detailLoading}</p>
            </div>
          ) : error || !detail ? (
            <div className="py-16 text-center space-y-2 text-[var(--text-secondary)]">
              <AlertTriangle className="w-6 h-6 mx-auto text-amber-400" />
              <p className="text-sm">{dict.detailError}</p>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              {/* 快覽數據 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                  <div className="text-[10px] text-[var(--text-secondary)] mb-1">{dict.colPrice}</div>
                  <div className="font-semibold tabular-nums">{fmt(detail.signal.price, 2)}</div>
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                  <div className="text-[10px] text-[var(--text-secondary)] mb-1">{dict.btWinRate}</div>
                  <div className="font-semibold tabular-nums">{formatWinRate(detail.signal.btWinRate)}</div>
                  {wilsonCi ? (
                    <div className="text-[10px] text-[var(--text-secondary)] tabular-nums mt-0.5 truncate">
                      CI {wilsonCi.lower}%~{wilsonCi.upper}%
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                  <div className="text-[10px] text-[var(--text-secondary)] mb-1">{dict.btSignals}</div>
                  <div className="font-semibold tabular-nums">{detail.signal.btTotalSignals ?? '—'}</div>
                  {detail.stats.openTrades ? (
                    <div className="text-[10px] text-sky-400 tabular-nums mt-0.5 truncate">
                      {detail.stats.openTrades} {dict.openBadge}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                  <div className="text-[10px] text-[var(--text-secondary)] mb-1">{dict.btAvgDays}</div>
                  <div className="font-semibold tabular-nums">{detail.signal.btAvgDays ?? '—'}</div>
                </div>
              </div>

              {/* 規則 chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                {ruleList(detail.signal.matchedRules, dict).map((r) => (
                  <span
                    key={r.key}
                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20"
                  >
                    {r.key}·{r.label}
                  </span>
                ))}
                <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[var(--accent)]/15 text-[var(--accent)] font-semibold tabular-nums">
                  {dict.colScore} {detail.signal.score}
                </span>
              </div>

              {/* 分頁 */}
              <div className="flex flex-wrap gap-1.5 border-b border-white/10 pb-3">
                {tabBtn('chart', dict.detailTabChart, LineChartIcon)}
                {tabBtn('trades', dict.detailTabTrades, Table2)}
                {tabBtn('rules', dict.detailTabRules, BookOpen)}
              </div>

              {/* Tab：曲線圖 */}
              {tab === 'chart' && (
                <div className="space-y-3">
                  <div className="flex gap-1.5">
                    {(
                      [
                        ['price', dict.chartPriceTitle],
                        ['equity', dict.chartEquityTitle],
                      ] as [ChartTab, string][]
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setChartTab(key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                          chartTab === key
                            ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                            : 'bg-white/5 text-[var(--text-secondary)] hover:bg-white/10'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {chartTab === 'price' ? (
                    <div>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
                            <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                            <XAxis
                              dataKey="date"
                              tickFormatter={(v) => formatChartDate(v as number)}
                              stroke="var(--text-secondary)"
                              fontSize={11}
                              minTickGap={40}
                            />
                            <YAxis
                              domain={['auto', 'auto']}
                              stroke="var(--text-secondary)"
                              fontSize={11}
                              tickFormatter={(v) => (v as number).toLocaleString()}
                              width={64}
                            />
                            <Tooltip
                              contentStyle={{
                                background: 'var(--bg-secondary)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 8,
                                fontSize: 12,
                              }}
                              labelFormatter={(v) => formatChartDate(v as number)}
                              formatter={(value, name) => [Number(value).toLocaleString(), name as string]}
                            />
                            <Line type="monotone" dataKey="close" stroke="var(--accent)" dot={false} strokeWidth={1.7} name={dict.chartClose} />
                            <Line type="monotone" dataKey="ma20" stroke="#facc15" dot={false} strokeWidth={1.2} name={dict.chartMA20} />
                            <Line type="monotone" dataKey="ma60" stroke="#38bdf8" dot={false} strokeWidth={1.2} name={dict.chartMA60} />
                            {chartData
                              .filter((d) => d.entry != null)
                              .map((d, i) => (
                                <ReferenceDot
                                  key={i}
                                  x={d.date}
                                  y={d.entry!}
                                  r={4}
                                  fill="var(--accent-green)"
                                  stroke="rgba(16,185,129,0.4)"
                                  strokeWidth={1}
                                />
                              ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mt-1">
                        <span className="mr-3">
                          <span className="inline-block w-2 h-2 rounded-full bg-[var(--accent-green)] mr-1" />
                          {dict.chartEntryDot}
                        </span>
                        <span className="mr-3">
                          <span className="inline-block w-2 h-0.5 bg-[#facc15] mr-1" />{dict.chartMA20}
                        </span>
                        <span>
                          <span className="inline-block w-2 h-0.5 bg-[#38bdf8] mr-1" />{dict.chartMA60}
                        </span>
                      </p>
                    </div>
                  ) : (
                    <div>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={equityData} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
                            <defs>
                              <linearGradient id="eqGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                            <XAxis
                              dataKey="date"
                              tickFormatter={(v) => formatChartDate(v as number)}
                              stroke="var(--text-secondary)"
                              fontSize={11}
                              minTickGap={40}
                            />
                            <YAxis
                              domain={['auto', 'auto']}
                              stroke="var(--text-secondary)"
                              fontSize={11}
                              tickFormatter={(v) => `${(v as number).toFixed(0)}%`}
                              width={48}
                            />
                            <Tooltip
                              contentStyle={{
                                background: 'var(--bg-secondary)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 8,
                                fontSize: 12,
                              }}
                              labelFormatter={(v) => formatChartDate(v as number)}
                              formatter={(value) => [`${(Number(value)).toFixed(1)}%`, dict.chartEquityValue]}
                            />
                            <Area
                              type="monotone"
                              dataKey="value"
                              stroke="var(--accent)"
                              strokeWidth={1.8}
                              fill="url(#eqGradient)"
                              name={dict.chartEquityValue}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mt-1">
                        {dict.chartEquityTitle}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Tab：逐筆交易明細 */}
              {tab === 'trades' && (
                <div>
                  {showTrades && detail.trades.length === 0 ? (
                    <p className="text-sm text-[var(--text-secondary)] py-8 text-center">{dict.tradesEmpty}</p>
                  ) : showTrades ? (
                    <>
                      <div className="overflow-x-auto rounded-xl border border-white/10">
                        <table className={tableClass(typo, 'w-full min-w-full')}>
                          <thead>
                            <tr className={headTrClass(typo, 'border-b border-white/10 text-left text-[var(--text-secondary)]')}>
                              <th className="px-3 py-2.5 font-medium whitespace-nowrap">{dict.colSignalDate}</th>
                              <th className="px-3 py-2.5 font-medium whitespace-nowrap">{dict.colEntryDate}</th>
                              <th className="px-3 py-2.5 font-medium whitespace-nowrap">{dict.colExitDate}</th>
                              <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">{dict.colReturn}</th>
                              <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">{dict.colHoldingDays}</th>
                              <th className="px-3 py-2.5 font-medium whitespace-nowrap">{dict.colExitReason}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.trades.map((t, i) => (
                              <tr key={i} className="border-b border-white/5 last:border-b-0 align-top">
                                <td className="px-3 py-3 whitespace-nowrap text-[var(--text-secondary)]">{formatFullDate(t.signalDate)}</td>
                                <td className="px-3 py-3 whitespace-nowrap">
                                  <div>{formatFullDate(t.entryDate)}</div>
                                  <div className="text-xs text-[var(--text-secondary)] tabular-nums">{fmt(t.entryPrice, 2)}</div>
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap">
                                  {t.outcome === 'open' ? (
                                    <span className="text-[var(--text-secondary)]">—</span>
                                  ) : (
                                    <>
                                      <div>{formatFullDate(t.exitDate)}</div>
                                      {t.exitPrice != null ? (
                                        <div className="text-xs text-[var(--text-secondary)] tabular-nums">{fmt(t.exitPrice, 2)}</div>
                                      ) : null}
                                    </>
                                  )}
                                </td>
                                <td
                                  className={`px-3 py-3 text-right whitespace-nowrap tabular-nums font-semibold ${
                                    t.outcome === 'win'
                                      ? 'text-[var(--accent-green)]'
                                      : t.outcome === 'loss'
                                        ? 'text-[var(--accent-red)]'
                                        : 'text-[var(--text-secondary)]'
                                  }`}
                                >
                                  {t.outcome === 'open' ? '—' : fmtPct(t.netReturnPct ?? t.returnPct)}
                                </td>
                                <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums text-[var(--text-secondary)]">
                                  {t.holdingDays ?? '—'}
                                </td>
                                <td className="px-3 py-3 text-xs whitespace-nowrap">
                                  {t.outcome === 'open' ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-sky-500/15 text-sky-400 border border-sky-500/25">
                                      {dict.exitReasonOpen}
                                    </span>
                                  ) : t.exitReason === 'target' ? (
                                    <span className="text-[var(--text-secondary)]">{dict.exitReasonTarget}</span>
                                  ) : t.exitReason === 'stop' ? (
                                    <span className="text-[var(--text-secondary)]">{dict.exitReasonStop}</span>
                                  ) : (
                                    <span className="text-[var(--text-secondary)]">{dict.exitReasonTimeout}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[11px] text-[var(--text-secondary)] mt-2">
                        * {dict.netReturnNote}
                      </p>
                    </>
                  ) : null}
                </div>
              )}

              {/* Tab：規則說明 */}
              {tab === 'rules' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 p-4">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)] mb-2">
                      <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                      {dict.winRateFormulaTitle}
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-line">{dict.winRateFormulaText}</p>
                    {decided > 0 ? (
                      <div className="mt-2.5 pt-2.5 border-t border-white/10 space-y-1.5">
                        <div className="inline-flex flex-wrap items-center gap-x-2 text-sm font-semibold tabular-nums">
                          <span className="text-[var(--accent)]">{dict.btWinRate}</span>
                          <span className="text-[var(--text-primary)]">
                            {signal.btWins ?? 0} ÷ ({signal.btWins ?? 0} + {signal.btLosses ?? 0})
                          </span>
                          <span className="text-[var(--text-secondary)]">=</span>
                          <span className={signal.btWinRate != null && signal.btWinRate >= 50 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}>
                            {formatWinRate(signal.btWinRate)}
                          </span>
                        </div>
                        {wilsonCi ? (
                          <div className="text-xs text-[var(--text-secondary)] flex flex-wrap items-center gap-1.5 pt-0.5">
                            <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[var(--text-primary)] text-[11px]">
                              {dict.ciLabel}
                            </span>
                            <span className="tabular-nums font-semibold text-[var(--text-primary)]">
                              {wilsonCi.lower}% ~ {wilsonCi.upper}%
                            </span>
                            <span className="text-[11px] text-[var(--text-secondary)]">
                              ({dict.sampleBadge}: {decided}{detail.stats.openTrades ? `，${detail.stats.openTrades} 筆${dict.openBadge}` : ''})
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <div className="text-sm font-semibold mb-2.5">{dict.ruleCheckTitle}</div>
                    <div className="rounded-xl border border-white/10 overflow-hidden">
                      <ul className="divide-y divide-white/5">
                        {RULE_ORDER.map((r) => {
                          const hit = matchedSet.has(r)
                          return (
                            <li key={r} className="flex items-center justify-between gap-3 px-4 py-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                                    hit
                                      ? 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]'
                                      : 'bg-white/5 text-[var(--text-secondary)]'
                                  }`}
                                >
                                  {r}
                                </span>
                                <span className="text-sm text-[var(--text-primary)]">{dict[RULE_LABEL[r]]}</span>
                              </div>
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${
                                  hit
                                    ? 'bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20'
                                    : 'bg-white/5 text-[var(--text-secondary)] border border-white/10'
                                }`}
                              >
                                {hit ? dict.ruleHit : dict.ruleMiss}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mt-2.5">
                      {dict.ruleThreshold}
                      {detail.lastEval ? ` ${dict.colScore} ${detail.lastEval.score}` : ''}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}