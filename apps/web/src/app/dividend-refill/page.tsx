'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  PieChart as PieChartIcon,
  Search,
} from 'lucide-react'
import { TableSkeleton } from '@/components/table-skeleton'
import { WorkspaceBackLink } from '@/components/workspace-back-link'
import { searchStocks, StockCandidateList, type StockCandidate } from '@/components/stock-search'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'
import type { FillDaysHistogram } from '@/lib/ex-dividend-engine'

// Issue #136：單檔填息回顧器（/dividend-refill）
// 文案紅線：僅歷史統計＋免責，禁「預測/保證」字眼。

interface EventRow {
  exDate: string
  preClose: number
  cashDividend: number | null
  filled: boolean
  daysToFill: number | null
  hitD1: boolean
  hitD5: boolean
  hitD10: boolean
  hitD20: boolean
  hitD40: boolean
  maxDrawdownPct: number
  matured: boolean
}

interface RefillResponse {
  symbol: string
  name: string | null
  asset_kind: 'etf' | 'stock' | 'unknown'
  asset_label: string
  stats: {
    eventCount: number
    skippedCount: number
    insufficient: boolean
    fillRateD1: number | null
    fillRateD5: number | null
    fillRateD10: number | null
    fillRateD20: number | null
    fillRateD40: number | null
    expiryFillRate: number | null
    maturedCount: number
    avgFillDays: number | null
    maxUnfilledDrawdownPct: number | null
    fillScore: number | null
    events: EventRow[]
    yearsCovered: string[]
  }
  histogram: FillDaysHistogram
  years_incomplete: boolean
  history_since: string | null
  data_period: {
    from: string
    to: string
    missing_dividend_years: string[]
  }
  disclaimer: string
}

type SortKey = 'exDate' | 'cashDividend' | 'preClose' | 'daysToFill' | 'maxDrawdownPct'
type SortDir = 'asc' | 'desc'

