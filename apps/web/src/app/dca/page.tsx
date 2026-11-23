'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Calculator, HelpCircle, Download, Share2, Save, PiggyBank, TrendingUp, Info } from 'lucide-react'
import { normalizeStockCode } from '@stock/core'
import { DCA_PRESET_SYMBOLS } from '@/lib/dca'
import { displayStockLabel } from '@/lib/stock-display'
import { useStockNames } from '@/lib/use-stock-names'
import { useI18n } from '@/i18n/LanguageProvider'
import { localizePath } from '@/i18n/paths'
import type { Locale } from '@/i18n/config'

const DCA_COPY: Record<
  Locale,
  {
    errSymbol: string
    errMonthly: string
    errSim: string
    errSave: string
    noticeSaved: string
    shareTitle: string
    shareText: (s?: string) => string
    title: string
    subtitle: string
    labelSymbol: string
    placeholderSymbol: string
    labelMonthly: string
    labelPeriod: string
    yrSuffix: string
    labelDivMode: string
    reinvest: string
    cashOut: string
    labelFees: string
    feeHelp: string
    withFees: string
    noFees: string
    running: string
    runBtn: string
    invested: string
    monthsUnit: string
    sharesUnit: string
    totalValue: string
    endPrice: string
    grossReturn: string
    grossHelp: string
    grossSub: string
    divBoost: (reinvest: boolean) => string
    divHelp: string
    divSubReinvest: string
    divSubCash: (amt: string) => string
    totalReturn: string
    annualized: string
    savingsCompare: (rate: string) => string
    savingsMulti: (x: string) => string
    feeSummary: (disc: string, isEtf: boolean) => string
    feeBreakdown: (b: string, s: string, t: string, net: string) => string
    noFeesLabel: string
    maxDdMonth: string
    noDrawdown: string
    formulaNote: string
    shareCardTitle: string
    shareBtn: string
    downloadBtn: string
    savingBtn: string
    saveBtn: string
    myPlansTitle: string
    planSummary: (amt: string, yr: number, isCash: boolean) => string
    planDisclaimer: string
    disclaimerPre: string
    savingsRateNote: (r: string) => string
    feeDiscountNote: (d: string) => string
    termsPre: string
    termsLink: string
  }
