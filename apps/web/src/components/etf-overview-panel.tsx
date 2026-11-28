'use client'

import { useEffect, useState } from 'react'
import { Activity, Layers, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react'
import { useI18n } from '@/i18n/LanguageProvider'
import type { EtfMetricsReport, EtfSubtype, EtfTrendState } from '@/lib/etf-metrics'

function subtypeLabel(
  subtype: EtfSubtype,
  ui: {
    etfSubtypeBroad: string
    etfSubtypeDividend: string
    etfSubtypeBond: string
  },
): string {
  if (subtype === 'dividend') return ui.etfSubtypeDividend
  if (subtype === 'bond') return ui.etfSubtypeBond
  return ui.etfSubtypeBroad
}

function trendBadge(
  trend: EtfTrendState,
  ui: {
    etfTrendBull: string
    etfTrendNeutral: string
    etfTrendPullback: string
  },
) {
  if (trend === 'bull') {
    return {
      label: ui.etfTrendBull,
      cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
      Icon: TrendingUp,
    }
  }
  if (trend === 'pullback') {
    return {
      label: ui.etfTrendPullback,
      cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
      Icon: TrendingDown,
    }
  }
  return {
    label: ui.etfTrendNeutral,
    cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
    Icon: Activity,
  }
}

function formatAum(aum: number, currency?: 'TWD' | 'USD'): string {
  if (currency === 'USD') {
    if (aum >= 1e12) return `$${(aum / 1e12).toFixed(2)}T`
    if (aum >= 1e9) return `$${(aum / 1e9).toFixed(2)}B`
    if (aum >= 1e6) return `$${(aum / 1e6).toFixed(1)}M`
    return `$${Math.round(aum).toLocaleString()}`
  }
  if (aum >= 1e8) return `NT$${(aum / 1e8).toFixed(1)}億`
  if (aum >= 1e4) return `NT$${(aum / 1e4).toFixed(0)}萬`
  return `NT$${Math.round(aum).toLocaleString()}`
}

export function EtfOverviewPanel({ ticker }: { ticker?: string }) {
  const { dict } = useI18n()
  const ui = dict.analysisCard
  const [metrics, setMetrics] = useState<EtfMetricsReport | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const clean = (ticker ?? '').trim()
    if (!clean) {
      setMetrics(null)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/analyze/etf-metrics?symbol=${encodeURIComponent(clean)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: EtfMetricsReport | null) => {
        if (!cancelled && data && data.symbol) setMetrics(data)
      })
      .catch(() => {
        if (!cancelled) setMetrics(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ticker])

  if (loading && !metrics) {
    return (
      <div className="bg-[var(--bg-card)] rounded-xl border border-white/5 p-5 animate-pulse space-y-3">
        <div className="h-4 w-44 rounded bg-white/10" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="h-16 rounded-lg bg-white/5" />
          <div className="h-16 rounded-lg bg-white/5" />
          <div className="h-16 rounded-lg bg-white/5" />
          <div className="h-16 rounded-lg bg-white/5" />
        </div>
      </div>
    )
  }

  if (!metrics) return null

  const badge = trendBadge(metrics.trendState, ui)
  const TrendIcon = badge.Icon

  // 僅組裝有真實數值的卡片，絕不放空卡或 N/A 佔位欄
  const cards: Array<{ key: string; label: string; value: string; hint?: string; tone?: 'warn' | 'neutral' }> = []
  if (metrics.expenseRatioPct != null && metrics.expenseRatioPct > 0) {
    cards.push({
      key: 'ter',
      label: ui.etfCardExpenseRatio,
      value: `${metrics.expenseRatioPct.toFixed(2)}%`,
    })
  }
  if (metrics.totalAssets != null && metrics.totalAssets > 0) {
    cards.push({
      key: 'aum',
      label: ui.etfCardAum,
      value: formatAum(metrics.totalAssets, metrics.currency),
    })
  }
  if (metrics.premiumDiscountPct != null) {
    const sign = metrics.premiumDiscountPct > 0 ? '+' : ''
    const navStr = metrics.navPrice != null ? metrics.navPrice.toFixed(2) : '—'
    const navHint =
      metrics.premiumDiscountSource === 'yahoo_prev_nav'
        ? ui.etfCardPrevNavHint.replace('{nav}', navStr)
        : ui.etfCardNavHint.replace('{nav}', navStr)
    cards.push({
      key: 'premium',
      label: ui.etfCardPremiumDiscount,
      value: `${sign}${metrics.premiumDiscountPct.toFixed(2)}%`,
      hint: metrics.navPrice != null ? navHint : undefined,
      tone: metrics.premiumDiscountPct > 1 ? 'warn' : undefined,
    })
  }
  if (metrics.bondMaturityYears != null && metrics.bondMaturityYears > 0) {
    cards.push({
      key: 'maturity',
      label: ui.etfCardBondMaturity,
      value: `${metrics.bondMaturityYears.toFixed(2)}y`,
    })
  }
  if (metrics.bias60Pct !== null) {
    const sign = metrics.bias60Pct > 0 ? '+' : ''
    cards.push({
      key: 'bias60',
      label: ui.etfCardBias60,
      value: `${sign}${metrics.bias60Pct.toFixed(2)}%`,
      hint: metrics.ma60 !== null ? `MA60: ${metrics.ma60}` : undefined,
    })
  }
  if (metrics.bias240Pct !== null) {
    const sign = metrics.bias240Pct > 0 ? '+' : ''
    cards.push({
      key: 'bias240',
      label: ui.etfCardBias240,
      value: `${sign}${metrics.bias240Pct.toFixed(2)}%`,
      hint: metrics.ma240 !== null ? `MA240: ${metrics.ma240}` : undefined,
    })
  }
  if (metrics.annualVolatilityPct !== null) {
    cards.push({
      key: 'vol',
      label: ui.etfCardVolatility,
      value: `${metrics.annualVolatilityPct.toFixed(1)}%`,
      hint:
        metrics.maxDrawdownPct !== null
          ? `${ui.etfCardMdd}: -${metrics.maxDrawdownPct.toFixed(1)}%`
          : undefined,
    })
  } else if (metrics.maxDrawdownPct !== null) {
    cards.push({
      key: 'mdd',
      label: ui.etfCardMdd,
      value: `-${metrics.maxDrawdownPct.toFixed(1)}%`,
    })
  }
  if (metrics.trailingYieldPct !== null) {
    cards.push({
      key: 'yield',
      label: ui.etfCardYield1y,
      value: `${metrics.trailingYieldPct.toFixed(2)}%`,
      hint:
        metrics.dividendCount1y !== null
          ? ui.etfCardDivCount.replace('{n}', String(metrics.dividendCount1y))
          : undefined,
    })
  }
  if (metrics.avgVolume20d !== null) {
    cards.push({
      key: 'volume',
      label: ui.etfCardAvgVol20d,
      value: metrics.avgVolume20d.toLocaleString(),
    })
  }

  return (
    <section
      className="bg-[var(--bg-card)] rounded-xl border border-white/10 p-5 space-y-4"
      data-testid="etf-overview-panel"
    >
      {/* 首屏：位階＋風險狀態 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Layers className="w-4 h-4 text-[var(--accent)]" />
          <h3 className="text-sm font-semibold">{ui.etfPanelTitle}</h3>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30">
            {subtypeLabel(metrics.subtype, ui)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${badge.cls}`}
          >
            <TrendIcon className="w-3.5 h-3.5" />
            {badge.label}
          </span>
          {metrics.bias60Pct !== null && metrics.bias60Pct >= 8 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-amber-500/40 bg-amber-500/10 text-amber-300">
              <ShieldAlert className="w-3.5 h-3.5" />
              {ui.etfBiasHighWarn}
            </span>
          )}
          {metrics.premiumDiscountPct != null && metrics.premiumDiscountPct > 1 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-rose-500/40 bg-rose-500/10 text-rose-300">
              <ShieldAlert className="w-3.5 h-3.5" />
              {ui.etfPremiumWarn}
            </span>
          )}
          {metrics.premiumDiscountPct != null && metrics.premiumDiscountPct < -1 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-sky-500/40 bg-sky-500/10 text-sky-300">
              <Activity className="w-3.5 h-3.5" />
              {ui.etfDiscountHint}
            </span>
          )}
        </div>
      </div>

      {/* 中段：ETF 體質摘要卡（只渲染有真實數據的項目） */}
      {cards.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {cards.map((c) => (
            <div
              key={c.key}
              className={`rounded-lg px-3.5 py-3 border ${
                c.tone === 'warn'
                  ? 'bg-rose-500/10 border-rose-500/30'
                  : 'bg-white/5 border-white/5'
              }`}
            >
              <div className="text-[11px] text-[var(--text-secondary)] mb-1">
                {c.label}
              </div>
              <div
                className={`text-base font-bold font-mono ${
                  c.tone === 'warn' ? 'text-rose-300' : 'text-[var(--text-primary)]'
                }`}
              >
                {c.value}
              </div>
              {c.hint && (
                <div className="text-[11px] text-[var(--text-secondary)] mt-0.5 font-mono">
                  {c.hint}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 下段：前 10 大成分股（僅有真實資料時顯示，無資料則隱藏） */}
      {metrics.topHoldings && metrics.topHoldings.length > 0 && (
        <div className="pt-2 border-t border-white/5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-[var(--text-secondary)]">
              {ui.etfHoldingsTitle}
            </h4>
            <span className="text-[11px] text-[var(--text-secondary)]">
              {metrics.topHoldingsSource === 'core_map'
                ? ui.etfHoldingsSourceCore
                : ui.etfHoldingsSourceYahoo}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {metrics.topHoldings.slice(0, 10).map((h, idx) => (
              <div key={`${h.symbol}-${idx}`} className="space-y-1">
                <div className="flex items-center justify-between text-xs gap-2">
                  <span className="truncate text-[var(--text-primary)]">
                    <span className="font-mono text-[var(--text-secondary)] mr-1.5">
                      {h.symbol}
                    </span>
                    {h.name !== h.symbol ? h.name : ''}
                  </span>
                  <span className="font-mono font-medium text-[var(--text-primary)] shrink-0">
                    {h.weightPct.toFixed(2)}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]/70"
                    style={{ width: `${Math.min(100, Math.max(2, h.weightPct))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