const QUICK_SYMBOLS = [
  { symbol: '0056', label: '0056 元大高股息' },
  { symbol: '2330', label: '2330 台積電' },
  { symbol: '00878', label: '00878 國泰永續高股息' },
  { symbol: '00919', label: '00919 群益台灣精選高息' },
  { symbol: '2884', label: '2884 玉山金' },
]

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(1)}%`
}

function fmtNum(v: number | null, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

export default function DividendRefillPage() {
  const typo = useTableTypography()
  const [query, setQuery] = useState('0056')
  const [activeSymbol, setActiveSymbol] = useState('0056')
  const [showCandidates, setShowCandidates] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<RefillResponse | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('exDate')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const [candidates, setCandidates] = useState<StockCandidate[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (!showCandidates || !q) {
      setCandidates([])
      return
    }
    let cancelled = false
    setCandidatesLoading(true)
    const timer = setTimeout(async () => {
      const list = await searchStocks(q, 'tw')
      if (!cancelled) {
        setCandidates(list.slice(0, 8))
        setCandidatesLoading(false)
      }
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, showCandidates])

  const loadSymbol = useCallback(async (sym: string) => {
    const clean = sym.trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
    if (!clean) return
    setActiveSymbol(clean)
    setQuery(clean)
    setShowCandidates(false)
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dividend-refill?symbol=${encodeURIComponent(clean)}`)
      const json = await res.json()
      if (!res.ok) {
        setData(null)
        setError(json?.error || `查詢 ${clean} 失敗（HTTP ${res.status}）`)
        return
      }
      setData(json as RefillResponse)
    } catch (e: unknown) {
      setData(null)
      setError(e instanceof Error ? e.message : '網路連線失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sym = params.get('symbol')?.trim()
    void loadSymbol(sym || '0056')
  }, [loadSymbol])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'exDate' ? 'desc' : 'asc')
    }
  }

  const sortedEvents = useMemo(() => {
    if (!data?.stats?.events) return []
    const list = [...data.stats.events]
    list.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'exDate') {
        cmp = a.exDate.localeCompare(b.exDate)
      } else if (sortKey === 'cashDividend') {
        cmp = (a.cashDividend ?? -1) - (b.cashDividend ?? -1)
      } else if (sortKey === 'preClose') {
        cmp = a.preClose - b.preClose
      } else if (sortKey === 'daysToFill') {
        // 未填息一律置底
        if (a.daysToFill == null && b.daysToFill == null) cmp = 0
        else if (a.daysToFill == null) return 1
        else if (b.daysToFill == null) return -1
        else cmp = a.daysToFill - b.daysToFill
      } else if (sortKey === 'maxDrawdownPct') {
        cmp = a.maxDrawdownPct - b.maxDrawdownPct
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [data, sortKey, sortDir])

  const maxBinCount = useMemo(() => {
    if (!data?.histogram?.bins) return 1
    return Math.max(1, ...data.histogram.bins.map((b) => b.count))
  }, [data])

  const renderSortTh = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => {
    const active = sortKey === key
    const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
    return (
      <th
        aria-sort={ariaSort}
        className={`px-3 py-2.5 whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
      >
        <button
          type="button"
          onClick={() => toggleSort(key)}
          className={`inline-flex items-center gap-1 font-semibold transition-colors hover:text-[var(--text-primary)] ${
            active ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'
          }`}
        >
          <span>{label}</span>
          {active ? (
            sortDir === 'asc' ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="text-[10px] opacity-40">▲▼</span>
          )}
        </button>
      </th>
    )
  }

  // Donut SVG geometry
  const pieRadius = 46
  const pieCircumference = 2 * Math.PI * pieRadius
  const filledRatio =
    data && data.histogram.eventCount > 0
      ? data.histogram.filledCount / data.histogram.eventCount
      : 0
  const filledStroke = filledRatio * pieCircumference

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <WorkspaceBackLink />
        <Link
          href="/ex-dividend"
          className="text-xs font-medium text-[var(--accent)] hover:underline"
        >
          前往除權息日曆 →
        </Link>
      </div>

      {/* 標題與搜尋列 */}
      <section className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)] sm:text-2xl">
              單檔填息回顧器
            </h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              查詢台股個股或 ETF 歷史除息事件的填息天數分布、到期填息比率與最大貼息幅度（純現金股利）。
            </p>
          </div>
          {data && (
            <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
              {data.asset_label}
            </span>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void loadSymbol(query)
          }}
          className="relative flex flex-col gap-2 sm:flex-row"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={query}
              onFocus={() => setShowCandidates(true)}
              onChange={(e) => {
                setQuery(e.target.value)
                setShowCandidates(true)
              }}
              placeholder="輸入台股代號或名稱（例如 0056、2330）"
              aria-label="股票代號或名稱"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] py-2.5 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
            />
            {showCandidates && (candidatesLoading || candidates.length > 0) && query.trim().length > 0 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-lg">
                <StockCandidateList
                  candidates={candidates}
                  loading={candidatesLoading}
                  onPick={(c) => {
                    void loadSymbol(c.symbol)
                  }}
                />
              </div>
            )}
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            查詢歷史填息
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">熱門範例：</span>
          {QUICK_SYMBOLS.map((item) => (
            <button
              key={item.symbol}
              type="button"
              onClick={() => void loadSymbol(item.symbol)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                activeSymbol === item.symbol
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {/* Loading Skeleton */}
      {loading && (
        <section
          aria-busy="true"
          aria-live="polite"
          className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5"
        >
          <TableSkeleton rows={5} message={`正在載入 ${activeSymbol} 歷史除息與還原收盤資料…`} />
        </section>
      )}

      {/* Error */}
      {!loading && error && (
        <section className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-400">
          {error}
        </section>
      )}

      {/* Main Content */}
      {!loading && !error && data && (
        <div className="space-y-6">
          {/* 標的資訊與年份不全警示 */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                {data.symbol} {data.name ?? ''}
              </h2>
              <span className="text-xs text-[var(--text-muted)]">
                資料期間：{data.data_period.from} ~ {data.data_period.to}（共 {data.stats.eventCount} 筆事件）
              </span>
            </div>
            {data.years_incomplete && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                年份不全（資料起始：{data.history_since ?? '無'}）
              </span>
            )}
          </div>

          {/* 樣本不足提醒 */}
          {data.stats.insufficient && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                樣本不足（有效除息事件 {data.stats.eventCount} 筆，少於 3 筆門檻），為避免誤導，不輸出統計機率與評分，僅列出既有明細供參考。
              </span>
            </div>
          )}

          {/* 4 張統計卡 */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-muted)]">填息成功率（40日內）</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-[var(--text-primary)]">
                {data.stats.insufficient ? '樣本不足' : fmtPct(data.histogram.fillRate)}
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                {data.histogram.filledCount} / {data.histogram.eventCount} 次達標
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-muted)]">到期填息比率（滿40日）</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-[var(--text-primary)]">
                {data.stats.insufficient ? '樣本不足' : fmtPct(data.stats.expiryFillRate)}
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                滿窗樣本 {data.stats.maturedCount} 筆
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-muted)]">填息天數（平均 / 中位數）</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-[var(--text-primary)]">
                {data.stats.avgFillDays != null ? `${fmtNum(data.stats.avgFillDays, 1)} 天` : '—'}
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-secondary)] tabular-nums">
                中位數：{data.histogram.medianFillDays != null ? `${data.histogram.medianFillDays} 天` : '—'}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-muted)]">最大貼息幅度（滿窗未填）</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-rose-400">
                {data.stats.maxUnfilledDrawdownPct != null
                  ? `${fmtNum(data.stats.maxUnfilledDrawdownPct, 2)}%`
                  : '0.00%'}
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                D20 填息率：{data.stats.insufficient ? '—' : fmtPct(data.stats.fillRateD20)}
              </div>
            </div>
          </section>

          {/* 視覺化：直方圖 + 成功/未填圓餅 */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* 直方圖 */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 lg:col-span-2">
              <div className="mb-4 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[var(--accent)]" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  填息天數分布直方圖（交易日分箱）
                </h3>
              </div>

              {data.histogram.eventCount === 0 ? (
                <div className="py-10 text-center text-sm text-[var(--text-muted)]">
                  尚無歷史除息事件資料
                </div>
              ) : (
                <div className="space-y-3">
                  {data.histogram.bins.map((bin) => {
                    const widthPct = Math.round((bin.count / maxBinCount) * 100)
                    const isUnfilled = bin.key === 'unfilled'
                    return (
                      <div key={bin.key} className="grid grid-cols-[68px_1fr_72px] items-center gap-3 text-xs">
                        <span className="font-medium text-[var(--text-secondary)]">{bin.label}</span>
                        <div className="h-6 overflow-hidden rounded-md bg-[var(--bg-secondary)]">
                          <div
                            className={`h-full rounded-md transition-all ${
                              isUnfilled ? 'bg-rose-500/75' : 'bg-[var(--accent)]'
                            }`}
                            style={{ width: `${bin.count > 0 ? Math.max(4, widthPct) : 0}%` }}
                          />
                        </div>
                        <span className="text-right tabular-nums text-[var(--text-primary)]">
                          {bin.count} 次 ({Math.round(bin.ratio * 100)}%)
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 圓餅圖 */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <div className="mb-4 flex items-center gap-2">
                <PieChartIcon className="h-4 w-4 text-[var(--accent)]" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  填息成功 / 未填比例
                </h3>
              </div>

              {data.histogram.eventCount === 0 ? (
                <div className="py-10 text-center text-sm text-[var(--text-muted)]">
                  尚無資料
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-4">
                  <svg viewBox="0 0 120 120" className="h-36 w-36" role="img" aria-label="填息成功與未填比例圓餅圖">
                    <circle
                      cx="60"
                      cy="60"
                      r={pieRadius}
                      fill="transparent"
                      stroke="rgba(244, 63, 94, 0.35)"
                      strokeWidth="16"
                    />
                    <circle
                      cx="60"
                      cy="60"
                      r={pieRadius}
                      fill="transparent"
                      stroke="var(--accent)"
                      strokeWidth="16"
                      strokeDasharray={`${filledStroke} ${pieCircumference}`}
                      transform="rotate(-90 60 60)"
                    />
                    <text
                      x="60"
                      y="58"
                      textAnchor="middle"
                      className="fill-[var(--text-primary)] text-sm font-bold"
                    >
                      {data.stats.insufficient ? '樣本不足' : `${Math.round(filledRatio * 100)}%`}
                    </text>
                    <text
                      x="60"
                      y="74"
                      textAnchor="middle"
                      className="fill-[var(--text-muted)] text-[10px]"
                    >
                      已填息佔比
                    </text>
                  </svg>

                  <div className="flex w-full justify-around text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
                      <span className="text-[var(--text-secondary)]">
                        已填息：{data.histogram.filledCount} 筆
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-500/75" />
                      <span className="text-[var(--text-secondary)]">
                        未填息：{data.histogram.unfilledCount} 筆
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 事件明細表（符合 docs/ui-table-checklist.md） */}
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
              歷史除息事件明細
            </h3>

            {sortedEvents.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--text-muted)]">
                查無歷史除息事件（可能為無配息標的或資料期間尚未覆蓋）
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className={tableClass(typo, 'w-full min-w-[640px] border-collapse')}>
                  <thead>
                    <tr className={headTrClass(typo, 'border-b border-[var(--border)]')}>
                      {renderSortTh('exDate', '除息日', 'left')}
                      {renderSortTh('cashDividend', '現金股利 (元)')}
                      {renderSortTh('preClose', '除息前收盤 (還原)')}
                      <th className="px-3 py-2.5 text-center font-semibold text-[var(--text-secondary)]">
                        狀態
                      </th>
                      {renderSortTh('daysToFill', '填息天數')}
                      {renderSortTh('maxDrawdownPct', '窗口最大貼息%')}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {sortedEvents.map((ev) => (
                      <tr key={ev.exDate} className="hover:bg-[var(--bg-secondary)]/50">
                        <td className="px-3 py-2.5 font-medium tabular-nums text-[var(--text-primary)]">
                          {ev.exDate}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-primary)]">
                          {fmtNum(ev.cashDividend, 2)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-secondary)]">
                          {fmtNum(ev.preClose, 2)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {ev.filled ? (
                            <span className="inline-flex rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                              已填息
                            </span>
                          ) : ev.matured ? (
                            <span className="inline-flex rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-medium text-rose-400">
                              40日未填
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-400">
                              觀察中
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-primary)]">
                          {ev.daysToFill != null ? `${ev.daysToFill} 天` : '—'}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right tabular-nums ${
                            ev.maxDrawdownPct < 0 ? 'text-rose-400' : 'text-[var(--text-secondary)]'
                          }`}
                        >
                          {ev.maxDrawdownPct.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 免責四件套 */}
          <footer className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/50 p-4 text-xs leading-relaxed text-[var(--text-muted)]">
            <p>
              1. 統計方式：採 Yahoo Finance 還原權值收盤序列（adjclose）與 TWSE 除息快取計算；填息定義＝除息日起 40 個交易日內收盤 ≥ 除息前一日收盤。
            </p>
            <p className="mt-1">
              2. 歷史填息統計僅供研究參考，不構成任何投資建議；過去填息表現不代表未來表現。
            </p>
            <p className="mt-1">
              3. 資料涵蓋：僅含純現金股利除息事件（不含純除權配股）；若歷史期間不足 5 年或快取缺年，已於上方標註「年份不全」。
            </p>
            <p className="mt-1">
              4. 使用本工具即表示同意{' '}
              <Link href="/terms" className="text-[var(--accent)] underline">
                服務條款與免責聲明
              </Link>
              。
            </p>
          </footer>
        </div>
      )}
    </main>
  )
}
