'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  Copy,
  Search,
  X,
  LayoutList,
  LayoutGrid,
} from 'lucide-react'
import { TableSkeleton } from '@/components/table-skeleton'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'

// Issue #67 & #93 & #123：除權息填息力預測＋填息進度追蹤
// 文案紅線：僅歷史統計＋免責，禁「預測/保證」字眼；機率＝過去填息事件佔比。
// 支援：ETF分類篩選、代號/名稱即時搜尋、預設列表表格(Table View)與卡片化切換。

interface ExDividendEventFill {
  exDate: string
  preClose: number
  cashDividend: number | null
  filled: boolean
  daysToFill: number | null
  matured: boolean
  maxDrawdownPct: number
}

interface ExDividendStats {
  eventCount: number
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
  events: ExDividendEventFill[]
  yearsCovered: string[]
  years_incomplete: boolean
  history_since: string | null
}

interface ExDividendItem {
  symbol: string
  name: string | null
  ex_date: string
  ex_last_buy_date: string
  days_to_ex: number | null
  cash_dividend: number
  yield_pct: number | null
  quote_type: string
  asset_kind: 'etf' | 'stock' | 'unknown'
  asset_label: string
  stats: ExDividendStats | null
  stats_reason: 'ok' | 'insufficient' | 'no-history'
}

/** Issue #93：填息追蹤項目 */
interface ExDividendTrackingItem {
  symbol: string
  name: string | null
  ex_date: string
  cash_dividend: number
  prev_close: number
  reference_price: number
  current_price: number
  progress_pct: number
  status: 'filled' | 'filling' | 'discount'
  status_label: string
  filled_in_days: number | null
  days_since_ex: number
  asset_kind: 'etf' | 'stock' | 'unknown'
  asset_label: string
  avg_fill_days: number | null
  fill_score: number | null
}

interface ExDividendResponse {
  success: boolean
  today: string
  window_end: string
  cache_as_of: string | null
  is_trading_day: boolean
  degraded: boolean
  notice: string
  source: string
  truncated: boolean
  total: number
  items: ExDividendItem[]
  tracking_items?: ExDividendTrackingItem[]
  cached_at?: string
  from_cache?: boolean
  error?: string
}

