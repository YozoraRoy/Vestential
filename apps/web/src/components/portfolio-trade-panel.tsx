'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, CheckCircle2, Pencil, Plus, ReceiptText, Search, Trash2, X } from 'lucide-react'
import type { Locale } from '@/i18n/config'
import {
  estimateTradeFeeAndTax,
  settlePortfolioTrade,
  type ExistingHoldingRow,
  type TradeMarket,
  type TradeSide,
} from '@/lib/portfolio-trade'
import { summarizeTransactionsByMarket, type MarketFilter } from '@/lib/portfolio-market-split'

export interface PortfolioTransactionItem {
  id: number
  market: string
  symbol: string
  symbol_name: string | null
  side: 'buy' | 'sell'
  shares: number
  price: number
  fee: number
  tax: number
  total_amount: number
  realized_pnl: number | null
  realized_pnl_pct: number | null
  trade_date: string
  note: string | null
  created_at: string
}

export interface PortfolioTransactionsSummary {
  totalRealizedPnl: number
  totalBuyAmount: number
  totalSellAmount: number
  buyCount: number
  sellCount: number
}

export interface TradeModalInitialPreset {
  market?: TradeMarket
  symbol?: string
  symbolName?: string
  side?: TradeSide
  currentPrice?: number
}

interface PortfolioTradeModalProps {
  open: boolean
  onClose: () => void
  locale: Locale
  feeDiscount: number
  existingHoldings: ExistingHoldingRow[]
  initialPreset?: TradeModalInitialPreset | null
  onSettled: (payload: {
    records: any[]
    transactions: PortfolioTransactionItem[]
    summary: PortfolioTransactionsSummary
    message: string
  }) => void
}

const MODAL_COPY: Record<
  Locale,
  {
    title: string
    subtitle: string
    buy: string
    sell: string
    marketTw: string
    marketUs: string
    symbol: string
    symbolPlaceholder: string
    lookupBtn: string
    currentHolding: (shares: number, avgCost: number) => string
    noHolding: string
    shares: string
    sellAll: string
    price: string
    tradeDate: string
    fee: string
    tax: string
    autoCalcHint: string
    note: string
    notePlaceholder: string
    previewTitle: string
    previewAfterShares: string
    previewAvgCost: string
    previewTotalPay: string
    previewNetProceeds: string
    previewRealizedPnl: string
    previewCleared: string
    submitBuy: string
    submitSell: string
    submitting: string
    cancel: string
  }
