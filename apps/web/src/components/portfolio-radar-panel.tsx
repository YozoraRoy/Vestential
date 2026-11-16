'use client'

import { Target } from 'lucide-react'
import type { LookThroughRadarResult } from '@/lib/etf-holdings-radar'

interface PortfolioRadarPanelProps {
  radar: LookThroughRadarResult
  hasHoldings: boolean
  formatMoney: (val: number, market: 'tw' | 'us') => string
  labels: {
    title: string
    subtitle: string
    topExposures: string
    directHolding: string
    fromEtf: string
    overlapTitle: string
    overlapDesc: string
    emptyTitle: string
    emptyDesc: string
  }
}

export function PortfolioRadarPanel({
  radar,
  hasHoldings,
  formatMoney,
  labels,
}: PortfolioRadarPanelProps) {
  if (!hasHoldings || !radar.hasEtf) {
    return (
      <div className="bg-[var(--bg-card)] rounded-2xl border border-dashed border-white/10 p-10 text-center space-y-2">
        <Target className="w-8 h-8 mx-auto text-[var(--text-secondary)] opacity-60" />
        <p className="text-base font-semibold text-[var(--text-primary)]">{labels.emptyTitle}</p>
        <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">{labels.emptyDesc}</p>
      </div>
    )
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/5 pb-4">
        <div>
          <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Target className="w-5 h-5 text-[var(--accent)]" />
            {labels.title}
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-1">{labels.subtitle}</p>
        </div>
      </div>

      {/* 集中度預警 */}
      {radar.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200 space-y-1.5 text-xs">
          {radar.warnings.map((w, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <span className="font-bold text-amber-400">⚠️</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* 真實 Top 10 個股曝險排行榜 */}
      <div>
        <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-3">
          {labels.topExposures} (總市值 {formatMoney(radar.totalPortfolioValue, 'tw')})
        </h4>
        <div className="space-y-3">
          {radar.topExposures.map((exp, idx) => (
            <div key={exp.symbol} className="bg-white/[0.02] border border-white/5 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-[var(--accent)]">
                    #{idx + 1}
                  </span>
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {exp.name}
                  </span>
                  <span className="text-xs text-[var(--text-secondary)] font-mono">
                    {exp.symbol}
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-sm text-[var(--text-primary)]">
                    {exp.weightPct.toFixed(1)}%
                  </span>
                  <span className="text-xs text-[var(--text-secondary)] ml-2">
                    ({formatMoney(exp.totalExposedValue, 'tw')})
                  </span>
                </div>
              </div>

              <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden mb-2">
                <div
                  className="bg-[var(--accent)] h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, exp.weightPct)}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {exp.directValue > 0 && (
                  <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                    {labels.directHolding}: {formatMoney(exp.directValue, 'tw')}
                  </span>
                )}
                {exp.etfContributions.map((c) => (
                  <span
                    key={c.etfSymbol}
                    className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                  >
                    {labels.fromEtf} {c.etfName}: {formatMoney(c.value, 'tw')} ({c.weightInEtfPct}%)
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ETF 重疊度分析 */}
      {radar.overlaps.length > 0 && (
        <div className="border-t border-white/5 pt-4">
          <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
            {labels.overlapTitle}
          </h4>
          <p className="text-xs text-[var(--text-secondary)] mb-3">{labels.overlapDesc}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {radar.overlaps.map((pair, idx) => (
              <div key={idx} className="bg-white/[0.02] border border-white/5 rounded-xl p-3 text-xs">
                <div className="flex items-center justify-between font-medium mb-1.5 text-[var(--text-primary)]">
                  <span>{pair.etfA} × {pair.etfB}</span>
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-mono text-[10px]">
                    重疊 {pair.overlapCount} 檔成分股
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 text-[11px] text-[var(--text-secondary)]">
                  {pair.commonStocks.map((cs) => (
                    <span key={cs.symbol} className="bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                      {cs.name} ({(cs.weightA * 100).toFixed(1)}% / {(cs.weightB * 100).toFixed(1)}%)
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
