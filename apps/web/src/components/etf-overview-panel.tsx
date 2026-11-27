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
  const cards: Array<{ key: string; label: string; value: string; hint?: string }> = []
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
        </div>
      </div>

      {/* 中段：ETF 體質摘要卡（只渲染有真實數據的項目） */}
      {cards.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {cards.map((c) => (
            <div
              key={c.key}
              className="rounded-lg bg-white/5 border border-white/5 px-3.5 py-3"
            >
              <div className="text-[11px] text-[var(--text-secondary)] mb-1">
                {c.label}
              </div>
              <div className="text-base font-bold font-mono text-[var(--text-primary)]">
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
    </section>
  )
}
