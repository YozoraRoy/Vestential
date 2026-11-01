'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Gauge,
  HelpCircle,
  Info,
  Layers,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'

interface MarketLevelBand {
  mean: number
  plus1Sigma: number
  plus2Sigma: number
  minus1Sigma: number
  minus2Sigma: number
}

interface MarketLevelAnalysis {
  tradeDate: string
  taiex: number | null
  peRatio: number | null
  pbRatio: number | null
  dividendYield: number | null
  pePercentile: number | null
  pbPercentile: number | null
  compositePercentile: number | null
  levelStatus: 'extreme_cold' | 'cold' | 'fair' | 'warm' | 'overheated'
  statusLabel: string
  statusDescription: string
  peBand: MarketLevelBand
  pbBand: MarketLevelBand
}

interface MarketLevelRow {
  trade_date: string
  taiex: number | null
  pe_ratio: number | null
  pb_ratio: number | null
  dividend_yield: number | null
  pe_percentile: number | null
  pb_percentile: number | null
  composite_percentile: number | null
  level_status: string | null
}

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; badge: string; textClass: string; bgClass: string; borderClass: string }
> = {
  extreme_cold: {
    label: '極冷（深度低估）',
    color: '#3b82f6',
    badge: 'bg-blue-500 text-white',
    textClass: 'text-blue-400',
    bgClass: 'bg-blue-500/10',
    borderClass: 'border-blue-500/30',
  },
  cold: {
    label: '偏冷（具安全邊際）',
    color: '#06b6d4',
    badge: 'bg-cyan-500 text-white',
    textClass: 'text-cyan-400',
    bgClass: 'bg-cyan-500/10',
    borderClass: 'border-cyan-500/30',
  },
  fair: {
    label: '合理（估值中樞）',
    color: '#10b981',
    badge: 'bg-emerald-500 text-white',
    textClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/30',
  },
  warm: {
    label: '偏熱（估值偏高）',
    color: '#f59e0b',
    badge: 'bg-amber-500 text-white',
    textClass: 'text-amber-400',
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/30',
  },
  overheated: {
    label: '過熱（歷史高位階）',
    color: '#ef4444',
    badge: 'bg-red-500 text-white',
    textClass: 'text-red-400',
    bgClass: 'bg-red-500/10',
    borderClass: 'border-red-500/30',
  },
}