> = {
  'zh-TW': {
    title: '股票買入／賣出交易結算',
    subtitle: '輸入成交明細後將自動留存交易紀錄，並依移動加權平均成本即時與持股總覽結算。',
    buy: '買入（建倉／加碼）',
    sell: '賣出（減倉／清倉）',
    marketTw: '台股 TW',
    marketUs: '美股 US',
    symbol: '股票代號',
    symbolPlaceholder: '例如 0056 或 2330',
    lookupBtn: '查現價',
    currentHolding: (s, c) => `目前持有 ${s.toLocaleString('en-US')} 股 · 均價 ${c.toFixed(2)}`,
    noHolding: '目前持股總覽尚未持有此標的',
    shares: '成交股數',
    sellAll: '全數賣出',
    price: '成交單價',
    tradeDate: '成交日期',
    fee: '手續費',
    tax: '證交稅',
    autoCalcHint: '依手續費折數與台股稅率自動試算，可直接改寫為實際金額',
    note: '備註（選填）',
    notePlaceholder: '例如：定期加碼、逢高部分停利',
    previewTitle: '結算試算預覽',
    previewAfterShares: '結算後持股數',
    previewAvgCost: '結算後均價',
    previewTotalPay: '本次應付總額',
    previewNetProceeds: '本次淨入帳金額',
    previewRealizedPnl: '預估已實現損益',
    previewCleared: '全數清倉（將自動自持股總覽移除）',
    submitBuy: '確認買入並結算',
    submitSell: '確認賣出並結算',
    submitting: '結算中…',
    cancel: '取消',
  },
  en: {
    title: 'Buy / Sell Trade Settlement',
    subtitle: 'Logs each trade and automatically updates Holdings Overview via moving weighted-average cost.',
    buy: 'Buy (Open / Add)',
    sell: 'Sell (Trim / Close)',
    marketTw: 'Taiwan (TW)',
    marketUs: 'US Stocks',
    symbol: 'Ticker Symbol',
    symbolPlaceholder: 'e.g. 0056 or AAPL',
    lookupBtn: 'Quote',
    currentHolding: (s, c) => `Holding ${s.toLocaleString('en-US')} sh · Avg ${c.toFixed(2)}`,
    noHolding: 'No existing position in Holdings Overview',
    shares: 'Shares',
    sellAll: 'Sell All',
    price: 'Fill Price',
    tradeDate: 'Trade Date',
    fee: 'Commission / Fee',
    tax: 'Transaction Tax',
    autoCalcHint: 'Auto-estimated using your fee discount & TW tax rate; editable.',
    note: 'Note (Optional)',
    notePlaceholder: 'e.g. DCA add, partial profit-taking',
    previewTitle: 'Settlement Preview',
    previewAfterShares: 'Post-Trade Shares',
    previewAvgCost: 'New Avg Cost',
    previewTotalPay: 'Total Outlay',
    previewNetProceeds: 'Net Proceeds',
    previewRealizedPnl: 'Est. Realized P&L',
    previewCleared: 'Full exit (position removed from Holdings Overview)',
    submitBuy: 'Confirm Buy & Settle',
    submitSell: 'Confirm Sell & Settle',
    submitting: 'Settling…',
    cancel: 'Cancel',
  },
  ja: {
    title: '株式売買・自動精算フロー',
    subtitle: '約定明細を記録し、移動加重平均法で保有銘柄一覧を自動精算・更新します。',
    buy: '買付（新規・買増）',
    sell: '売却（一部・全売却）',
    marketTw: '台湾株 TW',
    marketUs: '米国株 US',
    symbol: '銘柄コード',
    symbolPlaceholder: '例: 0056 / 2330',
    lookupBtn: '株価取得',
    currentHolding: (s, c) => `現在保有 ${s.toLocaleString('en-US')} 株 · 平均取得単価 ${c.toFixed(2)}`,
    noHolding: '現在この銘柄の保有はありません',
    shares: '約定株数',
    sellAll: '全株売却',
    price: '約定単価',
    tradeDate: '約定日',
    fee: '手数料',
    tax: '証券取引税',
    autoCalcHint: '割引率と税率で自動試算（実額へ手動修正可能）',
    note: 'メモ（任意）',
    notePlaceholder: '例：積立買増、一部利確',
    previewTitle: '精算プレビュー',
    previewAfterShares: '精算後保有株数',
    previewAvgCost: '精算後平均単価',
    previewTotalPay: '支払総額',
    previewNetProceeds: '受取金額',
    previewRealizedPnl: '実現損益見込',
    previewCleared: '全株売却（保有銘柄一覧から削除されます）',
    submitBuy: '買付を確定して精算',
    submitSell: '売却を確定して精算',
    submitting: '精算中…',
    cancel: 'キャンセル',
  },
}

function fmtMoney(n: number, market: TradeMarket): string {
  const prefix = market === 'tw' ? 'NT$' : '$'
  return `${prefix}${Math.round(n).toLocaleString('en-US')}`
}

