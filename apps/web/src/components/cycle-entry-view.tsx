'use client'

import { useMemo, useState } from 'react'
import { LayoutGrid, LayoutList, LineChart, Sparkles, HelpCircle, Layers, TrendingUp, Building2 } from 'lucide-react'
import type { CycleEntrySignalRow } from '@stock/database'
import { resolveStockName, getUniverseTier, type UniverseTier } from '@stock/cycle-entry'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'

export interface CycleEntryDict {
  viewModeList: string
  viewModeCard: string
  colRank: string
  colName: string
  colStage: string
  colRules: string
  colPrice: string
  colScore: string
  colBacktest: string
  aiNoteTitle: string
  btSignals: string
  btWinRate: string
  btAvgDays: string
  stageNearHigh: string
  stageMildPullback: string
  stagePullback: string
  stageDeepPullback: string
  ruleR1: string
  ruleR2: string
  ruleR3: string
  ruleR4: string
  ruleR5: string
  viewBacktestChart?: string
  exploreBacktestLab?: string
  winRateLegend?: string
  colBacktestTooltip?: string
  openBacktestLab: string
  openYahooQuote: string
  detailTitle: string
  detailSubtitle: string
  detailClose: string
  detailLoading: string
  detailError: string
  detailTabChart: string
  detailTabTrades: string
  detailTabRules: string
  chartPriceTitle: string
  chartEquityTitle: string
  chartDate: string
  chartClose: string
  chartMA20: string
  chartMA60: string
  chartEntryDot: string
  chartEquityValue: string
  colSignalDate: string
  colEntryDate: string
  colExitDate: string
  colExitPrice: string
  colReturn: string
  colHoldingDays: string
  colExitReason: string
  exitReasonTarget: string
  exitReasonStop: string
  exitReasonTimeout: string
  exitReasonOpen: string
  openBadge: string
  ciLabel: string
  sampleBadge: string
  netReturnNote: string
  tradesEmpty: string
  winRateFormulaTitle: string
  winRateFormulaText: string
  ruleCheckTitle: string
  ruleHit: string
  ruleMiss: string
  ruleThreshold: string
  tabEtf?: string
  tabStocks?: string
  tabAll?: string
  tierEtfBadge?: string
  tierTop50Badge?: string
  tierTop100Badge?: string
  tierOtherBadge?: string
}

type ViewMode = 'list' | 'card'
type TabCategory = 'etf' | 'stocks' | 'all'

const STAGES: Record<string, keyof CycleEntryDict> = {
  'near-high': 'stageNearHigh',
  'mild-pullback': 'stageMildPullback',
  pullback: 'stagePullback',
  'deep-pullback': 'stageDeepPullback',
}

const STAGE_STYLE: Record<string, string> = {
  'near-high': 'bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/25',
  'mild-pullback': 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/25',
  pullback: 'bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/25',
  'deep-pullback': 'bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/25',
}

const RULE_KEYS: Record<string, keyof CycleEntryDict> = {
  R1: 'ruleR1',
  R2: 'ruleR2',
  R3: 'ruleR3',
  R4: 'ruleR4',
  R5: 'ruleR5',
}

export function ruleList(matchedRules: string, dict: CycleEntryDict) {
  return (matchedRules || '')
    .split(',')
    .filter((r) => RULE_KEYS[r])
    .map((r) => ({ key: r, label: dict[RULE_KEYS[r]] }))
}

export function shortSymbol(symbol: string) {
  return symbol.replace(/\.(TW|TWO)$/, '')
}

/** Yahoo 股市報價連結（Issue #81）：上櫃 .TWO 其餘 .TW，另開新頁。 */
export function yahooQuoteUrl(symbol: string) {
  const bare = shortSymbol(symbol.trim())
  const suffix = /\.TWO$/i.test(symbol.trim()) ? '.TWO' : '.TW'
  return `https://tw.stock.yahoo.com/quote/${encodeURIComponent(bare)}${suffix}`
}

export function fmt(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString('zh-TW', { maximumFractionDigits: digits })
}

export function formatWinRate(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return '—'
  // 向下相容：若歷史版次資料庫仍存 0~1 小數（如 0.5），自動換算為百分比（50）
  const pct = rate > 0 && rate <= 1 ? rate * 100 : rate
  return `${Math.round(pct)}%`
}

function getWinRateStyle(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return 'text-[var(--text-secondary)]'
  const pct = rate > 0 && rate <= 1 ? rate * 100 : rate
  if (pct >= 100) {
    return 'text-emerald-300 font-bold bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded shadow-[0_0_8px_rgba(52,211,153,0.25)]'
  }
  if (pct >= 70) {
    return 'text-emerald-400 font-bold'
  }
  if (pct >= 50) {
    return 'text-[var(--accent-green)] font-semibold'
  }
  if (pct >= 30) {
    return 'text-amber-400 font-semibold'
  }
  return 'text-[var(--text-secondary)]'
}

