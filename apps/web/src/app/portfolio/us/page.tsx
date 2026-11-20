'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeftRight,
  Calculator,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { WorkspaceBackLink } from '@/components/workspace-back-link'
import { TableSkeleton } from '@/components/table-skeleton'
import { HealthVerdictBadge, VERDICT_META } from '@/components/portfolio-health-panel'
import type { DimensionResult, HoldingHealthResult, PortfolioHealthReport } from '@/lib/portfolio-health'
import {
  computeUsFxBreakdown,
  computeUsPositionMetrics,
  DEFAULT_OVERSEAS_CONFIG,
  DEFAULT_SUBBROKERAGE_CONFIG,
  simulateUsAverageDown,
  simulateUsSell,
  summarizeUsPortfolio,
  type UsBrokerConfig,
  type UsPositionMetrics,
} from '@/lib/portfolio-us'
import { useI18n } from '@/i18n/LanguageProvider'
import { localizePath } from '@/i18n/paths'
import { parseJsonSafe } from '@/lib/safe-parse'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'

const US_SETTINGS_STORAGE_KEY = 'vestential:portfolio-us-config:v1'

interface UsHoldingRow {
  id: number
  market: 'tw' | 'us'
  symbol: string
  symbol_name: string | null
  shares: number
  cost: number
  current_price: number
}

interface StoredUsSettings {
  config: UsBrokerConfig
  manualFxRate: string
}

function loadStoredSettings(): StoredUsSettings {
  if (typeof window === 'undefined') {
    return { config: DEFAULT_OVERSEAS_CONFIG, manualFxRate: '' }
  }
  try {
    const raw = window.localStorage.getItem(US_SETTINGS_STORAGE_KEY)
    if (!raw) return { config: DEFAULT_OVERSEAS_CONFIG, manualFxRate: '' }
    const parsed = JSON.parse(raw)
    const cfg = parsed?.config
    return {
      config: {
        mode: cfg?.mode === 'subbrokerage' ? 'subbrokerage' : 'overseas',
        feeRate: Number.isFinite(Number(cfg?.feeRate)) ? Number(cfg.feeRate) : 0,
        minFeeUsd: Number.isFinite(Number(cfg?.minFeeUsd)) ? Number(cfg.minFeeUsd) : 0,
        dividendTaxRate: [0, 0.15, 0.3].includes(Number(cfg?.dividendTaxRate)) ? Number(cfg.dividendTaxRate) : 0.3,
      },
      manualFxRate: typeof parsed?.manualFxRate === 'string' ? parsed.manualFxRate : '',
    }
  } catch {
    return { config: DEFAULT_OVERSEAS_CONFIG, manualFxRate: '' }
  }
}

