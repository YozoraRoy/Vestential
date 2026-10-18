'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react'
import { RISK_DISCLAIMER } from '@/lib/portfolio-risk'

type PortfolioDict = {
  riskLoading: string
  riskLoadFailed: string
  riskRetry: string
  riskEmptyTitle: string
  riskEmptyHint: string
  riskSingleNotice: string
  riskConcentrationTitle: string
  riskTop1: string
  riskTop3: string
  riskSectorTitle: string
  riskStressTitle: string
  riskStressFormula: string
  riskScenarioM10: string
  riskScenarioM20: string
  riskScenarioSector: string
  riskLossAmount: string
  riskLossPct: string
  riskValueNa: string
  riskCannotCompute: string
  riskExcluded: string
  riskExcludedMissingValue: string
  riskExcludedMissingSector: string
  riskAiSummary: string
  riskAiSummarizing: string
  riskAiQuota: string
  riskQuotaRemaining: string
  riskSummaryStale: string
  riskAiFailed: string
  riskAiLoginRequired: string
  riskDataAsOf: string
  riskSectorSource: string
  riskGroupTw: string
  riskGroupUs: string
}

interface WeightRow {
  market: 'tw' | 'us'
  symbol: string
  symbolName?: string | null
  sector: string
  marketValue: number
  weightPct: number
}

interface SectorSlice {
  sector: string
  marketValue: number
  weightPct: number
  count: number
}

interface ScenarioResult {
  id: string
  dropPct: number
  targetSector: string | null
  /** Issue #104：整組無已知產業 → 金額/比例顯示 `—`（不是 NT$0）。舊資料可能無此欄位。 */
  targetUnavailable?: boolean
  lossAmount: number
  lossPct: number
  excluded: Array<{ symbol: string; symbolName?: string | null; reason: string }>
}

interface RiskGroup {
  market: 'tw' | 'us'
  totalMarketValue: number
  includedCount: number
  weights: WeightRow[]
  top1Pct: number
  top3Pct: number
  weightSumPct: number
  sectors: SectorSlice[]
  sectorWeightSumPct: number
  scenarios: ScenarioResult[]
}

interface RiskData {
  success: boolean
  asOf: string
  holdingsCount: number
  sectorSource: string
  groups: RiskGroup[]
  excluded: Array<{ market: string; symbol: string; symbolName?: string | null; reason: string }>
}

function fmtMoney(n: number, market: 'tw' | 'us'): string {
  if (!Number.isFinite(n)) return '—'
  const ccy = market === 'tw' ? 'NT$' : '$'
  return `${ccy}${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(2)}%`
}

function scenarioName(id: string, ui: PortfolioDict, target: string | null): string {
  if (id === 'market-10') return ui.riskScenarioM10
  if (id === 'market-20') return ui.riskScenarioM20
  return target ? `${ui.riskScenarioSector}（${target}）` : ui.riskScenarioSector
}

export interface RiskSummaryValue {
  text: string
  dataAsOf: string
}

export interface RiskQuotaValue {
  remaining: number
  max: number
}