function renderTierBadge(tier: UniverseTier, dict: CycleEntryDict) {
  switch (tier) {
    case 'ETF':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 font-medium">
          <TrendingUp className="w-2.5 h-2.5" />
          {dict.tierEtfBadge ?? '核心 ETF'}
        </span>
      )
    case 'TOP_50':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-medium">
          <Building2 className="w-2.5 h-2.5" />
          {dict.tierTop50Badge ?? 'Top 50 權值'}
        </span>
      )
    case 'TOP_100':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-medium">
          <Building2 className="w-2.5 h-2.5" />
          {dict.tierTop100Badge ?? 'Top 51-100 績優'}
        </span>
      )
    default:
      return null
  }
}

interface Props {
  signals: CycleEntrySignalRow[]
  dict: CycleEntryDict
  /** 點擊任一標的入口（名稱／勝率／曲線圖與詳情）觸發詳情 Modal。 */
  onSelect?: (signal: CycleEntrySignalRow) => void
}

export function CycleEntryView({ signals, dict, onSelect }: Props) {
  const [activeTab, setActiveTab] = useState<TabCategory>('etf')
  const [mode, setMode] = useState<ViewMode>('list')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const typo = useTableTypography()

  // 統計各分頁數量
  const counts = useMemo(() => {
    let etf = 0
    let stocks = 0
    for (const s of signals) {
      const tier = getUniverseTier(s.symbol)
      if (tier === 'ETF') etf++
      else if (tier === 'TOP_50' || tier === 'TOP_100') stocks++
    }
    return { etf, stocks, all: signals.length }
  }, [signals])

  // 依 Tab 過濾標的
  const filteredSignals = useMemo(() => {
    if (activeTab === 'etf') {
      return signals.filter((s) => getUniverseTier(s.symbol) === 'ETF')
    }
    if (activeTab === 'stocks') {
      return signals.filter((s) => {
        const tier = getUniverseTier(s.symbol)
        return tier === 'TOP_50' || tier === 'TOP_100'
      })
    }
    return signals
  }, [signals, activeTab])

  const sortedSignals = useMemo(() => {
    const arr = [...filteredSignals]
    arr.sort((a, b) => {
      const av = a.btWinRate
      const bv = b.btWinRate
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return sortDir === 'desc' ? bv - av : av - bv
    })
    return arr
  }, [filteredSignals, sortDir])

  const btnClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
      active
        ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-semibold border border-[var(--accent)]/30'
        : 'bg-white/5 text-[var(--text-secondary)] hover:bg-white/10'
    }`

  const tabClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
      active
        ? 'bg-white/15 text-white font-semibold shadow-sm'
        : 'text-[var(--text-secondary)] hover:text-white hover:bg-white/5'
    }`

  return (
    <div>
      {/* 頂部分類分頁（小資族優先：核心 ETF 為主、Top 100 權值股為輔） */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-white/5">
        <div className="flex items-center gap-1.5 bg-black/20 p-1 rounded-xl border border-white/10">
          <button
            type="button"
            onClick={() => setActiveTab('etf')}
            className={tabClass(activeTab === 'etf')}
          >
            <span>{dict.tabEtf ?? '🎯 核心存股 ETF'}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-sky-500/20 text-sky-300">
              {counts.etf}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('stocks')}
            className={tabClass(activeTab === 'stocks')}
          >
            <span>{dict.tabStocks ?? '🏢 Top 100 權值股'}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300">
              {counts.stocks}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={tabClass(activeTab === 'all')}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{dict.tabAll ?? '全部標的'}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/10 text-white/70">
              {counts.all}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 border border-white/10 rounded-lg p-1">
          <button type="button" onClick={() => setMode('list')} className={btnClass(mode === 'list')}>
            <LayoutList className="w-3.5 h-3.5" />
            {dict.viewModeList}
          </button>
          <button type="button" onClick={() => setMode('card')} className={btnClass(mode === 'card')}>
            <LayoutGrid className="w-3.5 h-3.5" />
            {dict.viewModeCard}
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="text-xs text-[var(--text-secondary)]">
          {activeTab === 'etf' && '專為小資族挑選之穩健高股息與市值型核心原型 ETF，均線支撐與超賣回檔訊號齊備。'}
          {activeTab === 'stocks' && '市值前 100 大藍籌權值股（台灣 50 + 中型 100 前段），避開中小型投機陷阱。'}
          {activeTab === 'all' && '全站核心標的池（ETF + Top 100 權值股）今日訊號到位總覽。'}
        </div>

        {dict.winRateLegend ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)] bg-white/[0.02] border border-white/5 px-3 py-1.5 rounded-lg">
            <span className="text-[10px] text-white/40">●</span>
            <span>{dict.winRateLegend}</span>
          </div>
        ) : null}
      </div>

      {sortedSignals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.01] p-8 text-center text-sm text-[var(--text-secondary)]">
          {activeTab === 'etf'
            ? '今日暫無核心原型 ETF 通過多規則進場門檻。'
            : activeTab === 'stocks'
            ? '今日暫無 Top 100 權值股通過多規則進場門檻。'
            : '今日暫無標的通過門檻。'}
        </div>
      ) : mode === 'list' ? (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className={tableClass(typo, 'w-full min-w-full')}>
            <thead>
              <tr className={headTrClass(typo, 'border-b border-white/10 text-left text-[var(--text-secondary)]')}>
                <th className="px-3 py-2.5 font-medium">{dict.colRank}</th>
                <th className="px-3 py-2.5 font-medium">{dict.colName}</th>
                <th className="px-3 py-2.5 font-medium">{dict.colStage}</th>
                <th className="px-3 py-2.5 font-medium">{dict.colRules}</th>
                <th className="px-3 py-2.5 font-medium text-right">{dict.colPrice}</th>
                <th className="px-3 py-2.5 font-medium text-right">{dict.colScore}</th>
                <th className="px-3 py-2.5 font-medium text-right" aria-sort={sortDir === 'desc' ? 'descending' : 'ascending'}>
                  <button
                    type="button"
                    onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                    className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  >
                    <span>{dict.btWinRate}</span>
                    <span aria-hidden="true">{sortDir === 'desc' ? '▼' : '▲'}</span>
                  </button>
                </th>
                <th className="px-3 py-2.5 font-medium">
                  <div className="flex items-center gap-1.5">
                    <span>{dict.colBacktest}</span>
                    <span className="group relative inline-flex items-center cursor-help">
                      <span className="text-white/40 group-hover:text-white/80 transition">
                        <HelpCircle className="w-3.5 h-3.5" />
                      </span>
                      <span className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-white/10 bg-[var(--bg-secondary)] px-2.5 py-1.5 text-[10px] leading-relaxed text-[var(--text-primary)] opacity-0 shadow-2xl transition-opacity duration-150 group-hover:opacity-100">
                        {dict.colBacktestTooltip ?? '近 1 年多規則共振擬合回測，與回測實驗室的長區間乖離率算法不同'}
                      </span>
                    </span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedSignals.map((s) => {
                const rules = ruleList(s.matchedRules, dict)
                const tier = getUniverseTier(s.symbol)
                const detailTitle = `${shortSymbol(s.symbol)} ${resolveStockName(s.symbol, s.name)} — ${dict.viewBacktestChart ?? '曲線圖與詳情'}`
                return (
                  <tr key={s.symbol} className="border-b border-white/5 last:border-b-0 align-top hover:bg-white/[0.03]">
                    <td className="px-3 py-3 text-[var(--text-secondary)]">#{s.signalRank ?? '—'}</td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => onSelect?.(s)}
                        title={detailTitle}
                        className="group block cursor-pointer text-left"
                      >
                        <div className="font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] group-hover:underline flex items-center gap-1.5 flex-wrap">
                          <span>{shortSymbol(s.symbol)}</span>
                          {renderTierBadge(tier, dict)}
                          <LineChart className="w-3 h-3 text-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <div className="text-xs text-[var(--text-secondary)] mt-0.5 group-hover:text-[var(--text-primary)] transition-colors">
                          {resolveStockName(s.symbol, s.name)}
                        </div>
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      {s.cycleStage ? (
                        <span className={STAGE_STYLE[s.cycleStage] ?? STAGE_STYLE.pullback}>{dict[STAGES[s.cycleStage] ?? 'pullback']}</span>
                      ) : (
                        <span className="text-[var(--text-secondary)]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {rules.map((r) => (
                          <span key={r.key} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20">
                            {r.key}·{r.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmt(s.price, 2)}</td>
                    <td className="px-3 py-3 text-right">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[var(--accent)]/15 text-[var(--accent)] font-semibold tabular-nums">
                        {s.score}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onSelect?.(s)}
                        title={detailTitle}
                        className="inline-flex items-center gap-1.5 text-xs hover:underline group cursor-pointer tabular-nums"
                      >
                        <span className={getWinRateStyle(s.btWinRate)}>
                          {formatWinRate(s.btWinRate)}
                        </span>
                        <LineChart className="w-3.5 h-3.5 text-[var(--accent)] opacity-70 group-hover:opacity-100 transition-opacity" />
                      </button>
                    </td>
                    <td className="px-3 py-3 text-xs text-[var(--text-secondary)]">
                      <button
                        type="button"
                        onClick={() => onSelect?.(s)}
                        title={detailTitle}
                        className="hover:underline cursor-pointer group text-left block"
                      >
                        <div className="tabular-nums">
                          {s.btTotalSignals != null ? `${s.btTotalSignals} ${dict.btSignals}` : '—'}
                          {s.btAvgDays != null ? ` · ${s.btAvgDays.toFixed(1)} ${dict.btAvgDays}` : ''}
                        </div>
                        {s.llmNote ? (
                          <p className="text-[11px] text-[var(--text-secondary)] line-clamp-1 mt-0.5 group-hover:text-[var(--text-primary)] transition-colors">
                            {s.llmNote}
                          </p>
                        ) : null}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedSignals.map((s) => {
            const rules = ruleList(s.matchedRules, dict)
            const tier = getUniverseTier(s.symbol)
            const detailTitle = `${shortSymbol(s.symbol)} ${resolveStockName(s.symbol, s.name)} — ${dict.viewBacktestChart ?? '曲線圖與詳情'}`
            return (
              <li key={s.symbol} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <button
                      type="button"
                      onClick={() => onSelect?.(s)}
                      title={detailTitle}
                      className="group block cursor-pointer text-left"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-[var(--text-secondary)]">#{s.signalRank ?? '—'}</span>
                        <span className="font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] group-hover:underline">
                          {shortSymbol(s.symbol)}
                        </span>
                        {renderTierBadge(tier, dict)}
                        {s.cycleStage ? (
                          <span className={STAGE_STYLE[s.cycleStage] ?? STAGE_STYLE.pullback}>{dict[STAGES[s.cycleStage] ?? 'pullback']}</span>
                        ) : null}
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] mt-0.5 group-hover:text-[var(--text-primary)] transition-colors">
                        {resolveStockName(s.symbol, s.name)}
                      </div>
                    </button>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[var(--accent)]/15 text-[var(--accent)] font-semibold tabular-nums text-sm">
                    {s.score}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1 mb-3">
                  {rules.map((r) => (
                    <span key={r.key} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20">
                      {r.key}·{r.label}
                    </span>
                  ))}
                </div>

                <dl className="grid grid-cols-3 gap-2 text-xs border-t border-white/5 pt-3 mb-3">
                  <div>
                    <dt className="text-[var(--text-secondary)]">{dict.colPrice}</dt>
                    <dd className="text-[var(--text-primary)] font-semibold tabular-nums mt-0.5">{fmt(s.price, 2)}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-secondary)] flex items-center gap-1 cursor-help group relative">
                      <span>{dict.btWinRate}</span>
                      <span className="text-white/30 group-hover:text-white/60 transition">
                        <HelpCircle className="w-3 h-3" />
                      </span>
                      <span className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-white/10 bg-[var(--bg-secondary)] px-2.5 py-1.5 text-[10px] leading-relaxed text-[var(--text-primary)] opacity-0 shadow-2xl transition-opacity duration-150 group-hover:opacity-100">
                        {dict.colBacktestTooltip ?? '近 1 年多規則共振擬合回測'}
                      </span>
                    </dt>
                    <dd className="mt-0.5">
                      <button
                        type="button"
                        onClick={() => onSelect?.(s)}
                        title={detailTitle}
                        className="inline-flex items-center gap-1 tabular-nums hover:underline group cursor-pointer"
                      >
                        <span className={getWinRateStyle(s.btWinRate)}>
                          {formatWinRate(s.btWinRate)}
                        </span>
                        <LineChart className="w-3 h-3 text-[var(--accent)] opacity-70 group-hover:opacity-100 transition-opacity" />
                      </button>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-secondary)]">{dict.btSignals}</dt>
                    <dd className="text-[var(--text-primary)] font-semibold tabular-nums mt-0.5">{s.btTotalSignals ?? '—'}</dd>
                  </div>
                </dl>

                {s.llmNote ? (
                  <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[10px] text-[var(--accent)] mb-1">
                      <Sparkles className="w-3 h-3" />
                      {dict.aiNoteTitle}
                    </div>
                    <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{s.llmNote}</p>
                  </div>
                ) : null}

                <div className="flex items-center justify-end mt-3 pt-2 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => onSelect?.(s)}
                    className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline font-medium cursor-pointer"
                  >
                    <LineChart className="w-3.5 h-3.5" />
                    <span>{dict.viewBacktestChart ?? '曲線圖與詳情'}</span>
                    <span>→</span>
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
