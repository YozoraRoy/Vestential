'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import type {
  CheckStatus,
  DimensionResult,
  HealthVerdict,
  HoldingHealthResult,
  PortfolioHealthReport,
} from '@/lib/portfolio-health'
import { TableSkeleton } from '@/components/table-skeleton'
import { DividendPaybackCard } from '@/components/dividend-payback-card'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'

export const VERDICT_META: Record<
  HealthVerdict,
  {
    shortLabel: string
    label: string
    icon: string
    badgeClass: string
    borderClass: string
  }
> = {
  discount_healthy: {
    shortLabel: '健全折價',
    label: '體質健全・估值折價',
    icon: '💎',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
    borderClass: 'border-emerald-500/30',
  },
  healthy: {
    shortLabel: '體質健全',
    label: '體質健全・估值合理/偏高',
    icon: '🟢',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/35',
    borderClass: 'border-sky-500/30',
  },
  watch: {
    shortLabel: '轉弱追蹤',
    label: '體質轉弱・需追蹤',
    icon: '🟠',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/35',
    borderClass: 'border-amber-500/30',
  },
  warning: {
    shortLabel: '體質警戒',
    label: '體質警戒',
    icon: '🔴',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/35',
    borderClass: 'border-rose-500/30',
  },
  insufficient: {
    shortLabel: '資料不足',
    label: '資料不足',
    icon: '⚪',
    badgeClass: 'bg-white/10 text-[var(--text-secondary)] border-white/15',
    borderClass: 'border-white/10',
  },
}

const CHECK_DOT: Record<CheckStatus, { dot: string; text: string; label: string }> = {
  pass: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: '達標' },
  neutral: { dot: 'bg-amber-400', text: 'text-amber-300', label: '中性' },
  warn: { dot: 'bg-rose-400', text: 'text-rose-300', label: '留意' },
  na: { dot: 'bg-white/25', text: 'text-[var(--text-secondary)]', label: '無資料' },
}

const CATEGORY_LABEL: Record<HoldingHealthResult['assetCategory'], string> = {
  equity: '一般企業',
  financial: '金融業',
  etf: 'ETF',
}

