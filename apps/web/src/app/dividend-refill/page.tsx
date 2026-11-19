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
import { useI18n } from '@/i18n/LanguageProvider'
import { localizePath } from '@/i18n/paths'
import type { Locale } from '@/i18n/config'

const REFILL_COPY: Record<
  Locale,
  {
    toCalendar: string
    title: string
    subtitle: string
    placeholder: string
    ariaSymbol: string
    submitBtn: string
    examplesLabel: string
    loadingMsg: (sym: string) => string
    periodLabel: (from: string, to: string, count: number) => string
    yearsIncomplete: (since: string) => string
    insufficientBanner: (count: number) => string
    insufficientShort: string
    statFillRate: string
    statFillSub: (filled: number, total: number) => string
    statExpiryRate: string
    statExpirySub: (matured: number) => string
    statAvgDays: string
    daysUnit: string
    medianLabel: (d: string) => string
    statMaxDrawdown: string
    d20Label: (v: string) => string
    histTitle: string
    noHistEvents: string
    timesUnit: string
    pieTitle: string
    noData: string
    pieAria: string
    filledPctLabel: string
    filledLegend: (n: number) => string
    unfilledLegend: (n: number) => string
    tableTitle: string
    tableEmpty: string
    colExDate: string
    colCashDiv: string
    colPreClose: string
    colStatus: string
    colDays: string
    colDrawdown: string
    statusFilled: string
    statusUnfilled: string
    statusWatching: string
    d1: string
    d2: string
    d3: string
    d4Pre: string
    d4Link: string
  }