// Issue #30：summary/quota state 上提到 portfolio page 層（切頁籤不卸載清空），
// 本 panel 只保留 fetching 中間態；暫存讀寫由 page 層經 lib/risk-summary-cache 處理。
export default function PortfolioRiskPanel({ ui, isLoggedIn, summary, summaryStale, quota, holdingsHash, onSummarySaved, onQuota }: {
  ui: PortfolioDict
  isLoggedIn: boolean
  summary: RiskSummaryValue | null
  summaryStale: boolean
  quota: RiskQuotaValue | null
  holdingsHash: string
  onSummarySaved: (s: RiskSummaryValue, quota: RiskQuotaValue | null, hash: string) => void
  onQuota: (q: RiskQuotaValue) => void
}) {
  const [data, setData] = useState<RiskData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const fetchRisk = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/portfolio/risk')
      const body = await res.json()
      if (!res.ok || !body.success) {
        setError(body.error || ui.riskLoadFailed)
        return
      }
      setData(body as RiskData)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : ui.riskLoadFailed)
    } finally {
      setLoading(false)
    }
  }, [ui.riskLoadFailed])

  useEffect(() => {
    fetchRisk()
  }, [fetchRisk])

  const handleSummary = async () => {
    if (!isLoggedIn || summarizing) return
    setSummarizing(true)
    setSummaryError(null)
    // 按下當時的持倉快照 hash（page 層傳入）：回來後連同結果存檔，
    // 使「總結↔產生當時持倉」綁定，持倉變動即判定失效。
    const requestHash = holdingsHash
    try {
      const res = await fetch('/api/portfolio/risk/summary', { method: 'POST' })
      const body = await res.json()
      // Issue #30：成功/429/502（以及帶 quota 的其他回應）都更新額度顯示
      if (body?.quota && typeof body.quota.remaining === 'number' && typeof body.quota.max === 'number') {
        onQuota({ remaining: body.quota.remaining, max: body.quota.max })
      }
      if (res.ok && body.success) {
        onSummarySaved({ text: body.summary, dataAsOf: body.dataAsOf ?? '' }, body?.quota ?? null, requestHash)
      } else {
        // 降級：只顯示數字表
        setSummaryError(body.error || ui.riskAiFailed)
      }
    } catch (e: unknown) {
      setSummaryError(e instanceof Error ? e.message : ui.riskAiFailed)
    } finally {
      setSummarizing(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-[var(--bg-card)] rounded-xl border border-white/5 p-8 text-center">
        <p className="text-sm text-[var(--text-secondary)] flex items-center justify-center gap-2">
          <span className="inline-block w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          {ui.riskLoading}
        </p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="bg-[var(--bg-card)] rounded-xl border border-white/5 p-8 text-center">
        <p className="text-sm text-red-400 mb-3">{error ?? ui.riskLoadFailed}</p>
        <button
          type="button"
          onClick={fetchRisk}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-sm hover:bg-white/15 transition"
        >
          <RefreshCw className="w-4 h-4" />
          {ui.riskRetry}
        </button>
      </div>
    )
  }

  // 空倉：空狀態文案，不報錯、不 NaN
  if (data.holdingsCount === 0) {
    return (
      <div className="bg-[var(--bg-card)] rounded-xl border border-white/5 p-8 text-center">
        <ShieldAlert className="w-8 h-8 mx-auto mb-3 text-[var(--text-secondary)]" />
        <p className="text-sm font-medium text-[var(--text-primary)]">{ui.riskEmptyTitle}</p>
        <p className="text-xs text-[var(--text-secondary)] mt-1">{ui.riskEmptyHint}</p>
      </div>
    )
  }

  const singleHolding = data.holdingsCount === 1

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-[var(--text-secondary)]">
        {ui.riskDataAsOf}：{(data.asOf || '').replace('T', ' ').slice(0, 19)}　·　{ui.riskSectorSource}：{data.sectorSource}
      </p>

      {singleHolding && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
          <p className="text-xs text-amber-400">{ui.riskSingleNotice}</p>
        </div>
      )}

      {data.groups.filter((g) => g.includedCount > 0).map((g) => (
        <div key={g.market} className="bg-[var(--bg-card)] rounded-xl border border-white/5 p-4 space-y-4">
          <h3 className="text-sm font-semibold">
            {g.market === 'tw' ? ui.riskGroupTw : ui.riskGroupUs}
            <span className="ml-2 text-xs font-normal text-[var(--text-secondary)]">
              {fmtMoney(g.totalMarketValue, g.market)}
            </span>
          </h3>

          {/* 集中度：各標的權重 + Top-1/Top-3 */}
          <div>
            <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">
              {ui.riskConcentrationTitle} · {ui.riskTop1} {fmtPct(g.top1Pct)} · {ui.riskTop3} {fmtPct(g.top3Pct)}
            </p>
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-xs min-w-[420px]">
                <tbody>
                  {g.weights.map((w) => (
                    <tr key={w.symbol} className="border-b border-white/5 last:border-0">
                      <td className="px-3 py-2 font-medium">{w.symbolName || w.symbol}</td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">{w.symbol}</td>
                      <td className="px-3 py-2 text-right">{fmtMoney(w.marketValue, g.market)}</td>
                      <td className="px-3 py-2 text-right font-bold">{fmtPct(w.weightPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 產業暴露 */}
          <div>
            <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">
              {ui.riskSectorTitle}（{fmtPct(g.sectorWeightSumPct)}）
            </p>
            <div className="space-y-1.5">
              {g.sectors.map((s) => (
                <div key={s.sector} className="flex items-center gap-2 text-xs">
                  <span className="w-28 shrink-0 truncate text-[var(--text-primary)]">{s.sector} ×{s.count}</span>
                  <div className="flex-1 h-2 rounded bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-[var(--accent)] rounded"
                      style={{ width: `${Number.isFinite(s.weightPct) ? Math.min(Math.max(s.weightPct, 0), 100) : 0}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-[var(--text-secondary)]">{fmtPct(s.weightPct)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 壓力測試：三情境各輸出虧損金額＋％ */}
          <div>
            <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">{ui.riskStressTitle}</p>
            <p className="text-[10px] text-[var(--text-secondary)] mb-2">{ui.riskStressFormula}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {g.scenarios.map((sc) => {
                // Issue #104：該組完全無已知產業時，不得顯示 NT$0 / 0.00%（會誤導成「跌 30% 也不虧」）。
                const cannotCompute = sc.targetUnavailable === true
                return (
                  <div key={sc.id} className="rounded-lg border border-white/10 bg-[var(--bg-secondary)]/50 p-3">
                    <p className="text-xs font-medium flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      {scenarioName(sc.id, ui, sc.targetSector)}
                    </p>
                    <p className="mt-2 text-[11px] text-[var(--text-secondary)]">{ui.riskLossAmount}</p>
                    <p className="text-base font-bold text-[var(--accent-red)]">
                      {cannotCompute ? ui.riskValueNa : fmtMoney(sc.lossAmount, g.market)}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{ui.riskLossPct}</p>
                    <p className="text-sm font-bold">{cannotCompute ? ui.riskValueNa : fmtPct(sc.lossPct)}</p>
                    {cannotCompute && (
                      <p className="mt-1 text-[10px] text-amber-400">{ui.riskCannotCompute}</p>
                    )}
                    {((sc.excluded ?? []).length > 0) && (
                      <p className="mt-2 text-[10px] text-amber-400">
                        {ui.riskExcluded}：{(sc.excluded ?? []).map((x) => x.symbol).join('、')}
                        （{(sc.excluded ?? [])[0]?.reason === 'missing-sector' ? ui.riskExcludedMissingSector : ui.riskExcludedMissingValue}）
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ))}

      {/* 市值無效而不納入試算者（全情境） */}
      {((data.excluded ?? []).length > 0) && (
        <p className="text-[11px] text-amber-400">
          {ui.riskExcluded}：{(data.excluded ?? []).map((x) => x.symbol).join('、')}（{ui.riskExcludedMissingValue}）
        </p>
      )}

      {/* AI 風險總結（可選）：共用 quota，失敗降級只顯示數字表 */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-white/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <p className="text-xs font-medium flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
            {ui.riskAiSummary}
          </p>
          {isLoggedIn ? (
            <div className="flex items-center gap-2">
              {quota && (
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {ui.riskQuotaRemaining.replace('{remaining}', String(quota.remaining)).replace('{max}', String(quota.max))}
                </span>
              )}
              <button
                type="button"
                onClick={handleSummary}
                disabled={summarizing}
                className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                {summarizing ? ui.riskAiSummarizing : ui.riskAiSummary}
              </button>
            </div>
          ) : (
            <span className="text-[11px] text-[var(--text-secondary)]">{ui.riskAiLoginRequired}</span>
          )}
        </div>
        <p className="text-[10px] text-[var(--text-secondary)] mb-2">{ui.riskAiQuota}</p>
        {summaryError && <p className="text-[11px] text-amber-400 mb-2">{summaryError}</p>}
        {summaryStale ? (
          <p className="text-[11px] text-amber-400">{ui.riskSummaryStale}</p>
        ) : summary && (
          <div className="rounded-lg bg-[var(--bg-secondary)] border border-white/5 p-3">
            <p className="text-sm whitespace-pre-wrap">{summary.text}</p>
            <p className="mt-2 text-[10px] text-[var(--text-secondary)]">
              {RISK_DISCLAIMER}
              {summary.dataAsOf && `（${ui.riskDataAsOf}：${summary.dataAsOf.replace('T', ' ').slice(0, 19)}）`}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
