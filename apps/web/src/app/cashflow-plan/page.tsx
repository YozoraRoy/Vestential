'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Coins, Download, Info, Minus, Plus, RotateCcw, Search, ShieldAlert, Sparkles, Trash2 } from 'lucide-react'
import { WorkspaceBackLink } from '@/components/workspace-back-link'
import { useI18n } from '@/i18n/LanguageProvider'
import type { Locale } from '@/i18n/config'
import { localizePath } from '@/i18n/paths'
import { buildCashflowPlanExportHtml } from '@/lib/cashflow-plan-export'
import {
  CASHFLOW_STYLE_TEMPLATES,
  CASHFLOW_TARGET_PRESETS,
  DEFAULT_CASHFLOW_TARGET,
  evaluateCashflowPlan,
  getPlanAssetDisplayName,
  solveTargetLots,
  type CashflowStyleId,
  type PlanAllocationInput,
  type PlanAssetProfile,
} from '@/lib/cashflow-plan'

const STORAGE_KEY = 'vestential.cashflow-plan.v1'
const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const STYLE_COPY: Record<Locale, Record<CashflowStyleId, { name: string; desc: string }>> = {
  'zh-TW': {
    balanced: { name: '均衡月月領', desc: '高股息季配三巨頭錯開配息月，12 個月現金流最平均' },
    'tech-growth': { name: '科技含息成長', desc: '市值＋半導體＋高息混搭，兼顧股價成長與季度現金流' },
    'low-vol': { name: '高息低波防禦', desc: '低波動與高填息因子配置，適合重視本金穩定之領息族' },
  },
  en: {
    balanced: { name: 'Balanced Monthly', desc: 'Staggered quarterly high-dividend trio for smooth year-round payouts.' },
    'tech-growth': { name: 'Tech Dividend Growth', desc: 'Market-cap + semiconductor + high-yield mix balancing growth & income.' },
    'low-vol': { name: 'Low-Vol Defensive', desc: 'Low-volatility & fast dividend-fill factors tailored for capital stability.' },
  },
  ja: {
    balanced: { name: 'バランス毎月配当', desc: '配当月が異なる高配当ETF3銘柄を組み合わせ、毎月安定した収入を実現。' },
    'tech-growth': { name: 'テック配当成長', desc: '市場指数・半導体・高配当を組み合わせ、値上がりと配当を両立。' },
    'low-vol': { name: '高配当・低ボラ防御', desc: '低ボラティリティと配当落ち回復力重視の安定インカム配分。' },
  },
}

const PAGE_COPY: Record<
  Locale,
  {
    badgeNoLogin: string
    badge54c: string
    exportHtml: string
    resetDefault: string
    pageTitle: string
    pageDesc: string
    loadFailPrefix: string
    loadErrorFallback: string
    step1Title: string
    presetBtn: (amt: number, isDef: boolean) => string
    customLabel: string
    customAria: string
    step2Title: string
    kpiCapital: string
    kpiCapitalSub: string
    kpiMonthlyNet: string
    kpiMonthlyNetSub: (annualNet: string, target: string) => string
    kpiYield: string
    kpiYieldSub: (annualGross: string) => string
    kpiNhi: string
    kpiNhiSub: string
    chartTitle: string
    chartSub: (target: string) => string
    monthLabel: (m: number) => string
    monthDetailTitle: (m: number) => string
    monthDetailTotal: (net: string) => string
    monthDetailEmpty: string
    lotsUnit: string
    adjustTitle: string
    adjustSub: string
    searchPlaceholder: string
    addingText: string
    addBtnText: string
    alreadyInList: (sym: string) => string
    symbolNotFound: (sym: string) => string
    addFailFallback: string
    refPrice: string
    nhiTriggered: (fee: string) => string
    nhiSafeLimit: (lots: number) => string
    insufficientHistory: string
    assetSummaryPre: string
    assetSummaryMid: string
    decLotsAria: (sym: string) => string
    lotsAria: (sym: string) => string
    incLotsAria: (sym: string) => string
    removeAria: (sym: string) => string
    disclaimer1: string
    disclaimer2Pre: string
    disclaimer2Link: string
    disclaimer2Post: string
    customStyleName: string
  }
