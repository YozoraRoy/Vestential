'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Bookmark,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  CircleAlert,
  Coins,
  DollarSign,
  Edit3,
  Gauge,
  HelpCircle,
  Info,
  Layers,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react'
import type { BottomRadarDashboardData } from '@/lib/bottom-radar'

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

const DEFAULT_BOTTOM_BUYING_GUIDELINES = `1. 生存活水原則（緊急預備防線）：
   • 務必保留 6～12 個月生活必要開支之緊急預備金，絕對不可在下殺段動用作為抄底或攤平資金。
   • 僅以 1～2 年以上不影響生活的充裕閒置資金進行階梯式分批配置。

2. 階梯式分批佈局策略（拒絕單筆一次凹單）：
   • 第一批（30% 資金）：指標滿足 ≥ 3 項（中度超跌區，季線負乖離達 -5%～-7%）時啟動試單。
   • 第二批（40% 資金）：恐慌極值區（季線負乖離 ≤ -8% 且融資維持率斷頭 ≤ 130%）加碼核心部位。
   • 第三批（30% 資金）：右側轉折確認（破曉長紅吞噬站上 5MA、台幣止貶回升）後回補完畢。

3. 標的配置優先順序（防禦與反彈兼具）：
   • 第 1 順位【大盤市值型 ETF（如 0050 / 006208）】：具備最強均值回歸動能，歷史勝率最高、無個別公司倒閉風險。
   • 第 2 順位【高股息防禦型 ETF（如 0056 / 00878 / 00919）】：大跌後現金殖利率墊高，提供下檔支撐與被動現金流。
   • 警戒避開【高融資中小型投機股】：浮額斷頭踩踏未結束前，切勿過早猜底承接。`

