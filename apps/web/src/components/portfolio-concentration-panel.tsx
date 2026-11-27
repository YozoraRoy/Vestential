'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, PieChart, RefreshCw, ShieldAlert } from 'lucide-react'
import {
  INDUSTRY_BOND_ETF,
  INDUSTRY_DR,
  INDUSTRY_ETF,
  INDUSTRY_UNCLASSIFIED,
  industryLabel,
  type IndustryLang,
} from '@/lib/industry'
import type { ConcentrationFlag, ConcentrationReport } from '@/lib/portfolio-concentration'

export interface ConcentrationDict {
  concTitle: string
  concHhiLabel: string
  concStatusDanger: string
  concStatusWarn: string
  concStatusSafe: string
  concTopStocksTitle: string
  concIndustryTitle: string
  concIndustryDanger: string
  concEmptyTitle: string
  concEmptyHint: string
  concLoginRequired: string
  concLoadFailed: string
  riskRetry: string
  concIndustryUnclassified: string
  concIndustryEtf: string
  concIndustryBondEtf: string
  concIndustryDr: string
}

function localizeIndustryName(
  industry: string,
  locale: IndustryLang,
  ui: ConcentrationDict,
): string {
  if (industry === INDUSTRY_UNCLASSIFIED) return ui.concIndustryUnclassified
  if (industry === INDUSTRY_ETF) return ui.concIndustryEtf
  if (industry === INDUSTRY_BOND_ETF) return ui.concIndustryBondEtf
  if (industry === INDUSTRY_DR) return ui.concIndustryDr
  return industryLabel(industry, locale) || ui.concIndustryUnclassified
}

function getStatusBadge(flags: ConcentrationFlag[], ui: ConcentrationDict) {
  if (flags.includes('hhiDanger') || flags.includes('stockDanger')) {
    return {
      label: ui.concStatusDanger,
      tone: 'border-red-500/40 bg-red-500/10 text-red-400',
      dot: 'bg-red-400',
      Icon: ShieldAlert,
    }
  }
  if (flags.includes('stockWarn') || flags.includes('industryDanger')) {
    return {
      label: ui.concStatusWarn,
      tone: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
      dot: 'bg-amber-400',
      Icon: AlertTriangle,
    }
  }
  return {
    label: ui.concStatusSafe,
    tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    dot: 'bg-emerald-400',
    Icon: CheckCircle2,
  }
}