/** 持倉列表用精簡體質燈號 badge */
export function HealthVerdictBadge({
  item,
  onClick,
}: {
  item: HoldingHealthResult
  onClick?: () => void
}) {
  const meta = VERDICT_META[item.verdict]
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      title={`${meta.label}｜${item.summary}（點擊查看基本面健檢明細）`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap transition hover:brightness-110 ${meta.badgeClass}`}
    >
      <span aria-hidden="true">{meta.icon}</span>
      <span>{meta.shortLabel}</span>
    </button>
  )
}

type SortKey = 'healthScore' | 'drawdown' | 'unrealizedPnlPct' | 'pe' | 'roePct' | 'yieldPct'
type SortDir = 'asc' | 'desc'

interface Props {
  report: PortfolioHealthReport | null
  loading: boolean
  error: string | null
  onRefresh: () => void
  /** 從持倉列表點擊 badge 跳轉過來時，自動展開該標的（格式：`tw:2330`） */
  focusKey?: string | null
  onFocusHandled?: () => void
  /** 一鍵帶入巴菲特法則進行 AI 深度分析 */
  onDeepAnalyze?: (item: HoldingHealthResult) => void
  /** #175：外層市場篩選連動（all / tw / us） */
  marketFilter?: 'all' | 'tw' | 'us'
}

function DimDot({ dim }: { dim: DimensionResult }) {
  const st = CHECK_DOT[dim.status]
  return (
    <span
      title={`${dim.label}：${st.label}${dim.score != null ? ` (${dim.score}分)` : ''}`}
      className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)]"
    >
      <span className={`w-2 h-2 rounded-full ${st.dot}`} />
    </span>
  )
}

export function PortfolioHealthPanel({
  report,
  loading,
  error,
  onRefresh,
  focusKey,
  onFocusHandled,
  onDeepAnalyze,
  marketFilter = 'all',
}: Props) {
  const typo = useTableTypography()
  const [filter, setFilter] = useState<'all' | HealthVerdict>('all')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    if (!focusKey) return
    setFilter('all')
    setExpandedKey(focusKey)
    onFocusHandled?.()
  }, [focusKey, onFocusHandled])

  const handleSort = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('desc')
    } else if (sortDir === 'desc') {
      setSortDir('asc')
    } else {
      setSortKey(null)
    }
  }

  const marketHoldings = useMemo(() => {
    const base = report?.holdings ?? []
    return marketFilter === 'all' ? base : base.filter((h) => h.market === marketFilter)
  }, [report, marketFilter])

  const rows = useMemo(() => {
    const filtered = filter === 'all' ? marketHoldings : marketHoldings.filter((h) => h.verdict === filter)
    if (!sortKey) return filtered

    const getVal = (h: HoldingHealthResult): number | null => {
      switch (sortKey) {
        case 'healthScore': return h.healthScore
        case 'drawdown': return h.drawdownFrom52wHighPct
        case 'unrealizedPnlPct': return h.unrealizedPnlPct
        case 'pe': return h.highlights.pe
        case 'roePct': return h.highlights.roePct
        case 'yieldPct': return h.highlights.dividendYieldPct
      }
    }

    return [...filtered].sort((a, b) => {
      const va = getVal(a)
      const vb = getVal(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [marketHoldings, filter, sortKey, sortDir])

  const renderSortTh = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => {
    const active = sortKey === key
    const ariaSort: 'ascending' | 'descending' | 'none' = active
      ? sortDir === 'asc'
        ? 'ascending'
        : 'descending'
      : 'none'
    return (
      <th
        aria-sort={ariaSort}
        className={`py-2.5 px-3 whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
      >
        <button
          type="button"
          onClick={() => handleSort(key)}
          className={`inline-flex items-center gap-1 hover:text-white transition ${
            active ? 'text-[var(--accent)]' : ''
          }`}
        >
          <span>{label}</span>
          <span className="text-[10px] leading-none" aria-hidden="true">
            {active ? (sortDir === 'asc' ? '▲' : '▼') : '▲▼'}
          </span>
        </button>
      </th>
    )
  }

  if (loading && !report) {
    return (
      <TableSkeleton
        message="正在檢核全持股基本面體質…"
        hint="同步抓取財報指標（ROE、現金流、估值與 52 週回撤），不消耗 AI 額度"
        rows={5}
      />
    )
  }

  if (error && !report) {
    return (
      <div className="bg-[var(--bg-card)] border border-rose-500/30 rounded-2xl p-6 text-center space-y-3">
        <p className="text-sm text-rose-300">{error}</p>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          重新載入
        </button>
      </div>
    )
  }

  if (!report || marketHoldings.length === 0) {
    return (
      <div className="bg-[var(--bg-card)] border border-white/10 rounded-2xl p-8 text-center space-y-2">
        <ShieldCheck className="w-8 h-8 text-[var(--text-secondary)] mx-auto" />
        <p className="text-sm text-white font-medium">
          {marketFilter === 'us'
            ? '尚無美股持倉可進行基本面健檢'
            : marketFilter === 'tw'
              ? '尚無台股持倉可進行基本面健檢'
              : '尚無持倉可進行基本面健檢'}
        </p>
        <p className="text-xs text-[var(--text-secondary)]">
          先在「持倉列表」新增或匯入持股後，系統會自動依財報與估值指標進行免費體檢。
        </p>
      </div>
    )
  }

  const { tw, us } = report.summaryByMarket
  const counts = marketFilter === 'all'
    ? report.overallCounts
    : {
        total: marketHoldings.length,
        ...(marketFilter === 'tw' ? tw.counts : us.counts),
      }

  return (
    <div className="space-y-5">
      {/* 頂部說明列 + 重新整理 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[var(--accent)]" />
            <span>基本面健檢與價值評估</span>
            <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              純數據・零 AI 額度
            </span>
          </h3>
          <p className="text-xs text-[var(--text-secondary)]">
            區分「基本面健全但遭市場錯殺折價」與「體質轉弱／價值陷阱」標的；一般企業、金融業與 ETF 採獨立評估模型。
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-xs text-[var(--text-secondary)] hover:text-white transition disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? '更新中…' : '重新檢核'}</span>
        </button>
      </div>

      {/* 頂部 KPI 卡 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-[var(--bg-card)] border border-white/10 rounded-xl p-4 space-y-1.5">
          <div className="text-xs text-[var(--text-secondary)]">體質健全市值佔比（分幣別）</div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {marketFilter !== 'us' && tw.holdingCount > 0 && (
              <div className="tabular-nums">
                <span className="text-xs text-[var(--text-secondary)] mr-1">台股</span>
                <span className="text-2xl font-bold text-emerald-300">{tw.healthyValuePct.toFixed(1)}%</span>
              </div>
            )}
            {marketFilter !== 'tw' && us.holdingCount > 0 && (
              <div className="tabular-nums">
                <span className="text-xs text-[var(--text-secondary)] mr-1">美股</span>
                <span className="text-2xl font-bold text-sky-300">{us.healthyValuePct.toFixed(1)}%</span>
              </div>
            )}
          </div>
          <div className="text-[11px] text-[var(--text-secondary)]">
            含「體質健全・估值折價」與「體質健全・合理/偏高」標的
          </div>
        </div>

        <div className="bg-[var(--bg-card)] border border-emerald-500/25 rounded-xl p-4 space-y-1.5">
          <div className="text-xs text-[var(--text-secondary)]">💎 體質健全・估值折價</div>
          <div className="text-2xl font-bold text-emerald-300 tabular-nums">
            {counts.discount_healthy} <span className="text-xs font-normal text-[var(--text-secondary)]">/ {counts.total} 檔</span>
          </div>
          <div className="text-[11px] text-[var(--text-secondary)]">
            獲利與財務穩健，且本益比／PEG 或 52 週回撤具安全邊際
          </div>
        </div>

        <div className="bg-[var(--bg-card)] border border-rose-500/25 rounded-xl p-4 space-y-1.5">
          <div className="text-xs text-[var(--text-secondary)]">🔴 體質警戒 ／ 🟠 轉弱追蹤</div>
          <div className="flex items-baseline gap-3 tabular-nums">
            <span className="text-2xl font-bold text-rose-300">{counts.warning}</span>
            <span className="text-xs text-[var(--text-secondary)]">檔警戒</span>
            <span className="text-lg font-semibold text-amber-300">{counts.watch}</span>
            <span className="text-xs text-[var(--text-secondary)]">檔追蹤</span>
          </div>
          <div className="text-[11px] text-[var(--text-secondary)]">
            現金流轉弱、獲利衰退或槓桿偏高，建議優先檢視財報明細
          </div>
        </div>
      </div>

      {/* 篩選膠囊 */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { id: 'all', label: `全部 (${counts.total})` },
            { id: 'discount_healthy', label: `💎 健全折價 (${counts.discount_healthy})` },
            { id: 'healthy', label: `🟢 體質健全 (${counts.healthy})` },
            { id: 'watch', label: `🟠 轉弱追蹤 (${counts.watch})` },
            { id: 'warning', label: `🔴 體質警戒 (${counts.warning})` },
            ...(counts.insufficient > 0 ? [{ id: 'insufficient' as const, label: `⚪ 資料不足 (${counts.insufficient})` }] : []),
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`px-3 py-1 rounded-full text-xs border transition ${
              filter === tab.id
                ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-white/10 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 主體檢表格 */}
      <div className="bg-[var(--bg-card)] border border-white/10 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className={tableClass(typo, 'w-full min-w-[820px] border-collapse')}>
            <thead>
              <tr className={headTrClass(typo, 'border-b border-white/10 text-[var(--text-secondary)] bg-white/[0.02]')}>
                <th className="py-2.5 px-3 text-left whitespace-nowrap">標的 / 類型</th>
                <th className="py-2.5 px-3 text-left whitespace-nowrap">體檢狀態</th>
                {renderSortTh('healthScore', '體質分')}
                <th className="py-2.5 px-3 text-center whitespace-nowrap">四維燈號</th>
                {renderSortTh('drawdown', '距52週高點')}
                {renderSortTh('unrealizedPnlPct', '帳面損益')}
                {renderSortTh('pe', 'PE')}
                {renderSortTh('roePct', 'ROE')}
                {renderSortTh('yieldPct', '殖利率')}
                <th className="py-2.5 px-3 text-right whitespace-nowrap">明細</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-xs text-[var(--text-secondary)]">
                    此篩選條件下無符合的持股
                  </td>
                </tr>
              ) : (
                rows.map((h) => {
                  const rowKey = `${h.market}:${h.symbol}`
                  const isOpen = expandedKey === rowKey
                  const meta = VERDICT_META[h.verdict]
                  return (
                    <Fragment key={rowKey}>
                      <tr
                        onClick={() => setExpandedKey(isOpen ? null : rowKey)}
                        className="hover:bg-white/[0.03] cursor-pointer transition"
                      >
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white">{h.symbol}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-[var(--text-secondary)]">
                              {CATEGORY_LABEL[h.assetCategory]}
                            </span>
                          </div>
                          <div className="text-[11px] text-[var(--text-secondary)] truncate max-w-[180px]">
                            {h.symbolName || h.sector || (h.market === 'tw' ? '台股' : '美股')}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-xs font-medium whitespace-nowrap ${meta.badgeClass}`}
                          >
                            <span aria-hidden="true">{meta.icon}</span>
                            <span>{meta.label}</span>
                          </span>
                          <div className="text-[11px] text-[var(--text-secondary)] mt-1 max-w-[260px] truncate" title={h.summary}>
                            {h.summary}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums font-semibold text-white">
                          {h.healthScore != null ? h.healthScore : '—'}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center justify-center gap-1.5">
                            <DimDot dim={h.dimensions.profitability} />
                            <DimDot dim={h.dimensions.financialSafety} />
                            <DimDot dim={h.dimensions.valuation} />
                            <DimDot dim={h.dimensions.shareholderReturn} />
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          {h.drawdownFrom52wHighPct != null ? (
                            <span className={h.drawdownFrom52wHighPct <= -15 ? 'text-emerald-300' : 'text-[var(--text-secondary)]'}>
                              {h.drawdownFrom52wHighPct.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-[var(--text-secondary)]">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          <span className={h.unrealizedPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {h.unrealizedPnlPct >= 0 ? '+' : ''}
                            {h.unrealizedPnlPct.toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-[var(--text-secondary)]">
                          {h.highlights.pe != null ? `${h.highlights.pe.toFixed(1)}x` : '—'}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-[var(--text-secondary)]">
                          {h.highlights.roePct != null ? `${h.highlights.roePct.toFixed(1)}%` : '—'}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-[var(--text-secondary)]">
                          {h.highlights.dividendYieldPct != null ? `${h.highlights.dividendYieldPct.toFixed(2)}%` : '—'}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <span className="inline-flex items-center gap-0.5 text-xs text-[var(--accent)]">
                            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </span>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="bg-white/[0.02]">
                          <td colSpan={10} className="p-4">
                            <div className="space-y-4">
                              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/10">
                                <div className="text-xs text-[var(--text-secondary)]">
                                  <span className="text-white font-medium">{h.symbol} {h.symbolName ?? ''}</span>
                                  {' · '}
                                  <span>{CATEGORY_LABEL[h.assetCategory]}</span>
                                  {h.sector ? ` · ${h.sector}` : ''}
                                  {' · '}
                                  <span>摘要：{h.summary}</span>
                                </div>
                                {onDeepAnalyze && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onDeepAnalyze(h)
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)]/20 border border-[var(--accent)]/40 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/30 transition"
                                  >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    <span>帶入巴菲特法則做 AI 深度分析</span>
                                  </button>
                                )}
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                                {(
                                  [
                                    h.dimensions.profitability,
                                    h.dimensions.financialSafety,
                                    h.dimensions.valuation,
                                    h.dimensions.shareholderReturn,
                                  ] as DimensionResult[]
                                ).map((dim) => {
                                  const st = CHECK_DOT[dim.status]
                                  return (
                                    <div
                                      key={dim.key}
                                      className="bg-[var(--bg-secondary)]/70 border border-white/10 rounded-xl p-3 space-y-2.5"
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-white">{dim.label}</span>
                                        <span className={`inline-flex items-center gap-1 text-[11px] ${st.text}`}>
                                          <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                                          {st.label}
                                        </span>
                                      </div>
                                      <div className="space-y-2">
                                        {dim.metrics.map((m) => {
                                          const mst = CHECK_DOT[m.status]
                                          return (
                                            <div key={m.key} className="text-[11px] space-y-0.5">
                                              <div className="flex items-center justify-between gap-2">
                                                <span className="text-[var(--text-secondary)]">{m.label}</span>
                                                <span className={`font-semibold tabular-nums ${mst.text}`}>
                                                  {m.formatted}
                                                </span>
                                              </div>
                                              <div className="text-[10px] text-[var(--text-secondary)]/80">
                                                參考門檻：{m.threshold}
                                              </div>
                                              {m.note && (
                                                <div className="text-[10px] text-amber-300/90">
                                                  ※ {m.note}
                                                </div>
                                              )}
                                            </div>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                              <DividendPaybackCard
                                market={h.market}
                                symbol={h.symbol}
                                shares={h.shares}
                                cost={h.cost}
                                currentPrice={h.currentPrice}
                                dividendRates={h.highlights.dividendRates}
                                fallbackDividendRate={h.highlights.dividendRate}
                                verdict={h.verdict}
                                payoutRatioPct={h.highlights.payoutRatioPct}
                              />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 免責四件套（符合 docs/ui-table-checklist.md §6） */}
      <footer className="bg-[var(--bg-card)]/60 border border-white/5 rounded-xl px-4 py-3 text-[11px] text-[var(--text-secondary)] space-y-1">
        <p>
          <strong className="text-white/80">統計方法：</strong>
          財報與估值指標取自 Yahoo Finance（quoteSummary v10，6 小時快取），台股 5 年平均殖利率與配息年數取自 TWSE 歷史除息資料；一般企業、金融業與 ETF 採獨立門檻計算體質分數與估值區間。
        </p>
        <p>
          <strong className="text-white/80">覆蓋範圍：</strong>
          涵蓋使用者目前持倉之台股（上市／上櫃）、美股個股與 ETF；部分中小型股或冷門 ETF 若公開財報欄位缺漏，將以「—」與「資料不足」呈現，不計入扣分。
        </p>
        <p>
          本頁所有燈號與體檢標籤均為客觀財務數據之統計訊號，<strong>非投資建議</strong>，亦不構成買進、賣出或加碼指示；投資前請審慎評估自身風險並參閱{' '}
          <Link href="/terms" className="text-[var(--accent)] underline hover:opacity-80">
            服務條款
          </Link>
          。
        </p>
      </footer>
    </div>
  )
}