function fmtPct(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(1)}%`
}

function countdownBadge(days: number | null): { text: string; hot: boolean } {
  if (days == null) return { text: '—', hot: false }
  if (days < 0) return { text: '已除息', hot: false }
  if (days === 0) return { text: '今日除息', hot: true }
  return { text: `T-${days}`, hot: days <= 3 }
}

export default function ExDividendPage() {
  const [data, setData] = useState<ExDividendResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'tracking' | 'upcoming'>('tracking')
  const [assetFilter, setAssetFilter] = useState<'all' | 'stock' | 'etf'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table')
  const [sortBy, setSortBy] = useState<'date' | 'score'>('date')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const typo = useTableTypography()

  useEffect(() => {
    let cancelled = false
    fetch('/api/ex-dividend')
      .then((res) => res.json())
      .then((json: ExDividendResponse) => {
        if (cancelled) return
        if (json?.success) setData(json)
        else setError(json?.error ?? '讀取失敗')
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '讀取失敗')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = (symbol: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(symbol)) next.delete(symbol)
      else next.add(symbol)
      return next
    })
  }

  const share = async () => {
    try {
      const url = window.location.href
      if (navigator.share) {
        await navigator.share({ title: '除權息填息統計', url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      try {
        await navigator.clipboard.writeText(window.location.href)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {}
    }
  }

  // 排序未來預告標的
  const sortedUpcomingItems = [...(data?.items ?? [])].sort((a, b) => {
    if (sortBy === 'score') {
      const sa = a.stats?.fillScore ?? -1
      const sb = b.stats?.fillScore ?? -1
      if (sb !== sa) return sb - sa
    }
    return a.ex_date < b.ex_date ? -1 : a.ex_date > b.ex_date ? 1 : a.symbol.localeCompare(b.symbol)
  })

  // 搜尋過濾：填息追蹤
  const filteredTrackingItems = (data?.tracking_items ?? []).filter((item) => {
    if (assetFilter === 'etf' && item.asset_kind !== 'etf') return false
    if (assetFilter === 'stock' && item.asset_kind !== 'stock') return false
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      const matchSymbol = item.symbol.toLowerCase().includes(q)
      const matchName = item.name ? item.name.toLowerCase().includes(q) : false
      if (!matchSymbol && !matchName) return false
    }
    return true
  })

  // 搜尋過濾：未來預告
  const filteredUpcomingItems = sortedUpcomingItems.filter((item) => {
    if (assetFilter === 'etf' && item.asset_kind !== 'etf') return false
    if (assetFilter === 'stock' && item.asset_kind !== 'stock') return false
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      const matchSymbol = item.symbol.toLowerCase().includes(q)
      const matchName = item.name ? item.name.toLowerCase().includes(q) : false
      if (!matchSymbol && !matchName) return false
    }
    return true
  })

  // 數量統計
  const totalTrackingCount = data?.tracking_items?.length ?? 0
  const etfTrackingCount = data?.tracking_items?.filter((i) => i.asset_kind === 'etf').length ?? 0
  const stockTrackingCount = data?.tracking_items?.filter((i) => i.asset_kind === 'stock').length ?? 0

  const totalUpcomingCount = data?.items?.length ?? 0
  const etfUpcomingCount = data?.items?.filter((i) => i.asset_kind === 'etf').length ?? 0
  const stockUpcomingCount = data?.items?.filter((i) => i.asset_kind === 'stock').length ?? 0

  const currentAllCount = tab === 'tracking' ? totalTrackingCount : totalUpcomingCount
  const currentStockCount = tab === 'tracking' ? stockTrackingCount : stockUpcomingCount
  const currentEtfCount = tab === 'tracking' ? etfTrackingCount : etfUpcomingCount

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--text-primary)]">
            除權息填息力統計與進度追蹤
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1.5 leading-relaxed">
            近期除息即時填息進度條 ＋ 未來 30 天上市與 ETF 預告，附 5 年歷史填息實證統計。
          </p>
        </div>
        <button
          onClick={share}
          className="shrink-0 self-start sm:self-auto inline-flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-lg bg-[var(--bg-card)] border border-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-white/20 transition"
        >
          <Copy className="w-3.5 h-3.5" />
          {copied ? '已複製連結' : '分享頁面'}
        </button>
      </div>

      {loading && (
        <TableSkeleton message="載入除權息資料中…" hint="彙整 TWSE 預告與 5 年歷史回測數據，請稍候…" />
      )}

      {!loading && error && (
        <div className="rounded-xl bg-[var(--bg-card)] border border-red-500/30 p-4 text-sm text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>讀取失敗：{error}</span>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* 資料時間與說明條 */}
          <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-3.5 text-xs text-[var(--text-secondary)] leading-relaxed space-y-1">
            <p className="flex items-start gap-2">
              <CalendarDays className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent)]" />
              <span>
                資料時間：{data.cache_as_of ?? '無快取紀錄'}（今日 {data.today}
                {data.is_trading_day ? '' : '，非交易日'}；預告窗口至 {data.window_end}，共 {data.total} 檔
                {data.truncated ? '，僅顯示前 60 檔' : ''}）。
              </span>
            </p>
            {data.degraded && (
              <p className="flex items-start gap-2 text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>預告快取非最新（降級顯示），除息日可能異動，請以 TWSE 公告為準。</span>
              </p>
            )}
            {!data.degraded && <p>{data.notice}</p>}
          </div>

          {/* Tab 切換：近期填息追蹤 vs 未來預告 */}
          <div className="flex border-b border-white/10 gap-6 pt-1">
            <button
              onClick={() => setTab('tracking')}
              className={`pb-2.5 text-sm font-semibold border-b-2 transition flex items-center gap-1.5 ${
                tab === 'tracking'
                  ? 'border-[var(--accent)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              <span>🔥 近期除息·填息進度追蹤</span>
              <span className="text-xs px-1.5 py-0.2 rounded-full bg-white/10 font-mono">
                {totalTrackingCount}
              </span>
            </button>
            <button
              onClick={() => setTab('upcoming')}
              className={`pb-2.5 text-sm font-semibold border-b-2 transition flex items-center gap-1.5 ${
                tab === 'upcoming'
                  ? 'border-[var(--accent)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              <span>📅 未來 30 天預告</span>
              <span className="text-xs px-1.5 py-0.2 rounded-full bg-white/10 font-mono">
                {totalUpcomingCount}
              </span>
            </button>
          </div>

          {/* 綜合工具列：搜尋框 + ETF/個股分類篩選 + 視圖切換 (Table / Card) */}
          <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* 搜尋與分類 */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1 min-w-0">
              {/* 搜尋框 */}
              <div className="relative flex-1 min-w-[180px] max-w-sm">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜尋代號或名稱，如 0056、台積電"
                  className="w-full pl-8 pr-7 py-1.5 bg-black/20 border border-white/10 rounded-lg text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* ETF / 個股 分類篩選（Issue #123） */}
              <div className="inline-flex rounded-lg bg-black/20 p-0.5 border border-white/10 self-start sm:self-auto shrink-0">
                <button
                  type="button"
                  onClick={() => setAssetFilter('all')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    assetFilter === 'all'
                      ? 'bg-[var(--accent)] text-black font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  全部 ({currentAllCount})
                </button>
                <button
                  type="button"
                  onClick={() => setAssetFilter('stock')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    assetFilter === 'stock'
                      ? 'bg-[var(--accent)] text-black font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  個股 ({currentStockCount})
                </button>
                <button
                  type="button"
                  onClick={() => setAssetFilter('etf')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    assetFilter === 'etf'
                      ? 'bg-[var(--accent)] text-black font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  ETF ({currentEtfCount})
                </button>
              </div>
            </div>

            {/* 右側：視圖切換器（表格 vs 卡片）與排序 */}
            <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
              {tab === 'upcoming' && (
                <div className="flex items-center gap-1 text-xs text-[var(--text-secondary)] mr-1">
                  <span>排序：</span>
                  <button
                    onClick={() => setSortBy('date')}
                    className={`px-2 py-1 rounded border text-xs transition ${
                      sortBy === 'date'
                        ? 'border-[var(--accent)] text-[var(--text-primary)] bg-white/5'
                        : 'border-white/10 text-[var(--text-secondary)]'
                    }`}
                  >
                    除息日
                  </button>
                  <button
                    onClick={() => setSortBy('score')}
                    className={`px-2 py-1 rounded border text-xs transition ${
                      sortBy === 'score'
                        ? 'border-[var(--accent)] text-[var(--text-primary)] bg-white/5'
                        : 'border-white/10 text-[var(--text-secondary)]'
                    }`}
                  >
                    填息力
                  </button>
                </div>
              )}

              {/* 視圖切換器（預設表格） */}
              <div className="inline-flex rounded-lg bg-black/20 p-0.5 border border-white/10">
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  title="列表表格檢視（預設）"
                  className={`px-2 py-1 rounded-md text-xs flex items-center gap-1 transition ${
                    viewMode === 'table'
                      ? 'bg-white/15 text-[var(--text-primary)] font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  <LayoutList className="w-3.5 h-3.5" />
                  <span>列表表格</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('card')}
                  title="卡片化檢視"
                  className={`px-2 py-1 rounded-md text-xs flex items-center gap-1 transition ${
                    viewMode === 'card'
                      ? 'bg-white/15 text-[var(--text-primary)] font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>卡片</span>
                </button>
              </div>
            </div>
          </div>

          {/* ═══════════ Tab 1: 近期除息·填息進度追蹤 ═══════════ */}
          {tab === 'tracking' && (
            <>
              {filteredTrackingItems.length === 0 ? (
                <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-8 text-sm text-[var(--text-secondary)] text-center space-y-1">
                  <p className="font-medium text-[var(--text-primary)]">查無符合條件的除息標的</p>
                  <p className="text-xs">請嘗試調整搜尋關鍵字或分類篩選條件。</p>
                </div>
              ) : viewMode === 'table' ? (
                /* ── 列表表格模式（Table View，預設） ── */
                <div className="overflow-x-auto rounded-xl border border-white/5 bg-[var(--bg-card)]">
                  <table className={tableClass(typo, 'w-full text-xs')}>
                    <thead>
                      <tr className={headTrClass(typo, 'text-left text-[var(--text-secondary)] bg-white/[0.02] border-b border-white/5 whitespace-nowrap')}>
                        <th className="px-3.5 py-2.5 font-medium">狀態</th>
                        <th className="px-3 py-2.5 font-medium">標的</th>
                        <th className="px-3 py-2.5 font-medium">除息日</th>
                        <th className="px-3 py-2.5 font-medium text-right">現金股利</th>
                        <th className="px-3 py-2.5 font-medium text-right">除息前收 / 參考價</th>
                        <th className="px-3 py-2.5 font-medium text-right">最新現價</th>
                        <th className="px-3.5 py-2.5 font-medium min-w-[150px]">填息進度</th>
                        <th className="px-3.5 py-2.5 font-medium">填息天數實證</th>
                        <th className="px-3 py-2.5 font-medium text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredTrackingItems.map((item) => {
                        const isFilled = item.status === 'filled'
                        const isFilling = item.status === 'filling'
                        const barWidth = Math.min(100, Math.max(0, item.progress_pct))

                        return (
                          <tr key={item.symbol} className="hover:bg-white/[0.02] transition">
                            {/* 狀態標籤 */}
                            <td className="px-3.5 py-3 whitespace-nowrap">
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded font-semibold border ${
                                  isFilled
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                    : isFilling
                                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                                      : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                                }`}
                              >
                                {item.status_label}
                              </span>
                            </td>

                            {/* 標的代號與名稱 */}
                            <td className="px-3 py-3 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <Link
                                  href={`/odd-lot?symbol=${item.symbol}`}
                                  className="font-bold text-sm font-mono text-[var(--accent)] hover:underline"
                                >
                                  {item.symbol}
                                </Link>
                                {item.name && (
                                  <span className="text-xs text-[var(--text-primary)] max-w-[110px] truncate" title={item.name}>
                                    {item.name}
                                  </span>
                                )}
                                <span className="text-[10px] px-1 py-px rounded border border-white/10 text-[var(--text-secondary)]">
                                  {item.asset_label}
                                </span>
                              </div>
                            </td>

                            {/* 除息日 */}
                            <td className="px-3 py-3 whitespace-nowrap">
                              <span className="font-mono text-zinc-300">{item.ex_date}</span>
                              <span className="text-[10px] text-[var(--text-secondary)] block">
                                第 {item.days_since_ex} 交易日
                              </span>
                            </td>

                            {/* 現金股利 */}
                            <td className="px-3 py-3 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                              NT$ {item.cash_dividend}
                            </td>

                            {/* 前收 / 參考價 */}
                            <td className="px-3 py-3 text-right font-mono whitespace-nowrap text-zinc-300">
                              <div>{item.prev_close}</div>
                              <div className="text-[10px] text-zinc-400">參考 {item.reference_price}</div>
                            </td>

                            {/* 最新現價 */}
                            <td className="px-3 py-3 text-right font-mono font-bold text-sm text-zinc-100 whitespace-nowrap">
                              {item.current_price}
                            </td>

                            {/* 填息進度條 */}
                            <td className="px-3.5 py-3 min-w-[150px]">
                              <div className="space-y-1">
                                <div className="flex justify-between items-center text-[11px] font-mono">
                                  <span className="text-[var(--text-secondary)]">進度</span>
                                  <span
                                    className={`font-bold ${
                                      isFilled ? 'text-emerald-400' : isFilling ? 'text-blue-400' : 'text-rose-400'
                                    }`}
                                  >
                                    {item.progress_pct}%
                                  </span>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${
                                      isFilled
                                        ? 'bg-emerald-500'
                                        : isFilling
                                          ? 'bg-blue-500'
                                          : 'bg-rose-500'
                                    }`}
                                    style={{ width: `${barWidth}%` }}
                                  />
                                </div>
                              </div>
                            </td>

                            {/* 填息天數實證 */}
                            <td className="px-3.5 py-3 whitespace-nowrap text-[11px] text-[var(--text-secondary)]">
                              {item.avg_fill_days != null ? (
                                <span>
                                  歷史平均 <strong className="text-zinc-200">{item.avg_fill_days} 天</strong>
                                  {item.fill_score != null ? `（${item.fill_score}分）` : ''}
                                </span>
                              ) : (
                                <span className="text-zinc-400">歷史樣本不足</span>
                              )}
                            </td>

                            {/* 操作 */}
                            <td className="px-3 py-3 text-right whitespace-nowrap">
                              <Link
                                href={`/odd-lot?symbol=${item.symbol}`}
                                className="text-xs text-[var(--accent)] hover:underline"
                              >
                                零股 →
                              </Link>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* ── 卡片模式（Card View） ── */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredTrackingItems.map((item) => {
                    const isFilled = item.status === 'filled'
                    const isFilling = item.status === 'filling'
                    const barWidth = Math.min(100, Math.max(0, item.progress_pct))

                    return (
                      <div key={item.symbol} className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 min-w-0 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Link
                              href={`/odd-lot?symbol=${item.symbol}`}
                              className="font-bold text-base text-[var(--text-primary)] hover:text-[var(--accent)] transition"
                            >
                              {item.symbol}
                            </Link>
                            {item.name && (
                              <span className="text-xs text-[var(--text-secondary)] truncate">{item.name}</span>
                            )}
                            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-[var(--text-secondary)]">
                              {item.asset_label}
                            </span>
                          </div>

                          <span
                            className={`text-[11px] px-2 py-0.5 rounded font-medium border ${
                              isFilled
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : isFilling
                                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            }`}
                          >
                            {item.status_label}
                          </span>
                        </div>

                        {/* 價格與股利 3 欄 */}
                        <div className="grid grid-cols-3 gap-2 text-center text-xs py-2 bg-black/20 rounded-lg">
                          <div>
                            <div className="text-[10px] text-[var(--text-secondary)]">除息日 / 股利</div>
                            <div className="font-semibold text-zinc-200 mt-0.5">{item.ex_date}</div>
                            <div className="text-[11px] text-emerald-400 font-mono mt-0.5">NT$ {item.cash_dividend}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-[var(--text-secondary)]">前收 / 參考價</div>
                            <div className="font-mono text-zinc-300 mt-0.5">{item.prev_close}</div>
                            <div className="text-[11px] text-zinc-400 font-mono mt-0.5">參考 {item.reference_price}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-[var(--text-secondary)]">最新現價</div>
                            <div className="font-mono font-bold text-base text-zinc-100 mt-0.5">{item.current_price}</div>
                            <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">除息第 {item.days_since_ex} 交易日</div>
                          </div>
                        </div>

                        {/* 填息進度條 */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs">
                            <span className="text-[var(--text-secondary)]">填息進度</span>
                            <span
                              className={`font-mono font-semibold ${
                                isFilled ? 'text-emerald-400' : isFilling ? 'text-blue-400' : 'text-rose-400'
                              }`}
                            >
                              {item.progress_pct}%
                            </span>
                          </div>

                          <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isFilled
                                  ? 'bg-emerald-500'
                                  : isFilling
                                    ? 'bg-blue-500'
                                    : 'bg-rose-500'
                              }`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>

                        {/* 歷史天數對照錨點 */}
                        <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] pt-1 border-t border-white/5">
                          <div>
                            {item.avg_fill_days != null ? (
                              <span>
                                歷史平均 <strong className="text-zinc-200">{item.avg_fill_days} 天</strong> 填息
                                {item.fill_score != null ? `（填息力 ${item.fill_score} 分）` : ''}
                              </span>
                            ) : (
                              <span>歷史填息紀錄樣本不足</span>
                            )}
                          </div>
                          <Link
                            href={`/odd-lot?symbol=${item.symbol}`}
                            className="text-[var(--accent)] hover:underline"
                          >
                            零股行情 →
                          </Link>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* ═══════════ Tab 2: 未來 30 天預告 ═══════════ */}
          {tab === 'upcoming' && (
            <>
              {filteredUpcomingItems.length === 0 ? (
                <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-8 text-sm text-[var(--text-secondary)] text-center space-y-1">
                  <p className="font-medium text-[var(--text-primary)]">查無符合條件的除權息預告</p>
                  <p className="text-xs">請嘗試調整搜尋關鍵字或分類篩選條件。</p>
                </div>
              ) : viewMode === 'table' ? (
                /* ── 列表表格模式（Table View，預設） ── */
                <div className="overflow-x-auto rounded-xl border border-white/5 bg-[var(--bg-card)]">
                  <table className={tableClass(typo, 'w-full text-xs')}>
                    <thead>
                      <tr className={headTrClass(typo, 'text-left text-[var(--text-secondary)] bg-white/[0.02] border-b border-white/5 whitespace-nowrap')}>
                        <th className="px-3.5 py-2.5 font-medium">倒數</th>
                        <th className="px-3 py-2.5 font-medium">標的</th>
                        <th className="px-3 py-2.5 font-medium">除息日</th>
                        <th className="px-3 py-2.5 font-medium">最後買進日</th>
                        <th className="px-3 py-2.5 font-medium text-right">現金股利</th>
                        <th className="px-3 py-2.5 font-medium text-right">預估殖利率</th>
                        <th className="px-3 py-2.5 font-medium text-right">填息力評分</th>
                        <th className="px-3.5 py-2.5 font-medium">歷史平均填息</th>
                        <th className="px-3 py-2.5 font-medium text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredUpcomingItems.map((item) => {
                        const cd = countdownBadge(item.days_to_ex)
                        const st = item.stats
                        const open = expanded.has(item.symbol)

                        return (
                          <>
                            <tr key={item.symbol} className="hover:bg-white/[0.02] transition">
                              {/* 倒數標籤 */}
                              <td className="px-3.5 py-3 whitespace-nowrap">
                                <span
                                  className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                                    cd.hot ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-[var(--text-secondary)]'
                                  }`}
                                >
                                  {cd.text}
                                </span>
                              </td>

                              {/* 標的 */}
                              <td className="px-3 py-3 whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  <Link
                                    href={`/odd-lot?symbol=${item.symbol}`}
                                    className="font-bold text-sm font-mono text-[var(--accent)] hover:underline"
                                  >
                                    {item.symbol}
                                  </Link>
                                  {item.name && (
                                    <span className="text-xs text-[var(--text-primary)] max-w-[120px] truncate" title={item.name}>
                                      {item.name}
                                    </span>
                                  )}
                                  <span className="text-[10px] px-1 py-px rounded border border-white/10 text-[var(--text-secondary)]">
                                    {item.asset_label}
                                  </span>
                                </div>
                              </td>

                              {/* 除息日 */}
                              <td className="px-3 py-3 font-mono font-medium text-zinc-200 whitespace-nowrap">
                                {item.ex_date}
                              </td>

                              {/* 最後買進日 */}
                              <td className="px-3 py-3 font-mono text-zinc-300 whitespace-nowrap">
                                {item.ex_last_buy_date || '—'}
                              </td>

                              {/* 現金股利 */}
                              <td className="px-3 py-3 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                                NT$ {item.cash_dividend}
                              </td>

                              {/* 預估殖利率 */}
                              <td className="px-3 py-3 text-right font-mono font-medium text-zinc-100 whitespace-nowrap">
                                {item.yield_pct != null ? `${item.yield_pct}%` : '—'}
                              </td>

                              {/* 填息力評分 */}
                              <td className="px-3 py-3 text-right font-mono whitespace-nowrap">
                                {st && st.fillScore != null ? (
                                  <span className="font-bold text-amber-400">{st.fillScore} 分</span>
                                ) : (
                                  <span className="text-zinc-400">樣本不足</span>
                                )}
                              </td>

                              {/* 歷史平均填息 */}
                              <td className="px-3.5 py-3 whitespace-nowrap text-[11px]">
                                {st && st.avgFillDays != null ? (
                                  <span className="text-zinc-200 font-mono">
                                    平均 <strong>{st.avgFillDays}</strong> 天（{st.eventCount} 次除息）
                                  </span>
                                ) : (
                                  <span className="text-[var(--text-secondary)]">無足夠歷史</span>
                                )}
                              </td>

                              {/* 操作 */}
                              <td className="px-3 py-3 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => toggle(item.symbol)}
                                  className="text-xs text-[var(--accent)] hover:underline inline-flex items-center gap-0.5"
                                >
                                  <span>{open ? '收起' : '明細'}</span>
                                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                                </button>
                              </td>
                            </tr>

                            {/* 展開之歷史填息明細行 */}
                            {open && (
                              <tr key={`${item.symbol}-detail`} className="bg-black/30">
                                <td colSpan={9} className="px-4 py-3 border-b border-white/5 space-y-2">
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                    <div className="p-2 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">次日填息機率 (D1)</div>
                                      <div className="font-mono font-bold text-zinc-200">{fmtPct(st?.fillRateD1 ?? null)}</div>
                                    </div>
                                    <div className="p-2 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">5日填息機率 (D5)</div>
                                      <div className="font-mono font-bold text-zinc-200">{fmtPct(st?.fillRateD5 ?? null)}</div>
                                    </div>
                                    <div className="p-2 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">20日填息機率 (D20)</div>
                                      <div className="font-mono font-bold text-zinc-200">{fmtPct(st?.fillRateD20 ?? null)}</div>
                                    </div>
                                    <div className="p-2 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">貼息最大拉回幅度</div>
                                      <div className="font-mono font-bold text-rose-400">
                                        {st?.maxUnfilledDrawdownPct != null ? `-${(st.maxUnfilledDrawdownPct * 100).toFixed(1)}%` : '—'}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] pt-1">
                                    <span>
                                      回溯期間：{st?.yearsCovered?.join('、') ?? '無紀錄'} 年（共 {st?.eventCount ?? 0} 次除息紀錄）
                                    </span>
                                    <Link href={`/odd-lot?symbol=${item.symbol}`} className="text-[var(--accent)] hover:underline">
                                      查看 {item.symbol} 零股盤後報價 →
                                    </Link>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* ── 卡片模式（Card View） ── */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredUpcomingItems.map((item) => {
                    const cd = countdownBadge(item.days_to_ex)
                    const open = expanded.has(item.symbol)
                    const st = item.stats
                    return (
                      <div key={item.symbol} className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 min-w-0">
                        <button onClick={() => toggle(item.symbol)} className="w-full text-left min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-bold text-[var(--text-primary)]">{item.symbol}</span>
                              {item.name && (
                                <span className="text-xs text-[var(--text-secondary)] truncate">{item.name}</span>
                              )}
                              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-[var(--text-secondary)]">
                                {item.asset_label}
                              </span>
                            </div>
                            <span className="flex items-center gap-1 shrink-0">
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded-full ${cd.hot ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-[var(--text-secondary)]'}`}
                              >
                                {cd.text}
                              </span>
                              <ChevronDown className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`} />
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                            <div className="min-w-0">
                              <div className="text-[10px] text-[var(--text-secondary)]">除息日</div>
                              <div className="text-xs font-semibold text-[var(--text-primary)]">{item.ex_date}</div>
                              <div className="text-[10px] text-[var(--text-secondary)] truncate">
                                最後買進 {item.ex_last_buy_date || '—'}
                              </div>
                            </div>
                            <div className="min-w-0">
                              <div className="text-[10px] text-[var(--text-secondary)]">現金股利</div>
                              <div className="text-xs font-semibold text-emerald-400 font-mono">
                                NT$ {item.cash_dividend}
                              </div>
                              <div className="text-[10px] text-[var(--text-secondary)]">
                                {item.yield_pct != null ? `殖利率 ${item.yield_pct}%` : '殖利率 —'}
                              </div>
                            </div>
                            <div className="min-w-0">
                              <div className="text-[10px] text-[var(--text-secondary)]">填息力</div>
                              <div className="text-xs font-semibold text-[var(--accent)] font-mono">
                                {st && st.fillScore != null ? `${st.fillScore} 分` : '樣本不足'}
                              </div>
                              <div className="text-[10px] text-[var(--text-secondary)]">
                                {st && st.avgFillDays != null ? `平均 ${st.avgFillDays} 天` : '—'}
                              </div>
                            </div>
                          </div>
                        </button>

                        {open && (
                          <div className="mt-3 pt-3 border-t border-white/5 space-y-3 text-xs">
                            {st && !st.insufficient ? (
                              <>
                                <div>
                                  <div className="text-[11px] font-semibold text-[var(--text-primary)] mb-1.5">
                                    過去填息機率（共 {st.eventCount} 次除息紀錄）
                                  </div>
                                  <div className="grid grid-cols-4 gap-1.5 text-center text-[11px]">
                                    <div className="p-1.5 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">次日 (D1)</div>
                                      <div className="font-mono text-zinc-200">{fmtPct(st.fillRateD1)}</div>
                                    </div>
                                    <div className="p-1.5 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">5日 (D5)</div>
                                      <div className="font-mono text-zinc-200">{fmtPct(st.fillRateD5)}</div>
                                    </div>
                                    <div className="p-1.5 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">10日 (D10)</div>
                                      <div className="font-mono text-zinc-200">{fmtPct(st.fillRateD10)}</div>
                                    </div>
                                    <div className="p-1.5 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">20日 (D20)</div>
                                      <div className="font-mono text-zinc-200">{fmtPct(st.fillRateD20)}</div>
                                    </div>
                                  </div>
                                </div>

                                <div className="p-2 rounded bg-white/5 text-[11px] text-[var(--text-secondary)] space-y-0.5">
                                  <div>
                                    未填息最大拉回：
                                    <span className="text-rose-400 font-mono">
                                      {st.maxUnfilledDrawdownPct != null ? `-${(st.maxUnfilledDrawdownPct * 100).toFixed(1)}%` : '—'}
                                    </span>
                                  </div>
                                  <div>回溯年份：{st.yearsCovered.join('、')} 年</div>
                                </div>
                              </>
                            ) : (
                              <div className="p-3 rounded bg-white/5 text-[11px] text-[var(--text-secondary)]">
                                歷史除權息紀錄少於 3 次，樣本不足以計算填息機率。
                              </div>
                            )}

                            <div className="flex justify-between items-center pt-1 text-[11px]">
                              <Link
                                href={`/odd-lot?symbol=${item.symbol}`}
                                className="text-[var(--accent)] hover:underline"
                              >
                                查看 {item.symbol} 零股行情 →
                              </Link>
                              <span className="text-[10px] text-[var(--text-secondary)]">
                                統計僅供參考，過去表現不代表未來獲利保證
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* 底部免責宣告 */}
          <div className="rounded-xl bg-black/20 border border-white/5 p-3 text-[11px] text-[var(--text-secondary)] leading-relaxed space-y-1">
            <p className="font-medium text-zinc-300">⚠️ 除權息統計說明與合規聲明：</p>
            <p>
              1. 填息進度計算公式：<code className="text-zinc-200">(最新現價 - 除息參考價) / 現金股利 × 100%</code>。現價收復除息前收盤價即判定已填息；跌破參考價則為貼息。
            </p>
            <p>
              2. 本頁所有「填息天數」、「填息機率」均為客觀歷史統計事實，不含任何主觀投資買賣建議或獲利保證。實際除權息日、參考價與配息金額請以台灣證券交易所（TWSE）正式公告為準。
            </p>
          </div>
        </>
      )}
    </div>
  )
}