export default function PortfolioConcentrationPanel({
  ui,
  locale,
  isLoggedIn,
  holdingsHash,
}: {
  ui: ConcentrationDict
  locale: IndustryLang
  isLoggedIn: boolean
  holdingsHash: string
}) {
  const [report, setReport] = useState<ConcentrationReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadConcentration = useCallback(async () => {
    if (!isLoggedIn) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/portfolio/concentration', { cache: 'no-store' })
      if (!res.ok) {
        throw new Error(ui.concLoadFailed)
      }
      const data = (await res.json()) as ConcentrationReport
      setReport(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : ui.concLoadFailed)
    } finally {
      setLoading(false)
    }
  }, [isLoggedIn, ui.concLoadFailed])

  useEffect(() => {
    if (isLoggedIn) {
      void loadConcentration()
    } else {
      setReport(null)
      setError('')
    }
  }, [isLoggedIn, holdingsHash, loadConcentration])

  if (!isLoggedIn) {
    return (
      <section className="mb-8 bg-[var(--bg-card)] rounded-xl border border-white/5 p-5">
        <div className="flex items-center gap-2 mb-2">
          <PieChart className="w-4 h-4 text-[var(--accent)]" />
          <h3 className="text-sm font-semibold">{ui.concTitle}</h3>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">{ui.concLoginRequired}</p>
      </section>
    )
  }

  if (loading && !report) {
    return (
      <section className="mb-8 bg-[var(--bg-card)] rounded-xl border border-white/5 p-5 animate-pulse">
        <div className="h-4 w-40 rounded bg-white/10 mb-3" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-24 rounded-lg bg-white/5" />
          <div className="h-24 rounded-lg bg-white/5" />
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="mb-8 bg-[var(--bg-card)] rounded-xl border border-red-500/20 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadConcentration()}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {ui.riskRetry}
          </button>
        </div>
      </section>
    )
  }

  if (!report || report.empty) {
    return (
      <section className="mb-8 bg-[var(--bg-card)] rounded-xl border border-white/5 p-5">
        <div className="flex items-center gap-2 mb-2">
          <PieChart className="w-4 h-4 text-[var(--accent)]" />
          <h3 className="text-sm font-semibold">{ui.concTitle}</h3>
        </div>
        <p className="text-sm font-medium text-[var(--text-primary)]">{ui.concEmptyTitle}</p>
        <p className="text-xs text-[var(--text-secondary)] mt-1">{ui.concEmptyHint}</p>
      </section>
    )
  }

  const badge = getStatusBadge(report.flags, ui)
  const StatusIcon = badge.Icon
  const hasHhiDanger = report.flags.includes('hhiDanger')
  const hasIndustryDanger = report.flags.includes('industryDanger')
  const topIndustryPct = report.industryExposure[0]?.weightPct ?? 0

  return (
    <section
      className="mb-8 bg-[var(--bg-card)] rounded-xl border border-white/5 p-5"
      data-testid="portfolio-concentration-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <PieChart className="w-4 h-4 text-[var(--accent)]" />
          <h3 className="text-sm font-semibold">{ui.concTitle}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
              hasHhiDanger
                ? 'border-red-500/40 bg-red-500/10 text-red-400'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${hasHhiDanger ? 'bg-red-400' : 'bg-emerald-400'}`}
            />
            {ui.concHhiLabel}: {report.hhi.toFixed(3)}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${badge.tone}`}
          >
            <StatusIcon className="w-3.5 h-3.5" />
            {badge.label}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 個股集中度（前三大） */}
        <div className="space-y-3">
          <h4 className="text-xs font-medium text-[var(--text-secondary)]">
            {ui.concTopStocksTitle}
          </h4>
          <div className="space-y-2.5">
            {report.topWeights.map((item, idx) => {
              const isDanger = idx === 0 && report.flags.includes('stockDanger')
              const isWarn = idx === 0 && !isDanger && report.flags.includes('stockWarn')
              const barColor = isDanger
                ? 'bg-red-500'
                : isWarn
                  ? 'bg-amber-400'
                  : 'bg-[var(--accent)]'
              return (
                <div key={`${item.market}:${item.symbol}`} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-semibold text-[var(--text-primary)]">
                        {item.symbol}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-white/5 text-[10px] uppercase text-[var(--text-secondary)]">
                        {item.market}
                      </span>
                    </div>
                    <span
                      className={`font-mono ${
                        isDanger
                          ? 'text-red-400 font-semibold'
                          : isWarn
                            ? 'text-amber-300 font-semibold'
                            : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {item.weightPct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${Math.min(100, Math.max(0, item.weightPct))}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 產業曝險 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-medium text-[var(--text-secondary)]">
              {ui.concIndustryTitle}
            </h4>
            {hasIndustryDanger && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-red-500/40 bg-red-500/10 text-red-400">
                <AlertTriangle className="w-3 h-3" />
                {ui.concIndustryDanger}
              </span>
            )}
          </div>
          <div className="space-y-2.5">
            {report.industryExposure.map((item) => {
              const isDominantDanger =
                hasIndustryDanger && item.weightPct === topIndustryPct
              return (
                <div key={item.industry} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span
                      className={
                        isDominantDanger
                          ? 'text-red-400 font-medium'
                          : 'text-[var(--text-primary)]'
                      }
                    >
                      {localizeIndustryName(item.industry, locale, ui)}
                    </span>
                    <span
                      className={`font-mono ${
                        isDominantDanger
                          ? 'text-red-400 font-semibold'
                          : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {item.weightPct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isDominantDanger ? 'bg-red-500' : 'bg-sky-400/80'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, item.weightPct))}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