> = {
  'zh-TW': {
    badgeNoLogin: '免登入試算',
    badge54c: '依 54C 精算二代健保',
    exportHtml: '匯出 HTML 報告',
    resetDefault: '重設預設（月領 4 萬）',
    pageTitle: '股利現金流自由配置 Plan',
    pageDesc:
      '從零開始規劃你的「月月領息退休現金流」：先選擇每月稅後實拿目標（預設 4 萬）與配置風格，再自由微調各檔張數或加入自選台股 ETF，即時估算所需本金與 12 個月實際入帳分佈。',
    loadFailPrefix: '載入即時市價與配息資料失敗：',
    loadErrorFallback: '載入失敗',
    step1Title: '① 選擇每月「稅後實拿」目標現金流',
    presetBtn: (amt, isDef) => `月領 ${amt / 10_000} 萬${isDef ? '（預設）' : ''}`,
    customLabel: '自訂 NT$',
    customAria: '自訂每月目標金額',
    step2Title: '② 一鍵風格範本（套用後仍可下方自由微調）',
    kpiCapital: '預估所需總本金',
    kpiCapitalSub: '依目前即時參考收盤價計算',
    kpiMonthlyNet: '預估月均稅後實拿',
    kpiMonthlyNetSub: (annualNet, target) => `年領稅後 ${annualNet}（目標 ${target}/月）`,
    kpiYield: '預估稅後年殖利率',
    kpiYieldSub: (annualGross) => `年領稅前 ${annualGross}`,
    kpiNhi: '預估年繳二代健保',
    kpiNhiSub: '僅單次 54C ≥ NT$20,000 扣 2.11%',
    chartTitle: '12 個月實際領錢預估分佈（依發放月）',
    chartSub: (target) => `點選月份柱狀可查看該月預計領息明細；虛線為目標月領基準（${target}）`,
    monthLabel: (m) => `${m}月`,
    monthDetailTitle: (m) => `${m} 月領息明細`,
    monthDetailTotal: (net) => `實拿合計：${net}`,
    monthDetailEmpty: '該月份目前配置無預估配息入帳。',
    lotsUnit: '張',
    adjustTitle: '自由調整配置與健保檢視',
    adjustSub: '直接加減張數或新增其他台股 ETF／個股，所有數字將自動記憶於此瀏覽器。',
    searchPlaceholder: '加碼代號如 00929 / 2330',
    addingText: '查詢中…',
    addBtnText: '+ 加入標的',
    alreadyInList: (sym) => `${sym} 已在配置清單中`,
    symbolNotFound: (sym) => `查無 ${sym} 資料`,
    addFailFallback: '新增失敗',
    refPrice: '參考價',
    nhiTriggered: (fee) => `觸及健保門檻（年扣 ${fee}）`,
    nhiSafeLimit: (lots) => `單次免扣安全上限約 ${lots} 張`,
    insufficientHistory: '近 1 年無完整配息紀錄',
    assetSummaryPre: '需本金',
    assetSummaryMid: '· 預估年領稅後',
    decLotsAria: (sym) => `減少 ${sym} 張數`,
    lotsAria: (sym) => `${sym} 張數`,
    incLotsAria: (sym) => `增加 ${sym} 張數`,
    removeAria: (sym) => `移除 ${sym}`,
    disclaimer1:
      '僅為歷史統計與試算參考，非投資建議。配息金額與發放月係依最近 12 個月已公告／實發紀錄統計，未來實際配息、54C 股利所得佔比及二代健保扣費以投信／公司最新公告為準。',
    disclaimer2Pre: '若需管理實際部位，請前往 ',
    disclaimer2Link: '我的投資組合與現金流月曆',
    disclaimer2Post: '。',
    customStyleName: '自訂配置',
  },
  en: {
    badgeNoLogin: 'No Login Required',
    badge54c: '54C NHI Tax Precision',
    exportHtml: 'Export HTML Report',
    resetDefault: 'Reset Default (NT$40k)',
    pageTitle: 'Monthly Dividend Cashflow Planner',
    pageDesc:
      'Plan your monthly dividend retirement cashflow from scratch: pick a monthly post-tax target (default NT$40k) and strategy template, then fine-tune lots or add any TWSE ETF/stock.',
    loadFailPrefix: 'Failed to load market quotes and dividend data: ',
    loadErrorFallback: 'Failed to load',
    step1Title: '1. Select Monthly Net Take-Home Cashflow Target',
    presetBtn: (amt, isDef) => `NT$${amt / 1000}k/mo${isDef ? ' (Default)' : ''}`,
    customLabel: 'Custom NT$',
    customAria: 'Custom monthly target amount',
    step2Title: '2. Strategy Templates (editable below after applying)',
    kpiCapital: 'Est. Required Capital',
    kpiCapitalSub: 'Based on latest reference close price',
    kpiMonthlyNet: 'Est. Monthly Avg (Net)',
    kpiMonthlyNetSub: (annualNet, target) => `Annual Net ${annualNet} (Target ${target}/mo)`,
    kpiYield: 'Est. Net Annual Yield',
    kpiYieldSub: (annualGross) => `Annual Pre-tax ${annualGross}`,
    kpiNhi: 'Est. Annual NHI Fee',
    kpiNhiSub: '2.11% only on single 54C ≥ NT$20,000',
    chartTitle: '12-Month Net Cashflow Distribution (By Pay Month)',
    chartSub: (target) => `Click any bar to inspect monthly payouts; dashed line = target (${target})`,
    monthLabel: (m) => MONTH_NAMES_EN[m - 1] ?? `${m}`,
    monthDetailTitle: (m) => `${MONTH_NAMES_EN[m - 1] ?? m} Payout Details`,
    monthDetailTotal: (net) => `Net Total: ${net}`,
    monthDetailEmpty: 'No projected dividend payouts in this month.',
    lotsUnit: 'lots',
    adjustTitle: 'Customize Lots & NHI Threshold Check',
    adjustSub: 'Adjust lots or add TWSE ETFs/stocks; all changes auto-save in your browser.',
    searchPlaceholder: 'Add ticker e.g. 00929 / 2330',
    addingText: 'Loading…',
    addBtnText: '+ Add Ticker',
    alreadyInList: (sym) => `${sym} is already in your plan`,
    symbolNotFound: (sym) => `No data found for ${sym}`,
    addFailFallback: 'Failed to add ticker',
    refPrice: 'Ref',
    nhiTriggered: (fee) => `NHI triggered (-${fee}/yr)`,
    nhiSafeLimit: (lots) => `Safe max ~${lots} lots/payout`,
    insufficientHistory: 'Insufficient 1Y dividend history',
    assetSummaryPre: 'Capital',
    assetSummaryMid: '· Est. Annual Net',
    decLotsAria: (sym) => `Decrease ${sym} lots`,
    lotsAria: (sym) => `${sym} lots`,
    incLotsAria: (sym) => `Increase ${sym} lots`,
    removeAria: (sym) => `Remove ${sym}`,
    disclaimer1:
      'For historical simulation and educational reference only, not investment advice. Projections use trailing 12-month official dividends; actual payouts and 54C ratios follow issuer announcements.',
    disclaimer2Pre: 'To track your real holdings, visit ',
    disclaimer2Link: 'My Portfolio & Dividend Calendar',
    disclaimer2Post: '.',
    customStyleName: 'Custom Plan',
  },
  ja: {
    badgeNoLogin: 'ログイン不要で試算',
    badge54c: '54C 二代健保精密試算',
    exportHtml: 'HTML レポート出力',
    resetDefault: '初期設定へ（月4万元）',
    pageTitle: '月次配当キャッシュフロー自由配分 Plan',
    pageDesc:
      'ゼロから「毎月配当キャッシュフロー」を設計：月間手取り目標（初期設定4万元）と配分スタイルを選び、銘柄数や保有枚数を調整して必要元本と12ヶ月の受取分布を即時試算できます。',
    loadFailPrefix: '株価および配当データの読み込みに失敗しました：',
    loadErrorFallback: '読み込み失敗',
    step1Title: '① 月間「手取り」配当目標を選択',
    presetBtn: (amt, isDef) => `月${amt / 10_000}万${isDef ? '（初期）' : ''}`,
    customLabel: '任意 NT$',
    customAria: '任意の月間目標金額',
    step2Title: '② 配分スタイル（適用後も下で自由に微調整可能）',
    kpiCapital: '必要投資元本見込',
    kpiCapitalSub: '最新の参考終値ベースで算出',
    kpiMonthlyNet: '月平均手取り見込',
    kpiMonthlyNetSub: (annualNet, target) => `年間手取り ${annualNet}（目標 ${target}/月）`,
    kpiYield: '実質年間配当利回り',
    kpiYieldSub: (annualGross) => `年間税引前 ${annualGross}`,
    kpiNhi: '年間二代健保保険料見込',
    kpiNhiSub: '1回の 54C ≥ NT$20,000 のみ 2.11% 課徴',
    chartTitle: '1〜12月 手取り受取見込分布（支払月基準）',
    chartSub: (target) => `月の棒グラフをクリックすると内訳を表示します；破線＝目標（${target}）`,
    monthLabel: (m) => `${m}月`,
    monthDetailTitle: (m) => `${m}月 配当内訳`,
    monthDetailTotal: (net) => `手取り合計：${net}`,
    monthDetailEmpty: 'この月の配当予定はありません。',
    lotsUnit: '枚',
    adjustTitle: '保有枚数の調整と二代健保チェック',
    adjustSub: '枚数を増減または他の台湾株ETF/個別株を追加でき、ブラウザに自動保存されます。',
    searchPlaceholder: '銘柄追加 例: 00929 / 2330',
    addingText: '検索中…',
    addBtnText: '+ 銘柄追加',
    alreadyInList: (sym) => `${sym} は既に追加されています`,
    symbolNotFound: (sym) => `${sym} のデータが見つかりません`,
    addFailFallback: '追加に失敗しました',
    refPrice: '参考値',
    nhiTriggered: (fee) => `健保課徴対象（年 -${fee}）`,
    nhiSafeLimit: (lots) => `免除安全上限 約 ${lots} 枚`,
    insufficientHistory: '直近1年の配当実績不足',
    assetSummaryPre: '必要元本',
    assetSummaryMid: '· 年間手取り見込',
    decLotsAria: (sym) => `${sym} の枚数を減らす`,
    lotsAria: (sym) => `${sym} の枚数`,
    incLotsAria: (sym) => `${sym} の枚数を増やす`,
    removeAria: (sym) => `${sym} を削除`,
    disclaimer1:
      '過去の配当実績に基づく参考試算であり、投資助言ではありません。実際の配当金額・54C比率・二代健保課徴は運用会社等の公式発表に準じます。',
    disclaimer2Pre: '実際の保有資産を管理する場合は ',
    disclaimer2Link: 'ポートフォリオ・配当カレンダー',
    disclaimer2Post: ' をご利用ください。',
    customStyleName: 'カスタム配分',
  },
}

