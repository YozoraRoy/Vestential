'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
} from 'recharts'
import { Search as SearchIcon, TrendingDown, Target, Repeat, Clock, AlertTriangle, RefreshCw, ChevronDown, ChevronUp, ArrowUpDown, ArrowUp, ArrowDown, HelpCircle, Activity, ListOrdered, X, Zap, SlidersHorizontal, CheckCircle2, Info, Sparkles } from 'lucide-react'
import { searchStocks, StockCandidateList, type StockCandidate } from '@/components/stock-search'
import { buildBacktestInsight } from '@/lib/backtest-interpret'
import { useI18n } from '@/i18n/LanguageProvider'
import type { Dict } from '@/i18n/dictionaries'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'

interface SeriesPoint {
  date: number
  close: number
  ma60: number | null
  bias: number | null
  trigger: boolean
}

interface Trade {
  entryDate: number
  entryPrice: number
  outcome: 'win' | 'loss' | 'neutral'
  daysToTarget: number | null
}

interface ThresholdRow {
  threshold: number
  totalTrades: number
  winRate: number | null
  trades: Trade[]
}

type SortKey = 'threshold' | 'totalTrades' | 'winRate'

type Suggestion = StockCandidate

interface BacktestResponse {
  bestThreshold: number
  totalTrades: number
  winRate: number | null
  avgDaysToTarget: number | null
  wins: number
  losses: number
  neutral: number
  belowTarget: boolean
  allThresholds: ThresholdRow[]
  series: SeriesPoint[]
  usage: { startDate: number; endDate: number; dataPoints: number; entryThresholdPct: number }
}

interface LiveBias {
  symbol: string
  ma60: number
  latestClose: number
  latestBias: number | null
  livePrice: number | null
  livePriceBias: number | null
  asOf: number
}

interface TopVolumeItem {
  rank: number
  symbol: string
  name: string
  volume: number
  value?: number
  price?: number
}

type TopVolumeRange = 'day' | 'week' | 'month' | 'quarter'

interface TopInsight {
  symbol: string
  bestThreshold: number | null
  currentBias: number | null
  latestBias: number | null
  latestClose: number | null
  ma60: number | null
  livePrice: number | null
  livePriceBias: number | null
  asOf: number | null
  targetPrice: number | null
  inEntryZone: boolean
  distanceToTargetPct: number | null
}

function fmtPct(v: number | null): string {
  if (v == null) return '—'
  return `${(v * 100).toFixed(1)}%`
}