export function PortfolioTradeModal({
  open,
  onClose,
  locale,
  feeDiscount,
  existingHoldings,
  initialPreset,
  onSettled,
}: PortfolioTradeModalProps) {
  const t = MODAL_COPY[locale] ?? MODAL_COPY['zh-TW']
  const [side, setSide] = useState<TradeSide>('buy')
  const [market, setMarket] = useState<TradeMarket>('tw')
  const [symbol, setSymbol] = useState('')
  const [symbolName, setSymbolName] = useState('')
  const [shares, setShares] = useState('1000')
  const [price, setPrice] = useState('')
  const [fee, setFee] = useState('0')
  const [tax, setTax] = useState('0')
  const [feeTouched, setFeeTouched] = useState(false)
  const [taxTouched, setTaxTouched] = useState(false)
  const [tradeDate, setTradeDate] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }),
  )
  const [note, setNote] = useState('')
  const [currentQuote, setCurrentQuote] = useState<number | null>(null)
  const [lookingUp, setLookingUp] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 開啟時套用 preset
  useEffect(() => {
    if (!open) return
    setError(null)
    setFeeTouched(false)
    setTaxTouched(false)
    setSide(initialPreset?.side ?? 'buy')
    setMarket(initialPreset?.market ?? 'tw')
    setSymbol(initialPreset?.symbol ?? '')
    setSymbolName(initialPreset?.symbolName ?? '')
    setShares(initialPreset?.market === 'us' ? '10' : '1000')
    setPrice(initialPreset?.currentPrice ? String(initialPreset.currentPrice) : '')
    setCurrentQuote(initialPreset?.currentPrice ?? null)
    setNote('')
  }, [open, initialPreset])

  const cleanSym = symbol.trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')

  const matchedSummary = useMemo(() => {
    if (!cleanSym) return { shares: 0, avgCost: 0, symbolName: '' }
    const rows = existingHoldings.filter(
      (r) => (r.market === 'us' ? 'us' : 'tw') === market && r.symbol.trim().toUpperCase() === cleanSym,
    )
    const totalShares = rows.reduce((s, r) => s + (Number(r.shares) || 0), 0)
    const totalCost = rows.reduce(
      (s, r) => s + (Number(r.cost_basis) > 0 ? Number(r.cost_basis) : (Number(r.cost) || 0) * (Number(r.shares) || 0)),
      0,
    )
    return {
      shares: totalShares,
      avgCost: totalShares > 0 ? totalCost / totalShares : 0,
      symbolName: rows.find((r) => r.symbol_name)?.symbol_name ?? '',
    }
  }, [existingHoldings, market, cleanSym])

  // 自動試算手續費與證交稅
  useEffect(() => {
    const nShares = Number(shares) || 0
    const nPrice = Number(price) || 0
    const est = estimateTradeFeeAndTax({
      market,
      symbol: cleanSym,
      side,
      shares: nShares,
      price: nPrice,
      feeDiscount,
    })
    if (!feeTouched) setFee(String(est.fee))
    if (!taxTouched) setTax(String(est.tax))
  }, [market, cleanSym, side, shares, price, feeDiscount, feeTouched, taxTouched])

  const preview = useMemo(() => {
    const nShares = Number(shares)
    const nPrice = Number(price)
    const nFee = Number(fee) || 0
    const nTax = Number(tax) || 0
    if (!cleanSym || !Number.isFinite(nShares) || nShares <= 0 || !Number.isFinite(nPrice) || nPrice <= 0) {
      return { result: null, error: null }
    }
    try {
      const result = settlePortfolioTrade(existingHoldings, {
        market,
        symbol: cleanSym,
        symbolName: symbolName || matchedSummary.symbolName || null,
        side,
        shares: nShares,
        price: nPrice,
        fee: nFee,
        tax: nTax,
        currentPrice: currentQuote ?? nPrice,
        tradeDate,
        note,
      })
      return { result, error: null }
    } catch (e: unknown) {
      return { result: null, error: e instanceof Error ? e.message : 'Invalid' }
    }
  }, [existingHoldings, market, cleanSym, symbolName, matchedSummary.symbolName, side, shares, price, fee, tax, currentQuote, tradeDate, note])

  const handleLookup = async () => {
    if (!cleanSym) return
    setLookingUp(true)
    setError(null)
    try {
      const res = await fetch(`/api/portfolio/quote?market=${market}&symbol=${encodeURIComponent(cleanSym)}`)
      const data = await res.json().catch(() => null)
      if (res.ok && data?.price) {
        setCurrentQuote(Number(data.price))
        if (!price) setPrice(String(data.price))
        if (data.name && !symbolName) setSymbolName(String(data.name))
      }
    } catch {}
    setLookingUp(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (preview.error) {
      setError(preview.error)
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/portfolio/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market,
          symbol: cleanSym,
          symbolName: symbolName.trim() || matchedSummary.symbolName || null,
          side,
          shares: Number(shares),
          price: Number(price),
          fee: Number(fee) || 0,
          tax: Number(tax) || 0,
          currentPrice: currentQuote ?? Number(price),
          tradeDate,
          note: note.trim() || null,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || '結算失敗')
      }
      const msg =
        side === 'buy'
          ? locale === 'en'
            ? `Bought ${Number(shares).toLocaleString('en-US')} ${cleanSym} and updated Holdings Overview.`
            : `已完成買入 ${cleanSym} ${Number(shares).toLocaleString('en-US')} 股，並自動更新持股總覽均價！`
          : locale === 'en'
            ? `Sold ${Number(shares).toLocaleString('en-US')} ${cleanSym} (Realized P&L: ${fmtMoney(data.settlement.realizedPnl ?? 0, market)}).`
            : `已完成賣出 ${cleanSym} ${Number(shares).toLocaleString('en-US')} 股（已實現損益 ${fmtMoney(data.settlement.realizedPnl ?? 0, market)}），已與持股總覽同步結算！`

      onSettled({
        records: data.records ?? [],
        transactions: data.transactions ?? [],
        summary: data.summary,
        message: msg,
      })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '結算失敗')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl border border-white/10 bg-[var(--bg-card)] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
              <ArrowDownUp className="w-5 h-5 text-[var(--accent-green)]" />
              {t.title}
            </h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{t.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 買入 / 賣出切換 */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setSide('buy')
                setTaxTouched(false)
                setFeeTouched(false)
              }}
              className={`py-2.5 rounded-xl text-xs font-bold border transition ${
                side === 'buy'
                  ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-300'
                  : 'border-white/10 bg-white/5 text-[var(--text-secondary)]'
              }`}
            >
              {t.buy}
            </button>
            <button
              type="button"
              onClick={() => {
                setSide('sell')
                setTaxTouched(false)
                setFeeTouched(false)
              }}
              className={`py-2.5 rounded-xl text-xs font-bold border transition ${
                side === 'sell'
                  ? 'border-rose-500/60 bg-rose-500/20 text-rose-300'
                  : 'border-white/10 bg-white/5 text-[var(--text-secondary)]'
              }`}
            >
              {t.sell}
            </button>
          </div>

          {/* 市場與代號 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">Market</label>
              <div className="flex rounded-lg overflow-hidden border border-white/10">
                {(['tw', 'us'] as TradeMarket[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setMarket(m)
                      setFeeTouched(false)
                      setTaxTouched(false)
                    }}
                    className={`flex-1 py-2 text-xs font-medium transition ${
                      market === m ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {m === 'tw' ? t.marketTw : t.marketUs}
                  </button>
                ))}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs text-[var(--text-secondary)] mb-1">{t.symbol}</label>
              <div className="flex gap-2">
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder={t.symbolPlaceholder}
                  required
                  className="flex-1 rounded-lg border border-white/10 bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={handleLookup}
                  disabled={lookingUp || !cleanSym}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-xs text-[var(--text-primary)] hover:bg-white/10 disabled:opacity-40"
                >
                  <Search className="w-3.5 h-3.5" />
                  {t.lookupBtn}
                </button>
              </div>
            </div>
          </div>

          {/* 目前持有狀態 */}
          {cleanSym && (
            <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2 text-xs flex items-center justify-between gap-2">
              <span className="text-[var(--text-secondary)]">
                {matchedSummary.shares > 0
                  ? t.currentHolding(matchedSummary.shares, matchedSummary.avgCost)
                  : t.noHolding}
              </span>
              {side === 'sell' && matchedSummary.shares > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setShares(String(matchedSummary.shares))
                    setFeeTouched(false)
                    setTaxTouched(false)
                  }}
                  className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 font-medium"
                >
                  {t.sellAll}
                </button>
              )}
            </div>
          )}

          {/* 股數 / 單價 / 日期 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">{t.shares}</label>
              <input
                type="number"
                min="0.0001"
                step="any"
                required
                value={shares}
                onChange={(e) => {
                  setShares(e.target.value)
                  setFeeTouched(false)
                  setTaxTouched(false)
                }}
                className="w-full rounded-lg border border-white/10 bg-[var(--bg-secondary)] px-3 py-2 text-sm font-mono text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">{t.price}</label>
              <input
                type="number"
                min="0.0001"
                step="any"
                required
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value)
                  setFeeTouched(false)
                  setTaxTouched(false)
                }}
                className="w-full rounded-lg border border-white/10 bg-[var(--bg-secondary)] px-3 py-2 text-sm font-mono text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">{t.tradeDate}</label>
              <input
                type="date"
                required
                value={tradeDate}
                onChange={(e) => setTradeDate(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
            </div>
          </div>

          {/* 手續費 & 證交稅（可微調） */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">{t.fee}</label>
              <input
                type="number"
                min="0"
                step="1"
                value={fee}
                onChange={(e) => {
                  setFeeTouched(true)
                  setFee(e.target.value)
                }}
                className="w-full rounded-lg border border-white/10 bg-[var(--bg-secondary)] px-3 py-2 text-sm font-mono text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-secondary)] mb-1">{t.tax}</label>
              <input
                type="number"
                min="0"
                step="1"
                disabled={side === 'buy'}
                value={tax}
                onChange={(e) => {
                  setTaxTouched(true)
                  setTax(e.target.value)
                }}
                className="w-full rounded-lg border border-white/10 bg-[var(--bg-secondary)] px-3 py-2 text-sm font-mono text-[var(--text-primary)] disabled:opacity-40"
              />
            </div>
          </div>
          <p className="text-[11px] text-[var(--text-secondary)] -mt-2">{t.autoCalcHint}</p>

          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">{t.note}</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.notePlaceholder}
              className="w-full rounded-lg border border-white/10 bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </div>

          {/* 結算試算預覽 */}
          {preview.error ? (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
              {preview.error}
            </div>
          ) : preview.result ? (
            <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/10 p-3.5 text-xs space-y-1.5">
              <div className="font-semibold text-[var(--accent)] flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t.previewTitle}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <span className="text-[var(--text-secondary)]">
                    {side === 'buy' ? t.previewTotalPay : t.previewNetProceeds}：
                  </span>
                  <strong className="tabular-nums text-[var(--text-primary)]">
                    {fmtMoney(preview.result.totalAmount, market)}
                  </strong>
                </div>
                {preview.result.action === 'delete' ? (
                  <div className="text-amber-300 font-medium">{t.previewCleared}</div>
                ) : preview.result.settledRecord ? (
                  <div>
                    <span className="text-[var(--text-secondary)]">{t.previewAfterShares}：</span>
                    <strong className="tabular-nums text-[var(--text-primary)]">
                      {preview.result.settledRecord.shares.toLocaleString('en-US')}（{t.previewAvgCost}{' '}
                      {preview.result.settledRecord.cost.toFixed(2)}）
                    </strong>
                  </div>
                ) : null}
                {side === 'sell' && preview.result.realizedPnl != null && (
                  <div className="col-span-2">
                    <span className="text-[var(--text-secondary)]">{t.previewRealizedPnl}：</span>
                    <strong
                      className={`tabular-nums ${
                        preview.result.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {preview.result.realizedPnl >= 0 ? '+' : ''}
                      {fmtMoney(preview.result.realizedPnl, market)} (
                      {preview.result.realizedPnlPct?.toFixed(2)}%)
                    </strong>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-white/10 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={submitting || !preview.result || !!preview.error}
              className={`px-5 py-2 rounded-xl text-xs font-bold text-white transition disabled:opacity-40 ${
                side === 'buy'
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : 'bg-rose-600 hover:bg-rose-500'
              }`}
            >
              {submitting ? t.submitting : side === 'buy' ? t.submitBuy : t.submitSell}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface PortfolioTransactionsTabProps {
  transactions: PortfolioTransactionItem[]
  summary: PortfolioTransactionsSummary
  loading: boolean
  locale: Locale
  onOpenTradeModal: () => void
  onUpdated?: (transactions: PortfolioTransactionItem[], summary: PortfolioTransactionsSummary) => void
}

const TAB_COPY: Record<
  Locale,
  {
    realizedPnl: string
    buyTotal: string
    sellTotal: string
    tradeCount: (b: number, s: number) => string
    newTradeBtn: string
    empty: string
    colDate: string
    colSide: string
    colSymbol: string
    colShares: string
    colPrice: string
    colFeeTax: string
    colAmount: string
    colRealized: string
    colNote: string
    colActions: string
    editTitle: string
    editBtnTitle: string
    deleteBtnTitle: string
    editHint: string
    editSave: string
    editSaving: string
    cancel: string
    deleteConfirm: (symbol: string, date: string) => string
    buyBadge: string
    sellBadge: string
  }
> = {
  'zh-TW': {
    realizedPnl: '累計已實現損益',
    buyTotal: '累計買入成交額',
    sellTotal: '累計賣出回收額',
    tradeCount: (b, s) => `買入 ${b} 筆 · 賣出 ${s} 筆`,
    newTradeBtn: '新增買入／賣出結算',
    empty: '尚無買賣交易紀錄，點擊右上角「買入／賣出結算」即可輸入並自動與持股總覽結算。',
    colDate: '成交日期',
    colSide: '方向',
    colSymbol: '標的',
    colShares: '股數',
    colPrice: '成交價',
    colFeeTax: '手續費／稅',
    colAmount: '交割金額',
    colRealized: '已實現損益',
    colNote: '備註',
    colActions: '操作',
    editTitle: '編輯交易結算紀錄',
    editBtnTitle: '編輯紀錄',
    deleteBtnTitle: '刪除紀錄',
    editHint: '修改或刪除此筆紀錄僅更新交易結算明細與上方統計，不會回溯覆寫「持股總覽」。',
    editSave: '儲存變更',
    editSaving: '儲存中...',
    cancel: '取消',
    deleteConfirm: (sym, dt) => `確定要刪除 ${sym}（${dt}）這筆交易結算紀錄嗎？（僅移除此筆明細，不會自動回溯修改持股總覽）`,
    buyBadge: '買入',
    sellBadge: '賣出',
  },
  en: {
    realizedPnl: 'Total Realized P&L',
    buyTotal: 'Total Buy Outlay',
    sellTotal: 'Total Sell Proceeds',
    tradeCount: (b, s) => `${b} buys · ${s} sells`,
    newTradeBtn: 'New Buy / Sell Trade',
    empty: 'No trade settlement records yet. Click "Buy / Sell Trade" to log and settle automatically.',
    colDate: 'Date',
    colSide: 'Side',
    colSymbol: 'Symbol',
    colShares: 'Shares',
    colPrice: 'Price',
    colFeeTax: 'Fee / Tax',
    colAmount: 'Settlement',
    colRealized: 'Realized P&L',
    colNote: 'Note',
    colActions: 'Actions',
    editTitle: 'Edit Trade Settlement',
    editBtnTitle: 'Edit record',
    deleteBtnTitle: 'Delete record',
    editHint: 'Editing or deleting this record only updates the trade ledger and KPIs without overwriting Holdings Overview.',
    editSave: 'Save Changes',
    editSaving: 'Saving...',
    cancel: 'Cancel',
    deleteConfirm: (sym, dt) => `Delete settlement record for ${sym} (${dt})? This will not alter Holdings Overview.`,
    buyBadge: 'BUY',
    sellBadge: 'SELL',
  },
  ja: {
    realizedPnl: '累計実現損益',
    buyTotal: '累計買付額',
    sellTotal: '累計売却額',
    tradeCount: (b, s) => `買付 ${b} 件 · 売却 ${s} 件`,
    newTradeBtn: '新規売買精算',
    empty: '取引精算履歴はまだありません。「株式売買精算」から入力すると自動で保有銘柄へ反映されます。',
    colDate: '約定日',
    colSide: '売買',
    colSymbol: '銘柄',
    colShares: '株数',
    colPrice: '単価',
    colFeeTax: '手数料・税',
    colAmount: '受渡金額',
    colRealized: '実現損益',
    colNote: 'メモ',
    colActions: '操作',
    editTitle: '取引精算履歴を編集',
    editBtnTitle: '編集',
    deleteBtnTitle: '削除',
    editHint: 'この履歴の編集・削除は取引明細と集計のみを更新し、保有銘柄一覧は自動変更されません。',
    editSave: '保存する',
    editSaving: '保存中...',
    cancel: 'キャンセル',
    deleteConfirm: (sym, dt) => `${sym}（${dt}）の精算履歴を削除しますか？（保有銘柄一覧には影響しません）`,
    buyBadge: '買付',
    sellBadge: '売却',
  },
}

export function PortfolioTransactionsTab({
  transactions,
  summary: _summary,
  loading,
  locale,
  onOpenTradeModal,
  onUpdated,
}: PortfolioTransactionsTabProps) {
  const t = TAB_COPY[locale] ?? TAB_COPY['zh-TW']
  const [txMarketFilter, setTxMarketFilter] = useState<MarketFilter>('all')
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [editingTx, setEditingTx] = useState<PortfolioTransactionItem | null>(null)
  const [editTradeDate, setEditTradeDate] = useState('')
  const [editShares, setEditShares] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editFee, setEditFee] = useState('')
  const [editTax, setEditTax] = useState('')
  const [editRealizedPnl, setEditRealizedPnl] = useState('')
  const [editNote, setEditNote] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const openEditModal = (tx: PortfolioTransactionItem) => {
    setActionErr(null)
    setEditingTx(tx)
    setEditTradeDate(tx.trade_date)
    setEditShares(String(tx.shares))
    setEditPrice(String(tx.price))
    setEditFee(String(tx.fee))
    setEditTax(String(tx.tax))
    setEditRealizedPnl(tx.realized_pnl != null ? String(tx.realized_pnl) : '')
    setEditNote(tx.note ?? '')
  }

  const handleDeleteTx = async (tx: PortfolioTransactionItem) => {
    if (!window.confirm(t.deleteConfirm(tx.symbol, tx.trade_date))) return
    setActionErr(null)
    setDeletingId(tx.id)
    try {
      const res = await fetch(`/api/portfolio/transactions/${tx.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setActionErr(data.error || `刪除失敗 (${res.status})`)
        return
      }
      if (Array.isArray(data.transactions) && data.summary) {
        onUpdated?.(data.transactions, data.summary)
      }
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : '刪除失敗')
    } finally {
      setDeletingId(null)
    }
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingTx) return
    setActionErr(null)
    setSavingEdit(true)
    try {
      const payload: Record<string, unknown> = {
        tradeDate: editTradeDate.trim(),
        shares: Number(editShares),
        price: Number(editPrice),
        fee: Number(editFee || 0),
        tax: Number(editTax || 0),
        note: editNote.trim() || null,
      }
      if (editingTx.side === 'sell') {
        payload.realizedPnl = editRealizedPnl.trim() === '' ? null : Number(editRealizedPnl)
      }
      const res = await fetch(`/api/portfolio/transactions/${editingTx.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setActionErr(data.error || `更新失敗 (${res.status})`)
        return
      }
      if (Array.isArray(data.transactions) && data.summary) {
        onUpdated?.(data.transactions, data.summary)
      }
      setEditingTx(null)
    } catch (err: unknown) {
      setActionErr(err instanceof Error ? err.message : '更新失敗')
    } finally {
      setSavingEdit(false)
    }
  }

  const byMarket = useMemo(() => summarizeTransactionsByMarket(transactions), [transactions])
  const filteredTx = useMemo(() => {
    if (txMarketFilter === 'all') return transactions
    return transactions.filter((tx) => (tx.market === 'us' ? 'us' : 'tw') === txMarketFilter)
  }, [transactions, txMarketFilter])

  const twCount = byMarket.tw.buyCount + byMarket.tw.sellCount
  const usCount = byMarket.us.buyCount + byMarket.us.sellCount

  const fmtAmt = (n: number, m: 'tw' | 'us') =>
    m === 'us'
      ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `NT$${Math.round(n).toLocaleString('en-US')}`

  return (
    <div className="space-y-5">
      {/* 市場篩選膠囊 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {(
            [
              { id: 'all', label: `全部 (${transactions.length})` },
              { id: 'tw', label: `🇹🇼 台股 (${twCount})` },
              { id: 'us', label: `🇺🇸 美股 (${usCount})` },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setTxMarketFilter(f.id)}
              className={`px-3 py-1 rounded-full text-xs border transition ${
                txMarketFilter === f.id
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-white/10 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 摘要 KPI（分幣別顯示，絕不混加） */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-white/10 bg-[var(--bg-card)] p-4 space-y-1">
          <div className="text-xs text-[var(--text-secondary)]">{t.realizedPnl}</div>
          {txMarketFilter !== 'us' && (
            <div className={`text-lg font-bold tabular-nums ${byMarket.tw.totalRealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {txMarketFilter === 'all' && usCount > 0 ? '台股 ' : ''}
              {byMarket.tw.totalRealizedPnl >= 0 ? '+' : ''}
              {fmtAmt(byMarket.tw.totalRealizedPnl, 'tw')}
            </div>
          )}
          {txMarketFilter !== 'tw' && (usCount > 0 || txMarketFilter === 'us') && (
            <div className={`text-lg font-bold tabular-nums ${byMarket.us.totalRealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {txMarketFilter === 'all' ? '美股 ' : ''}
              {byMarket.us.totalRealizedPnl >= 0 ? '+' : ''}
              {fmtAmt(byMarket.us.totalRealizedPnl, 'us')}
            </div>
          )}
          <div className="text-[11px] text-[var(--text-secondary)]">
            {txMarketFilter === 'tw'
              ? t.tradeCount(byMarket.tw.buyCount, byMarket.tw.sellCount)
              : txMarketFilter === 'us'
                ? t.tradeCount(byMarket.us.buyCount, byMarket.us.sellCount)
                : t.tradeCount(byMarket.tw.buyCount + byMarket.us.buyCount, byMarket.tw.sellCount + byMarket.us.sellCount)}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[var(--bg-card)] p-4 space-y-1">
          <div className="text-xs text-[var(--text-secondary)]">{t.buyTotal}</div>
          {txMarketFilter !== 'us' && (
            <div className="text-lg font-bold tabular-nums text-[var(--text-primary)]">
              {txMarketFilter === 'all' && usCount > 0 ? '台股 ' : ''}
              {fmtAmt(byMarket.tw.totalBuyAmount, 'tw')}
            </div>
          )}
          {txMarketFilter !== 'tw' && (usCount > 0 || txMarketFilter === 'us') && (
            <div className="text-lg font-bold tabular-nums text-sky-300">
              {txMarketFilter === 'all' ? '美股 ' : ''}
              {fmtAmt(byMarket.us.totalBuyAmount, 'us')}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-[var(--bg-card)] p-4 flex items-center justify-between gap-2">
          <div className="space-y-1">
            <div className="text-xs text-[var(--text-secondary)]">{t.sellTotal}</div>
            {txMarketFilter !== 'us' && (
              <div className="text-lg font-bold tabular-nums text-[var(--text-primary)]">
                {txMarketFilter === 'all' && usCount > 0 ? '台股 ' : ''}
                {fmtAmt(byMarket.tw.totalSellAmount, 'tw')}
              </div>
            )}
            {txMarketFilter !== 'tw' && (usCount > 0 || txMarketFilter === 'us') && (
              <div className="text-lg font-bold tabular-nums text-sky-300">
                {txMarketFilter === 'all' ? '美股 ' : ''}
                {fmtAmt(byMarket.us.totalSellAmount, 'us')}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onOpenTradeModal}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
          >
            <Plus className="w-3.5 h-3.5" />
            {t.newTradeBtn}
          </button>
        </div>
      </div>

      {loading && transactions.length === 0 ? (
        <div className="h-40 rounded-2xl border border-white/5 bg-[var(--bg-card)] animate-pulse" />
      ) : filteredTx.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-[var(--bg-card)] p-10 text-center space-y-3">
          <ReceiptText className="w-8 h-8 text-[var(--text-secondary)] mx-auto opacity-70" />
          <p className="text-sm text-[var(--text-secondary)]">{t.empty}</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-[var(--bg-card)] overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[var(--text-secondary)]">
                <th className="px-3 py-2.5 text-left whitespace-nowrap">{t.colDate}</th>
                <th className="px-3 py-2.5 text-left whitespace-nowrap">{t.colSide}</th>
                <th className="px-3 py-2.5 text-left whitespace-nowrap">{t.colSymbol}</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">{t.colShares}</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">{t.colPrice}</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">{t.colFeeTax}</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">{t.colAmount}</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">{t.colRealized}</th>
                <th className="px-3 py-2.5 text-left whitespace-nowrap">{t.colNote}</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">{t.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {filteredTx.map((tx) => {
                const mkt: TradeMarket = tx.market === 'us' ? 'us' : 'tw'
                return (
                  <tr key={tx.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{tx.trade_date}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          tx.side === 'buy'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-rose-500/15 text-rose-300'
                        }`}
                      >
                        {tx.side === 'buy' ? t.buyBadge : t.sellBadge}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-medium">
                      {tx.symbol} {tx.symbol_name ?? ''}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums">
                      {tx.shares.toLocaleString('en-US')}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums">
                      {tx.price.toLocaleString('en-US')}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums text-[var(--text-secondary)]">
                      {Math.round(tx.fee)} / {Math.round(tx.tax)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums font-semibold">
                      {fmtMoney(tx.total_amount, mkt)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right tabular-nums font-semibold">
                      {tx.realized_pnl != null ? (
                        <span className={tx.realized_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {tx.realized_pnl >= 0 ? '+' : ''}
                          {fmtMoney(tx.realized_pnl, mkt)}
                        </span>
                      ) : (
                        <span className="text-[var(--text-secondary)]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-secondary)] max-w-[180px] truncate">
                      {tx.note ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditModal(tx)}
                          title={t.editBtnTitle}
                          className="p-1.5 rounded-lg bg-white/5 text-[var(--accent)] hover:bg-white/10 transition"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTx(tx)}
                          disabled={deletingId === tx.id}
                          title={t.deleteBtnTitle}
                          className="p-1.5 rounded-lg bg-white/5 text-red-400 hover:bg-red-500/10 transition disabled:opacity-50 disabled:cursor-wait"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {actionErr && !editingTx && (
        <p className="text-xs text-rose-400">{actionErr}</p>
      )}

      {editingTx && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setEditingTx(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/15 bg-[var(--bg-card)] shadow-2xl overflow-hidden"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-primary)]">
                  {t.editTitle} — {editingTx.symbol} {editingTx.symbol_name ?? ''}
                </h3>
                <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{t.editHint}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingTx(null)}
                className="p-1 rounded-lg hover:bg-white/10 text-[var(--text-secondary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[var(--text-secondary)] mb-1">{t.colDate}</label>
                  <input
                    type="date"
                    value={editTradeDate}
                    onChange={(ev) => setEditTradeDate(ev.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[var(--text-secondary)] mb-1">{t.colShares}</label>
                  <input
                    type="number"
                    step="any"
                    min="0.0001"
                    value={editShares}
                    onChange={(ev) => setEditShares(ev.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-[var(--text-primary)] tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[var(--text-secondary)] mb-1">{t.colPrice}</label>
                  <input
                    type="number"
                    step="any"
                    min="0.0001"
                    value={editPrice}
                    onChange={(ev) => setEditPrice(ev.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-[var(--text-primary)] tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[var(--text-secondary)] mb-1">手續費</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={editFee}
                    onChange={(ev) => setEditFee(ev.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-[var(--text-primary)] tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[var(--text-secondary)] mb-1">交易稅</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={editTax}
                    onChange={(ev) => setEditTax(ev.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-[var(--text-primary)] tabular-nums"
                  />
                </div>
                {editingTx.side === 'sell' && (
                  <div>
                    <label className="block text-[var(--text-secondary)] mb-1">{t.colRealized}</label>
                    <input
                      type="number"
                      step="any"
                      value={editRealizedPnl}
                      onChange={(ev) => setEditRealizedPnl(ev.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-[var(--text-primary)] tabular-nums"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[var(--text-secondary)] mb-1">{t.colNote}</label>
                <input
                  type="text"
                  maxLength={500}
                  value={editNote}
                  onChange={(ev) => setEditNote(ev.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-[var(--text-primary)]"
                />
              </div>
              {actionErr && <p className="text-xs text-rose-400">{actionErr}</p>}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingTx(null)}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-[var(--text-secondary)]"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {savingEdit ? t.editSaving : t.editSave}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
