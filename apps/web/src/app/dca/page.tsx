'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Calculator, HelpCircle, Download, Share2, Save, PiggyBank, TrendingUp, Info } from 'lucide-react'
import { DCA_PRESET_SYMBOLS } from '@/lib/dca'

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
      setError('請輸入正確的台股代號（如 0050）')
      return
    }
    const m = Number(monthly)
    if (!Number.isFinite(m) || m < 1000 || m > 1000000) {
      setError('每月金額需介於 1,000～1,000,000 元')
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
        setError(data?.error ?? '試算失敗')
        return
      }
      setResult(data.result as DcaResult)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '試算失敗')
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
        setError(data?.error ?? '儲存計畫失敗')
        return
      }
      setNotice('已儲存計畫（與真實持倉分開存放，可回來對帳）')
      await fetchPlans()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '儲存計畫失敗')
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
        await navigator.share({ title: '零股存股試算', text: `${result?.symbol} 存股試算結果`, url: ogUrl })
        return
      }
    } catch {}
    window.open(ogUrl, '_blank')
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="flex items-center gap-3 mb-2">
        <PiggyBank className="w-7 h-7 text-[var(--accent)]" />
        <h1 className="text-2xl font-bold">零股存股試算所</h1>
      </div>
      <p className="text-[var(--text-secondary)] mb-8">
        每月扣 N 元買某檔，X 年後大概多少？含股利再投入差多少？跟放定存差幾倍？以下為歷史回測試算。
      </p>

      {/* 輸入區 */}
      <div className="mb-8 rounded-2xl bg-[var(--bg-card)] border border-white/5 p-5 md:p-6 shadow-xl space-y-5">
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">標的（單檔台股）</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="如 0050"
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
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">每月金額（元）</span>
            <input
              type="number" min={1000} max={1000000} value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-[var(--bg-secondary)] border border-white/10 focus:border-[var(--accent)] outline-none text-sm"
            />
          </label>
          <div>
            <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">期間</span>
            <div className="grid grid-cols-4 gap-1.5">
              {([1, 3, 5, 10] as const).map((y) => (
                <button
                  key={y} type="button" onClick={() => setYears(y)}
                  className={`h-11 rounded-xl border text-sm font-medium transition ${years === y ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]' : 'border-white/10 bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
                >
                  {y} 年
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">股利處理</span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button" onClick={() => setMode('reinvest')}
                className={`h-11 rounded-xl border text-sm font-medium transition ${mode === 'reinvest' ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]' : 'border-white/10 bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
              >
                股利再投入
              </button>
              <button
                type="button" onClick={() => setMode('cash')}
                className={`h-11 rounded-xl border text-sm font-medium transition ${mode === 'cash' ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]' : 'border-white/10 bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
              >
                領現
              </button>
            </div>
          </div>
          <div>
            <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              手續費/證交稅
              <Help text="手續費 0.1425%×折讓（後台可調），買賣各計、不足 NT$20 以 20 計；證交稅賣出時扣（ETF 0.1%／個股 0.3%，00 開頭啟發式判定，可能誤判）。與 /portfolio 試算頁同公式。" />
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button" onClick={() => setFees(true)}
                className={`h-11 rounded-xl border text-sm font-medium transition ${fees ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]' : 'border-white/10 bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
              >
                含稅費
              </button>
              <button
                type="button" onClick={() => setFees(false)}
                className={`h-11 rounded-xl border text-sm font-medium transition ${!fees ? 'bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]' : 'border-white/10 bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}
              >
                不含稅費
              </button>
            </div>
          </div>
        </div>
        <button
          type="button" onClick={run} disabled={loading}
          className="w-full h-12 rounded-xl bg-[var(--accent)] text-white font-medium text-sm hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 transition"
        >
          <Calculator className="w-4 h-4" />
          {loading ? '試算中…' : '開始試算'}
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
              <div className="text-[var(--text-secondary)] text-xs mb-2">投入本金</div>
              <div className="text-2xl font-bold">{fmtTWD(result.invested)}</div>
              <div className="text-xs text-[var(--text-secondary)] mt-1">{result.nMonths} 個月 · {result.shares.toFixed(2)} 股</div>
            </div>
            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-white/5">
              <div className="text-[var(--text-secondary)] text-xs mb-2">期末總值（含股利）</div>
              <div className="text-2xl font-bold text-[var(--accent-green)]">{fmtTWD(result.totalValue)}</div>
              <div className="text-xs text-[var(--text-secondary)] mt-1">期末價 {result.endPrice.toFixed(2)}（{result.endDate}）</div>
            </div>
            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-white/5">
              <div className="text-[var(--text-secondary)] text-xs mb-2 flex items-center">
                總報酬（裸價差）
                <Help text="總報酬（裸價差，沿 #44）：(期末市值_不含股利 − 投入本金) / 投入本金 ×100%。股利另計，不混入。" />
              </div>
              <div className="text-2xl font-bold text-[var(--accent)]">{fmtPct(result.grossReturnPct)}</div>
              <div className="text-xs text-[var(--text-secondary)] mt-1">不含股利的價差報酬</div>
            </div>
            <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-white/5">
              <div className="text-[var(--text-secondary)] text-xs mb-2 flex items-center">
                股利{result.dividendMode === 'reinvest' ? '再投入' : '領現'}加成
                <Help text="股利加成（百分點）：(期末總值 − 期末市值_不含股利) / 投入本金 ×100%。再投入按除息日買入、領現為現金累積不投入。" />
              </div>
              <div className="text-2xl font-bold text-[var(--accent-green)]">{fmtPct(result.divBoostPp)}</div>
              <div className="text-xs text-[var(--text-secondary)] mt-1">
                {result.dividendMode === 'reinvest' ? '按除息日再投入買入' : `累積現金股利 ${fmtTWD(result.cashDividends)}`}
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">含股利總報酬</span>
              <span className="font-semibold">{fmtPct(result.totalReturnPct)}（簡化年化 {fmtPct(result.annualizedPct)}，非 XIRR）</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">定存對照（年利率 {((result.savingsAnnualRate) * 100).toFixed(2)}%，月利＝年利率/12）</span>
              <span className="font-semibold">{fmtTWD(result.savingsValue)}{result.savingsMultiple != null ? ` · 存股約 ${result.savingsMultiple.toFixed(2)} 倍` : ''}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">稅費（折讓 {Math.round(result.feeDiscount * 100)}%{result.isEtf ? ' · ETF 稅率 0.1%' : ' · 個股稅率 0.3%'}）</span>
              <span className="font-semibold">
                {result.includeFees
                  ? `買入 ${fmtTWD(result.buyFeesTotal)}＋賣出 ${fmtTWD(result.sellFee)}＋稅 ${fmtTWD(result.tax)} · 淨值 ${fmtTWD(result.netTotal)}`
                  : '未含稅費'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[var(--text-secondary)]">最大回撤月份</span>
              <span className="font-semibold">
                {result.maxDrawdownMonth ? `${result.maxDrawdownMonth}（${fmtPct(result.maxDrawdownPct)}）` : '無回撤'}
              </span>
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed pt-1">
              公式：總報酬（裸價差）＝(期末市值_不含股利−投入本金)/投入本金×100%；
              股利加成＝(期末總值−期末市值_不含股利)/投入本金×100%（百分點）；
              定存終值＝Σ每月投入×(1＋年利率/12)^剩餘月數；
              年化＝(期末總值/投入本金)^(12/月數)−1（定期定額簡化 CAGR，非 XIRR）。
              買入價為還原權值（adjclose）逐月首個交易日收盤，零股可小數持有，手續費外加不扣減股數。
            </p>
          </div>

          {/* 圖卡分享 */}
          <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Share2 className="w-4 h-4 text-[var(--accent)]" />
              <h2 className="text-sm font-semibold">複利圖卡分享</h2>
            </div>
            {ogUrl && (
              <img src={ogUrl} alt="存股試算圖卡" className="w-full max-w-md rounded-xl border border-white/10 mb-3" loading="lazy" />
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button" onClick={handleShare}
                className="h-10 px-4 rounded-xl bg-[var(--accent)] text-white text-sm font-medium flex items-center gap-2"
              >
                <Share2 className="w-4 h-4" /> 分享圖卡
              </button>
              {ogUrl && (
                <a
                  href={ogUrl} download={`dca-${result.symbol}.jpg`}
                  className="h-10 px-4 rounded-xl bg-[var(--bg-secondary)] border border-white/10 text-sm font-medium flex items-center gap-2"
                >
                  <Download className="w-4 h-4" /> 下載圖卡
                </a>
              )}
              <button
                type="button" onClick={savePlan} disabled={saving}
                className="h-10 px-4 rounded-xl bg-[var(--bg-secondary)] border border-white/10 text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                <Save className="w-4 h-4" /> {saving ? '儲存中…' : '儲存計畫'}
              </button>
            </div>
          </div>

          {/* 計畫 vs 實際 */}
          {plans.length > 0 && (
            <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-[var(--accent)]" />
                <h2 className="text-sm font-semibold">我的存股計畫（與真實持倉分開存放）</h2>
              </div>
              <div className="space-y-2 text-sm">
                {plans.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="font-mono font-bold">{p.symbol}</span>
                    <span className="text-[var(--text-secondary)]">每月 {fmtTWD(p.monthly_amount)} × {p.years} 年 · {p.dividend_mode === 'cash' ? '領現' : '再投入'}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] mt-2">
                計畫僅為試算紀錄，不會出現在 /portfolio 持倉列表與損益中；每月對帳請以券商實際扣款為準。
              </p>
            </div>
          )}
        </div>
      )}

      {/* 免責＋參數揭露 */}
      <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 text-xs text-[var(--text-secondary)] leading-relaxed space-y-2">
        <p className="flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent)]" />
          <span>本頁為歷史回測試算，不代表未來表現，亦非投資建議。價格採 Yahoo 還原權值，股息採 TWSE 除息快取（缺檔月份視為無配息）。{savingsRate != null ? `定存年利率 ${(savingsRate * 100).toFixed(2)}%（後台可調）。` : ''}{feeDiscount != null ? `手續費折讓 ${Math.round(feeDiscount * 100)}%（沿用後台 portfolio.fee_discount）。` : ''}</span>
        </p>
        <p>
          使用即代表同意 <Link href="/terms" className="underline hover:text-[var(--text-primary)]">服務條款</Link>。
        </p>
      </div>
    </div>
  )
}