interface SavedPlanState {
  targetMonthly: number
  styleId: CashflowStyleId
  items: Array<{ symbol: string; lots: number; profile?: PlanAssetProfile }>
}

function fmtNtd(n: number): string {
  return `NT$${Math.round(n).toLocaleString('en-US')}`
}

export default function CashflowPlanPage() {
  const { locale } = useI18n()
  const t = PAGE_COPY[locale] ?? PAGE_COPY['zh-TW']
  const styleText = STYLE_COPY[locale] ?? STYLE_COPY['zh-TW']

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
        if (!cancelled) setLoadError(e instanceof Error ? e.message : t.loadErrorFallback)
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
    const styleName = styleText[styleId]?.name ?? t.customStyleName
    const html = buildCashflowPlanExportHtml({ evaluation, styleName, locale })
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
      setAddError(t.alreadyInList(clean))
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
        throw new Error(json?.error || t.symbolNotFound(clean))
      }
      const prof = json.profile as PlanAssetProfile
      setProfiles((prev) => ({ ...prev, [prof.symbol]: prof }))
      setAllocations((prev) => [...prev, { asset: prof, lots: 1 }])
      setAddSymbol('')
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : t.addFailFallback)
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
            {t.badgeNoLogin}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">
            {t.badge54c}
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
            {t.exportHtml}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-white/10 hover:text-[var(--text-primary)] transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t.resetDefault}
          </button>
        </div>
      </div>

      <h1 className="text-3xl font-bold mb-2">{t.pageTitle}</h1>
      <div className="mb-4 w-16 h-1 rounded-full bg-gradient-to-r from-[var(--accent-green)] to-[var(--accent)]" />
      <p className="max-w-2xl text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
        {t.pageDesc}
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
          {t.loadFailPrefix}
          {loadError}
        </div>
      ) : (
        <div className="space-y-6">
          {/* 控制區：目標月領 ＋ 風格範本 */}
          <div className="rounded-2xl border border-white/10 bg-[var(--bg-card)] p-5 space-y-5">
            <div>
              <div className="text-xs font-semibold text-[var(--text-secondary)] mb-2.5">
                {t.step1Title}
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
                      {t.presetBtn(amt, amt === DEFAULT_CASHFLOW_TARGET)}
                    </button>
                  )
                })}
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-xs text-[var(--text-secondary)]">{t.customLabel}</span>
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
                    aria-label={t.customAria}
                    className="w-28 rounded-lg border border-white/10 bg-[var(--bg-secondary)] px-2.5 py-1.5 text-sm font-mono text-[var(--text-primary)]"
                  />
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-[var(--text-secondary)] mb-2.5 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
                {t.step2Title}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {CASHFLOW_STYLE_TEMPLATES.map((tpl) => {
                  const active = styleId === tpl.id
                  const tplCopy = styleText[tpl.id]
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
                        <span className="text-sm font-bold text-[var(--text-primary)]">{tplCopy?.name ?? tpl.name}</span>
                        <span className="text-[11px] font-mono text-[var(--accent)]">
                          {tpl.allocations.map((a) => a.symbol).join(' · ')}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{tplCopy?.desc ?? tpl.desc}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 核心指標 4 格 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-white/5 bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-secondary)]">{t.kpiCapital}</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-[var(--text-primary)]">
                {fmtNtd(evaluation.totalCapital)}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{t.kpiCapitalSub}</div>
            </div>

            <div className="rounded-2xl border border-emerald-500/20 bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-secondary)]">{t.kpiMonthlyNet}</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-emerald-400">
                {fmtNtd(evaluation.monthlyAvgNet)}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--text-secondary)] tabular-nums">
                {t.kpiMonthlyNetSub(fmtNtd(evaluation.annualNet), fmtNtd(targetMonthly))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-secondary)]">{t.kpiYield}</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-[var(--accent)]">
                {evaluation.portfolioYieldPct.toFixed(2)}%
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--text-secondary)] tabular-nums">
                {t.kpiYieldSub(fmtNtd(evaluation.annualGross))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-[var(--bg-card)] p-4">
              <div className="text-xs text-[var(--text-secondary)]">{t.kpiNhi}</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-amber-300">
                {fmtNtd(evaluation.annualNhiFee)}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                {t.kpiNhiSub}
              </div>
            </div>
          </div>

          {/* 12 個月實際領錢分佈長條圖 */}
          <div className="rounded-2xl border border-white/5 bg-[var(--bg-card)] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-[var(--text-primary)]">{t.chartTitle}</h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  {t.chartSub(fmtNtd(targetMonthly))}
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
                        {t.monthLabel(m.month)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {activeMonth !== null && (
              <div className="rounded-xl border border-white/10 bg-[var(--bg-secondary)]/60 p-3.5 text-xs space-y-2">
                <div className="flex items-center justify-between font-semibold text-[var(--text-primary)]">
                  <span>{t.monthDetailTitle(activeMonth)}</span>
                  <span>{t.monthDetailTotal(fmtNtd(evaluation.months[activeMonth - 1]?.net ?? 0))}</span>
                </div>
                {(evaluation.months[activeMonth - 1]?.items.length ?? 0) === 0 ? (
                  <p className="text-[var(--text-secondary)]">{t.monthDetailEmpty}</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {evaluation.months[activeMonth - 1]!.items.map((it, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                        <span>
                          <a
                            href={localizePath(locale, `/dividend-refill?symbol=${encodeURIComponent(it.symbol)}`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-bold text-[var(--accent)] hover:underline"
                          >
                            {it.symbol}
                          </a>{' '}
                          {getPlanAssetDisplayName(it.symbol, it.name, it.names, locale)}（{it.lots} {t.lotsUnit}）
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
                <h2 className="text-base font-bold text-[var(--text-primary)]">{t.adjustTitle}</h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  {t.adjustSub}
                </p>
              </div>
              <form onSubmit={handleAddSymbol} className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                  <input
                    value={addSymbol}
                    onChange={(e) => setAddSymbol(e.target.value)}
                    placeholder={t.searchPlaceholder}
                    className="pl-8 pr-3 py-1.5 w-48 rounded-lg border border-white/10 bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={adding}
                  className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {adding ? t.addingText : t.addBtnText}
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
                        <a
                          href={localizePath(locale, `/dividend-refill?symbol=${encodeURIComponent(a.symbol)}`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--accent)] hover:underline"
                        >
                          {a.symbol}
                        </a>{' '}
                        {getPlanAssetDisplayName(a.symbol, a.name, a.names, locale)}
                      </span>
                      <span className="text-xs text-[var(--text-secondary)] tabular-nums">
                        {t.refPrice} {a.price.toFixed(2)}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-white/5 text-[10px] text-[var(--text-secondary)]">
                        54C {Math.round(a.dividend54cRatio * 100)}%
                      </span>
                      {a.nhiTriggered ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] font-medium">
                          <ShieldAlert className="w-3 h-3" />
                          {t.nhiTriggered(fmtNtd(a.annualNhiFee))}
                        </span>
                      ) : a.safeMaxLots !== null ? (
                        <span className="text-[10px] text-emerald-400/90">
                          {t.nhiSafeLimit(a.safeMaxLots)}
                        </span>
                      ) : null}
                      {a.insufficientHistory ? (
                        <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 text-[10px]">
                          {t.insufficientHistory}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] tabular-nums">
                      {t.assetSummaryPre} {fmtNtd(a.capital)} {t.assetSummaryMid}{' '}
                      <span className="text-emerald-400 font-semibold">{fmtNtd(a.annualNet)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-center">
                    <button
                      type="button"
                      onClick={() => updateLots(a.symbol, a.lots - 1)}
                      aria-label={t.decLotsAria(a.symbol)}
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
                      aria-label={t.lotsAria(a.symbol)}
                      className="w-16 text-center rounded-lg border border-white/10 bg-[var(--bg-secondary)] py-1 text-sm font-mono font-bold text-[var(--text-primary)]"
                    />
                    <span className="text-xs text-[var(--text-secondary)]">{t.lotsUnit}</span>
                    <button
                      type="button"
                      onClick={() => updateLots(a.symbol, a.lots + 1)}
                      aria-label={t.incLotsAria(a.symbol)}
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[var(--text-primary)]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSymbol(a.symbol)}
                      aria-label={t.removeAria(a.symbol)}
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
          <span>{t.disclaimer1}</span>
        </p>
        <p>
          {t.disclaimer2Pre}
          <Link href={localizePath(locale, '/portfolio')} className="underline hover:text-[var(--text-primary)]">
            {t.disclaimer2Link}
          </Link>
          {t.disclaimer2Post}
        </p>
      </div>
    </div>
  )
}