> = {
  'zh-TW': {
    errSymbol: '請輸入正確的台股代號（如 0050）',
    errMonthly: '每月金額需介於 1,000～1,000,000 元',
    errSim: '試算失敗',
    errSave: '儲存計畫失敗',
    noticeSaved: '已儲存計畫（與真實持倉分開存放，可回來對帳）',
    shareTitle: '零股存股試算',
    shareText: (s) => `${s ?? ''} 存股試算結果`,
    title: '零股存股試算所',
    subtitle: '每月扣 N 元買某檔，X 年後大概多少？含股利再投入差多少？跟放定存差幾倍？以下為歷史回測試算。',
    labelSymbol: '標的（單檔台股）',
    placeholderSymbol: '如 0050',
    labelMonthly: '每月金額（元）',
    labelPeriod: '期間',
    yrSuffix: '年',
    labelDivMode: '股利處理',
    reinvest: '股利再投入',
    cashOut: '領現',
    labelFees: '手續費/證交稅',
    feeHelp: '手續費 0.1425%×折讓，買賣各計、不足 NT$20 以 20 計；證交稅賣出時扣（ETF 0.1%／個股 0.3%）。',
    withFees: '含稅費',
    noFees: '不含稅費',
    running: '試算中…',
    runBtn: '開始試算',
    invested: '投入本金',
    monthsUnit: '個月',
    sharesUnit: '股',
    totalValue: '期末總值（含股利）',
    endPrice: '期末價',
    grossReturn: '總報酬（裸價差）',
    grossHelp: '(期末市值_不含股利 − 投入本金) / 投入本金 × 100%',
    grossSub: '不含股利的價差報酬',
    divBoost: (r) => `股利${r ? '再投入' : '領現'}加成`,
    divHelp: '股利加成（百分點）：(期末總值 − 期末市值_不含股利) / 投入本金 × 100%。',
    divSubReinvest: '按除息日再投入買入',
    divSubCash: (amt) => `累積現金股利 ${amt}`,
    totalReturn: '含股利總報酬',
    annualized: '簡化年化',
    savingsCompare: (rate) => `定存對照（年利率 ${rate}%，月利＝年利率/12）`,
    savingsMulti: (x) => ` · 存股約 ${x} 倍`,
    feeSummary: (disc, isEtf) => `稅費（折讓 ${disc}% · ${isEtf ? 'ETF 稅率 0.1%' : '個股稅率 0.3%'}）`,
    feeBreakdown: (b, s, t, net) => `買入 ${b}＋賣出 ${s}＋稅 ${t} · 淨值 ${net}`,
    noFeesLabel: '未含稅費',
    maxDdMonth: '最大回撤月份',
    noDrawdown: '無回撤',
    formulaNote: '買入價為還原權值（adjclose）逐月首個交易日收盤，零股可小數持有，手續費外加不扣減股數。',
    shareCardTitle: '複利圖卡分享',
    shareBtn: '分享圖卡',
    downloadBtn: '下載圖卡',
    savingBtn: '儲存中…',
    saveBtn: '儲存計畫',
    myPlansTitle: '我的存股計畫（與真實持倉分開存放）',
    planSummary: (amt, yr, isCash) => `每月 ${amt} × ${yr} 年 · ${isCash ? '領現' : '再投入'}`,
    planDisclaimer: '計畫僅為試算紀錄，不會出現在 /portfolio 持倉列表與損益中；每月對帳請以券商實際扣款為準。',
    disclaimerPre: '本頁為歷史回測試算，不代表未來表現，亦非投資建議。價格採 Yahoo 還原權值，股息採 TWSE 除息快取。',
    savingsRateNote: (r) => `定存年利率 ${r}%（後台可調）。`,
    feeDiscountNote: (d) => `手續費折讓 ${d}%。`,
    termsPre: '使用即代表同意 ',
    termsLink: '服務條款',
  },
  en: {
    errSymbol: 'Enter a valid TWSE ticker (e.g. 0050)',
    errMonthly: 'Monthly amount must be between NT$1,000 and NT$1,000,000',
    errSim: 'Simulation failed',
    errSave: 'Failed to save plan',
    noticeSaved: 'Plan saved separately from real holdings.',
    shareTitle: 'TWSE Odd-Lot DCA Simulator',
    shareText: (s) => `${s ?? ''} DCA Simulation`,
    title: 'Odd-Lot DCA Simulator',
    subtitle: 'See how monthly DCA contributions compound over 1–10 years with dividend reinvestment vs. cash and bank savings.',
    labelSymbol: 'Ticker (TWSE)',
    placeholderSymbol: 'e.g. 0050',
    labelMonthly: 'Monthly Amount (NT$)',
    labelPeriod: 'Horizon',
    yrSuffix: 'Y',
    labelDivMode: 'Dividends',
    reinvest: 'DRIP (Reinvest)',
    cashOut: 'Cash Payout',
    labelFees: 'Fees & Tax',
    feeHelp: '0.1425% × discount commission (min NT$20), plus TWSE sell tax (0.1% ETF / 0.3% stock).',
    withFees: 'Incl. Fees/Tax',
    noFees: 'Gross (No Fees)',
    running: 'Simulating…',
    runBtn: 'Run DCA Backtest',
    invested: 'Total Invested',
    monthsUnit: 'mo',
    sharesUnit: 'sh',
    totalValue: 'Ending Value (Incl. Div)',
    endPrice: 'End Price',
    grossReturn: 'Price Return Only',
    grossHelp: '(Ending Market Value ex-div − Invested) / Invested × 100%',
    grossSub: 'Capital gain excluding dividends',
    divBoost: (r) => `Dividend ${r ? 'Reinvest' : 'Cash'} Boost`,
    divHelp: 'Additional percentage-point return contributed by dividends.',
    divSubReinvest: 'Reinvested on ex-dividend dates',
    divSubCash: (amt) => `Cash dividends ${amt}`,
    totalReturn: 'Total Return',
    annualized: 'Approx. CAGR',
    savingsCompare: (rate) => `Bank Savings (${rate}% APR)`,
    savingsMulti: (x) => ` · ${x}x vs Savings`,
    feeSummary: (disc, isEtf) => `Fees & Tax (${disc}% disc · ${isEtf ? 'ETF 0.1%' : 'Stock 0.3%'})`,
    feeBreakdown: (b, s, t, net) => `Buy ${b} + Sell ${s} + Tax ${t} · Net ${net}`,
    noFeesLabel: 'Excluded',
    maxDdMonth: 'Max Drawdown Month',
    noDrawdown: 'None',
    formulaNote: 'Buys occur on the first trading day each month using adjusted close prices; fractional odd-lot shares supported.',
    shareCardTitle: 'Share Result Card',
    shareBtn: 'Share Card',
    downloadBtn: 'Download Card',
    savingBtn: 'Saving…',
    saveBtn: 'Save Plan',
    myPlansTitle: 'My Saved DCA Plans',
    planSummary: (amt, yr, isCash) => `${amt}/mo × ${yr}Y · ${isCash ? 'Cash' : 'Reinvest'}`,
    planDisclaimer: 'Simulation records only; separated from /portfolio real positions.',
    disclaimerPre: 'Historical backtest only, not investment advice. Adjusted prices from Yahoo Finance; dividends from TWSE cache. ',
    savingsRateNote: (r) => `Benchmark savings APR ${r}%. `,
    feeDiscountNote: (d) => `Fee discount ${d}%. `,
    termsPre: 'By using this tool, you agree to our ',
    termsLink: 'Terms of Service',
  },
  ja: {
    errSymbol: '有効な台湾株コードを入力してください（例：0050）',
    errMonthly: '積立金額は NT$1,000〜1,000,000 の範囲で入力してください',
    errSim: '試算に失敗しました',
    errSave: 'プランの保存に失敗しました',
    noticeSaved: '積立プランを保存しました（保有資産とは別管理）',
    shareTitle: '台湾株 積立シミュレーション',
    shareText: (s) => `${s ?? ''} 積立試算結果`,
    title: '単元未満株 積立シミュレーター',
    subtitle: '毎月定額積立による配当再投資・現金受取・銀行定期預金との比較を過去データで試算します。',
    labelSymbol: '銘柄（台湾株）',
    placeholderSymbol: '例: 0050',
    labelMonthly: '毎月積立額（元）',
    labelPeriod: '期間',
    yrSuffix: '年',
    labelDivMode: '配当処理',
    reinvest: '配当再投資',
    cashOut: '現金受取',
    labelFees: '手数料・税金',
    feeHelp: '売買手数料 0.1425%×割引（最低 NT$20）＋売却時取引税（ETF 0.1%／個別株 0.3%）。',
    withFees: '税・手数料込',
    noFees: '税・手数料抜',
    running: '試算中…',
    runBtn: '試算を実行',
    invested: '積立元本',
    monthsUnit: 'ヶ月',
    sharesUnit: '株',
    totalValue: '期末評価額（配当込）',
    endPrice: '期末株価',
    grossReturn: '値上がり益率',
    grossHelp: '(配当除き時価 − 元本) / 元本 × 100%',
    grossSub: '配当を除いた価格リターン',
    divBoost: (r) => `配当${r ? '再投資' : '受取'}上乗せ効果`,
    divHelp: '配当によるリターン上乗せ（パーセンテージポイント）。',
    divSubReinvest: '権利落日に自動再投資',
    divSubCash: (amt) => `累計現金配当 ${amt}`,
    totalReturn: 'トータルリターン',
    annualized: '年率換算',
    savingsCompare: (rate) => `定期預金比較（年利 ${rate}%）`,
    savingsMulti: (x) => ` · 預金の約 ${x} 倍`,
    feeSummary: (disc, isEtf) => `手数料・税金（割引 ${disc}% · ${isEtf ? 'ETF 0.1%' : '株 0.3%'}）`,
    feeBreakdown: (b, s, t, net) => `買付 ${b}＋売却 ${s}＋税 ${t} · 純額 ${net}`,
    noFeesLabel: '含めない',
    maxDdMonth: '最大ドローダウン月',
    noDrawdown: 'なし',
    formulaNote: '調整後終値に基づき毎月第1営業日に買付。単元未満株の端数保有に対応。',
    shareCardTitle: '結果カード共有',
    shareBtn: 'シェア',
    downloadBtn: '画像保存',
    savingBtn: '保存中…',
    saveBtn: 'プラン保存',
    myPlansTitle: '保存済み積立プラン',
    planSummary: (amt, yr, isCash) => `毎月 ${amt} × ${yr}年 · ${isCash ? '現金受取' : '再投資'}`,
    planDisclaimer: '試算用メモであり、/portfolio の実保有残高には影響しません。',
    disclaimerPre: '過去データに基づく試算であり投資助言ではありません。',
    savingsRateNote: (r) => `定期預金年利 ${r}%。`,
    feeDiscountNote: (d) => `手数料割引 ${d}%。`,
    termsPre: 'ご利用にあたり ',
    termsLink: '利用規約',
  },
}