function fmtUsd(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtTwd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  return `${sign}NT$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
}

type SortKey = 'marketValueUsd' | 'netPnlUsd' | 'netPnlPct' | 'annualDivNet' | 'healthScore' | 'drawdown'
type SortDir = 'asc' | 'desc'

export default function UsPortfolioPage() {
  const { locale } = useI18n()
  const typo = useTableTypography()

  const [records, setRecords] = useState<UsHoldingRow[]>([])
  const [recordsReady, setRecordsReady] = useState(false)
  const [healthReport, setHealthReport] = useState<PortfolioHealthReport | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)

  // 即時匯率與手動覆蓋
  const [liveFxRate, setLiveFxRate] = useState<number | null>(null)
  const [fxFailed, setFxFailed] = useState(false)
  const [fxAsOf, setFxAsOf] = useState<string | null>(null)
  const [manualFxRate, setManualFxRate] = useState('')
  const [brokerConfig, setBrokerConfig] = useState<UsBrokerConfig>(DEFAULT_OVERSEAS_CONFIG)
  const [settingsHydrated, setSettingsHydrated] = useState(false)

  // 試算器 state
  const [simSymbol, setSimSymbol] = useState('')
  const [simMode, setSimMode] = useState<'buy' | 'sell'>('buy')
  const [simShares, setSimShares] = useState('10')
  const [simPrice, setSimPrice] = useState('')
  const [simBuyFx, setSimBuyFx] = useState('')
  const [simHealth, setSimHealth] = useState<HoldingHealthResult | null>(null)
  const [simLookupLoading, setSimLookupLoading] = useState(false)
  const [simError, setSimError] = useState<string | null>(null)
  const [addingToPortfolio, setAddingToPortfolio] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // 表格排序與展開
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    const s = loadStoredSettings()
    setBrokerConfig(s.config)
    setManualFxRate(s.manualFxRate)
    setSettingsHydrated(true)
  }, [])

  useEffect(() => {
    if (!settingsHydrated) return
    try {
      window.localStorage.setItem(
        US_SETTINGS_STORAGE_KEY,
        JSON.stringify({ config: brokerConfig, manualFxRate }),
      )
    } catch {}
  }, [brokerConfig, manualFxRate, settingsHydrated])

  const effectiveFxRate = useMemo(() => {
    const m = Number(manualFxRate)
    if (manualFxRate.trim() !== '' && Number.isFinite(m) && m > 0) return m
    return liveFxRate
  }, [manualFxRate, liveFxRate])

  const fetchFx = useCallback(async () => {
    try {
      const res = await fetch('/api/portfolio/fx', { cache: 'no-store' })
      const data = await parseJsonSafe<{ success?: boolean; rate: number | null; asOf?: string }>(res, {
        connectionInterrupted: '連線中斷',
        serverBusy: '伺服器忙碌',
      })
      if (data?.rate != null && Number.isFinite(data.rate)) {
        setLiveFxRate(data.rate)
        setFxFailed(false)
        setFxAsOf(data.asOf ?? null)
      } else {
        setLiveFxRate(null)
        setFxFailed(true)
      }
    } catch {
      setLiveFxRate(null)
      setFxFailed(true)
    }
  }, [])

  const fetchUsHoldingsAndHealth = useCallback(async () => {
    setHealthLoading(true)
    try {
      const [recRes, healthRes] = await Promise.all([
        fetch('/api/portfolio/records?limit=100', { cache: 'no-store' }),
        fetch('/api/portfolio/health', { cache: 'no-store' }),
      ])
      const recJson = await parseJsonSafe<{ records?: UsHoldingRow[] }>(recRes, {
        connectionInterrupted: '連線中斷',
        serverBusy: '伺服器忙碌',
      })
      const healthJson = await parseJsonSafe<PortfolioHealthReport & { success?: boolean }>(healthRes, {
        connectionInterrupted: '連線中斷',
        serverBusy: '伺服器忙碌',
      })

      const rawList = recJson?.records ?? []
      // 依代號去重取最新一筆美股持倉
      const dedup = new Map<string, UsHoldingRow>()
      for (const r of rawList) {
        if (r.market !== 'us') continue
        const sym = r.symbol.trim().toUpperCase()
        if (!dedup.has(sym)) dedup.set(sym, { ...r, symbol: sym })
      }
      setRecords([...dedup.values()])
      setRecordsReady(true)

      if (healthJson?.holdings) {
        setHealthReport(healthJson)
      }
    } catch {
      setRecordsReady(true)
    } finally {
      setHealthLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchFx()
    void fetchUsHoldingsAndHealth()
  }, [fetchFx, fetchUsHoldingsAndHealth])

  const healthBySymbol = useMemo(() => {
    const map = new Map<string, HoldingHealthResult>()
    for (const h of healthReport?.holdings ?? []) {
      if (h.market === 'us') {
        map.set(h.symbol.trim().toUpperCase(), h)
      }
    }
    return map
  }, [healthReport])

  const enrichedRows = useMemo(() => {
    return records.map((r) => {
      const health = healthBySymbol.get(r.symbol) ?? null
      const metrics: UsPositionMetrics = computeUsPositionMetrics({
        shares: r.shares,
        cost: r.cost,
        currentPrice: r.current_price,
        dividendRate: health?.highlights.dividendRate ?? null,
        dividendYieldPct: health?.highlights.dividendYieldPct ?? null,
        config: brokerConfig,
        fxRate: effectiveFxRate,
      })
      return { row: r, health, metrics }
    })
  }, [records, healthBySymbol, brokerConfig, effectiveFxRate])

  const summary = useMemo(
    () => summarizeUsPortfolio(enrichedRows.map((x) => x.metrics), effectiveFxRate),
    [enrichedRows, effectiveFxRate],
  )

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

  const sortedRows = useMemo(() => {
    if (!sortKey) return enrichedRows
    const getVal = (x: (typeof enrichedRows)[number]): number | null => {
      switch (sortKey) {
        case 'marketValueUsd': return x.metrics.marketValueUsd
        case 'netPnlUsd': return x.metrics.netPnlUsd
        case 'netPnlPct': return x.metrics.netPnlPct
        case 'annualDivNet': return x.metrics.annualDividendNetUsd
        case 'healthScore': return x.health?.healthScore ?? null
        case 'drawdown': return x.health?.drawdownFrom52wHighPct ?? null
      }
    }
    return [...enrichedRows].sort((a, b) => {
      const va = getVal(a)
      const vb = getVal(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [enrichedRows, sortKey, sortDir])

  const lookupSymbolForSim = useCallback(async (rawSym: string, existing?: UsHoldingRow) => {
    const clean = rawSym.trim().toUpperCase()
    if (!clean) return
    setSimSymbol(clean)
    setSimError(null)
    setSimLookupLoading(true)
    if (existing) {
      setSimPrice(String(existing.current_price))
    }
    try {
      const res = await fetch(`/api/portfolio/health?symbol=${encodeURIComponent(clean)}&market=us`, {
        cache: 'no-store',
      })
      const data = await parseJsonSafe<{ success?: boolean; holding?: HoldingHealthResult; error?: string }>(res, {
        connectionInterrupted: '連線中斷',
        serverBusy: '伺服器忙碌',
      })
      if (!res.ok || !data?.holding) {
        setSimError(data?.error || `查無 ${clean} 的報價與基本面資料`)
        setSimHealth(null)
        return
      }
      setSimHealth(data.holding)
      if (!existing && data.holding.currentPrice > 0) {
        setSimPrice(String(data.holding.currentPrice))
      }
    } catch {
      setSimError('查詢失敗，請確認代號是否正確或稍後再試')
    } finally {
      setSimLookupLoading(false)
    }
  }, [])

  const simExistingHolding = useMemo(() => {
    const clean = simSymbol.trim().toUpperCase()
    if (!clean) return null
    return records.find((r) => r.symbol === clean) ?? null
  }, [records, simSymbol])

  const activeSimHealth = simHealth?.symbol.toUpperCase() === simSymbol.trim().toUpperCase()
    ? simHealth
    : simExistingHolding
      ? (healthBySymbol.get(simExistingHolding.symbol) ?? null)
      : null

  const simBuyResult = useMemo(() => {
    const addShares = Number(simShares) || 0
    const addPrice = Number(simPrice) || 0
    if (addShares <= 0 || addPrice <= 0) return null
    return simulateUsAverageDown({
      existingShares: simExistingHolding?.shares ?? 0,
      existingAvgCost: simExistingHolding?.cost ?? 0,
      addShares,
      addPrice,
      config: brokerConfig,
      fxRate: effectiveFxRate,
    })
  }, [simShares, simPrice, simExistingHolding, brokerConfig, effectiveFxRate])

  const simSellResult = useMemo(() => {
    if (!simExistingHolding) return null
    const sellShares = Number(simShares) || 0
    const sellPrice = Number(simPrice) || 0
    return simulateUsSell({
      existingShares: simExistingHolding.shares,
      avgCost: simExistingHolding.cost,
      sellShares,
      sellPrice,
      config: brokerConfig,
      fxRate: effectiveFxRate,
    })
  }, [simExistingHolding, simShares, simPrice, brokerConfig, effectiveFxRate])

  const simFxBreakdown = useMemo(() => {
    const buyFx = Number(simBuyFx)
    if (!effectiveFxRate || !Number.isFinite(buyFx) || buyFx <= 0) return null
    if (simExistingHolding) {
      return computeUsFxBreakdown({
        costBasisUsd: simExistingHolding.shares * simExistingHolding.cost,
        marketValueUsd: simExistingHolding.shares * (Number(simPrice) || simExistingHolding.current_price),
        buyFxRate: buyFx,
        currentFxRate: effectiveFxRate,
      })
    }
    return null
  }, [simBuyFx, effectiveFxRate, simExistingHolding, simPrice])

  const handleAddSimulatedToPortfolio = async () => {
    const clean = simSymbol.trim().toUpperCase()
    const shares = Number(simShares)
    const price = Number(simPrice)
    if (!clean || !(shares > 0) || !(price > 0)) return
    setAddingToPortfolio(true)
    setNotice(null)
    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: 'us',
          symbol: clean,
          symbolName: activeSimHealth?.symbolName ?? undefined,
          shares,
          cost: price,
          currentPrice: activeSimHealth?.currentPrice && activeSimHealth.currentPrice > 0 ? activeSimHealth.currentPrice : price,
        }),
      })
      if (!res.ok) {
        setSimError('加入持倉失敗，請稍後再試')
        return
      }
      setNotice(`已將 ${clean} (${shares} 股 @ ${fmtUsd(price)}) 加入美股持倉總覽`)
      await fetchUsHoldingsAndHealth()
    } catch {
      setSimError('網路異常，加入持倉失敗')
    } finally {
      setAddingToPortfolio(false)
    }
  }

  const renderSortTh = (key: SortKey, label: string) => {
    const active = sortKey === key
    const ariaSort: 'ascending' | 'descending' | 'none' = active
      ? sortDir === 'asc'
        ? 'ascending'
        : 'descending'
      : 'none'
    return (
      <th aria-sort={ariaSort} className="py-2.5 px-3 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={() => handleSort(key)}
          className={`inline-flex items-center gap-1 hover:text-white transition ${active ? 'text-[var(--accent)]' : ''}`}
        >
          <span>{label}</span>
          <span className="text-[10px] leading-none" aria-hidden="true">
            {active ? (sortDir === 'asc' ? '▲' : '▼') : '▲▼'}
          </span>
        </button>
      </th>
    )
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto px-4 lg:px-8 py-8 space-y-6">
      <WorkspaceBackLink />

      {/* 頁首與雙向切換 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2.5 text-white">
            <DollarSign className="w-7 h-7 text-sky-400" />
            <span>美股個人損益試算與基本面健檢</span>
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            共用您的美股持倉紀錄，即時換算 USD/TWD、複委託／海外券商淨損益、股息預扣稅與加碼攤平試算，並連動基本面體檢防呆。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={localizePath(locale, '/portfolio')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--bg-secondary)] border border-white/10 text-xs font-medium text-[var(--text-primary)] hover:border-white/25 transition"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span>🇹🇼 台美股總覽 / 交易結算</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              void fetchFx()
              void fetchUsHoldingsAndHealth()
            }}
            disabled={healthLoading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 text-xs font-medium hover:bg-white/15 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${healthLoading ? 'animate-spin' : ''}`} />
            <span>更新報價與健檢</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="px-4 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-300">
          {notice}
        </div>
      )}

      {/* 參數設定條：匯率 / 券商費率 / 股息預扣稅 */}
      <section className="bg-[var(--bg-card)] border border-white/10 rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 1. USD/TWD 匯率 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-secondary)]">USD / TWD 匯率</span>
              {liveFxRate != null ? (
                <span className="text-emerald-300 tabular-nums">
                  即時 {liveFxRate.toFixed(2)}
                  {fxAsOf ? ` (${fxAsOf.slice(11, 16)} UTC)` : ''}
                </span>
              ) : fxFailed ? (
                <span className="text-amber-300">暫無法取得即時匯率，可手動輸入</span>
              ) : (
                <span className="text-[var(--text-secondary)]">讀取中…</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                placeholder={liveFxRate ? `自動 (${liveFxRate.toFixed(2)})` : '輸入假設匯率，如 32.5'}
                value={manualFxRate}
                onChange={(e) => setManualFxRate(e.target.value)}
                className="w-full bg-[var(--bg-secondary)] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white tabular-nums focus:outline-none focus:border-[var(--accent)]"
              />
              {manualFxRate && (
                <button
                  type="button"
                  onClick={() => setManualFxRate('')}
                  className="px-2.5 py-1.5 rounded-lg bg-white/10 text-[11px] text-[var(--text-secondary)] hover:text-white shrink-0"
                >
                  重設
                </button>
              )}
            </div>
          </div>

          {/* 2. 券商手續費模式 */}
          <div className="space-y-1.5">
            <div className="text-xs text-[var(--text-secondary)]">券商手續費模式</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setBrokerConfig((prev) => ({
                    ...DEFAULT_OVERSEAS_CONFIG,
                    dividendTaxRate: prev.dividendTaxRate,
                  }))
                }
                className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs border transition ${
                  brokerConfig.mode === 'overseas'
                    ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-white/10'
                }`}
              >
                海外券商 (0%)
              </button>
              <button
                type="button"
                onClick={() =>
                  setBrokerConfig((prev) => ({
                    ...DEFAULT_SUBBROKERAGE_CONFIG,
                    dividendTaxRate: prev.dividendTaxRate,
                  }))
                }
                className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs border transition ${
                  brokerConfig.mode === 'subbrokerage'
                    ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-white/10'
                }`}
              >
                台灣複委託
              </button>
            </div>
            {brokerConfig.mode === 'subbrokerage' && (
              <div className="flex items-center gap-2 pt-1 text-[11px] text-[var(--text-secondary)]">
                <label className="flex items-center gap-1">
                  <span>費率%</span>
                  <input
                    type="number"
                    step="0.01"
                    value={Number((brokerConfig.feeRate * 100).toFixed(3))}
                    onChange={(e) => {
                      const pct = Math.max(0, Number(e.target.value) || 0)
                      setBrokerConfig((p) => ({ ...p, feeRate: pct / 100 }))
                    }}
                    className="w-16 bg-[var(--bg-secondary)] border border-white/10 rounded px-2 py-0.5 text-white tabular-nums"
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span>低消 US$</span>
                  <input
                    type="number"
                    step="1"
                    value={brokerConfig.minFeeUsd}
                    onChange={(e) => {
                      const min = Math.max(0, Number(e.target.value) || 0)
                      setBrokerConfig((p) => ({ ...p, minFeeUsd: min }))
                    }}
                    className="w-16 bg-[var(--bg-secondary)] border border-white/10 rounded px-2 py-0.5 text-white tabular-nums"
                  />
                </label>
              </div>
            )}
          </div>

          {/* 3. 股息預扣稅率 */}
          <div className="space-y-1.5">
            <div className="text-xs text-[var(--text-secondary)]">美股股息預扣稅率</div>
            <div className="flex items-center gap-1.5">
              {(
                [
                  { rate: 0.3, label: '30% 美股/美ETF' },
                  { rate: 0.15, label: '15% 愛爾蘭ETF' },
                  { rate: 0, label: '0% 免稅/債券' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.rate}
                  type="button"
                  onClick={() => setBrokerConfig((p) => ({ ...p, dividendTaxRate: opt.rate }))}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] border transition ${
                    brokerConfig.dividendTaxRate === opt.rate
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-white/10'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 頂部 4 張美股 KPI 卡 */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[var(--bg-card)] border border-white/10 rounded-2xl p-4 space-y-1">
          <div className="text-xs text-[var(--text-secondary)]">美股總市值 ({summary.holdingCount} 檔)</div>
          <div className="text-xl font-bold text-white tabular-nums">{fmtUsd(summary.totalMarketValueUsd)}</div>
          <div className="text-xs text-[var(--text-secondary)] tabular-nums">
            折合 {fmtTwd(summary.totalMarketValueTwd)}
          </div>
        </div>

        <div className="bg-[var(--bg-card)] border border-white/10 rounded-2xl p-4 space-y-1">
          <div className="text-xs text-[var(--text-secondary)]">美股總成本（原幣）</div>
          <div className="text-xl font-bold text-white tabular-nums">{fmtUsd(summary.totalCostUsd)}</div>
          <div className="text-xs text-[var(--text-secondary)] tabular-nums">
            預估買賣手續費 {fmtUsd(summary.totalEstimatedFeesUsd)}
          </div>
        </div>

        <div className="bg-[var(--bg-card)] border border-white/10 rounded-2xl p-4 space-y-1">
          <div className="text-xs text-[var(--text-secondary)]">未實現淨損益（含費）</div>
          <div
            className={`text-xl font-bold tabular-nums ${
              summary.totalNetPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {fmtUsd(summary.totalNetPnlUsd)} ({summary.totalNetPnlPct >= 0 ? '+' : ''}
            {summary.totalNetPnlPct.toFixed(2)}%)
          </div>
          <div className="text-xs text-[var(--text-secondary)] tabular-nums">
            折合 {fmtTwd(summary.totalNetPnlTwd)}
          </div>
        </div>

        <div className="bg-[var(--bg-card)] border border-white/10 rounded-2xl p-4 space-y-1">
          <div className="text-xs text-[var(--text-secondary)]">
            預估年領股息（扣 {(brokerConfig.dividendTaxRate * 100).toFixed(0)}% 稅）
          </div>
          <div className="text-xl font-bold text-sky-300 tabular-nums">{fmtUsd(summary.totalAnnualDividendNetUsd)}</div>
          <div className="text-xs text-[var(--text-secondary)] tabular-nums">
            折合 {fmtTwd(summary.totalAnnualDividendNetTwd)} / 年
          </div>
        </div>
      </section>

      {/* 中段：互動式損益與加碼攤平試算器 + 基本面警戒防呆 */}
      <section className="bg-[var(--bg-card)] border border-white/10 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-[var(--accent)]" />
            <h2 className="text-base font-semibold text-white">互動式攤平／賣出試算器（連動基本面健檢）</h2>
          </div>
          <div className="flex rounded-lg overflow-hidden border border-white/10">
            <button
              type="button"
              onClick={() => setSimMode('buy')}
              className={`px-3 py-1 text-xs transition ${
                simMode === 'buy'
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
              }`}
            >
              加碼攤平 / 新買試算
            </button>
            <button
              type="button"
              onClick={() => setSimMode('sell')}
              className={`px-3 py-1 text-xs transition ${
                simMode === 'sell'
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
              }`}
            >
              賣出損益試算
            </button>
          </div>
        </div>

        {/* 查詢列 */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">美股代號（未持有也可測）</label>
            <input
              type="text"
              placeholder="如 AAPL, NVDA, VOO"
              value={simSymbol}
              onChange={(e) => setSimSymbol(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void lookupSymbolForSim(simSymbol, simExistingHolding ?? undefined)
              }}
              className="w-full bg-[var(--bg-secondary)] border border-white/10 rounded-lg px-3 py-2 text-sm text-white uppercase focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <button
            type="button"
            onClick={() => void lookupSymbolForSim(simSymbol, simExistingHolding ?? undefined)}
            disabled={simLookupLoading || !simSymbol.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            <Search className="w-3.5 h-3.5" />
            <span>{simLookupLoading ? '查詢中…' : '查詢現價與基本面健檢'}</span>
          </button>

          <div className="w-32">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">
              {simMode === 'buy' ? '預計買入股數' : '預計賣出股數'}
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={simShares}
              onChange={(e) => setSimShares(e.target.value)}
              className="w-full bg-[var(--bg-secondary)] border border-white/10 rounded-lg px-3 py-2 text-sm text-white tabular-nums focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div className="w-36">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">
              {simMode === 'buy' ? '假設買入單價 (US$)' : '假設賣出單價 (US$)'}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="自動帶入現價"
              value={simPrice}
              onChange={(e) => setSimPrice(e.target.value)}
              className="w-full bg-[var(--bg-secondary)] border border-white/10 rounded-lg px-3 py-2 text-sm text-white tabular-nums focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div className="w-40">
            <label className="block text-xs text-[var(--text-secondary)] mb-1">買入平均匯率（選填拆匯差）</label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="例如 31.2"
              value={simBuyFx}
              onChange={(e) => setSimBuyFx(e.target.value)}
              className="w-full bg-[var(--bg-secondary)] border border-white/10 rounded-lg px-3 py-2 text-sm text-white tabular-nums focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>

        {simError && <p className="text-xs text-rose-400">{simError}</p>}

        {/* 基本面健檢結果卡片 + 警戒防呆提示 */}
        {activeSimHealth && (
          <div className="space-y-3 pt-1">
            {(activeSimHealth.verdict === 'warning' || activeSimHealth.verdict === 'watch') && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/35 text-xs text-rose-200">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-semibold">
                    基本面警示：{activeSimHealth.symbol} 目前為「{VERDICT_META[activeSimHealth.verdict].label}」
                  </div>
                  <p className="text-rose-200/85">
                    客觀財務摘要：{activeSimHealth.summary}。若公司獲利或現金流正處於轉弱階段，低價攤平可能面臨基本面持續惡化風險，請先檢視下方四維度財報明細。
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 左卡：該標的健檢摘要 */}
              <div className="bg-[var(--bg-secondary)]/70 border border-white/10 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">{activeSimHealth.symbol}</span>
                    {activeSimHealth.symbolName && (
                      <span className="text-xs text-[var(--text-secondary)]">{activeSimHealth.symbolName}</span>
                    )}
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-xs font-medium ${VERDICT_META[activeSimHealth.verdict].badgeClass}`}
                  >
                    <span>{VERDICT_META[activeSimHealth.verdict].icon}</span>
                    <span>{VERDICT_META[activeSimHealth.verdict].label}</span>
                  </span>
                </div>

                <div className="text-xs text-[var(--text-secondary)]">{activeSimHealth.summary}</div>

                <div className="grid grid-cols-4 gap-2 pt-1 text-xs">
                  <div>
                    <div className="text-[10px] text-[var(--text-secondary)]">體質分數</div>
                    <div className="font-semibold text-white tabular-nums">
                      {activeSimHealth.healthScore ?? '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-secondary)]">PE</div>
                    <div className="font-semibold text-white tabular-nums">
                      {activeSimHealth.highlights.pe != null ? `${activeSimHealth.highlights.pe.toFixed(1)}x` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-secondary)]">ROE</div>
                    <div className="font-semibold text-white tabular-nums">
                      {activeSimHealth.highlights.roePct != null ? `${activeSimHealth.highlights.roePct.toFixed(1)}%` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-secondary)]">距52週高點</div>
                    <div className="font-semibold text-emerald-300 tabular-nums">
                      {activeSimHealth.drawdownFrom52wHighPct != null
                        ? `${activeSimHealth.drawdownFrom52wHighPct.toFixed(1)}%`
                        : '—'}
                    </div>
                  </div>
                </div>

                {!simExistingHolding && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => void handleAddSimulatedToPortfolio()}
                      disabled={addingToPortfolio || !(Number(simShares) > 0) || !(Number(simPrice) > 0)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-xs text-emerald-300 hover:bg-emerald-500/30 transition disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{addingToPortfolio ? '加入中…' : '一鍵加入我的美股持倉'}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* 右卡：試算數字結果 */}
              <div className="bg-[var(--bg-secondary)]/70 border border-white/10 rounded-xl p-4 space-y-2.5">
                {simMode === 'buy' && simBuyResult ? (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">
                        {simExistingHolding
                          ? `目前持有 ${simExistingHolding.shares} 股 @ 均價 ${fmtUsd(simExistingHolding.cost)}`
                          : '目前尚未持有（以新建倉計算）'}
                      </span>
                      <span className="text-[var(--text-secondary)]">
                        含手續費 {fmtUsd(simBuyResult.addFeeUsd)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs pt-1">
                      <div>
                        <div className="text-[10px] text-[var(--text-secondary)]">本次投入總額</div>
                        <div className="text-sm font-bold text-white tabular-nums">
                          {fmtUsd(simBuyResult.addTotalOutlayUsd)}
                        </div>
                        <div className="text-[10px] text-[var(--text-secondary)] tabular-nums">
                          {fmtTwd(simBuyResult.addTotalOutlayTwd)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-[var(--text-secondary)]">試算後新均價</div>
                        <div className="text-sm font-bold text-sky-300 tabular-nums">
                          {fmtUsd(simBuyResult.newAvgCostUsd)}
                        </div>
                        {simExistingHolding && (
                          <div className="text-[10px] text-emerald-300 tabular-nums">
                            均價 {simBuyResult.avgCostChangePct.toFixed(1)}%（共 {simBuyResult.newTotalShares} 股）
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] text-[var(--text-secondary)]">距離回本需漲</div>
                        <div className="text-sm font-bold text-amber-300 tabular-nums">
                          +{simBuyResult.breakevenRallyPct.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  </>
                ) : simMode === 'sell' && simSellResult ? (
                  !simExistingHolding ? (
                    <p className="text-xs text-[var(--text-secondary)]">請先在下方持倉列表選擇一檔已持有美股進行賣出試算。</p>
                  ) : !simSellResult.valid ? (
                    <p className="text-xs text-rose-300">
                      賣出股數須大於 0 且不可超過目前持有股數（{simExistingHolding.shares} 股）。
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                      <div>
                        <div className="text-[10px] text-[var(--text-secondary)]">扣費後實拿</div>
                        <div className="text-sm font-bold text-white tabular-nums">
                          {fmtUsd(simSellResult.netProceedsUsd)}
                        </div>
                        <div className="text-[10px] text-[var(--text-secondary)] tabular-nums">
                          {fmtTwd(simSellResult.netProceedsTwd)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-[var(--text-secondary)]">預估已實現損益</div>
                        <div
                          className={`text-sm font-bold tabular-nums ${
                            simSellResult.realizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {fmtUsd(simSellResult.realizedPnlUsd)} ({simSellResult.realizedPnlPct.toFixed(1)}%)
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-[var(--text-secondary)]">賣出手續費 / 剩餘股數</div>
                        <div className="text-sm font-semibold text-white tabular-nums">
                          {fmtUsd(simSellResult.sellFeeUsd)} / {simSellResult.remainingShares} 股
                        </div>
                      </div>
                    </div>
                  )
                ) : (
                  <p className="text-xs text-[var(--text-secondary)]">輸入代號、股數與單價後即顯示含手續費試算結果。</p>
                )}

                {simFxBreakdown && (
                  <div className="pt-2 border-t border-white/10 text-[11px] flex flex-wrap gap-x-4 gap-y-1 text-[var(--text-secondary)]">
                    <span>
                      含匯差總損益：<strong className="text-white tabular-nums">{fmtTwd(simFxBreakdown.totalPnlTwd)}</strong>
                    </span>
                    <span>
                      股價價差貢獻：<strong className="text-white tabular-nums">{fmtTwd(simFxBreakdown.pricePnlTwd)}</strong>
                    </span>
                    <span>
                      匯率變動貢獻：<strong className="text-white tabular-nums">{fmtTwd(simFxBreakdown.fxPnlTwd)}</strong>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 下段：美股持倉與基本面健檢總表 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[var(--accent)]" />
            <span>我的美股持倉明細與基本面體檢</span>
          </h2>
          <span className="text-xs text-[var(--text-secondary)]">點擊任一列可展開四大財報維度明細</span>
        </div>

        {!recordsReady ? (
          <TableSkeleton message="載入美股持倉與基本面健檢中…" rows={5} />
        ) : sortedRows.length === 0 ? (
          <div className="bg-[var(--bg-card)] border border-white/10 rounded-2xl p-8 text-center space-y-2">
            <p className="text-sm text-white font-medium">目前尚無美股持倉紀錄</p>
            <p className="text-xs text-[var(--text-secondary)]">
              可直接使用上方試算器輸入任意美股代號（如 AAPL、NVDA、VOO）進行健檢並一鍵加入持倉，或前往台美股總覽匯入。
            </p>
          </div>
        ) : (
          <div className="bg-[var(--bg-card)] border border-white/10 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className={tableClass(typo, 'w-full min-w-[960px] border-collapse')}>
                <thead>
                  <tr className={headTrClass(typo, 'border-b border-white/10 text-[var(--text-secondary)] bg-white/[0.02]')}>
                    <th className="py-2.5 px-3 text-left whitespace-nowrap">美股標的</th>
                    <th className="py-2.5 px-3 text-left whitespace-nowrap">基本面體檢</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">股數 / 均價</th>
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">現價</th>
                    {renderSortTh('marketValueUsd', '市值 (US$)')}
                    {renderSortTh('netPnlUsd', '含費淨損益')}
                    {renderSortTh('netPnlPct', '淨報酬%')}
                    {renderSortTh('annualDivNet', '稅後年股息')}
                    {renderSortTh('drawdown', '距52週高點')}
                    {renderSortTh('healthScore', '體質分')}
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {sortedRows.map(({ row, health, metrics }) => {
                    const isOpen = expandedSymbol === row.symbol
                    return (
                      <Fragment key={row.symbol}>
                        <tr
                          onClick={() => setExpandedSymbol(isOpen ? null : row.symbol)}
                          className="hover:bg-white/[0.03] cursor-pointer transition"
                        >
                          <td className="py-3 px-3">
                            <div className="font-semibold text-white">{row.symbol}</div>
                            <div className="text-[11px] text-[var(--text-secondary)] truncate max-w-[150px]">
                              {row.symbol_name || health?.sector || '美股'}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            {health ? (
                              <HealthVerdictBadge
                                item={health}
                                onClick={() => setExpandedSymbol(isOpen ? null : row.symbol)}
                              />
                            ) : (
                              <span className="text-xs text-[var(--text-secondary)]">載入中…</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-[var(--text-secondary)]">
                            <div className="text-white">{row.shares} 股</div>
                            <div className="text-[11px]">{fmtUsd(row.cost)}</div>
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-white">
                            {fmtUsd(row.current_price)}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums">
                            <div className="font-medium text-white">{fmtUsd(metrics.marketValueUsd)}</div>
                            <div className="text-[11px] text-[var(--text-secondary)]">{fmtTwd(metrics.marketValueTwd)}</div>
                          </td>
                          <td
                            className={`py-3 px-3 text-right tabular-nums font-medium ${
                              metrics.netPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            <div>{fmtUsd(metrics.netPnlUsd)}</div>
                            <div className="text-[11px] opacity-80">{fmtTwd(metrics.netPnlTwd)}</div>
                          </td>
                          <td
                            className={`py-3 px-3 text-right tabular-nums font-semibold ${
                              metrics.netPnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {metrics.netPnlPct >= 0 ? '+' : ''}
                            {metrics.netPnlPct.toFixed(2)}%
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-sky-300">
                            {metrics.annualDividendNetUsd != null ? (
                              <>
                                <div>{fmtUsd(metrics.annualDividendNetUsd)}</div>
                                <div className="text-[11px] text-[var(--text-secondary)]">
                                  {fmtTwd(metrics.annualDividendNetTwd)}
                                </div>
                              </>
                            ) : (
                              <span className="text-[var(--text-secondary)]">—</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums">
                            {health?.drawdownFrom52wHighPct != null ? (
                              <span
                                className={
                                  health.drawdownFrom52wHighPct <= -15 ? 'text-emerald-300' : 'text-[var(--text-secondary)]'
                                }
                              >
                                {health.drawdownFrom52wHighPct.toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-[var(--text-secondary)]">—</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums font-semibold text-white">
                            {health?.healthScore ?? '—'}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSimMode('buy')
                                  void lookupSymbolForSim(row.symbol, row)
                                  if (typeof window !== 'undefined') window.scrollTo({ top: 220, behavior: 'smooth' })
                                }}
                                className="px-2 py-1 rounded bg-white/10 text-[11px] text-white hover:bg-white/20 transition"
                              >
                                試算
                              </button>
                              <span className="text-[var(--accent)]">
                                {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </span>
                            </div>
                          </td>
                        </tr>

                        {isOpen && health && (
                          <tr className="bg-white/[0.02]">
                            <td colSpan={11} className="p-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                                {(
                                  [
                                    health.dimensions.profitability,
                                    health.dimensions.financialSafety,
                                    health.dimensions.valuation,
                                    health.dimensions.shareholderReturn,
                                  ] as DimensionResult[]
                                ).map((dim) => (
                                  <div
                                    key={dim.key}
                                    className="bg-[var(--bg-secondary)]/70 border border-white/10 rounded-xl p-3 space-y-2"
                                  >
                                    <div className="text-xs font-semibold text-white">{dim.label}</div>
                                    <div className="space-y-1.5">
                                      {dim.metrics.map((m) => (
                                        <div key={m.key} className="text-[11px] flex items-center justify-between gap-2">
                                          <span className="text-[var(--text-secondary)]">{m.label}</span>
                                          <span className="font-semibold text-white tabular-nums">{m.formatted}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
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
      </section>

      {/* 免責四件套（符合 docs/ui-table-checklist.md §6） */}
      <footer className="bg-[var(--bg-card)]/60 border border-white/5 rounded-xl px-4 py-3 text-[11px] text-[var(--text-secondary)] space-y-1">
        <p>
          <strong className="text-white/80">統計方法：</strong>
          基本面財報與每股配息取自 Yahoo Finance（quoteSummary v10），USD/TWD 匯率取自 Yahoo `TWD=X`（30 分鐘快取）；含費淨損益依所選券商費率計算買入與預估賣出手續費，稅後股息依所選預扣稅率試算。
        </p>
        <p>
          <strong className="text-white/80">覆蓋範圍：</strong>
          涵蓋使用者美股個股與美股 ETF 持倉及試算器查詢標的；未提供即時匯率或財報欄位缺漏時以「—」顯示，不進行假值補齊。
        </p>
        <p>
          本頁所有損益試算、匯差拆解與基本面燈號均為統計試算工具，<strong>非投資建議</strong>亦非券商正式對帳單；投資前請參閱{' '}
          <Link href="/terms" className="text-[var(--accent)] underline hover:opacity-80">
            服務條款
          </Link>
          。
        </p>
      </footer>
    </div>
  )
}