export default function MarketLevelPage() {
  const [data, setData] = useState<{ current: MarketLevelAnalysis; history: MarketLevelRow[]; disclaimer: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'pe' | 'pb'>('pe')

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/market-level')
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || '載入失敗')
      setData(json)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '取得大盤水位失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
          <div className="h-8 bg-slate-800 rounded w-48"></div>
          <div className="h-44 bg-slate-850 rounded-2xl border border-slate-800"></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="h-24 bg-slate-850 rounded-xl"></div>
            <div className="h-24 bg-slate-850 rounded-xl"></div>
            <div className="h-24 bg-slate-850 rounded-xl"></div>
            <div className="h-24 bg-slate-850 rounded-xl"></div>
          </div>
        </div>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 flex items-center justify-center">
        <div className="bg-slate-900 border border-red-500/30 p-6 rounded-2xl max-w-md w-full text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto" />
          <h2 className="text-xl font-bold">無法取得大盤水位資料</h2>
          <p className="text-sm text-slate-400">{error}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition"
          >
            重新整理
          </button>
        </div>
      </main>
    )
  }

  const { current, history, disclaimer } = data
  const statusCfg = STATUS_CONFIG[current.levelStatus] || STATUS_CONFIG.fair
  const compositePercentile = current.compositePercentile ?? 50

  // 繪製河流帶狀圖數據
  const isPe = activeTab === 'pe'
  const activeBand = isPe ? current.peBand : current.pbBand
  const activeValue = isPe ? current.peRatio : current.pbRatio
  const activePercentile = isPe ? current.pePercentile : current.pbPercentile
  const metricName = isPe ? '大盤本益比 (P/E)' : '大盤股價淨值比 (P/B)'

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 頂部標題 */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 pb-2 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <Gauge className="w-6 h-6 text-indigo-400" />
              <h1 className="text-2xl font-bold text-white tracking-tight">大盤水位儀表板</h1>
              <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                加權指數估值位階
              </span>
            </div>
            <p className="text-xs md:text-sm text-slate-400 mt-1">
              以 TWSE 官方每日 PER、PBR 與殖利率，計算 5 年滾動歷史分位與常態分布帶
            </p>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-400">數據基準交易日</span>
            <div className="text-sm font-semibold text-slate-200">{current.tradeDate}</div>
          </div>
        </div>

        {/* 核心卡片 1：水位燈號總覽（手機一屏優先） */}
        <div className={`p-6 rounded-2xl border ${statusCfg.bgClass} ${statusCfg.borderClass} relative overflow-hidden backdrop-blur-sm`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${statusCfg.badge}`}>
                  當前水位燈號
                </span>
                <span className="text-xs text-slate-400">5 年歷史窗口綜合評價</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-extrabold text-white mt-2 flex items-center gap-3">
                {statusCfg.label}
              </h2>
            </div>
            <div className="md:text-right">
              <div className="text-xs text-slate-400">綜合歷史分位數</div>
              <div className="text-3xl md:text-4xl font-black tracking-tight text-white mt-1">
                {compositePercentile}%
                <span className="text-sm font-normal text-slate-400 ml-1">分位</span>
              </div>
            </div>
          </div>

          {/* 5 段視覺化進度指針條 */}
          <div className="mt-6 space-y-2">
            <div className="relative h-3 w-full bg-slate-900 rounded-full overflow-hidden flex">
              <div className="h-full w-1/5 bg-blue-500/80" title="極冷 (<20%)"></div>
              <div className="h-full w-1/5 bg-cyan-500/80" title="偏冷 (20-40%)"></div>
              <div className="h-full w-1/5 bg-emerald-500/80" title="合理 (40-60%)"></div>
              <div className="h-full w-1/5 bg-amber-500/80" title="偏熱 (60-80%)"></div>
              <div className="h-full w-1/5 bg-red-500/80" title="過熱 (>80%)"></div>
            </div>

            {/* 指針位置標示 */}
            <div className="relative h-4 w-full">
              <div
                className="absolute -top-1 -translate-x-1/2 flex flex-col items-center transition-all duration-500"
                style={{ left: `${Math.min(98, Math.max(2, compositePercentile))}%` }}
              >
                <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[6px] border-b-white"></div>
                <span className="text-[10px] font-bold text-white bg-slate-800 px-1 rounded shadow">
                  目前 {compositePercentile}%
                </span>
              </div>
            </div>

            {/* 標尺文字 */}
            <div className="flex justify-between text-[11px] text-slate-400 pt-1">
              <span>0% 極冷</span>
              <span>20% 偏冷</span>
              <span>40% 合理</span>
              <span>60% 偏熱</span>
              <span>80% 過熱</span>
              <span>100%</span>
            </div>
          </div>

          {/* 白話解讀卡 */}
          <div className="mt-4 pt-4 border-t border-slate-800/60 text-xs md:text-sm text-slate-300 leading-relaxed">
            <span className="font-semibold text-white mr-1">今日大盤解讀：</span>
            {current.statusDescription}
          </div>
        </div>

        {/* 核心卡片 2：四項關鍵數據指標 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {/* 加權指數 */}
          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400">加權指數點位 (TAIEX)</div>
            <div className="text-xl md:text-2xl font-bold text-white mt-1">
              {current.taiex ? Number(current.taiex).toLocaleString() : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">台股大盤最新收盤</div>
          </div>

          {/* 本益比 */}
          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400">大盤本益比 (P/E)</div>
            <div className="text-xl md:text-2xl font-bold text-indigo-400 mt-1">
              {current.peRatio ? `${current.peRatio}x` : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              歷史分位：<span className="font-semibold text-slate-200">{current.pePercentile}%</span>
            </div>
          </div>

          {/* 淨值比 */}
          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400">股價淨值比 (P/B)</div>
            <div className="text-xl md:text-2xl font-bold text-cyan-400 mt-1">
              {current.pbRatio ? `${current.pbRatio}x` : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              歷史分位：<span className="font-semibold text-slate-200">{current.pbPercentile}%</span>
            </div>
          </div>

          {/* 殖利率 */}
          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400">市場平均殖利率</div>
            <div className="text-xl md:text-2xl font-bold text-emerald-400 mt-1">
              {current.dividendYield ? `${current.dividendYield}%` : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">全市場現金股利水準</div>
          </div>
        </div>

        {/* 核心卡片 3：5 年常態河流圖帶狀估值 */}
        <div className="bg-slate-900/90 border border-slate-800 p-6 rounded-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-400" />
                5 年河流圖帶狀分析
              </h3>
              <p className="text-xs text-slate-400">以歷史均線（Mean）與標準差（±1σ、±2σ）劃分估值常態分佈</p>
            </div>
            {/* 切換 P/E 與 P/B */}
            <div className="flex bg-slate-800 p-1 rounded-lg text-xs font-medium self-start sm:self-auto">
              <button
                onClick={() => setActiveTab('pe')}
                className={`px-3 py-1.5 rounded-md transition ${activeTab === 'pe' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                本益比 (P/E)
              </button>
              <button
                onClick={() => setActiveTab('pb')}
                className={`px-3 py-1.5 rounded-md transition ${activeTab === 'pb' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                淨值比 (P/B)
              </button>
            </div>
          </div>

          {/* 5 段帶狀常態數值展示卡 */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
            <div className="bg-slate-950/60 p-3 rounded-lg border border-red-500/20 text-center">
              <div className="text-[11px] text-red-400 font-semibold">+2σ（極高估）</div>
              <div className="text-base font-bold text-white mt-0.5">{activeBand.plus2Sigma}x</div>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-lg border border-amber-500/20 text-center">
              <div className="text-[11px] text-amber-400 font-semibold">+1σ（偏高估）</div>
              <div className="text-base font-bold text-white mt-0.5">{activeBand.plus1Sigma}x</div>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-lg border border-emerald-500/20 text-center">
              <div className="text-[11px] text-emerald-400 font-semibold">Mean（5年均線）</div>
              <div className="text-base font-bold text-white mt-0.5">{activeBand.mean}x</div>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-lg border border-cyan-500/20 text-center">
              <div className="text-[11px] text-cyan-400 font-semibold">-1σ（偏低估）</div>
              <div className="text-base font-bold text-white mt-0.5">{activeBand.minus1Sigma}x</div>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-lg border border-blue-500/20 text-center col-span-2 sm:col-span-1">
              <div className="text-[11px] text-blue-400 font-semibold">-2σ（極低估）</div>
              <div className="text-base font-bold text-white mt-0.5">{activeBand.minus2Sigma}x</div>
            </div>
          </div>

          {/* 視覺化常態分佈橫條圖 */}
          <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">當前 {metricName} 位階：</span>
              <span className="text-white font-bold">{activeValue}x（第 {activePercentile}% 分位）</span>
            </div>
            {/* 帶狀刻度尺 */}
            <div className="relative h-6 bg-slate-900 rounded-lg overflow-hidden flex border border-slate-800">
              <div className="h-full flex-1 bg-blue-500/20 flex items-center justify-center text-[10px] text-blue-400 border-r border-slate-800/40">
                -2σ
              </div>
              <div className="h-full flex-1 bg-cyan-500/20 flex items-center justify-center text-[10px] text-cyan-400 border-r border-slate-800/40">
                -1σ
              </div>
              <div className="h-full flex-1 bg-emerald-500/20 flex items-center justify-center text-[10px] text-emerald-400 border-r border-slate-800/40 font-semibold">
                Mean
              </div>
              <div className="h-full flex-1 bg-amber-500/20 flex items-center justify-center text-[10px] text-amber-400 border-r border-slate-800/40">
                +1σ
              </div>
              <div className="h-full flex-1 bg-red-500/20 flex items-center justify-center text-[10px] text-red-400">
                +2σ
              </div>
            </div>
          </div>
        </div>

        {/* 核心卡片 4：近期水位歷史紀錄明細 */}
        <div className="bg-slate-900/90 border border-slate-800 p-6 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-400" />
              歷史交易日水位明細
            </h3>
            <span className="text-xs text-slate-400">顯示最近 10 筆交易日</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3 font-semibold">交易日期</th>
                  <th className="py-2.5 px-3 font-semibold">加權指數</th>
                  <th className="py-2.5 px-3 font-semibold">本益比 (P/E)</th>
                  <th className="py-2.5 px-3 font-semibold">淨值比 (P/B)</th>
                  <th className="py-2.5 px-3 font-semibold">綜合分位</th>
                  <th className="py-2.5 px-3 font-semibold">水位燈號</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {history.slice(0, 10).map((row) => {
                  const cfg = STATUS_CONFIG[row.level_status ?? 'fair'] || STATUS_CONFIG.fair
                  return (
                    <tr key={row.trade_date} className="hover:bg-slate-800/40 transition">
                      <td className="py-2.5 px-3 text-slate-300 font-mono">{row.trade_date}</td>
                      <td className="py-2.5 px-3 text-white font-medium">
                        {row.taiex ? Number(row.taiex).toLocaleString() : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">{row.pe_ratio ? `${row.pe_ratio}x` : '—'}</td>
                      <td className="py-2.5 px-3 text-slate-300">{row.pb_ratio ? `${row.pb_ratio}x` : '—'}</td>
                      <td className="py-2.5 px-3 text-slate-300 font-semibold">{row.composite_percentile ?? '—'}%</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${cfg.badge}`}>
                          {cfg.label.split('（')[0]}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 底部法規紅線與合規免責宣告 */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs text-slate-400 space-y-2 leading-relaxed">
          <div className="flex items-center gap-1.5 font-semibold text-slate-300">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            合規警語與免責聲明
          </div>
          <p>{disclaimer}</p>
        </div>
      </div>
    </main>
  )
}