function fmtDays(v: number | null, unitStr: string): string {
  if (v == null) return '—'
  return unitStr.replace('{n}', v.toFixed(1))
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function fmtPriceRange(trades: Trade[]): string {
  if (!trades || trades.length === 0) return '—'
  const prices = trades.map((t) => t.entryPrice)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  if (min === max) return min.toFixed(2)
  return `${min.toFixed(2)} ~ ${max.toFixed(2)}`
}

/** 成交量格式化：億/萬。 */
function fmtVolume(v: number, billionStr: string, tenThousandStr: string): string {
  if (v >= 1e8) return billionStr.replace('{n}', (v / 1e8).toFixed(2))
  if (v >= 1e4) return tenThousandStr.replace('{n}', (v / 1e4).toFixed(1))
  return `${Math.round(v)}`
}

/** 送出一筆功能使用事件（伺服器會依登入狀態歸屬帳號）。keepalive 避免遺失、不阻擋。 */
function trackEvent(event: 'page_view' | 'backtest_run', symbol?: string) {
  try {
    fetch('/api/backtest/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, symbol: symbol ?? null }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <ArrowUpDown className="w-3.5 h-3.5 inline ml-1 text-[var(--text-secondary)] opacity-60" />
  return dir === 'asc' ? (
    <ArrowUp className="w-3.5 h-3.5 inline ml-1 text-[var(--accent)]" />
  ) : (
    <ArrowDown className="w-3.5 h-3.5 inline ml-1 text-[var(--accent)]" />
  )
}

function OutcomeBadge({ outcome, dict }: { outcome: Trade['outcome']; dict: Dict }) {
  const ui = dict.backtest
  if (outcome === 'win') {
    return <span className="text-[var(--accent-green)] font-medium">{ui.outcomeWin}</span>
  }
  if (outcome === 'loss') return <span className="text-[var(--accent-red)] font-medium">{ui.outcomeLoss}</span>
  return <span className="text-[var(--text-secondary)]">{ui.outcomeNeutral}</span>
}

/** 欄位說明的「？」圖示，滑鼠懸停顯示 tooltip（可含公式）。align 控制 tooltip 相對圖示的水平對齊，靠邊欄位請用 'left' 以避免被裁切。 */
function HelpCell({ text, align = 'center' }: { text: string; align?: 'left' | 'center' | 'right' }) {
  const alignCls = align === 'left' ? 'left-0' : align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'
  return (
    <span className="relative inline-flex items-center ml-1.5 group/help">
      <HelpCircle className="w-3.5 h-3.5 text-[var(--text-secondary)] cursor-help" />
      <span
        className={`pointer-events-none absolute top-full ${alignCls} mt-1 z-30 w-64 hidden group-hover/help:block p-3 rounded-lg bg-[var(--bg-card)] border border-white/10 shadow-xl text-[11px] leading-relaxed text-[var(--text-primary)] font-normal text-left`}
      >
        {text}
      </span>
    </span>
  )
}

/** 可排序的表格欄位標題，含排序箭頭與說明 tooltip。 */
function HeaderCell({
  label,
  sortable,
  active,
  dir,
  onSort,
  help,
  helpAlign,
}: {
  label: string
  sortable?: boolean
  active?: boolean
  dir?: 'asc' | 'desc'
  onSort?: () => void
  help: string
  helpAlign?: 'left' | 'center' | 'right'
}) {
  const base = 'px-4 py-2 text-left ' + (sortable ? 'cursor-pointer select-none hover:text-[var(--text-primary)]' : '')
  return (
    <th className={base} onClick={sortable ? onSort : undefined}>
      <span className="inline-flex items-center">
        {label}
        {sortable && active !== undefined && dir && <SortIcon active={active} dir={dir} />}
        <HelpCell text={help} align={helpAlign} />
      </span>
    </th>
  )
}

function getColumnHelp(dict: Dict): Record<string, string> {
  const ui = dict.backtest
  return {
    threshold: ui.tableHelpThreshold,
    totalTrades: ui.tableHelpTrades,
    winRate: ui.tableHelpWinRate,
    range: ui.tableHelpPriceRange,
  }
}

function parsePresetText(raw: string) {
  const match = raw.match(/^(.*?)\s*\((.*?)\)$/)
  if (match) {
    return { title: match[1].trim(), desc: match[2].trim() }
  }
  return { title: raw, desc: '' }
}

/** Issue #19 點子流：preset 代號對應的回測參數（URL ?preset= 與一鍵跳轉共用）。 */
const PRESET_PARAMS = {
  short: { years: '5', holdingDays: '40', targetPct: '8', stopPct: '5' },
  medium: { years: '10', holdingDays: '120', targetPct: '15', stopPct: '8' },
  long: { years: '15', holdingDays: '252', targetPct: '25', stopPct: '12' },
} as const

export default function BacktestPage() {
  const { dict, locale } = useI18n()
  const ui = dict.backtest
  const columnHelp = getColumnHelp(dict)
  const typo = useTableTypography()
  const [symbol, setSymbol] = useState('')
  const [stockName, setStockName] = useState('')
  const [holdingDays, setHoldingDays] = useState('252')
  const [targetPct, setTargetPct] = useState('25')
  const [stopPct, setStopPct] = useState('12')
  const [years, setYears] = useState('15')

  type PresetType = 'short' | 'medium' | 'long' | 'custom'

  const applyPreset = (type: 'short' | 'medium' | 'long') => {
    if (type === 'short') {
      setYears('5')
      setHoldingDays('40')
      setTargetPct('8')
      setStopPct('5')
    } else if (type === 'medium') {
      setYears('10')
      setHoldingDays('120')
      setTargetPct('15')
      setStopPct('8')
    } else if (type === 'long') {
      setYears('15')
      setHoldingDays('252')
      setTargetPct('25')
      setStopPct('12')
    }
  }

  const getActivePreset = (): PresetType => {
    if (years === '5' && holdingDays === '40' && targetPct === '8' && stopPct === '5') return 'short'
    if (years === '10' && holdingDays === '120' && targetPct === '15' && stopPct === '8') return 'medium'
    if (years === '15' && holdingDays === '252' && targetPct === '25' && stopPct === '12') return 'long'
    return 'custom'
  }
  const activePreset = getActivePreset()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BacktestResponse | null>(null)
  const [expandedThreshold, setExpandedThreshold] = useState<number | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('threshold')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [searching, setSearching] = useState(false)
  const [liveBias, setLiveBias] = useState<LiveBias | null>(null)
  const [biasSource, setBiasSource] = useState<'close' | 'live'>('close')
  const [showExplain, setShowExplain] = useState(false)
  const [showTop, setShowTop] = useState(false)
  const [topRange, setTopRange] = useState<TopVolumeRange>('day')
  const [topList, setTopList] = useState<TopVolumeItem[]>([])
  const [topLoading, setTopLoading] = useState(false)
  const [topError, setTopError] = useState<string | null>(null)
  const [topInsights, setTopInsights] = useState<Record<string, TopInsight | 'loading' | 'error'>>({})
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  // debounce 共用搜尋（/api/stocks/search）搜尋台股（支援代號與中文名稱）
  useEffect(() => {
    const q = symbol.trim()
    if (!q) {
      setSuggestions([])
      setShowDropdown(false)
      setSearching(false)
      setStockName('')
      return
    }
    setSearching(true)
    setShowDropdown(true)
    const t = setTimeout(async () => {
      try {
        const results = await searchStocks(q, 'tw')
        setSuggestions(results)
        // 自動檢查是否已有完全匹配的代號或名稱
        const exactMatch = results.find(
          (r) => r.symbol.toUpperCase() === q.toUpperCase() || r.name === q
        )
        if (exactMatch) {
          setStockName(exactMatch.name)
        } else if (results.length === 1 && (results[0].symbol.toUpperCase().startsWith(q.toUpperCase()) || results[0].name.includes(q))) {
          setStockName(results[0].name)
        }
      } catch {
        setSuggestions([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [symbol])

  // 點選下拉選項 → 填入代號並自動回測
  const pickStock = (s: Suggestion) => {
    setSymbol(s.symbol)
    setStockName(s.name)
    setShowDropdown(false)
    void runFromSymbol(s.symbol, s.name)
  }

  // 點擊外部關閉下拉
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(ev.target as Node)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // 造訪回測頁記錄（僅 mount 一次，避免 HMR/重渲染重複計），並支援 URL 參數自動帶入回測
  useEffect(() => {
    trackEvent('page_view')
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const paramSym = params.get('symbol')
    if (paramSym) {
      const cleanSym = paramSym.replace(/\.(TW|TWO)$/i, '').trim()
      setSymbol(cleanSym)
      runWithPreset(cleanSym, undefined, params.get('preset'))
    }
  }, [])

  const runFromSymbol = async (
    sym: string,
    nameOpt?: string,
    overrideParams?: { holdingDays?: string; targetPct?: string; stopPct?: string; years?: string },
  ) => {
    setLoading(true)
    setError(null)
    setResult(null)
    setLiveBias(null)
    setExpandedThreshold(null)
    if (nameOpt) {
      setStockName(nameOpt)
    } else if (!stockName) {
      void searchStocks(sym, 'tw').then((res) => {
        const m = res.find((r) => r.symbol.toUpperCase() === sym.toUpperCase()) ?? res[0]
        if (m) setStockName(m.name)
      }).catch(() => {})
    }
    trackEvent('backtest_run', sym)
    try {
      const qs = new URLSearchParams({
        symbol: sym,
        holdingDays: overrideParams?.holdingDays ?? holdingDays ?? '252',
        target: overrideParams?.targetPct ?? targetPct ?? '25',
        stop: overrideParams?.stopPct ?? stopPct ?? '12',
        years: overrideParams?.years ?? years ?? '15',
      })
      const res = await fetch(`/api/backtest?${qs.toString()}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? ui.errorBacktestFailed)
        return
      }
      setResult(data)
      try {
        const lb = await fetch(`/api/backtest/live-bias?symbol=${encodeURIComponent(sym)}`)
        if (lb.ok) setLiveBias(await lb.json())
      } catch (_) {}
    } catch {
      setError(ui.errorNetwork)
    } finally {
      setLoading(false)
    }
  }

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const sym = symbol.trim()
    if (!sym) return
    setShowDropdown(false)
    await runFromSymbol(sym, stockName)
  }

  // Issue #19 點子流：一鍵帶參數（?symbol=&preset=）跳轉落點，與 URL 直連、Top 排行連結共用。
  const runWithPreset = (
    sym: string,
    nameOpt?: string,
    preset?: string | null,
  ) => {
    if (preset === 'short' || preset === 'medium' || preset === 'long') {
      applyPreset(preset)
      void runFromSymbol(sym, nameOpt, { ...PRESET_PARAMS[preset] })
    } else {
      void runFromSymbol(sym, nameOpt)
    }
  }

  // 抓取「成交量 Top 20」清單（依所選範圍），並非同步逐檔計算進場閾值與目前乖離。
  const loadTop = async (range: TopVolumeRange) => {
    setTopRange(range)
    setTopLoading(true)
    setTopError(null)
    setTopInsights({})
    try {
      const res = await fetch(`/api/backtest/top-volume?range=${range}`)
      const data = await res.json()
      if (!res.ok) {
        setTopError(data.error ?? ui.errorTopVolume)
        setTopList([])
        return
      }
      const list: TopVolumeItem[] = data.results ?? []
      setTopList(list)
      // 依成交量中位順序並發計算閾值/乖離（每檔獨立非同步，即時逐檔更新）。
      for (const item of list) {
        setTopInsights((m) => ({ ...m, [item.symbol]: 'loading' }))
        fetchInsight(item.symbol)
      }
    } catch {
      setTopError(ui.errorTopNetwork)
      setTopList([])
    } finally {
      setTopLoading(false)
    }
  }

  // 對單一股票計算「最佳進場閾值 + 目前乖離」，即時回寫到 state。
  const fetchInsight = async (symbol: string) => {
    try {
      const qs = new URLSearchParams({
        symbol,
        holdingDays: holdingDays || '252',
        target: targetPct || '25',
        stop: stopPct || '12',
        years: years || '15',
      })
      const res = await fetch(`/api/backtest/insight?${qs.toString()}`)
      const data = await res.json()
      if (!res.ok) {
        setTopInsights((m) => ({ ...m, [symbol]: 'error' }))
        return
      }
      setTopInsights((m) => ({ ...m, [symbol]: data as TopInsight }))
    } catch {
      setTopInsights((m) => ({ ...m, [symbol]: 'error' }))
    }
  }

  const openTop = () => {
    setShowTop(true)
    setTopList([])
    setTopError(null)
    setTopInsights({})
    void loadTop('day')
  }

  // 點選排行榜中的股票 → 填入代號、關閉 modal、自動開始回測。
  const pickTopStock = (item: TopVolumeItem) => {
    setSymbol(item.symbol)
    setStockName(item.name)
    setShowTop(false)
    void runFromSymbol(item.symbol, item.name)
  }

  const triggerPoints = (result?.series ?? []).filter((p) => p.trigger)
  const chartData = (result?.series ?? []).map((p) => ({
    date: p.date,
    close: p.close,
    ma60: p.ma60 ?? undefined,
  }))

  // 目前乖離率：預設以前一期收盤價為基準；可切換為即時盤中價（需 livePriceBias 存在）。
  const currentBias =
    biasSource === 'live' ? (liveBias?.livePriceBias ?? liveBias?.latestBias ?? null) : (liveBias?.latestBias ?? null)
  const bestThreshold = result?.bestThreshold ?? null
  const targetClosePrice = bestThreshold != null && liveBias?.ma60 ? liveBias.ma60 * (1 + bestThreshold / 100) : null
  const distanceToTargetPct =
    currentBias != null && bestThreshold != null ? (currentBias - bestThreshold / 100) * 100 : null
  // 目前乖離已觸發的最佳閾值（乖離 ≤ 閾值即會觸發進場）
  const currentTriggerThreshold: number | null = (() => {
    if (currentBias == null || !result?.bestThreshold) return null
    if (currentBias <= result.bestThreshold / 100) return result.bestThreshold
    // 否則找最近一個已達成的較淺閾值
    const ts = (result.allThresholds ?? []).map((t) => t.threshold).sort((a, b) => b - a)
    for (const t of ts) if (currentBias <= t) return t
    return null
  })()

  // 切換「即時盤中」後若數值不會變（無即時報價 或 即時價=上一期收盤），提醒使用者原因。
  const liveUnchanged: 'nolive' | 'same' | null = (() => {
    if (biasSource !== 'live' || !liveBias) return null
    if (liveBias.livePrice == null || liveBias.livePriceBias == null) return 'nolive'
    if (liveBias.latestClose != null && Math.abs(liveBias.livePrice - liveBias.latestClose) < 0.01) return 'same'
    return null
  })()

  const sortedRows = (result?.allThresholds ? [...result.allThresholds] : [])
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'threshold') return (a.threshold - b.threshold) * dir
      if (sortKey === 'totalTrades') return (a.totalTrades - b.totalTrades) * dir
      const aw = a.winRate ?? -1
      const bw = b.winRate ?? -1
      return (aw - bw) * dir
    })

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'threshold' ? 'asc' : 'desc')
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="flex items-center gap-3 mb-2">
        <Target className="w-7 h-7 text-[var(--accent)]" />
        <h1 className="text-2xl font-bold">{ui.pageTitle}</h1>
      </div>
      <p className="text-[var(--text-secondary)] mb-8">
        {ui.pageDesc
          .replace('{holdingDays}', holdingDays || '252')
          .replace('{targetPct}', targetPct || '25')
          .replace('{stopPct}', stopPct || '12')
          .replace('{years}', years || '15')}
      </p>

      <div className="mb-8 rounded-xl bg-[var(--bg-card)] border border-white/5 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowExplain((s) => !s)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-white/5 transition"
          aria-expanded={showExplain}
        >
          <span className="text-sm font-medium text-[var(--accent)]">{ui.explainTitle}</span>
          {showExplain ? (
            <ChevronUp className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
          )}
        </button>
        {showExplain && (
          <div className="px-4 pb-4 space-y-3 text-sm text-[var(--text-secondary)] leading-relaxed">
            <div>
              <p className="font-medium text-[var(--text-primary)] mb-1">{ui.explainWhyLineTitle}</p>
              <p>{ui.explainWhyLine}</p>
            </div>
            <div>
              <p className="font-medium text-[var(--text-primary)] mb-1">{ui.explainWhyRateTitle}</p>
              <p>{ui.explainWhyRate}</p>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={run} className="mb-8 rounded-2xl bg-[var(--bg-card)] border border-white/5 p-5 md:p-6 shadow-xl space-y-6">
        {/* 標的搜尋與主要操作區 */}
        <div className="space-y-2.5">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1" ref={dropdownRef}>
              <SearchIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
              <input
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value)
                  if (stockName) setStockName('')
                }}
                onFocus={() => {
                  const q = symbol.trim()
                  if (q && suggestions.length) setShowDropdown(true)
                }}
                placeholder={ui.placeholder}
                className={`w-full h-11 pl-10 ${
                  stockName ? 'pr-32 sm:pr-36' : symbol ? 'pr-10' : 'pr-4'
                } rounded-xl bg-[var(--bg-secondary)] border border-white/10 focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] outline-none text-sm md:text-base text-[var(--text-primary)] transition placeholder:text-[var(--text-secondary)]/50`}
              />

              {/* 輸入框內部右側：中文名稱即時小標籤 + 清除按鈕 */}
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                {stockName && (
                  <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--accent)]/15 border border-[var(--accent)]/30 text-xs font-semibold text-[var(--accent)] shadow-sm pointer-events-auto animate-in fade-in zoom-in-95 duration-150">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                    <span className="truncate max-w-[130px]">{stockName}</span>
                  </span>
                )}
                {symbol && (
                  <button
                    type="button"
                    onClick={() => {
                      setSymbol('')
                      setStockName('')
                      setSuggestions([])
                    }}
                    className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition pointer-events-auto"
                    aria-label="Clear input"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {(showDropdown || searching) && (
                <div className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-xl bg-[var(--bg-card)] border border-white/10 shadow-2xl overflow-hidden">
                  <StockCandidateList
                    candidates={suggestions}
                    loading={searching}
                    onPick={pickStock}
                    layout="stack"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="submit"
                disabled={loading}
                className="h-11 px-6 rounded-xl bg-[var(--accent)] text-white font-medium text-sm hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm transition shrink-0 whitespace-nowrap"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                {loading ? ui.btnBacktesting : ui.btnBacktest}
              </button>
              <button
                type="button"
                onClick={openTop}
                className="h-11 px-4 rounded-xl bg-[var(--bg-secondary)] border border-white/10 text-sm font-medium text-[var(--text-primary)] hover:bg-white/5 transition flex items-center justify-center gap-2 shrink-0 whitespace-nowrap"
              >
                <ListOrdered className="w-4 h-4 text-[var(--accent)]" />
                {ui.btnTopVolume}
              </button>
            </div>
          </div>

          {/* 輸入框下方：標的已識別中文名稱專屬指示條 */}
          {stockName && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
              <span className="text-xs text-[var(--text-secondary)]">已辨識標的：</span>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/25 text-xs text-[var(--accent)] shadow-sm">
                <span className="font-mono font-bold text-[var(--text-primary)]">{symbol.toUpperCase()}</span>
                <span className="w-1 h-1 rounded-full bg-[var(--accent)]/50" />
                <span className="font-semibold text-[var(--accent)]">{stockName}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/5 text-[var(--text-secondary)] uppercase font-normal">
                  台股
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 策略風格推薦與自訂參數設定 */}
        <div className="pt-4 border-t border-white/5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <SlidersHorizontal className="w-4 h-4 text-[var(--accent)]" />
              {ui.presetLabel}
            </span>
            {activePreset === 'custom' ? (
              <span className="text-xs px-2 py-0.5 rounded-md bg-white/5 text-[var(--text-secondary)] border border-white/5">
                {locale === 'en' ? 'Custom' : locale === 'ja' ? 'カスタム' : '自訂參數模式'}
              </span>
            ) : (
              <span className="text-xs text-[var(--text-secondary)]">
                {locale === 'en' ? 'Click preset to quickly apply settings' : locale === 'ja' ? 'スタイルをクリックして即座に適用' : '點選風格即可快速套用建議參數'}
              </span>
            )}
          </div>

          {/* 三個推薦風格按鈕 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {(
              [
                { id: 'short', raw: ui.presetShort },
                { id: 'medium', raw: ui.presetMedium },
                { id: 'long', raw: ui.presetLong },
              ] as const
            ).map(({ id, raw }) => {
              const { title, desc } = parsePresetText(raw)
              const isSelected = activePreset === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => applyPreset(id)}
                  className={`px-3.5 py-2.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)] font-medium shadow-sm ring-1 ring-[var(--accent)]/30'
                      : 'border-white/10 bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-white/20 hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className={`text-sm font-semibold ${isSelected ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>
                      {title}
                    </span>
                    {isSelected && (
                      <span className="w-2 h-2 rounded-full bg-[var(--accent)] ring-2 ring-[var(--accent)]/20" />
                    )}
                  </div>
                  {desc && <div className="text-xs text-[var(--text-secondary)] leading-relaxed">{desc}</div>}
                </button>
              )
            })}
          </div>

          {/* 4 個參數自訂細項 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <label className="block">
              <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{ui.labelYears}</span>
              <div className="relative">
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={years}
                  onChange={(e) => setYears(e.target.value)}
                  className="w-full h-10 px-3 pr-8 rounded-xl bg-[var(--bg-secondary)] border border-white/10 focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] outline-none text-sm transition"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-secondary)] pointer-events-none">
                  {locale === 'en' ? 'yrs' : '年'}
                </span>
              </div>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{ui.labelHoldingDays}</span>
              <div className="relative">
                <input
                  type="number"
                  min={1}
                  max={252}
                  value={holdingDays}
                  onChange={(e) => setHoldingDays(e.target.value)}
                  className="w-full h-10 px-3 pr-8 rounded-xl bg-[var(--bg-secondary)] border border-white/10 focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] outline-none text-sm transition"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-secondary)] pointer-events-none">
                  {locale === 'en' ? 'days' : '日'}
                </span>
              </div>
            </label>
            <label className="block">
              <span className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {ui.labelTargetPct}
                <HelpCell text={ui.targetPctHelp} />
              </span>
              <div className="relative">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={targetPct}
                  onChange={(e) => setTargetPct(e.target.value)}
                  className="w-full h-10 px-3 pr-8 rounded-xl bg-[var(--bg-secondary)] border border-white/10 focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] outline-none text-sm transition"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-secondary)] pointer-events-none">
                  %
                </span>
              </div>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{ui.labelStopPct}</span>
              <div className="relative">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={stopPct}
                  onChange={(e) => setStopPct(e.target.value)}
                  className="w-full h-10 px-3 pr-8 rounded-xl bg-[var(--bg-secondary)] border border-white/10 focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] outline-none text-sm transition"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-secondary)] pointer-events-none">
                  %
                </span>
              </div>
            </label>
          </div>
        </div>
      </form>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="p-10 text-center text-[var(--text-secondary)]">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3" />
          {ui.loadingData.replace('{years}', years || '15')}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          {/* 回測標的與參數摘要標題 */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-[var(--bg-card)] border border-white/5 shadow-sm">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-xl font-bold text-[var(--accent)]">{symbol.toUpperCase()}</span>
              {stockName && (
                <span className="text-base font-semibold text-[var(--text-primary)]">
                  {stockName}
                </span>
              )}
              <span className="text-xs px-2 py-0.5 rounded-md bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 font-medium">
                近 {years} 年週期模型
              </span>
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              持有 {holdingDays} 日 · 目標 +{targetPct}% · 停損 {stopPct}%
            </div>
          </div>

          {/* 策略與數據說明提示條 */}
          <div className="p-3.5 rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 text-xs text-[var(--text-secondary)] flex items-start gap-2.5">
            <Info className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-semibold text-[var(--text-primary)] mr-1">
                {locale === 'en' ? 'Strategy & Data Note:' : locale === 'ja' ? '戦略・データに関する説明：' : '策略與數據說明：'}
              </span>
              <span>{ui.cycleEntryDiffBanner}</span>
            </div>
          </div>

          {result.belowTarget && (
            <div className="flex items-center gap-2 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {ui.belowTargetWarning}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-white/5">
              <div className="flex items-center gap-2 text-[var(--text-secondary)] text-xs mb-2">
                <TrendingDown className="w-3.5 h-3.5" /> {ui.statBestBias}
              </div>
              <div className="text-2xl font-bold text-[var(--accent)]">
                {result.bestThreshold < 0 && result.totalTrades > 0 ? fmtPct(result.bestThreshold / 100) : '—'}
              </div>
            </div>
            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-white/5">
              <div className="flex items-center gap-2 text-[var(--text-secondary)] text-xs mb-2">
                <Repeat className="w-3.5 h-3.5" /> {ui.statTotalTriggers}
              </div>
              <div className="text-2xl font-bold">{result.totalTrades}</div>
              <div className="text-xs text-[var(--text-secondary)] mt-1">
                {ui.statWin} {result.wins} / {ui.statLoss} {result.losses} / {ui.statNeutral} {result.neutral}
              </div>
            </div>
            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-white/5">
              <div className="flex items-center gap-2 text-[var(--text-secondary)] text-xs mb-2">
                <Target className="w-3.5 h-3.5" /> {ui.statWinRate}
              </div>
              <div
                className={`text-2xl font-bold ${
                  result.winRate != null && result.winRate >= 0.75
                    ? 'text-[var(--accent-green)]'
                    : 'text-[var(--accent-red)]'
                }`}
              >
                {fmtPct(result.winRate)}
              </div>
            </div>
            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-white/5">
              <div className="flex items-center gap-2 text-[var(--text-secondary)] text-xs mb-2">
                <Clock className="w-3.5 h-3.5" /> {ui.statAvgDays.replace('{targetPct}', targetPct || '25')}
              </div>
              <div className="text-2xl font-bold">{fmtDays(result.avgDaysToTarget, ui.daysUnit)}</div>
            </div>
          </div>

          {/* Issue #19（A4+B5）AI 解讀：數字一律由引擎 JSON 注入、原樣顯示；純計算、不扣 quota */}
          {(() => {
            const insight = buildBacktestInsight(result, currentBias)
            const n = insight.numbers
            const sym = symbol.toUpperCase()
            const name = stockName ? `（${stockName}）` : ''
            const body = insight.kind === 'no-trades'
              ? ui.aiNoTrades
                .replace('{symbol}', sym)
                .replace('{name}', name)
                .replace('{years}', years || '15')
                .replace('{trades}', String(n.totalTrades))
              : insight.kind === 'in-zone'
                ? ui.aiInZone
                  .replace('{symbol}', sym)
                  .replace('{name}', name)
                  .replace('{bias}', fmtPct(currentBias))
                  .replace('{threshold}', fmtPct(n.bestThreshold != null ? n.bestThreshold / 100 : null))
                  .replace('{trades}', String(n.totalTrades))
                  .replace('{wins}', String(n.wins))
                  .replace('{losses}', String(n.losses))
                  .replace('{neutral}', String(n.neutral))
                  .replace('{winRate}', fmtPct(n.winRate))
                  .replace('{days}', fmtDays(n.avgDaysToTarget, ui.daysUnit))
                : ui.aiWatch
                  .replace('{symbol}', sym)
                  .replace('{name}', name)
                  .replace('{bias}', fmtPct(currentBias))
                  .replace('{threshold}', fmtPct(n.bestThreshold != null ? n.bestThreshold / 100 : null))
                  .replace('{pct}', distanceToTargetPct != null ? distanceToTargetPct.toFixed(1) : '—')
                  .replace('{trades}', String(n.totalTrades))
                  .replace('{winRate}', fmtPct(n.winRate))
                  .replace('{days}', fmtDays(n.avgDaysToTarget, ui.daysUnit))
            return (
              <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--accent)]/25 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                  <h2 className="text-sm font-semibold">{ui.aiTitle}</h2>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">AI</span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-2.5">{ui.aiHardRule}</p>
                <p className="text-sm text-[var(--text-primary)] leading-relaxed">{body}</p>
                <details className="mt-2.5 text-xs">
                  <summary className="cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition select-none">
                    {ui.aiJsonToggle}
                  </summary>
                  <pre className="mt-2 p-3 rounded-lg bg-white/[0.02] border border-white/5 overflow-x-auto font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    {JSON.stringify(
                      {
                        bestThreshold: n.bestThreshold,
                        totalTrades: n.totalTrades,
                        winRate: n.winRate,
                        avgDaysToTarget: n.avgDaysToTarget,
                        wins: n.wins,
                        losses: n.losses,
                        neutral: n.neutral,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <p className="mt-2.5 text-[11px] text-[var(--text-secondary)] leading-relaxed">{ui.aiDisclaimer}</p>
              </div>
            )
          })()}

          {liveBias && (
            <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 text-[var(--text-secondary)] text-xs">
                  <Activity className="w-3.5 h-3.5 text-[var(--accent)]" />
                  {ui.liveBiasTitle.replace('{date}', formatDate(liveBias.asOf))}
                </div>
                <div
                  className="flex items-center gap-1 rounded-lg bg-[var(--bg-secondary)] p-0.5"
                  role="group"
                  aria-label={ui.biasSourceLabel}
                >
                  <button
                    type="button"
                    onClick={() => setBiasSource('close')}
                    className={`px-2.5 py-1 text-xs rounded-md transition ${
                      biasSource === 'close'
                        ? 'bg-[var(--accent)] text-white'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {ui.biasSourceClose}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBiasSource('live')}
                    className={`px-2.5 py-1 text-xs rounded-md transition ${
                      biasSource === 'live'
                        ? 'bg-[var(--accent)] text-white'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {ui.biasSourceLive}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-8 gap-y-3">
                <div>
                  <div className="text-xs text-[var(--text-secondary)] mb-1">
                    {ui.liveBiasCurrent}
                    {biasSource === 'close' && liveBias.livePriceBias != null && Math.abs(liveBias.livePriceBias - liveBias.latestBias!) > 0.001
                      ? ui.biasSourceLiveBiasLabel.replace('{bias}', fmtPct(liveBias.livePriceBias))
                      : biasSource === 'live' && liveBias.latestBias != null && Math.abs(liveBias.livePriceBias! - liveBias.latestBias) > 0.001
                        ? ui.liveBiasPrevCloseLabel.replace('{bias}', fmtPct(liveBias.latestBias))
                        : ''}
                  </div>
                  <div
                    className={`text-2xl font-bold ${
                      currentTriggerThreshold != null
                        ? 'text-[var(--accent-green)]'
                        : distanceToTargetPct != null && distanceToTargetPct <= 1
                          ? 'text-[var(--accent)]'
                          : 'text-[var(--text-primary)]'
                    }`}
                  >
                    {fmtPct(currentBias)}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)] mt-1">
                    {ui.liveBiasMA60}：{liveBias.ma60.toFixed(2)} · {ui.liveBiasPrevClose} {liveBias.latestClose.toFixed(2)}
                    {liveBias.livePrice != null ? ` · ${ui.liveBiasCurrentPriceLabel.replace('{price}', liveBias.livePrice.toFixed(2))}` : ''}
                  </div>
                </div>

                {bestThreshold != null && (
                  <div className="border-l border-white/10 pl-6">
                    <div className="text-xs text-[var(--text-secondary)] mb-1">{ui.liveBiasBestThreshold.replace('{threshold}', fmtPct(bestThreshold / 100))}</div>
                    {targetClosePrice != null && (
                      <div className="text-xl font-bold text-[var(--text-primary)]">
                        {targetClosePrice.toFixed(2)}
                        <span className="text-xs font-normal text-[var(--text-secondary)] ml-1">{ui.liveBiasClosePriceNote}</span>
                      </div>
                    )}
                    <div className="text-xs mt-1">
                      {currentTriggerThreshold != null ? (
                        <span className="text-[var(--accent-green)]">
                          {ui.liveBiasReached.replace('{threshold}', fmtPct(currentTriggerThreshold / 100))}
                        </span>
                      ) : distanceToTargetPct != null ? (
                        <span className="text-[var(--text-secondary)]">
                          {ui.liveBiasDistance.replace('{pct}', distanceToTargetPct.toFixed(1))}
                        </span>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>

              {liveUnchanged && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 px-3 py-2 text-xs text-[var(--text-secondary)] animate-in fade-in duration-150">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--accent)]" />
                  <span>
                    {liveUnchanged === 'nolive'
                      ? ui.liveBiasNoLiveData
                      : ui.liveBiasSameAsClose.replace('{price}', liveBias.livePrice != null ? liveBias.livePrice.toFixed(2) : liveBias.latestClose.toFixed(2))}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-sm font-medium">{ui.chartTitle.replace('{years}', years || '15')}</h2>
              {currentBias != null && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    currentTriggerThreshold != null
                      ? 'bg-[var(--accent-green)]/10 text-[var(--accent-green)]'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                  }`}
                >
                  {ui.chartBadgeCurrentBias.replace('{bias}', fmtPct(currentBias))}
                </span>
              )}
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => formatDate(v as number)}
                    stroke="var(--text-secondary)"
                    fontSize={11}
                    minTickGap={40}
                  />
                  <YAxis
                    domain={['auto', 'auto']}
                    stroke="var(--text-secondary)"
                    fontSize={11}
                    tickFormatter={(v) => v.toLocaleString()}
                    width={70}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelFormatter={(v) => formatDate(v as number)}
                    formatter={(value, name) => [Number(value).toLocaleString(), name === 'close' ? ui.chartTooltipClose : ui.chartTooltipMA60]}
                  />
                  <Line type="monotone" dataKey="close" stroke="var(--accent)" dot={false} strokeWidth={1.7} />
                  <Line type="monotone" dataKey="ma60" stroke="var(--accent-green)" dot={false} strokeWidth={1.3} strokeDasharray="4 3" />
                  {triggerPoints.map((p, i) => (
                    <ReferenceDot
                      key={i}
                      x={p.date}
                      y={p.close}
                      r={4}
                      fill="var(--accent-red)"
                      stroke="var(--accent-red)"
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-3">
              {ui.chartTriggerDotsNote.replace('{years}', years || '15')}
            </p>
          </div>

          {result.allThresholds && result.allThresholds.length > 0 && (
            <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 overflow-hidden">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 border-b border-white/5">
                <h2 className="text-sm font-medium">{ui.tableTitle}</h2>
                {currentBias != null && (
                  <span className="text-xs text-[var(--text-secondary)]">
                    {ui.tableCurrentBias.replace('{bias}', fmtPct(currentBias))}
                    {currentTriggerThreshold != null ? (
                      <>
                        {' '}{ui.tableInThresholdRange.replace('{threshold}', fmtPct(currentTriggerThreshold / 100))}
                      </>
                    ) : bestThreshold != null ? (
                      <>
                        {' '}{ui.tableBelowAllThresholds.replace('{threshold}', fmtPct(bestThreshold / 100))}
                      </>
                    ) : null}
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className={tableClass(typo, 'w-full')}>
                  <thead>
                    <tr className={headTrClass(typo, 'text-[var(--text-secondary)] border-b border-white/5')}>
                      <HeaderCell
                        label={ui.tableHeaderThreshold}
                        sortable
                        active={sortKey === 'threshold'}
                        dir={sortDir}
                        onSort={() => toggleSort('threshold')}
                        help={columnHelp.threshold}
                        helpAlign="left"
                      />
                      <HeaderCell
                        label={ui.tableHeaderTrades}
                        sortable
                        active={sortKey === 'totalTrades'}
                        dir={sortDir}
                        onSort={() => toggleSort('totalTrades')}
                        help={columnHelp.totalTrades}
                      />
                      <HeaderCell
                        label={ui.tableHeaderWinRate}
                        sortable
                        active={sortKey === 'winRate'}
                        dir={sortDir}
                        onSort={() => toggleSort('winRate')}
                        help={columnHelp.winRate}
                      />
                      <HeaderCell label={ui.tableHeaderPriceRange} help={columnHelp.range} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row) => {
                      const isOpen = expandedThreshold === row.threshold
                      return (
                        <Fragment key={row.threshold}>
                          <tr
                            onClick={() => setExpandedThreshold(isOpen ? null : row.threshold)}
                            className={`border-b border-white/5 last:border-0 cursor-pointer transition ${
                              isOpen ? 'bg-white/5' : 'hover:bg-white/5'
                            }`}
                          >
                            <td className="px-4 py-2 font-mono">
                              <span className="flex items-center gap-1.5">
                                {fmtPct(row.threshold / 100)}
                                {row.threshold === result.bestThreshold && (
                                  <span className="text-[var(--accent)] text-xs">{ui.badgeBest}</span>
                                )}
                                {currentBias != null && currentBias <= row.threshold / 100 && (
                                  <span className="text-[var(--accent-green)] text-[10px] bg-[var(--accent-green)]/10 px-1.5 py-0.5 rounded-full">
                                    {ui.badgeTriggered}
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-2">{row.totalTrades}</td>
                            <td className="px-4 py-2">{fmtPct(row.winRate)}</td>
                            <td className="px-4 py-2 font-mono text-[var(--text-primary)]">
                              <span className="flex items-center gap-2">
                                {fmtPriceRange(row.trades)}
                                <span className="ml-auto">
                                  {isOpen ? (
                                    <ChevronUp className="w-4 h-4 text-[var(--text-secondary)]" />
                                  ) : (
                                    <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" />
                                  )}
                                </span>
                              </span>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-[var(--bg-secondary)]/60 border-b border-white/5">
                              <td colSpan={4} className="px-4 py-3">
                                  {row.trades && row.trades.length > 0 ? (
                                    <div className="overflow-x-auto">
                                      <table className={tableClass(typo, 'w-full', 'text-xs')}>
                                        <thead>
                                          <tr className={headTrClass(typo, 'text-[var(--text-secondary)]', '')}>
                                            <th className="px-3 py-1.5 text-left">{ui.tableHeaderEntryDate}</th>
                                            <th className="px-3 py-1.5 text-left">{ui.tableHeaderEntryPrice}</th>
                                            <th className="px-3 py-1.5 text-left">{ui.tableHeaderResult}</th>
                                            <th className="px-3 py-1.5 text-left">{ui.tableHeaderDaysToTarget.replace('{pct}', targetPct || '25')}</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {row.trades
                                            .slice()
                                            .sort((a, b) => a.entryDate - b.entryDate)
                                            .map((t, ti) => (
                                              <tr key={ti} className="border-b border-white/5 last:border-0">
                                                <td className="px-3 py-1.5 text-[var(--text-primary)]">
                                                  {formatDate(t.entryDate)}
                                                </td>
                                                <td className="px-3 py-1.5 font-mono">{t.entryPrice.toFixed(2)}</td>
                                                <td className="px-3 py-1.5">
                                                  <OutcomeBadge outcome={t.outcome} dict={dict} />
                                                </td>
                                                <td className="px-3 py-1.5">
                                                  {t.outcome === 'win' && t.daysToTarget != null
                                                    ? ui.daysUnit.replace('{n}', String(t.daysToTarget))
                                                    : '—'}
                                                </td>
                                              </tr>
                                            ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <p className="text-[var(--text-secondary)] text-xs">{ui.noTrades}</p>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {showTop && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowTop(false)}
        >
          <div
            className="w-full max-w-2xl sm:max-w-3xl rounded-2xl bg-[var(--bg-card)] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2">
                <ListOrdered className="w-5 h-5 text-[var(--accent)]" />
                <h2 className="text-base font-bold">{ui.topModalTitle}</h2>
              </div>
              <button
                onClick={() => setShowTop(false)}
                className="p-1.5 rounded-lg hover:bg-white/5 text-[var(--text-secondary)] transition"
                aria-label={ui.topCloseAria}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2 shrink-0">
              <div className="flex gap-1.5">
                {(
                  [
                    ['day', ui.topRangeDay],
                    ['week', ui.topRangeWeek],
                    ['month', ui.topRangeMonth],
                    ['quarter', ui.topRangeQuarter],
                  ] as [TopVolumeRange, string][]
                ).map(([r, label]) => (
                  <button
                    key={r}
                    onClick={() => void loadTop(r)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      topRange === r
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="text-xs text-[var(--text-secondary)] hidden sm:block">
                點擊任一標的即可自動帶入回測
              </div>
            </div>

            {/* 欄位表頭 */}
            <div className="px-5 py-2 border-b border-white/5 text-[11px] text-[var(--text-secondary)] font-medium grid grid-cols-12 gap-2 shrink-0">
              <div className="col-span-1 text-center">#</div>
              <div className="col-span-2">代號</div>
              <div className="col-span-4 sm:col-span-4">股票名稱</div>
              <div className="col-span-2 text-right">成交量</div>
              <div className="col-span-3 text-right">週期模型預估</div>
            </div>

            <div className="px-3 sm:px-5 py-2 flex-1 overflow-y-auto">
              {topLoading ? (
                <div className="py-12 text-center text-[var(--text-secondary)]">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-[var(--accent)]" />
                  <p className="text-sm">{topRange === 'day' ? ui.topLoadingDay : ui.topLoadingOther}</p>
                </div>
              ) : topError ? (
                <div className="my-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                  {topError}
                </div>
              ) : topList.length === 0 ? (
                <div className="py-12 text-center text-[var(--text-secondary)] text-sm">{ui.topNoData}</div>
              ) : (
                <div className="space-y-1">
                  {topList.map((item) => {
                    const insight = topInsights[item.symbol]
                    const ready = insight && insight !== 'loading' && insight !== 'error'
                    const insightBias =
                      ready
                        ? (biasSource === 'live'
                            ? (insight.livePriceBias ?? insight.latestBias)
                            : (insight.latestBias ?? insight.livePriceBias))
                        : null
                    const hasValidThreshold =
                      ready && insight.bestThreshold != null && insight.bestThreshold < 0
                    const insightDistance =
                      insightBias != null && hasValidThreshold
                        ? (insightBias - insight.bestThreshold! / 100) * 100
                        : null
                    const insightReached =
                      hasValidThreshold && insightBias != null && insightBias <= insight.bestThreshold! / 100
                    // Issue #19 點子流：逐檔回測連結帶 ?symbol=&preset=（自訂參數時退回 medium）
                    const rowPreset = activePreset === 'custom' ? 'medium' : activePreset
                    return (
                      <div
                        key={item.symbol}
                        className={`w-full flex items-center gap-1 pr-1 rounded-xl transition ${
                          insightReached
                            ? 'bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/20'
                            : 'border border-transparent'
                        }`}
                      >
                      <button
                        onClick={() => pickTopStock(item)}
                        className="flex-1 grid grid-cols-12 gap-2 items-center px-3 py-2.5 rounded-lg hover:bg-white/5 transition text-left"
                      >
                        <span className="col-span-1 text-center font-mono text-xs text-[var(--text-secondary)]">
                          {item.rank}
                        </span>
                        <span className="col-span-2 font-mono text-sm font-bold text-[var(--accent)]">
                          {item.symbol}
                        </span>
                        <span className="col-span-4 font-medium text-sm text-[var(--text-primary)] truncate">
                          {item.name}
                        </span>
                        <div className="col-span-2 text-right text-sm text-[var(--text-primary)] font-medium tabular-nums">
                          {fmtVolume(item.volume, ui.volumeUnitBillion, ui.volumeUnitTenThousand)}
                        </div>
                        <div className="col-span-3 text-right">
                          {insight === 'loading' ? (
                            <div className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] justify-end">
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              <span className="hidden sm:inline">{ui.topLoadingThreshold}</span>
                            </div>
                          ) : insight === 'error' ? (
                            <div className="text-[11px] text-[var(--text-secondary)]">—</div>
                          ) : insight ? (
                            <div className="text-[11px] tabular-nums">
                              {insightReached && hasValidThreshold ? (
                                <span className="inline-flex items-center gap-1 text-[var(--accent-green)] font-semibold">
                                  <Zap className="w-3 h-3" />
                                  <span>{fmtPct(insight.bestThreshold! / 100)}</span>
                                  <span className="hidden sm:inline">· {ui.topEntryZone}</span>
                                </span>
                              ) : hasValidThreshold && insightDistance != null ? (
                                <span className="text-[var(--text-secondary)]">
                                  <span>{fmtPct(insight.bestThreshold! / 100)}</span>
                                  <span className="hidden sm:inline"> (距 {insightDistance.toFixed(1)}%)</span>
                                </span>
                              ) : (
                                <span className="text-[var(--text-secondary)]">{ui.topInsufficientData}</span>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </button>
                      <Link
                        href={`/backtest?symbol=${encodeURIComponent(item.symbol)}&preset=${rowPreset}`}
                        onClick={() => {
                          // 同頁內以 SPA 直接帶入（含 preset 參數）；href 保留深連結可分享／重整
                          setShowTop(false)
                          setSymbol(item.symbol)
                          setStockName(item.name)
                          runWithPreset(item.symbol, item.name, rowPreset)
                        }}
                        className="shrink-0 inline-flex items-center gap-0.5 px-2 py-1 rounded-lg text-[11px] font-semibold text-[var(--accent)] border border-transparent hover:bg-[var(--accent)]/15 hover:border-[var(--accent)]/30 transition whitespace-nowrap"
                      >
                        {ui.topBacktestLink}
                      </Link>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-white/5 text-xs text-[var(--text-secondary)] shrink-0">
              {ui.topFooterHint}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