export default function MarketLevelPage() {
  const [data, setData] = useState<{
    current: MarketLevelAnalysis
    history: MarketLevelRow[]
    bottomRadar?: BottomRadarDashboardData | null
    disclaimer: string
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'pe' | 'pb'>('pe')

  // 大盤落底抄底資金紀律與操作建議（支援自訂備忘錄）
  const [personalNotes, setPersonalNotes] = useState(DEFAULT_BOTTOM_BUYING_GUIDELINES)
  const [isEditingNotes, setIsEditingNotes] = useState(false)
  const [savedNotesAlert, setSavedNotesAlert] = useState(false)

  // 手動更新按鈕狀態
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null)

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const res = await fetch('/api/market-level/refresh', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || '同步失敗')
      }
      if (json.current) {
        setData({
          current: json.current,
          history: json.history ?? data?.history ?? [],
          bottomRadar: json.bottomRadar ?? data?.bottomRadar,
          disclaimer: json.disclaimer ?? data?.disclaimer ?? '',
        })
      }
      if (json.throttled) {
        setRefreshMsg({
          type: 'info',
          text: json.message || '資料已是最新（60 秒內剛同步過）',
        })
      } else {
        setRefreshMsg({
          type: 'success',
          text: json.message || `已成功同步最新大盤水位與落底指標（${json.today || ''}）`,
        })
      }
      setTimeout(() => setRefreshMsg(null), 4000)
    } catch (e: unknown) {
      setRefreshMsg({
        type: 'error',
        text: e instanceof Error ? e.message : '手動同步失敗，請稍後再試',
      })
      setTimeout(() => setRefreshMsg(null), 5000)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem('vestential_capital_notes')
      // 自動升級：若本機儲存為舊版特定個人備忘，自動採用通用建議指南
      if (saved && !saved.includes('115 萬') && !saved.includes('星宇')) {
        setPersonalNotes(saved)
      } else {
        setPersonalNotes(DEFAULT_BOTTOM_BUYING_GUIDELINES)
      }
    } catch (_) {}
  }, [])

  const saveNotes = () => {
    try {
      localStorage.setItem('vestential_capital_notes', personalNotes)
      setIsEditingNotes(false)
      setSavedNotesAlert(true)
      setTimeout(() => setSavedNotesAlert(false), 2500)
    } catch (_) {}
  }

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
          <div className="flex items-center gap-3 self-start md:self-auto">
            <div className="text-left md:text-right">
              <span className="text-xs text-slate-400 block">數據基準交易日</span>
              <div className="text-sm font-semibold text-slate-200 font-mono">{current.tradeDate}</div>
            </div>

            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              title="立即同步最新加權指數與估值位階數據"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer select-none ${
                refreshing
                  ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40 animate-pulse cursor-wait'
                  : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/20 hover:text-indigo-200 hover:border-indigo-500/50 shadow-sm'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? '同步中...' : '手動更新'}</span>
            </button>
          </div>
        </div>

        {refreshMsg && (
          <div
            className={`text-xs px-4 py-2.5 rounded-xl border flex items-center justify-between transition-all animate-in fade-in slide-in-from-top-1 ${
              refreshMsg.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : refreshMsg.type === 'info'
                  ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                  : 'bg-red-500/10 text-red-300 border-red-500/30'
            }`}
          >
            <div className="flex items-center gap-2">
              {refreshMsg.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />}
              {refreshMsg.type === 'info' && <Info className="w-4 h-4 shrink-0 text-cyan-400" />}
              {refreshMsg.type === 'error' && <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />}
              <span>{refreshMsg.text}</span>
            </div>
            <button
              onClick={() => setRefreshMsg(null)}
              className="text-slate-400 hover:text-white text-xs ml-3 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

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

        {/* Issue #127 核心模組：大盤落底訊號雷達 ＆ 抄底 SOP 檢核 */}
        {data.bottomRadar && (
          <div className="bg-slate-900/95 border border-indigo-500/30 p-6 rounded-2xl space-y-6 shadow-xl relative overflow-hidden backdrop-blur-md">
            {/* 標題列 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-xl font-bold text-white tracking-tight">大盤落底訊號雷達 ＆ 抄底 SOP</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
                    四大指標共振
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  核心不在於猜測指數跌到幾點，而在於觀察「籌碼去槓桿、季線負乖離、量價換手、外資期權」四大客觀訊號是否共振衰竭
                </p>
              </div>
              <div className="text-right">
                <span className="text-[11px] text-slate-400">抄底判定機制</span>
                <div className="text-xs font-bold text-indigo-300">滿足 ≥ 3 項視為安全買點</div>
              </div>
            </div>

            {/* SOP 5 條件檢視清單 */}
            <div
              className={`p-5 rounded-xl border transition-all ${
                data.bottomRadar.checklist.isSafeToBuy
                  ? 'bg-emerald-950/30 border-emerald-500/40 shadow-emerald-900/20 shadow-lg'
                  : 'bg-amber-950/20 border-amber-500/30'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2.5">
                  {data.bottomRadar.checklist.isSafeToBuy ? (
                    <ShieldCheck className="w-6 h-6 text-emerald-400 shrink-0" />
                  ) : (
                    <CircleAlert className="w-6 h-6 text-amber-400 shrink-0" />
                  )}
                  <div>
                    <div className="text-lg font-black text-white">
                      {data.bottomRadar.checklist.verdictLabel}
                    </div>
                    <div className="text-xs text-slate-300 mt-0.5">
                      {data.bottomRadar.checklist.verdictDescription}
                    </div>
                  </div>
                </div>
                <div className="text-right self-start md:self-auto bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
                  <span className="text-xs text-slate-400">目前達成條件：</span>
                  <span
                    className={`text-lg font-black ml-1.5 ${
                      data.bottomRadar.checklist.isSafeToBuy ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {data.bottomRadar.checklist.metCount} / 5
                  </span>
                </div>
              </div>

              {/* 5 條件逐項核對 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                {/* 條件 1 */}
                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition ${
                    data.bottomRadar.checklist.marginMet
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-100 font-medium'
                      : 'bg-slate-900/50 border-slate-800 text-slate-400'
                  }`}
                >
                  {data.bottomRadar.checklist.marginMet ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-200">籌碼去槓桿：</span>
                    融資維持率 ≤ 135% 或 單日融資大減 ≥ 50 億
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      當前融資增減：
                      <span
                        className={`font-mono font-bold ml-1 ${
                          (data.bottomRadar.margin.marginChange ?? 0) <= -50 ? 'text-emerald-400' : 'text-slate-300'
                        }`}
                      >
                        {data.bottomRadar.margin.marginChange != null
                          ? `${data.bottomRadar.margin.marginChange > 0 ? '+' : ''}${data.bottomRadar.margin.marginChange} 億元`
                          : '—'}
                      </span>
                      {data.bottomRadar.margin.marginMaintenanceRatio != null && (
                        <span> · 維持率約 {data.bottomRadar.margin.marginMaintenanceRatio}%</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 條件 2 */}
                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition ${
                    data.bottomRadar.checklist.biasMet
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-100 font-medium'
                      : 'bg-slate-900/50 border-slate-800 text-slate-400'
                  }`}
                >
                  {data.bottomRadar.checklist.biasMet ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-200">季線負乖離：</span>
                    0050 或加權指數之 60MA 季線負乖離 ≤ -5%
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      加權負乖離：
                      <span className="font-mono font-bold text-slate-300 ml-1">
                        {data.bottomRadar.bias.taiexBias != null ? `${data.bottomRadar.bias.taiexBias}%` : '—'}
                      </span>
                      {' · '}
                      0050 負乖離：
                      <span
                        className={`font-mono font-bold ml-1 ${
                          (data.bottomRadar.bias.stock0050Bias ?? 0) <= -5 ? 'text-emerald-400' : 'text-slate-300'
                        }`}
                      >
                        {data.bottomRadar.bias.stock0050Bias != null
                          ? `${data.bottomRadar.bias.stock0050Bias}%`
                          : '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 條件 3 */}
                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition ${
                    data.bottomRadar.checklist.patternMet
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-100 font-medium'
                      : 'bg-slate-900/50 border-slate-800 text-slate-400'
                  }`}
                >
                  {data.bottomRadar.checklist.patternMet ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-200">量價型態：</span>
                    爆量長下影線（打樁）、量縮窒息底或破曉吞噬
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      當前型態：
                      <span
                        className={`font-semibold ml-1 ${
                          data.bottomRadar.pattern.patternTriggered ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      >
                        {data.bottomRadar.pattern.description}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 條件 4 */}
                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition ${
                    data.bottomRadar.checklist.futuresMet
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-100 font-medium'
                      : 'bg-slate-900/50 border-slate-800 text-slate-400'
                  }`}
                >
                  {data.bottomRadar.checklist.futuresMet ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-200">期權避險：</span>
                    外資台指期淨空單顯著回補（單日 ≥ 5000 口或水位 &lt; 2.5 萬口）
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      外資淨空單：
                      <span className="font-mono font-bold text-slate-300 ml-1">
                        {data.bottomRadar.hedging.txForeignNetOI != null
                          ? `${data.bottomRadar.hedging.txForeignNetOI.toLocaleString()} 口`
                          : '—'}
                      </span>
                      {data.bottomRadar.hedging.txForeignNetChange != null && (
                        <span>
                          （單日 {data.bottomRadar.hedging.txForeignNetChange >= 0 ? '+' : ''}
                          {data.bottomRadar.hedging.txForeignNetChange.toLocaleString()} 口）
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 條件 5 */}
                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border md:col-span-2 transition ${
                    data.bottomRadar.checklist.fxMet
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-100 font-medium'
                      : 'bg-slate-900/50 border-slate-800 text-slate-400'
                  }`}
                >
                  {data.bottomRadar.checklist.fxMet ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-200">匯率動向：</span>
                    新台幣匯率停止貶值（USD/TWD 由貶轉升，外資資金停止提款）
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      最新匯率：
                      <span className="font-mono font-bold text-slate-300 ml-1">
                        {data.bottomRadar.hedging.usdTwdRate ?? '—'}
                      </span>
                      <span
                        className={`font-semibold ml-2 ${
                          data.bottomRadar.hedging.isFxStabilized ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      >
                        {data.bottomRadar.hedging.isFxStabilized ? '● 台幣止貶回升' : '● 台幣仍處貶值整理'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 四大客觀指標監控卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 1. 籌碼去槓桿 */}
              <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Coins className="w-4 h-4 text-amber-400" />
                    一、籌碼去槓桿與融資維持率
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                    {data.bottomRadar.margin.statusLabel}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="bg-slate-900 p-2 rounded-lg">
                    <div className="text-[11px] text-slate-400">大盤融資餘額</div>
                    <div className="text-sm font-bold text-white mt-0.5 font-mono">
                      {data.bottomRadar.margin.marginBalance ? `${data.bottomRadar.margin.marginBalance} 億` : '—'}
                    </div>
                  </div>
                  <div className="bg-slate-900 p-2 rounded-lg">
                    <div className="text-[11px] text-slate-400">單日融資增減</div>
                    <div
                      className={`text-sm font-bold mt-0.5 font-mono ${
                        (data.bottomRadar.margin.marginChange ?? 0) <= -50 ? 'text-emerald-400' : 'text-slate-200'
                      }`}
                    >
                      {data.bottomRadar.margin.marginChange != null
                        ? `${data.bottomRadar.margin.marginChange > 0 ? '+' : ''}${data.bottomRadar.margin.marginChange} 億`
                        : '—'}
                    </div>
                  </div>
                  <div className="bg-slate-900 p-2 rounded-lg">
                    <div className="text-[11px] text-slate-400">大盤估計維持率</div>
                    <div className="text-sm font-bold text-indigo-300 mt-0.5 font-mono">
                      {data.bottomRadar.margin.marginMaintenanceRatio != null
                        ? `${data.bottomRadar.margin.marginMaintenanceRatio}%`
                        : '—'}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                  {data.bottomRadar.margin.statusDescription}
                </p>
              </div>

              {/* 2. 季線負乖離 */}
              <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <TrendingDown className="w-4 h-4 text-cyan-400" />
                    二、60 日季線負乖離率 (BIAS60)
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                    {data.bottomRadar.bias.isBiasTriggered ? '中度超跌／恐慌極值' : '常態技術回檔'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 text-center">
                  <div className="bg-slate-900 p-2 rounded-lg">
                    <div className="text-[11px] text-slate-400">加權指數負乖離</div>
                    <div
                      className={`text-sm font-bold mt-0.5 font-mono ${
                        (data.bottomRadar.bias.taiexBias ?? 0) <= -5 ? 'text-emerald-400' : 'text-slate-200'
                      }`}
                    >
                      {data.bottomRadar.bias.taiexBias != null ? `${data.bottomRadar.bias.taiexBias}%` : '—'}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      季線：{data.bottomRadar.bias.taiexMa60?.toLocaleString() ?? '—'}
                    </div>
                  </div>
                  <div className="bg-slate-900 p-2 rounded-lg">
                    <div className="text-[11px] text-slate-400">0050 季線負乖離</div>
                    <div
                      className={`text-sm font-bold mt-0.5 font-mono ${
                        (data.bottomRadar.bias.stock0050Bias ?? 0) <= -5 ? 'text-emerald-400' : 'text-slate-200'
                      }`}
                    >
                      {data.bottomRadar.bias.stock0050Bias != null ? `${data.bottomRadar.bias.stock0050Bias}%` : '—'}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      季線：{data.bottomRadar.bias.stock0050Ma60?.toFixed(2) ?? '—'}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                  區間 1：0% ~ -3%（常態定期定額）· 區間 2：-5% ~ -7%（階梯試單 30%）· 區間 3：≤ -8%（恐慌甜蜜擊球區）
                </p>
              </div>

              {/* 3. 量價與型態指標 */}
              <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    三、量價換手與 K 線型態
                  </span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                      data.bottomRadar.pattern.patternTriggered
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {data.bottomRadar.pattern.patternTriggered ? '已出現轉折型態' : '尚未出現型態'}
                  </span>
                </div>
                <div className="space-y-1.5 pt-1 text-xs">
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-900/80">
                    <span className="text-slate-400">爆量長下影線（打樁線）：</span>
                    <span
                      className={`font-semibold ${
                        data.bottomRadar.pattern.hammer ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      {data.bottomRadar.pattern.hammer ? '✓ 滿足（融資斷頭被全數吸收）' : '未出現'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-900/80">
                    <span className="text-slate-400">量縮窒息底（跌無可跌）：</span>
                    <span
                      className={`font-semibold ${
                        data.bottomRadar.pattern.volumeDrying ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      {data.bottomRadar.pattern.volumeDrying ? '✓ 滿足（量縮至 60% 且 3 日不破低）' : '未出現'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-900/80">
                    <span className="text-slate-400">破曉長紅吞噬（右側確認）：</span>
                    <span
                      className={`font-semibold ${
                        data.bottomRadar.pattern.dawnEngulfing ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      {data.bottomRadar.pattern.dawnEngulfing ? '✓ 滿足（紅 K 吞噬前高並站上 5MA）' : '未出現'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 4. 資金與期權避險動向 */}
              <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-purple-400" />
                    四、外資期權避險與新台幣匯率
                  </span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                      data.bottomRadar.hedging.isHedgingTriggered
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {data.bottomRadar.hedging.isHedgingTriggered ? '期權空單回補' : '空單壓力仍重'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 text-center">
                  <div className="bg-slate-900 p-2 rounded-lg">
                    <div className="text-[11px] text-slate-400">外資台指期淨空單</div>
                    <div className="text-sm font-bold text-purple-300 mt-0.5 font-mono">
                      {data.bottomRadar.hedging.txForeignNetOI != null
                        ? `${data.bottomRadar.hedging.txForeignNetOI.toLocaleString()} 口`
                        : '—'}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      單日：{data.bottomRadar.hedging.txForeignNetChange != null ? `${data.bottomRadar.hedging.txForeignNetChange > 0 ? '+' : ''}${data.bottomRadar.hedging.txForeignNetChange.toLocaleString()}` : '—'}
                    </div>
                  </div>
                  <div className="bg-slate-900 p-2 rounded-lg">
                    <div className="text-[11px] text-slate-400">美元兌新台幣 (USD/TWD)</div>
                    <div className="text-sm font-bold text-white mt-0.5 font-mono">
                      {data.bottomRadar.hedging.usdTwdRate ?? '—'}
                    </div>
                    <div
                      className={`text-[10px] font-semibold mt-0.5 ${
                        data.bottomRadar.hedging.isFxStabilized ? 'text-emerald-400' : 'text-slate-400'
                      }`}
                    >
                      {data.bottomRadar.hedging.isFxStabilized ? '止貶由貶轉升' : '仍處貶值趨勢'}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                  外資期貨淨空單若大於 3.5 萬口摜壓沉重；當單日大幅回補 ≥ 5,000 口或台幣領先止貶，代表熱錢避險賣壓退潮。
                </p>
              </div>
            </div>

            {/* 0050 動態階梯買進試算 ＆ 個人資金紀律提醒 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              {/* 0050 階梯目標價試算 */}
              <div className="bg-gradient-to-br from-indigo-950/40 to-slate-900 border border-indigo-500/30 p-4 rounded-xl space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-300">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  0050 動態階梯掛單價試算
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center p-2 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-400">當前 0050 季線 (MA60)：</span>
                    <span className="font-mono font-bold text-white">
                      {data.bottomRadar.bias.stock0050Ma60 ? `${data.bottomRadar.bias.stock0050Ma60.toFixed(2)} 元` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-slate-900/80 border border-cyan-500/30">
                    <div>
                      <div className="font-semibold text-cyan-300">區間 2 試單價 (-5%)</div>
                      <div className="text-[10px] text-slate-400">中度超跌 · 第一筆投入 30% 資金</div>
                    </div>
                    <span className="font-mono text-base font-black text-cyan-400">
                      {data.bottomRadar.bias.tier2TargetPrice ? `${data.bottomRadar.bias.tier2TargetPrice.toFixed(2)} 元` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-slate-900/80 border border-emerald-500/30">
                    <div>
                      <div className="font-semibold text-emerald-300">區間 3 甜美價 (-8%)</div>
                      <div className="text-[10px] text-slate-400">恐慌極值 · 最佳風險報酬擊球區</div>
                    </div>
                    <span className="font-mono text-base font-black text-emerald-400">
                      {data.bottomRadar.bias.tier3TargetPrice ? `${data.bottomRadar.bias.tier3TargetPrice.toFixed(2)} 元` : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 通用資金紀律指南與備忘錄 */}
              <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl md:col-span-2 space-y-2.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Bookmark className="w-4 h-4 text-amber-400" />
                      大盤落底抄底資金紀律與操作建議
                    </span>
                    <div className="flex items-center gap-2">
                      {savedNotesAlert && (
                        <span className="text-[11px] text-emerald-400 font-semibold animate-pulse">
                          ✓ 已儲存備忘
                        </span>
                      )}
                      {isEditingNotes ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setPersonalNotes(DEFAULT_BOTTOM_BUYING_GUIDELINES)
                              localStorage.removeItem('vestential_capital_notes')
                              setIsEditingNotes(false)
                            }}
                            className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                          >
                            恢復通用建議
                          </button>
                          <button
                            type="button"
                            onClick={saveNotes}
                            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition"
                          >
                            <Save className="w-3 h-3" /> 儲存自訂
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsEditingNotes(true)}
                          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition"
                          title="自訂個人專屬資金紀律筆記"
                        >
                          <Edit3 className="w-3 h-3" /> 自訂備忘
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditingNotes ? (
                    <textarea
                      value={personalNotes}
                      onChange={(e) => setPersonalNotes(e.target.value)}
                      rows={7}
                      className="w-full mt-2 p-2.5 text-xs font-mono bg-slate-900 border border-indigo-500/40 rounded-lg text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 leading-relaxed"
                      placeholder="請輸入您的大盤落底抄底資金紀律提醒..."
                    />
                  ) : (
                    <div className="mt-2 text-xs text-slate-300 leading-relaxed whitespace-pre-line font-mono bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
                      {personalNotes}
                    </div>
                  )}
                </div>

                <div className="text-[11px] text-slate-400 border-t border-slate-800/60 pt-2 flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>
                    核心心法提醒：融資斷頭潮徹底釋放前勿躁進，生存活水備用金絕對不可在下殺段當作攤平籌碼。
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

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
