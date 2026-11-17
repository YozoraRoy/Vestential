'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Coins, Download, Info, Minus, Plus, RotateCcw, Search, ShieldAlert, Sparkles, Trash2 } from 'lucide-react'
import { WorkspaceBackLink } from '@/components/workspace-back-link'
import { buildCashflowPlanExportHtml } from '@/lib/cashflow-plan-export'
import {
  CASHFLOW_STYLE_TEMPLATES,
  CASHFLOW_TARGET_PRESETS,
  DEFAULT_CASHFLOW_TARGET,
  evaluateCashflowPlan,
  solveTargetLots,
  type CashflowStyleId,
  type PlanAllocationInput,
  type PlanAssetProfile,
} from '@/lib/cashflow-plan'

const STORAGE_KEY = 'vestential.cashflow-plan.v1'

interface SavedPlanState {
  targetMonthly: number
  styleId: CashflowStyleId
  items: Array<{ symbol: string; lots: number; profile?: PlanAssetProfile }>
}

function fmtNtd(n: number): string {
  return `NT$${Math.round(n).toLocaleString('en-US')}`
}

export default function CashflowPlanPage() {
  const [profiles, setProfiles] = useState<Record<string, PlanAssetProfile>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [targetMonthly, setTargetMonthly] = useState<number>(DEFAULT_CASHFLOW_TARGET)
  const [customInput, setCustomInput] = useState<string>(String(DEFAULT_CASHFLOW_TARGET))
  const [styleId, setStyleId] = useState<CashflowStyleId>('balanced')
  const [allocations, setAllocations] = useState<PlanAllocationInput[]>([])

  const [addSymbol, setAddSymbol] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [activeMonth, setActiveMonth] = useState<number | null>(null)

  // 從 presets 計算某個風格範本在指定目標月領下的初始張數
  const applyTemplate = (
    tplId: CashflowStyleId,
    monthly: number,
    profMap: Record<string, PlanAssetProfile>,
  ): PlanAllocationInput[] => {
    const tpl = CASHFLOW_STYLE_TEMPLATES.find((t) => t.id === tplId) ?? CASHFLOW_STYLE_TEMPLATES[0]!
    const inputs = tpl.allocations
      .map((a) => ({ asset: profMap[a.symbol], weight: a.weight }))
      .filter((x): x is { asset: PlanAssetProfile; weight: number } => Boolean(x.asset))
    return solveTargetLots(inputs, monthly)
  }

  useEffect(() => {
    let cancelled = false
    fetch('/api/cashflow-plan/presets')
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return
        if (!json?.success || !json?.profiles) {
          throw new Error(json?.error || '無法載入預設配置資料')
        }
        const profMap = json.profiles as Record<string, PlanAssetProfile>
        setProfiles(profMap)

        // 嘗試讀取 localStorage 記憶
        let restored = false
        try {
          const raw = localStorage.getItem(STORAGE_KEY)
          if (raw) {
            const parsed = JSON.parse(raw) as SavedPlanState
            if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
              const mergedMap = { ...profMap }
              const nextAllocs: PlanAllocationInput[] = []
              for (const item of parsed.items) {
                const sym = item.symbol.toUpperCase()
                const prof = profMap[sym] ?? item.profile
                if (prof) {
                  mergedMap[sym] = prof
                  nextAllocs.push({ asset: prof, lots: Math.max(0, Math.round(item.lots)) })
                }
              }
              if (nextAllocs.length > 0) {
                setProfiles(mergedMap)
                setTargetMonthly(parsed.targetMonthly || DEFAULT_CASHFLOW_TARGET)
                setCustomInput(String(parsed.targetMonthly || DEFAULT_CASHFLOW_TARGET))
                setStyleId(parsed.styleId || 'balanced')
                setAllocations(nextAllocs)
                restored = true
              }
            }
          }
        } catch {}

        if (!restored) {
          setAllocations(applyTemplate('balanced', DEFAULT_CASHFLOW_TARGET, profMap))
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : '載入失敗')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 自動儲存至 localStorage
  useEffect(() => {
    if (loading || allocations.length === 0) return
    try {
      const payload: SavedPlanState = {
        targetMonthly,
        styleId,
        items: allocations.map((a) => ({
          symbol: a.asset.symbol,
          lots: a.lots,
          profile: a.asset,
        })),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {}
  }, [allocations, targetMonthly, styleId, loading])

  const evaluation = useMemo(
    () => evaluateCashflowPlan(allocations, targetMonthly),
    [allocations, targetMonthly],
  )

  const maxMonthNet = useMemo(() => {
    return Math.max(targetMonthly * 1.2, ...evaluation.months.map((m) => m.net), 1)
  }, [evaluation.months, targetMonthly])

  // Q10：點選月領金額時，依當前標的清單權重重新反推達標張數
  const handleSelectTarget = (nextMonthly: number) => {
    const safe = Math.max(1000, Math.round(nextMonthly))
    setTargetMonthly(safe)
    setCustomInput(String(safe))
    if (allocations.length === 0) return

    const totalCap = allocations.reduce((s, a) => s + Math.max(1, a.lots) * a.asset.price, 0)
    const weighted = allocations.map((a) => ({
      asset: a.asset,
      weight: totalCap > 0 ? (Math.max(1, a.lots) * a.asset.price) / totalCap : 1 / allocations.length,
    }))
    setAllocations(solveTargetLots(weighted, safe))
  }

  // Q10：切換風格範本或重設時，載入該範本預設標的與達標張數
  const handleSelectStyle = (nextStyle: CashflowStyleId) => {
    setStyleId(nextStyle)
    setAllocations(applyTemplate(nextStyle, targetMonthly, profiles))
  }

  const handleReset = () => {
    setTargetMonthly(DEFAULT_CASHFLOW_TARGET)
    setCustomInput(String(DEFAULT_CASHFLOW_TARGET))
    setStyleId('balanced')
    setAllocations(applyTemplate('balanced', DEFAULT_CASHFLOW_TARGET, profiles))
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {}
  }

  const handleExportHtml = () => {
    if (loading || allocations.length === 0) return
    const styleName = CASHFLOW_STYLE_TEMPLATES.find((t) => t.id === styleId)?.name ?? '自訂配置'
    const html = buildCashflowPlanExportHtml({ evaluation, styleName })
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const ymd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }).replaceAll('-', '')
    const a = document.createElement('a')
    a.href = url
    a.download = `vestential-cashflow-plan-${ymd}.html`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const updateLots = (symbol: string, nextLots: number) => {
    const clamped = Math.max(0, Math.min(9999, Math.round(nextLots)))
    setAllocations((prev) => prev.map((a) => (a.asset.symbol === symbol ? { ...a, lots: clamped } : a)))
  }

  const removeSymbol = (symbol: string) => {
    setAllocations((prev) => prev.filter((a) => a.asset.symbol !== symbol))
  }

  const handleAddSymbol = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = addSymbol.trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
    if (!clean) return
    if (allocations.some((a) => a.asset.symbol === clean)) {
      setAddError(`${clean} 已在配置清單中`)
      return
    }
    setAdding(true)
    setAddError(null)
    try {
      const cachedProf = profiles[clean]
      if (cachedProf) {
        setAllocations((prev) => [...prev, { asset: cachedProf, lots: 1 }])
        setAddSymbol('')
        return
      }
      const res = await fetch(`/api/cashflow-plan/quote?symbol=${encodeURIComponent(clean)}`)
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success || !json?.profile) {
        throw new Error(json?.error || `查無 ${clean} 資料`)
      }
      const prof = json.profile as PlanAssetProfile
      setProfiles((prev) => ({ ...prev, [prof.symbol]: prof }))
      setAllocations((prev) => [...prev, { asset: prof, lots: 1 }])
      setAddSymbol('')
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : '新增失敗')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto w-full px-4 py-8 md:py-10">
      <WorkspaceBackLink className="mb-4" />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Coins className="w-6 h-6 text-[var(--accent-green)]" />
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            免登入試算
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">
            依 54C 精算二代健保
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportHtml}
            disabled={loading || allocations.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 disabled:pointer-events-none transition"
          >
            <Download className="w-3.5 h-3.5" />
            匯出 HTML 報告
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-white/10 hover:text-[var(--text-primary)] transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            重設預設（月領 4 萬）
          </button>
        </div>
      </div>

      <h1 className="text-3xl font-bold mb-2">股利現金流自由配置 Plan</h1>
      <div className="mb-4 w-16 h-1 rounded-full bg-gradient-to-r from-[var(--accent-green)] to-[var(--accent)]" />
      <p className="max-w-2xl text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
        從零開始規劃你的「月月領息退休現金流」：先選擇每月稅後實拿目標（預設 4 萬）與配置風格，再自由微調各檔張數或加入自選台股 ETF，即時估算所需本金與 12 個月實際入帳分佈。
      </p>

      {loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-36 rounded-2xl bg-[var(--bg-card)] border border-white/5" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-2xl bg-[var(--bg-card)] border border-white/5" />
            ))}
          </div>
          <div className="h-56 rounded-2xl bg-[var(--bg-card)] border border-white/5" />
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-200">
          載入即時市價與配息資料失敗：{loadError}
        </div>
      ) : (
        <div className="space-y-6">
          {/* 控制區：目標月領 ＋ 風格範本 */}
          <div className="rounded-2xl border border-white/10 bg-[var(--bg-card)] p-5 space-y-5">
            <div>
              <div className="text-xs font-semibold text-[var(--text-secondary)] mb-2.5">
                ① 選擇每月「稅後實拿」目標現金流
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {CASHFLOW_TARGET_PRESETS.map((amt) => {
                  const active = targetMonthly === amt
                  return (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => handleSelectTarget(amt)}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                        active
                          ? 'bg-[var(--accent-green)] text-white shadow-sm'
                          : 'bg-white/5 text-[var(--text-secondary)] hover:bg-white/10 hover:text-[var(--text-primary)]'
                      }`}
                    >
                      月領 {amt / 10_000} 萬{amt === DEFAULT_CASHFLOW_TARGET ? '（預設）' : ''}
                    </button>
                  )
                })}
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-xs text-[var(--text-secondary)]">自訂 NT$</span>
                  <input
                    type="number"
                    min={1000}
                    step={1000}
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    onBlur={() => {
                      const val = Number(customInput)
                      if (Number.isFinite(val) && val >= 1000) handleSelectTarget(val)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = Number(customInput)
                        if (Number.isFinite(val) && val >= 1000) handleSelectTarget(val)
                      }
                    }}
                    aria-label="自訂每月目標金額"
                    className="w-28 rounded-lg border border-white/10 bg-[var(--bg-secondary)] px-2.5 py-1.5 text-sm font-mono text-[var(--text-primary)]"
                  />
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-[var(--text-secondary)] mb-2.5 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
                ② 一鍵風格範本（套用後仍可下方自由微調）
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {CASHFLOW_STYLE_TEMPLATES.map((tpl) => {
                  const active = styleId === tpl.id
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleSelectStyle(tpl.id)}
                      className={`text-left rounded-xl border p-3.5 transition ${
                        active
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                          : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold text-[var(--text-primary)]">{tpl.name}</span>
                        <span className="text-[11px] font-mono text-[var(--accent)]">
                          {tpl.allocations.map((a) => a.symbol).join(' · ')}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{tpl.desc}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 核心指標 4 格 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-white/5 bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-secondary)]">預估所需總本金</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-[var(--text-primary)]">
                {fmtNtd(evaluation.totalCapital)}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">依目前即時參考收盤價計算</div>
            </div>

            <div className="rounded-2xl border border-emerald-500/20 bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-secondary)]">預估月均稅後實拿</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-emerald-400">
                {fmtNtd(evaluation.monthlyAvgNet)}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--text-secondary)] tabular-nums">
                年領稅後 {fmtNtd(evaluation.annualNet)}（目標 {fmtNtd(targetMonthly)}/月）
              </div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-secondary)]">預估稅後年殖利率</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-[var(--accent)]">
                {evaluation.portfolioYieldPct.toFixed(2)}%
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--text-secondary)] tabular-nums">
                年領稅前 {fmtNtd(evaluation.annualGross)}
              </div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-secondary)]">預估年繳二代健保</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-amber-300">
                {fmtNtd(evaluation.annualNhiFee)}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                僅單次 54C ≥ NT$20,000 扣 2.11%
              </div>
            </div>
          </div>

          {/* 12 個月實際領錢分佈長條圖 */}
          <div className="rounded-2xl border border-white/5 bg-[var(--bg-card)] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-[var(--text-primary)]">12 個月實際領錢預估分佈（依發放月）</h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  點選月份柱狀可查看該月預計領息明細；虛線為目標月領基準（{fmtNtd(targetMonthly)}）
                </p>
              </div>
            </div>

            <div className="relative pt-4">
              {/* 目標基準線 */}
              <div
                className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-emerald-400/50 z-10"
                style={{
                  bottom: `${Math.min(95, (targetMonthly / maxMonthNet) * 140) + 28}px`,
                }}
              />
              <div className="grid grid-cols-12 gap-1.5 sm:gap-2 items-end h-44">
                {evaluation.months.map((m) => {
                  const pct = Math.max(4, Math.min(100, (m.net / maxMonthNet) * 100))
                  const isSelected = activeMonth === m.month
                  const hitTarget = m.net >= targetMonthly
                  return (
                    <button
                      key={m.month}
                      type="button"
                      onClick={() => setActiveMonth(isSelected ? null : m.month)}
                      className="flex flex-col items-center justify-end h-full group"
                    >
                      <span className="text-[10px] tabular-nums text-[var(--text-secondary)] mb-1 hidden sm:inline">
                        {m.net > 0 ? `${Math.round(m.net / 1000)}k` : '0'}
                      </span>
                      <div
                        className={`w-full rounded-t-md transition-all ${
                          isSelected
                            ? 'bg-[var(--accent)]'
                            : hitTarget
                              ? 'bg-emerald-500/80 group-hover:bg-emerald-400'
                              : m.net > 0
                                ? 'bg-blue-500/60 group-hover:bg-blue-400'
                                : 'bg-white/5'
                        }`}
                        style={{ height: `${m.net > 0 ? pct : 3}%` }}
                      />
                      <span className="mt-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
                        {m.month}月
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {activeMonth !== null && (
              <div className="rounded-xl border border-white/10 bg-[var(--bg-secondary)]/60 p-3.5 text-xs space-y-2">
                <div className="flex items-center justify-between font-semibold text-[var(--text-primary)]">
                  <span>{activeMonth} 月領息明細</span>
                  <span>實拿合計：{fmtNtd(evaluation.months[activeMonth - 1]?.net ?? 0)}</span>
                </div>
                {(evaluation.months[activeMonth - 1]?.items.length ?? 0) === 0 ? (
                  <p className="text-[var(--text-secondary)]">該月份目前配置無預估配息入帳。</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {evaluation.months[activeMonth - 1]!.items.map((it, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                        <span>
                          <b>{it.symbol}</b> {it.name}（{it.lots} 張）
                        </span>
                        <span className="tabular-nums font-semibold text-emerald-300">{fmtNtd(it.net)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 自由配置清單 */}
          <div className="rounded-2xl border border-white/5 bg-[var(--bg-card)] p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[var(--text-primary)]">自由調整配置與健保檢視</h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  直接加減張數或新增其他台股 ETF／個股，所有數字將自動記憶於此瀏覽器。
                </p>
              </div>
              <form onSubmit={handleAddSymbol} className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                  <input
                    value={addSymbol}
                    onChange={(e) => setAddSymbol(e.target.value)}
                    placeholder="加碼代號如 00929 / 2330"
                    className="pl-8 pr-3 py-1.5 w-48 rounded-lg border border-white/10 bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={adding}
                  className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {adding ? '查詢中…' : '+ 加入標的'}
                </button>
              </form>
            </div>
            {addError && <p className="text-xs text-rose-400">{addError}</p>}

            <div className="space-y-2.5">
              {evaluation.assets.map((a) => (
                <div
                  key={a.symbol}
                  className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3.5"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-[var(--text-primary)]">
                        {a.symbol} {a.name}
                      </span>
                      <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                        參考價 {a.price.toFixed(2)}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-white/5 text-[10px] text-[var(--text-secondary)]">
                        54C {Math.round(a.dividend54cRatio * 100)}%
                      </span>
                      {a.nhiTriggered ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] font-medium">
                          <ShieldAlert className="w-3 h-3" />
                          觸及健保門檻（年扣 {fmtNtd(a.annualNhiFee)}）
                        </span>
                      ) : a.safeMaxLots !== null ? (
                        <span className="text-[10px] text-emerald-400/90">
                          單次免扣安全上限約 {a.safeMaxLots} 張
                        </span>
                      ) : null}
                      {a.insufficientHistory ? (
                        <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 text-[10px]">
                          近 1 年無完整配息紀錄
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] tabular-nums">
                      需本金 {fmtNtd(a.capital)} · 預估年領稅後{' '}
                      <span className="text-emerald-400 font-semibold">{fmtNtd(a.annualNet)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-center">
                    <button
                      type="button"
                      onClick={() => updateLots(a.symbol, a.lots - 1)}
                      aria-label={`減少 ${a.symbol} 張數`}
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[var(--text-primary)]"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={9999}
                      value={a.lots}
                      onChange={(e) => updateLots(a.symbol, Number(e.target.value))}
                      aria-label={`${a.symbol} 張數`}
                      className="w-16 text-center rounded-lg border border-white/10 bg-[var(--bg-secondary)] py-1 text-sm font-mono font-bold text-[var(--text-primary)]"
                    />
                    <span className="text-xs text-[var(--text-secondary)]">張</span>
                    <button
                      type="button"
                      onClick={() => updateLots(a.symbol, a.lots + 1)}
                      aria-label={`增加 ${a.symbol} 張數`}
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[var(--text-primary)]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSymbol(a.symbol)}
                      aria-label={`移除 ${a.symbol}`}
                      className="ml-2 p-1.5 rounded-lg bg-white/5 text-rose-400 hover:bg-rose-500/15"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 免責聲明 */}
      <div className="mt-6 rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 text-xs text-[var(--text-secondary)] leading-relaxed space-y-1.5">
        <p className="flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent)]" />
          <span>
            僅為歷史統計與試算參考，非投資建議。配息金額與發放月係依最近 12 個月已公告／實發紀錄統計，未來實際配息、54C 股利所得佔比及二代健保扣費以投信／公司最新公告為準。
          </span>
        </p>
        <p>
          若需管理實際部位，請前往{' '}
          <Link href="/portfolio" className="underline hover:text-[var(--text-primary)]">
            我的投資組合與現金流月曆
          </Link>
          。
        </p>
      </div>
    </div>
  )
}