> = {
  'zh-TW': {
    toCalendar: '前往除權息日曆 →',
    title: '單檔填息回顧器',
    subtitle: '查詢台股個股或 ETF 歷史除息事件的填息天數分布、到期填息比率與最大貼息幅度（純現金股利）。',
    placeholder: '輸入台股代號或名稱（例如 0056、2330）',
    ariaSymbol: '股票代號或名稱',
    submitBtn: '查詢歷史填息',
    examplesLabel: '熱門範例：',
    loadingMsg: (sym) => `正在載入 ${sym} 歷史除息與還原收盤資料…`,
    periodLabel: (from, to, count) => `資料期間：${from} ~ ${to}（共 ${count} 筆事件）`,
    yearsIncomplete: (since) => `年份不全（資料起始：${since}）`,
    insufficientBanner: (count) => `樣本不足（有效除息事件 ${count} 筆，少於 3 筆門檻），為避免誤導，不輸出統計機率與評分，僅列出既有明細供參考。`,
    insufficientShort: '樣本不足',
    statFillRate: '填息成功率（40日內）',
    statFillSub: (filled, total) => `${filled} / ${total} 次達標`,
    statExpiryRate: '到期填息比率（滿40日）',
    statExpirySub: (matured) => `滿窗樣本 ${matured} 筆`,
    statAvgDays: '填息天數（平均 / 中位數）',
    daysUnit: '天',
    medianLabel: (d) => `中位數：${d}`,
    statMaxDrawdown: '最大貼息幅度（滿窗未填）',
    d20Label: (v) => `D20 填息率：${v}`,
    histTitle: '填息天數分布直方圖（交易日分箱）',
    noHistEvents: '尚無歷史除息事件資料',
    timesUnit: '次',
    pieTitle: '填息成功 / 未填比例',
    noData: '尚無資料',
    pieAria: '填息成功與未填比例圓餅圖',
    filledPctLabel: '已填息佔比',
    filledLegend: (n) => `已填息：${n} 筆`,
    unfilledLegend: (n) => `未填息：${n} 筆`,
    tableTitle: '歷史除息事件明細',
    tableEmpty: '查無歷史除息事件（可能為無配息標的或資料期間尚未覆蓋）',
    colExDate: '除息日',
    colCashDiv: '現金股利 (元)',
    colPreClose: '除息前收盤 (還原)',
    colStatus: '狀態',
    colDays: '填息天數',
    colDrawdown: '窗口最大貼息%',
    statusFilled: '已填息',
    statusUnfilled: '40日未填',
    statusWatching: '觀察中',
    d1: '1. 統計方式：採 Yahoo Finance 還原權值收盤序列（adjclose）與 TWSE 除息快取計算；填息定義＝除息日起 40 個交易日內收盤 ≥ 除息前一日收盤。',
    d2: '2. 歷史填息統計僅供研究參考，不構成任何投資建議；過去填息表現不代表未來表現。',
    d3: '3. 資料涵蓋：僅含純現金股利除息事件（不含純除權配股）；若歷史期間不足 5 年或快取缺年，已於上方標註「年份不全」。',
    d4Pre: '4. 使用本工具即表示同意 ',
    d4Link: '服務條款與免責聲明',
  },
  en: {
    toCalendar: 'Ex-Dividend Calendar →',
    title: 'Single-Stock Dividend Fill Analyzer',
    subtitle: 'Inspect historical days-to-fill distribution, 40-day fill rate, and max drawdown on TWSE cash dividends.',
    placeholder: 'Enter TWSE ticker or name (e.g. 0056, 2330)',
    ariaSymbol: 'Ticker or stock name',
    submitBtn: 'Analyze History',
    examplesLabel: 'Popular:',
    loadingMsg: (sym) => `Loading ${sym} historical ex-dividend & adjusted price data…`,
    periodLabel: (from, to, count) => `Period: ${from} ~ ${to} (${count} events)`,
    yearsIncomplete: (since) => `Incomplete history (since: ${since})`,
    insufficientBanner: (count) => `Insufficient sample (${count} events, below 3-event minimum). Statistics are suppressed to prevent misleading rates.`,
    insufficientShort: 'Low sample',
    statFillRate: 'Fill Rate (within 40d)',
    statFillSub: (filled, total) => `${filled} / ${total} filled`,
    statExpiryRate: 'Matured Fill Rate (40d)',
    statExpirySub: (matured) => `${matured} matured events`,
    statAvgDays: 'Days to Fill (Avg / Med)',
    daysUnit: 'd',
    medianLabel: (d) => `Median: ${d}`,
    statMaxDrawdown: 'Max Unfilled Drawdown',
    d20Label: (v) => `D20 Fill Rate: ${v}`,
    histTitle: 'Days-to-Fill Histogram (Trading Days)',
    noHistEvents: 'No historical ex-dividend events found',
    timesUnit: 'x',
    pieTitle: 'Filled vs. Unfilled Ratio',
    noData: 'No data',
    pieAria: 'Dividend fill ratio chart',
    filledPctLabel: 'Filled Share',
    filledLegend: (n) => `Filled: ${n}`,
    unfilledLegend: (n) => `Unfilled: ${n}`,
    tableTitle: 'Historical Ex-Dividend Events',
    tableEmpty: 'No historical ex-dividend events found.',
    colExDate: 'Ex-Date',
    colCashDiv: 'Cash Div',
    colPreClose: 'Pre-Ex Close (Adj)',
    colStatus: 'Status',
    colDays: 'Days to Fill',
    colDrawdown: 'Max Drawdown %',
    statusFilled: 'Filled',
    statusUnfilled: '40d Unfilled',
    statusWatching: 'Watching',
    d1: '1. Methodology: Uses Yahoo Finance adjusted close series & TWSE dividend cache; filled = close ≥ pre-ex close within 40 trading days.',
    d2: '2. For historical research only, not investment advice; past fill speed does not predict future results.',
    d3: '3. Scope: Cash dividend events only (excludes stock dividends).',
    d4Pre: '4. By using this tool you agree to our ',
    d4Link: 'Terms & Disclaimer',
  },
  ja: {
    toCalendar: '権利落ちカレンダーへ →',
    title: '個別銘柄 配当埋め（填息）分析',
    subtitle: '台湾株の過去の現金配当における配当落ち回復日数分布・40日以内回復率・最大下落幅を確認できます。',
    placeholder: '銘柄コードまたは名前を入力（例：0056、2330）',
    ariaSymbol: '銘柄コードまたは名前',
    submitBtn: '履歴を分析',
    examplesLabel: '人気例：',
    loadingMsg: (sym) => `${sym} の過去配当・調整後終値データを読み込み中…`,
    periodLabel: (from, to, count) => `期間：${from} 〜 ${to}（計 ${count} 件）`,
    yearsIncomplete: (since) => `年数不足（データ開始：${since}）`,
    insufficientBanner: (count) => `サンプル不足（有効イベント ${count} 件、最小基準3件未満）のため統計スコアは表示しません。`,
    insufficientShort: 'サンプル不足',
    statFillRate: '配当埋め成功率（40日以内）',
    statFillSub: (filled, total) => `${filled} / ${total} 回達成`,
    statExpiryRate: '満期回復率（40日経過）',
    statExpirySub: (matured) => `満期サンプル ${matured} 件`,
    statAvgDays: '回復日数（平均 / 中央値）',
    daysUnit: '日',
    medianLabel: (d) => `中央値：${d}`,
    statMaxDrawdown: '最大下落幅（未回復）',
    d20Label: (v) => `20日回復率：${v}`,
    histTitle: '配当埋め日数ヒストグラム（営業日）',
    noHistEvents: '過去の配当イベントデータがありません',
    timesUnit: '回',
    pieTitle: '回復 / 未回復 比率',
    noData: 'データなし',
    pieAria: '配当埋め比率グラフ',
    filledPctLabel: '回復割合',
    filledLegend: (n) => `回復済：${n} 件`,
    unfilledLegend: (n) => `未回復：${n} 件`,
    tableTitle: '過去配当イベント明細',
    tableEmpty: '過去の現金配当イベントが見つかりません。',
    colExDate: '権利落日',
    colCashDiv: '現金配当',
    colPreClose: '前日終値(調整済)',
    colStatus: '状態',
    colDays: '回復日数',
    colDrawdown: '最大下落%',
    statusFilled: '回復済',
    statusUnfilled: '40日未回復',
    statusWatching: '観察中',
    d1: '1. 集計方法：Yahoo Finance 調整後終値と TWSE 配当データを用い、40営業日以内に前日終値以上へ回復した場合を「回復済」とします。',
    d2: '2. 過去統計の参考ツールであり、投資助言ではありません。',
    d3: '3. 現金配当イベントのみを対象としています。',
    d4Pre: '4. ご利用にあたり ',
    d4Link: '利用規約・免責事項',
  },
}

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
  const { locale } = useI18n()
  const t = REFILL_COPY[locale] ?? REFILL_COPY['zh-TW']
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
          href={localizePath(locale, '/ex-dividend')}
          className="text-xs font-medium text-[var(--accent)] hover:underline"
        >
          {t.toCalendar}
        </Link>
      </div>

      {/* 標題與搜尋列 */}
      <section className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)] sm:text-2xl">
              {t.title}
            </h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {t.subtitle}
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
              placeholder={t.placeholder}
              aria-label={t.ariaSymbol}
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
            {t.submitBtn}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">{t.examplesLabel}</span>
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
          <TableSkeleton rows={5} message={t.loadingMsg(activeSymbol)} />
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
                {t.periodLabel(data.data_period.from, data.data_period.to, data.stats.eventCount)}
              </span>
            </div>
            {data.years_incomplete && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t.yearsIncomplete(data.history_since ?? '—')}
              </span>
            )}
          </div>

          {/* 樣本不足提醒 */}
          {data.stats.insufficient && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{t.insufficientBanner(data.stats.eventCount)}</span>
            </div>
          )}

          {/* 4 張統計卡 */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-muted)]">{t.statFillRate}</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-[var(--text-primary)]">
                {data.stats.insufficient ? t.insufficientShort : fmtPct(data.histogram.fillRate)}
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                {t.statFillSub(data.histogram.filledCount, data.histogram.eventCount)}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-muted)]">{t.statExpiryRate}</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-[var(--text-primary)]">
                {data.stats.insufficient ? t.insufficientShort : fmtPct(data.stats.expiryFillRate)}
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                {t.statExpirySub(data.stats.maturedCount)}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-muted)]">{t.statAvgDays}</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-[var(--text-primary)]">
                {data.stats.avgFillDays != null ? `${fmtNum(data.stats.avgFillDays, 1)} ${t.daysUnit}` : '—'}
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-secondary)] tabular-nums">
                {t.medianLabel(data.histogram.medianFillDays != null ? `${data.histogram.medianFillDays} ${t.daysUnit}` : '—')}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-muted)]">{t.statMaxDrawdown}</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-rose-400">
                {data.stats.maxUnfilledDrawdownPct != null
                  ? `${fmtNum(data.stats.maxUnfilledDrawdownPct, 2)}%`
                  : '0.00%'}
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                {t.d20Label(data.stats.insufficient ? '—' : fmtPct(data.stats.fillRateD20))}
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
                  {t.histTitle}
                </h3>
              </div>

              {data.histogram.eventCount === 0 ? (
                <div className="py-10 text-center text-sm text-[var(--text-muted)]">
                  {t.noHistEvents}
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
                          {bin.count} {t.timesUnit} ({Math.round(bin.ratio * 100)}%)
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
                  {t.pieTitle}
                </h3>
              </div>

              {data.histogram.eventCount === 0 ? (
                <div className="py-10 text-center text-sm text-[var(--text-muted)]">
                  {t.noData}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-4">
                  <svg viewBox="0 0 120 120" className="h-36 w-36" role="img" aria-label={t.pieAria}>
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
                      {data.stats.insufficient ? t.insufficientShort : `${Math.round(filledRatio * 100)}%`}
                    </text>
                    <text
                      x="60"
                      y="74"
                      textAnchor="middle"
                      className="fill-[var(--text-muted)] text-[10px]"
                    >
                      {t.filledPctLabel}
                    </text>
                  </svg>

                  <div className="flex w-full justify-around text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
                      <span className="text-[var(--text-secondary)]">
                        {t.filledLegend(data.histogram.filledCount)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-500/75" />
                      <span className="text-[var(--text-secondary)]">
                        {t.unfilledLegend(data.histogram.unfilledCount)}
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
              {t.tableTitle}
            </h3>

            {sortedEvents.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--text-muted)]">
                {t.tableEmpty}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className={tableClass(typo, 'w-full min-w-[640px] border-collapse')}>
                  <thead>
                    <tr className={headTrClass(typo, 'border-b border-[var(--border)]')}>
                      {renderSortTh('exDate', t.colExDate, 'left')}
                      {renderSortTh('cashDividend', t.colCashDiv)}
                      {renderSortTh('preClose', t.colPreClose)}
                      <th className="px-3 py-2.5 text-center font-semibold text-[var(--text-secondary)]">
                        {t.colStatus}
                      </th>
                      {renderSortTh('daysToFill', t.colDays)}
                      {renderSortTh('maxDrawdownPct', t.colDrawdown)}
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
                              {t.statusFilled}
                            </span>
                          ) : ev.matured ? (
                            <span className="inline-flex rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-medium text-rose-400">
                              {t.statusUnfilled}
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-400">
                              {t.statusWatching}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-primary)]">
                          {ev.daysToFill != null ? `${ev.daysToFill} ${t.daysUnit}` : '—'}
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
            <p>{t.d1}</p>
            <p className="mt-1">{t.d2}</p>
            <p className="mt-1">{t.d3}</p>
            <p className="mt-1">
              {t.d4Pre}
              <Link href={localizePath(locale, '/terms')} className="text-[var(--accent)] underline">
                {t.d4Link}
              </Link>
              。
            </p>
          </footer>
        </div>
      )}
    </main>
  )
}