// Issue #69：零股存股試算所（/dca，手機優先單頁）。
// 文案紅線：僅歷史回測＋免責，禁「預測/保證」字眼。

interface DcaResult {
  symbol: string
  dividendMode: 'reinvest' | 'cash'
  includeFees: boolean
  feeDiscount: number
  nMonths: number
  invested: number
  shares: number
  endPrice: number
  endDate: string
  marketValue: number
  baselineMarketValue: number
  cashDividends: number
  totalValue: number
  grossReturnPct: number
  divBoostPp: number
  totalReturnPct: number
  annualizedPct: number
  buyFeesTotal: number
  sellFee: number
  tax: number
  taxRate: number
  isEtf: boolean
  netTotal: number
  netReturnPct: number
  maxDrawdownMonth: string | null
  maxDrawdownPct: number | null
  savingsValue: number
  savingsAnnualRate: number
  savingsMultiple: number | null
}

interface DcaPlan {
  id: number
  symbol: string
  symbol_name: string | null
  monthly_amount: number
  years: number
  dividend_mode: string
  include_fees: number
  created_at?: string
}

function fmtTWD(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `NT$${Math.round(n).toLocaleString('en-US')}`
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function track(event: 'dca_page_view' | 'dca_share', symbol?: string) {
  try {
    fetch('/api/dca/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, symbol: symbol ?? null }),
      keepalive: true,
    }).catch(() => {})
  } catch {}
}

