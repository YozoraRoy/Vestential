'use client'

import { useEffect, useState, useTransition, useMemo } from 'react'
import Link from 'next/link'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import {
  TrendingUp,
  Target,
  Sparkles,
  AlertTriangle,
  RefreshCw,
  SlidersHorizontal,
  ChevronRight,
  ShieldCheck,
  Calendar,
  Layers,
  ArrowRight,
  Zap,
} from 'lucide-react'
import { WorkspaceBackLink } from '@/components/workspace-back-link'
import { useI18n } from '@/i18n/LanguageProvider'
import { searchStocks, StockCandidateList, type StockCandidate } from '@/components/stock-search'
import { CORE_ETF_UNIVERSE, resolveStockName, getUniverseTier } from '@stock/cycle-entry'


const POPULAR_ETFS = [
  { symbol: '0050', name: '元大台灣50' },
  { symbol: '006208', name: '富邦台50' },
  { symbol: '0056', name: '元大高股息' },
  { symbol: '00878', name: '國泰永續高股息' },
  { symbol: '00919', name: '群益台灣精選高息' },
  { symbol: '00757', name: '統一FANG+' },
]

export default function DcaLabPage() {
  const { dict } = useI18n()
  const ui = dict.dcaLab

  const [symbol, setSymbol] = useState('0050')
  const [symbolInput, setSymbolInput] = useState('0050')
  const [candidates, setCandidates] = useState<StockCandidate[]>([])
  const [searching, setSearching] = useState(false)

  // 試算參數
  const [monthlyAmount, setMonthlyAmount] = useState(10000)
  const [investDay, setInvestDay] = useState(6)
  const [thresholdPct, setThresholdPct] = useState(-5)
  const [multiplier, setMultiplier] = useState(1.5)
  const [years, setYears] = useState(5)

  // 回測結果狀態
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<any>(null)

  const fetchData = async (targetSymbol: string) => {
    setLoading(true)
    setError(null)
    try {
      const query = new URLSearchParams({
        symbol: targetSymbol,
        monthlyAmount: String(monthlyAmount),
        investDay: String(investDay),
        threshold: String(thresholdPct),
        multiplier: String(multiplier),
        years: String(years),
      })

      const res = await fetch(`/api/backtest/dca?${query.toString()}`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || '試算失敗')
      }
      setData(json)
    } catch (err: any) {
      setError(err?.message || '載入失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData(symbol)
  }, [symbol, monthlyAmount, investDay, thresholdPct, multiplier, years])

  const handleSelectSymbol = (s: string) => {
    setSymbol(s)
    setSymbolInput(s)
    setCandidates([])
  }

  const handleSearchInput = async (val: string) => {
    setSymbolInput(val)
    if (!val.trim()) {
      setCandidates([])
      return
    }
    setSearching(true)
    try {
      const res = await searchStocks(val.trim(), 'tw')
      setCandidates(res)
    } catch {
      setCandidates([])
    } finally {
      setSearching(false)
    }
  }

  const stockName = useMemo(() => {
    return resolveStockName(symbol) || POPULAR_ETFS.find(p => p.symbol === symbol)?.name || ''
  }, [symbol])

  // 圖表格式化資料
  const chartData = useMemo(() => {
    if (!data?.dca?.chartData) return []
    // 依序取樣，保留約 150 點以維持圖表流暢度
    const raw = data.dca.chartData
    const step = Math.max(1, Math.floor(raw.length / 150))
    return raw.filter((_: any, idx: number) => idx % step === 0 || idx === raw.length - 1)
  }, [data])

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <WorkspaceBackLink className="mb-4" />

      {/* 雙頁模式切換分頁 */}
      <div className="flex items-center gap-3 mb-6 border-b border-white/10 pb-3">
        <Link
          href="/backtest"
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition"
        >
          {ui.tabSwing}
        </Link>
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-[var(--accent)] text-white shadow-sm">
          {ui.tabDca}
        </div>
      </div>

      {/* 主標頭 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Target className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{ui.title}</h1>
            <p className="text-sm text-[var(--text-secondary)] mt-0.5">{ui.subtitle}</p>
          </div>
        </div>

        {/* 快速選取熱門 ETF */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--text-secondary)] mr-1">{ui.quickPicksTitle}：</span>
          {POPULAR_ETFS.map((item) => (
            <button
              key={item.symbol}
              type="button"
              onClick={() => handleSelectSymbol(item.symbol)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition border ${
                symbol === item.symbol
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-white/5 text-[var(--text-secondary)] border-white/10 hover:bg-white/10'
              }`}
            >
              {item.symbol} {item.name}
            </button>
          ))}
        </div>
      </div>

      {/* 今日加碼倍率行動指南卡片 */}
      {data?.todaySignal && (
        <div className="bg-gradient-to-r from-emerald-950/40 via-[var(--bg-card)] to-[var(--bg-card)] rounded-2xl border border-emerald-500/30 p-6 mb-8 relative overflow-hidden shadow-lg">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="flex items-center gap-2.5">
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  {data.todaySignal.actionBadge}
                </span>
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  {symbol} {stockName}
                </span>
              </div>
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                {ui.todaySignalTitle}
              </h2>
              <p className="text-sm text-emerald-200/90 leading-relaxed">
                {data.todaySignal.reason}
              </p>
            </div>

            {/* 即時指標四方格 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
              <div className="bg-white/5 rounded-xl p-3 border border-white/5 text-center">
                <p className="text-[11px] text-[var(--text-secondary)] mb-0.5">{ui.currentPrice}</p>
                <p className="text-base font-bold font-mono">
                  NT$ {data.todaySignal.currentClose?.toFixed(2) ?? '—'}
                </p>
              </div>

              <div className="bg-white/5 rounded-xl p-3 border border-white/5 text-center">
                <p className="text-[11px] text-[var(--text-secondary)] mb-0.5">{ui.currentBias}</p>
                <p
                  className={`text-base font-bold font-mono ${
                    (data.todaySignal.currentBiasPct ?? 0) <= 0
                      ? 'text-emerald-400'
                      : 'text-amber-400'
                  }`}
                >
                  {data.todaySignal.currentBiasPct != null
                    ? `${data.todaySignal.currentBiasPct > 0 ? '+' : ''}${data.todaySignal.currentBiasPct.toFixed(1)}%`
                    : '—'}
                </p>
              </div>

              <div className="bg-white/5 rounded-xl p-3 border border-white/5 text-center">
                <p className="text-[11px] text-[var(--text-secondary)] mb-0.5">{ui.marketLevelTemp}</p>
                <p className="text-xs font-semibold mt-1">
                  {data.todaySignal.marketLevelStatus === 'extreme_cold'
                    ? '🟢 極冷超跌'
                    : data.todaySignal.marketLevelStatus === 'cold'
                    ? '🟢 偏冷低檔'
                    : data.todaySignal.marketLevelStatus === 'overheated'
                    ? '🔴 過熱警戒'
                    : data.todaySignal.marketLevelStatus === 'warm'
                    ? '🟡 偏熱合理'
                    : '⚪ 常態合理'}
                </p>
              </div>

              <div className="bg-white/5 rounded-xl p-3 border border-white/5 text-center">
                <p className="text-[11px] text-[var(--text-secondary)] mb-0.5">{ui.radarSignal}</p>
                <p className="text-xs font-semibold mt-1">
                  {data.todaySignal.isRadarTriggered ? (
                    <span className="text-emerald-400 font-bold">⚡ 觸發落底</span>
                  ) : (
                    <span className="text-[var(--text-secondary)]">平穩</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 參數設定面板 */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-6 mb-8">
        <div className="flex items-center gap-2 mb-4 text-sm font-semibold text-[var(--text-primary)]">
          <SlidersHorizontal className="w-4 h-4 text-[var(--accent)]" />
          <span>試算參數設定</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">{ui.inputMonthly}</label>
            <input
              type="number"
              step="1000"
              min="1000"
              max="500000"
              value={monthlyAmount}
              onChange={(e) => setMonthlyAmount(Number(e.target.value) || 10000)}
              className="w-full bg-[var(--bg-secondary)] border border-white/10 rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">{ui.inputInvestDay}</label>
            <select
              value={investDay}
              onChange={(e) => setInvestDay(Number(e.target.value))}
              className="w-full bg-[var(--bg-secondary)] border border-white/10 rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            >
              {[1, 6, 11, 16, 21, 26].map((d) => (
                <option key={d} value={d}>
                  每月 {d} 號
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">{ui.inputThreshold}</label>
            <select
              value={thresholdPct}
              onChange={(e) => setThresholdPct(Number(e.target.value))}
              className="w-full bg-[var(--bg-secondary)] border border-white/10 rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            >
              {[-3, -5, -8, -10, -12].map((t) => (
                <option key={t} value={t}>
                  季線負乖離 {t}%
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">{ui.inputMultiplier}</label>
            <select
              value={multiplier}
              onChange={(e) => setMultiplier(Number(e.target.value))}
              className="w-full bg-[var(--bg-secondary)] border border-white/10 rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            >
              <option value={1.3}>1.3x 輕度加碼</option>
              <option value={1.5}>1.5x 溫和加碼 (推薦)</option>
              <option value={2.0}>2.0x 積極加碼</option>
              <option value={2.5}>2.5x 大幅加碼</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1.5">{ui.inputYears}</label>
            <select
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
              className="w-full bg-[var(--bg-secondary)] border border-white/10 rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            >
              <option value={3}>過去 3 年</option>
              <option value={5}>過去 5 年 (推薦)</option>
              <option value={8}>過去 8 年</option>
              <option value={10}>過去 10 年</option>
            </select>
          </div>
        </div>
      </div>

      {loading && (
        <div className="py-16 text-center text-[var(--text-secondary)] flex items-center justify-center gap-2">
          <RefreshCw className="w-5 h-5 animate-spin text-[var(--accent)]" />
          <span>{ui.calculating}</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-400 mb-8 text-sm">
          {error}
        </div>
      )}

      {data?.dca && !loading && (
        <>
          {/* 雙軌成效亮點橫幅 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-5">
              <p className="text-xs text-[var(--text-secondary)] mb-1">{ui.comparisonExtraValue}</p>
              <p className="text-2xl font-bold text-emerald-400 font-mono">
                +NT$ {data.dca.smart.extraReturn.toLocaleString()}
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                期末總資產：NT$ {data.dca.smart.finalValue.toLocaleString()} vs NT${' '}
                {data.dca.standard.finalValue.toLocaleString()}
              </p>
            </div>

            <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-5">
              <p className="text-xs text-[var(--text-secondary)] mb-1">{ui.comparisonCostReduction}</p>
              <p className="text-2xl font-bold text-emerald-400 font-mono">
                -{data.dca.smart.costReductionPct.toFixed(1)}%
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                每股均價降至 NT$ {data.dca.smart.avgCostPerShare.toFixed(2)} (原 NT${' '}
                {data.dca.standard.avgCostPerShare.toFixed(2)})
              </p>
            </div>

            <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-5">
              <p className="text-xs text-[var(--text-secondary)] mb-1">{ui.comparisonExtraRoi}</p>
              <p className="text-2xl font-bold text-[var(--accent)] font-mono">
                +{data.dca.smart.extraRoiPct.toFixed(1)}%
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                累積 ROI：{data.dca.smart.roiPct.toFixed(1)}% (年化{' '}
                {data.dca.smart.annualizedReturnPct.toFixed(1)}%)
              </p>
            </div>

            <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-5">
              <p className="text-xs text-[var(--text-secondary)] mb-1">{ui.comparisonTriggerCount}</p>
              <p className="text-2xl font-bold text-[var(--text-primary)] font-mono">
                {data.dca.smart.dipTriggerCount} 次
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                平均每年僅需加碼約 {(data.dca.smart.dipTriggerCount / (data.dca.meta.monthsCount / 12)).toFixed(1)} 次
              </p>
            </div>
          </div>

          {/* 雙軌完整數據卡片對比 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {/* A 軌：純定期定額 */}
            <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <h3 className="font-semibold text-sm text-[var(--text-secondary)] flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  {ui.trackStdTitle}
                </h3>
                <span className="text-xs text-[var(--text-secondary)]">無逢低加碼</span>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">{ui.metricTotalInvested}</p>
                  <p className="font-semibold text-base mt-0.5 font-mono">
                    NT$ {data.dca.standard.totalInvested.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">{ui.metricFinalValue}</p>
                  <p className="font-semibold text-base mt-0.5 font-mono text-[var(--text-primary)]">
                    NT$ {data.dca.standard.finalValue.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">{ui.metricTotalReturn}</p>
                  <p className="font-semibold text-base mt-0.5 font-mono text-emerald-400">
                    +NT$ {data.dca.standard.totalReturn.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">{ui.metricRoi}</p>
                  <p className="font-semibold text-base mt-0.5 font-mono text-emerald-400">
                    +{data.dca.standard.roiPct.toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">{ui.metricAnnualized}</p>
                  <p className="font-semibold text-sm mt-0.5 font-mono">
                    {data.dca.standard.annualizedReturnPct.toFixed(1)}% / 年
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">{ui.metricAvgCost}</p>
                  <p className="font-semibold text-sm mt-0.5 font-mono">
                    NT$ {data.dca.standard.avgCostPerShare.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            {/* B 軌：逢低智慧加碼 */}
            <div className="bg-gradient-to-br from-emerald-950/20 to-[var(--bg-card)] rounded-2xl border border-emerald-500/20 p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-emerald-500/10 pb-3">
                <h3 className="font-semibold text-sm text-emerald-400 flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  {ui.trackSmartTitle}
                </h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                  {multiplier}x 智慧加碼
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">{ui.metricTotalInvested}</p>
                  <p className="font-semibold text-base mt-0.5 font-mono">
                    NT$ {data.dca.smart.totalInvested.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">{ui.metricFinalValue}</p>
                  <p className="font-bold text-base mt-0.5 font-mono text-emerald-400">
                    NT$ {data.dca.smart.finalValue.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">{ui.metricTotalReturn}</p>
                  <p className="font-semibold text-base mt-0.5 font-mono text-emerald-400">
                    +NT$ {data.dca.smart.totalReturn.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">{ui.metricRoi}</p>
                  <p className="font-bold text-base mt-0.5 font-mono text-emerald-400">
                    +{data.dca.smart.roiPct.toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">{ui.metricAnnualized}</p>
                  <p className="font-semibold text-sm mt-0.5 font-mono text-[var(--accent)]">
                    {data.dca.smart.annualizedReturnPct.toFixed(1)}% / 年
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">{ui.metricAvgCost}</p>
                  <p className="font-bold text-sm mt-0.5 font-mono text-emerald-300">
                    NT$ {data.dca.smart.avgCostPerShare.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 資產累積與成長圖表 */}
          <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-6 mb-8">
            <h3 className="text-base font-semibold mb-4">{ui.chartTitle}</h3>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="dateStr"
                    stroke="rgba(255,255,255,0.4)"
                    fontSize={11}
                    tickFormatter={(str) => str.slice(0, 7)}
                  />
                  <YAxis
                    stroke="rgba(255,255,255,0.4)"
                    fontSize={11}
                    tickFormatter={(v) => `${(v / 10000).toFixed(0)}萬`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(20, 24, 33, 0.95)',
                      borderColor: 'rgba(255,255,255,0.1)',
                      borderRadius: '0.75rem',
                      fontSize: '12px',
                    }}
                    formatter={(val: any, name: any) => [
                      `NT$ ${Number(val).toLocaleString()}`,
                      name === 'smartValue'
                        ? ui.chartSmartValue
                        : name === 'stdValue'
                        ? ui.chartStdValue
                        : name === 'smartCost'
                        ? ui.chartSmartCost
                        : ui.chartStdCost,
                    ]}
                  />
                  <Legend
                    verticalAlign="top"
                    height={36}
                    formatter={(val) =>
                      val === 'smartValue'
                        ? ui.chartSmartValue
                        : val === 'stdValue'
                        ? ui.chartStdValue
                        : val === 'smartCost'
                        ? ui.chartSmartCost
                        : ui.chartStdCost
                    }
                  />
                  {/* B 軌資產市值 */}
                  <Line
                    type="monotone"
                    dataKey="smartValue"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={false}
                  />
                  {/* A 軌資產市值 */}
                  <Line
                    type="monotone"
                    dataKey="stdValue"
                    stroke="#3b82f6"
                    strokeWidth={1.8}
                    dot={false}
                  />
                  {/* B 軌投入本金 */}
                  <Line
                    type="monotone"
                    dataKey="smartCost"
                    stroke="#059669"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                  {/* A 軌投入本金 */}
                  <Line
                    type="monotone"
                    dataKey="stdCost"
                    stroke="#6b7280"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 歷史逢低加碼明細清單 */}
          {data.dca.dipEvents && data.dca.dipEvents.length > 0 && (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-6">
              <h3 className="text-base font-semibold mb-4">{ui.dipHistoryTitle} ({data.dca.dipEvents.length})</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[var(--text-secondary)]">
                      <th className="py-2.5 px-3 font-medium">{ui.colDate}</th>
                      <th className="py-2.5 px-3 font-medium">{ui.colClose}</th>
                      <th className="py-2.5 px-3 font-medium">{ui.colBias}</th>
                      <th className="py-2.5 px-3 font-medium">{ui.colAmount}</th>
                      <th className="py-2.5 px-3 font-medium">{ui.colShares}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dca.dipEvents.map((ev: any, idx: number) => (
                      <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition">
                        <td className="py-2.5 px-3 font-mono">{ev.dateStr}</td>
                        <td className="py-2.5 px-3 font-mono">NT$ {ev.close.toFixed(2)}</td>
                        <td className="py-2.5 px-3 font-mono text-emerald-400 font-bold">
                          {ev.biasPct.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 font-mono font-medium">
                          +NT$ {ev.amount.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[var(--text-secondary)]">
                          {Math.round(ev.sharesBought).toLocaleString()} 股
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