/** 「？」公式 tooltip（沿 backtest/page.tsx:160 HelpCell 模式）。 */
function Help({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center ml-1.5 group/help">
      <HelpCircle className="w-3.5 h-3.5 text-[var(--text-secondary)] cursor-help" />
      <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 z-30 w-64 hidden group-hover/help:block p-3 rounded-lg bg-[var(--bg-card)] border border-white/10 shadow-xl text-[11px] leading-relaxed text-[var(--text-primary)] font-normal text-left">
        {text}
      </span>
    </span>
  )
}

export default function DcaPage() {
  const { locale } = useI18n()
  const t = DCA_COPY[locale] ?? DCA_COPY['zh-TW']
  const [symbol, setSymbol] = useState('0050')
  const [monthly, setMonthly] = useState('5000')
  const [years, setYears] = useState<1 | 3 | 5 | 10>(5)
  const [mode, setMode] = useState<'reinvest' | 'cash'>('reinvest')
  const [fees, setFees] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DcaResult | null>(null)
  const [savingsRate, setSavingsRate] = useState<number | null>(null)
  const [feeDiscount, setFeeDiscount] = useState<number | null>(null)
  const [plans, setPlans] = useState<DcaPlan[]>([])
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const dcaAllSymbols = useMemo(
    () => [...DCA_PRESET_SYMBOLS, ...plans.map((p) => p.symbol)],
    [plans],
  )
  const stockNames = useStockNames(dcaAllSymbols)

  useEffect(() => {
    track('dca_page_view')
    ;(async () => {
      try {
        const res = await fetch('/api/dca/config')
        const data = await res.json()
        if (typeof data?.savingsRate === 'number') setSavingsRate(data.savingsRate)
        if (typeof data?.feeDiscount === 'number') setFeeDiscount(data.feeDiscount)
      } catch {}
    })()
    void fetchPlans()
  }, [])

  const fetchPlans = async () => {
    try {
      const res = await fetch('/api/dca/plans')
      const data = await res.json()
      if (data?.success && Array.isArray(data.plans)) setPlans(data.plans)
    } catch {}
  }

  const run = async () => {
    const sym = symbol.trim().toUpperCase()
    if (!/^\d{4,6}[A-Z0-9]{0,2}$/.test(sym)) {
      setError(t.errSymbol)
      return
    }
    const m = Number(monthly)
    if (!Number.isFinite(m) || m < 1000 || m > 1000000) {
      setError(t.errMonthly)
      return
    }
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const qs = new URLSearchParams({
        symbol: sym, monthly: String(m), years: String(years),
        mode, fees: fees ? '1' : '0',
      })
      const res = await fetch(`/api/dca/simulate?${qs.toString()}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? t.errSim)
        return
      }
      setResult(data.result as DcaResult)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.errSim)
    } finally {
      setLoading(false)
    }
  }

  const savePlan = async () => {
    if (saving) return
    const sym = symbol.trim().toUpperCase()
    const m = Number(monthly)
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/dca/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, monthlyAmount: m, years, dividendMode: mode, includeFees: fees }),
      })
      const data = await res.json()
      if (!res.ok || !data?.success) {
        setError(data?.error ?? t.errSave)
        return
      }
      setNotice(t.noticeSaved)
      await fetchPlans()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.errSave)
    } finally {
      setSaving(false)
    }
  }

  const ogUrl = result
    ? `/api/social/og?type=dca&symbol=${encodeURIComponent(result.symbol)}&monthly=${encodeURIComponent(monthly)}&years=${years}&invested=${Math.round(result.invested)}&value=${Math.round(result.totalValue)}&boost=${result.divBoostPp.toFixed(2)}&ret=${result.totalReturnPct.toFixed(2)}`
    : null

  const handleShare = async () => {
    track('dca_share', result?.symbol)
    if (!ogUrl) return
    try {
      if (navigator.share) {
        await navigator.share({ title: t.shareTitle, text: t.shareText(result?.symbol), url: ogUrl })
        return
      }
    } catch {}
    window.open(ogUrl, '_blank')
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="flex items-center gap-3 mb-2">
        <PiggyBank className="w-7 h-7 text-[var(--accent)]" />
        <h1 className="text-2xl font-bold">{t.title}</h1>
      </div>
      <p className="text-[var(--text-secondary)] mb-8">
        {t.subtitle}
      </p>

      {/* 輸入區 */}
      <div className="mb-8 rounded-2xl bg-[var(--bg-card)] border border-white/5 p-5 md:p-6 shadow-xl space-y-5">
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t.labelSymbol}</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder={t.placeholderSymbol}
              inputMode="numeric"
              className="flex-1 h-11 px-3 rounded-xl bg-[var(--bg-secondary)] border border-white/10 focus:border-[var(--accent)] outline-none text-sm"
            />
            <div className="flex gap-2">
              {DCA_PRESET_SYMBOLS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSymbol(s)}
                  className={`h-11 px-4 rounded-xl border text-sm font-medium transition ${symbol === s ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]' : 'border-white/10 bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
                >
                  {displayStockLabel(s, locale, { names: stockNames[normalizeStockCode(s)] })}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t.labelMonthly}</span>
            <input
              type="number" min={1000} max={1000000} value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-[var(--bg-secondary)] border border-white/10 focus:border-[var(--accent)] outline-none text-sm"
            />
          </label>
          <div>
            <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t.labelPeriod}</span>
            <div className="grid grid-cols-4 gap-1.5">
              {([1, 3, 5, 10] as const).map((y) => (
                <button
                  key={y} type="button" onClick={() => setYears(y)}
                  className={`h-11 rounded-xl border text-sm font-medium transition ${years === y ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]' : 'border-white/10 bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
                >
                  {y} {t.yrSuffix}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t.labelDivMode}</span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button" onClick={() => setMode('reinvest')}
                className={`h-11 rounded-xl border text-sm font-medium transition ${mode === 'reinvest' ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]' : 'border-white/10 bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
              >
                {t.reinvest}
              </button>
              <button
                type="button" onClick={() => setMode('cash')}
                className={`h-11 rounded-xl border text-sm font-medium transition ${mode === 'cash' ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]' : 'border-white/10 bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
              >
                {t.cashOut}
              </button>
            </div>
          </div>
          <div>
            <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {t.labelFees}
              <Help text={t.feeHelp} />
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button" onClick={() => setFees(true)}
                className={`h-11 rounded-xl border text-sm font-medium transition ${fees ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]' : 'border-white/10 bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
              >
                {t.withFees}
              </button>
              <button
                type="button" onClick={() => setFees(false)}
                className={`h-11 rounded-xl border text-sm font-medium transition ${!fees ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]' : 'border-white/10 bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
              >
                {t.noFees}
              </button>
            </div>
          </div>
        </div>
        <button
          type="button" onClick={run} disabled={loading}
          className="w-full h-12 rounded-xl bg-[var(--accent)] text-white font-medium text-sm hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 transition"
        >
          <Calculator className="w-4 h-4" />
          {loading ? t.running : t.runBtn}
        </button>
        {error && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
        )}
        {notice && (
          <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">{notice}</div>
        )}
      </div>

      {/* 結果區 */}
      {result && (
        <div className="space-y-6 mb-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-white/5">
              <div className="text-[var(--text-secondary)] text-xs mb-2">{t.invested}</div>
              <div className="text-2xl font-bold">{fmtTWD(result.invested)}</div>
              <div className="text-xs text-[var(--text-secondary)] mt-1">{result.nMonths} {t.monthsUnit} · {result.shares.toFixed(2)} {t.sharesUnit}</div>
            </div>
            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-white/5">
              <div className="text-[var(--text-secondary)] text-xs mb-2">{t.totalValue}</div>
              <div className="text-2xl font-bold text-[var(--accent-green)]">{fmtTWD(result.totalValue)}</div>
              <div className="text-xs text-[var(--text-secondary)] mt-1">{t.endPrice} {result.endPrice.toFixed(2)}（{result.endDate}）</div>
            </div>
            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-white/5">
              <div className="text-[var(--text-secondary)] text-xs mb-2 flex items-center">
                {t.grossReturn}
                <Help text={t.grossHelp} />
              </div>
              <div className="text-2xl font-bold text-[var(--accent)]">{fmtPct(result.grossReturnPct)}</div>
              <div className="text-xs text-[var(--text-secondary)] mt-1">{t.grossSub}</div>
            </div>
            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-white/5">
              <div className="text-[var(--text-secondary)] text-xs mb-2 flex items-center">
                {t.divBoost(result.dividendMode === 'reinvest')}
                <Help text={t.divHelp} />
              </div>
              <div className="text-2xl font-bold text-[var(--accent-green)]">{fmtPct(result.divBoostPp)}</div>
              <div className="text-xs text-[var(--text-secondary)] mt-1">
                {result.dividendMode === 'reinvest' ? t.divSubReinvest : t.divSubCash(fmtTWD(result.cashDividends))}
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">{t.totalReturn}</span>
              <span className="font-semibold">{fmtPct(result.totalReturnPct)}（{t.annualized} {fmtPct(result.annualizedPct)}）</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">{t.savingsCompare(((result.savingsAnnualRate) * 100).toFixed(2))}</span>
              <span className="font-semibold">{fmtTWD(result.savingsValue)}{result.savingsMultiple != null ? t.savingsMulti(result.savingsMultiple.toFixed(2)) : ''}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">{t.feeSummary(String(Math.round(result.feeDiscount * 100)), result.isEtf)}</span>
              <span className="font-semibold">
                {result.includeFees
                  ? t.feeBreakdown(fmtTWD(result.buyFeesTotal), fmtTWD(result.sellFee), fmtTWD(result.tax), fmtTWD(result.netTotal))
                  : t.noFeesLabel}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">{t.maxDdMonth}</span>
              <span className="font-semibold">
                {result.maxDrawdownMonth ? `${result.maxDrawdownMonth}（${fmtPct(result.maxDrawdownPct)}）` : t.noDrawdown}
              </span>
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed pt-1">
              {t.formulaNote}
            </p>
          </div>

          {/* 圖卡分享 */}
          <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Share2 className="w-4 h-4 text-[var(--accent)]" />
              <h2 className="text-sm font-semibold">{t.shareCardTitle}</h2>
            </div>
            {ogUrl && (
              <img src={ogUrl} alt={t.shareCardTitle} className="w-full max-w-md rounded-xl border border-white/10 mb-3" loading="lazy" />
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button" onClick={handleShare}
                className="h-10 px-4 rounded-xl bg-[var(--accent)] text-white text-sm font-medium flex items-center gap-2"
              >
                <Share2 className="w-4 h-4" /> {t.shareBtn}
              </button>
              {ogUrl && (
                <a
                  href={ogUrl} download={`dca-${result.symbol}.jpg`}
                  className="h-10 px-4 rounded-xl bg-[var(--bg-secondary)] border border-white/10 text-sm font-medium flex items-center gap-2"
                >
                  <Download className="w-4 h-4" /> {t.downloadBtn}
                </a>
              )}
              <button
                type="button" onClick={savePlan} disabled={saving}
                className="h-10 px-4 rounded-xl bg-[var(--bg-secondary)] border border-white/10 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                <Save className="w-4 h-4" /> {saving ? t.savingBtn : t.saveBtn}
              </button>
            </div>
          </div>

          {/* 計畫 vs 實際 */}
          {plans.length > 0 && (
            <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-[var(--accent)]" />
                <h2 className="text-sm font-semibold">{t.myPlansTitle}</h2>
              </div>
              <div className="space-y-2 text-sm">
                {plans.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="font-mono font-bold">
                      {displayStockLabel(p.symbol, locale, { names: stockNames[normalizeStockCode(p.symbol)] })}
                    </span>
                    <span className="text-[var(--text-secondary)]">{t.planSummary(fmtTWD(p.monthly_amount), p.years, p.dividend_mode === 'cash')}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] mt-2">
                {t.planDisclaimer}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 免責＋參數揭露 */}
      <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 text-xs text-[var(--text-secondary)] leading-relaxed space-y-2">
        <p className="flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent)]" />
          <span>{t.disclaimerPre}{savingsRate != null ? t.savingsRateNote((savingsRate * 100).toFixed(2)) : ''}{feeDiscount != null ? t.feeDiscountNote(String(Math.round(feeDiscount * 100))) : ''}</span>
        </p>
        <p>
          {t.termsPre}<Link href={localizePath(locale, '/terms')} className="underline hover:text-[var(--text-primary)]">{t.termsLink}</Link>。
        </p>
      </div>
    </div>
  )
}
