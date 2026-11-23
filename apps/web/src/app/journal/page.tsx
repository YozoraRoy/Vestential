'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { normalizeStockCode } from '@stock/core'
import { useI18n } from '@/i18n/LanguageProvider'
import { computeJournalPnl } from '@/lib/journal'
import { displayStockLabel } from '@/lib/stock-display'
import { useStockNames } from '@/lib/use-stock-names'

interface JournalEntry {
  id: number
  user_id: number
  trade_date: string
  symbol: string
  direction: 'long' | 'short'
  entry_price: number
  exit_price: number
  shares: number
  reason: string
  stop_loss_obeyed: number
  created_at?: string
}

interface JournalStats {
  count: number
  wins: number
  losses: number
  winRate: number | null
  totalPnl: number
  avgPnl: number | null
  maxLossEntry: { id?: number; symbol: string; tradeDate: string; pnl: number } | null
  stopLossObeyedCount: number
  stopLossViolatedCount: number
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmt(n: number | null, digits = 2): string {
  return n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

const inputCls = 'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/60 focus:outline-none focus:border-[var(--accent)]'
const labelCls = 'block text-xs text-[var(--text-secondary)] mb-1'
const cardCls = 'bg-[var(--bg-card)] rounded-2xl border border-white/5 p-5'

export default function JournalPage() {
  const router = useRouter()
  const { dict, locale } = useI18n()
  const t = dict.journal

  const [month, setMonth] = useState(currentMonth())
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [stats, setStats] = useState<JournalStats | null>(null)
  const journalSymbols = useMemo(() => {
    const syms = entries.map((e) => e.symbol)
    if (stats?.maxLossEntry?.symbol) syms.push(stats.maxLossEntry.symbol)
    return syms
  }, [entries, stats])
  const stockNames = useStockNames(journalSymbols)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [fDate, setFDate] = useState('')
  const [fSymbol, setFSymbol] = useState('')
  const [fDirection, setFDirection] = useState<'long' | 'short' | ''>('')
  const [fEntry, setFEntry] = useState('')
  const [fExit, setFExit] = useState('')
  const [fShares, setFShares] = useState('')
  const [fReason, setFReason] = useState('')
  const [fStop, setFStop] = useState<'yes' | 'no' | ''>('')

  const [review, setReview] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const goLogin = useCallback(() => {
    router.replace(`/login?redirect=${encodeURIComponent('/journal')}`)
  }, [router])

  const load = useCallback(async (m: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/journal/stats?month=${encodeURIComponent(m)}`)
      if (res.status === 401) { goLogin(); return }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || t.loadFailed)
      setEntries(data.entries ?? [])
      setStats(data.stats ?? null)
    } catch (e: any) {
      setLoadError(e.message || t.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [goLogin, t.loadFailed])

  useEffect(() => { void load(month) }, [load, month])

  const resetForm = () => {
    setEditingId(null)
    setFDate(''); setFSymbol(''); setFDirection('')
    setFEntry(''); setFExit(''); setFShares('')
    setFReason(''); setFStop('')
    setFormError(null)
  }

  const openAdd = () => { resetForm(); setShowForm(true) }
  const openEdit = (e: JournalEntry) => {
    setEditingId(e.id)
    setFDate(e.trade_date.slice(0, 10))
    setFSymbol(e.symbol)
    setFDirection(e.direction)
    setFEntry(String(e.entry_price))
    setFExit(String(e.exit_price))
    setFShares(String(e.shares))
    setFReason(e.reason)
    setFStop(Number(e.stop_loss_obeyed) === 1 ? 'yes' : 'no')
    setFormError(null)
    setShowForm(true)
  }

  /** 前端先擋：具名指出缺失欄位（後端 validateJournalInput 會再擋一次）。 */
  const handleSubmit = async () => {
    const missing: string[] = []
    if (!fDate.trim()) missing.push(t.fieldDate)
    if (!fSymbol.trim()) missing.push(t.fieldSymbol)
    if (!fDirection) missing.push(t.fieldDirection)
    if (!(Number(fEntry) > 0)) missing.push(t.fieldEntryPrice)
    if (!(Number(fExit) > 0)) missing.push(t.fieldExitPrice)
    if (!(Number(fShares) > 0)) missing.push(t.fieldShares)
    if (!fReason.trim()) missing.push(t.fieldReason)
    if (!fStop) missing.push(t.fieldStopLoss)
    if (missing.length > 0) {
      setFormError(`缺少必填欄位：${missing.join('、')}`)
      return
    }
    setFormError(null)
    setSaving(true)
    try {
      const payload = {
        tradeDate: fDate.trim(),
        symbol: fSymbol.trim().toUpperCase(),
        direction: fDirection,
        entryPrice: Number(fEntry),
        exitPrice: Number(fExit),
        shares: Number(fShares),
        reason: fReason.trim(),
        stopLossObeyed: fStop === 'yes',
      }
      const url = editingId ? `/api/journal/${editingId}` : '/api/journal'
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.status === 401) { goLogin(); return }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || t.saveFailed)
      setShowForm(false)
      resetForm()
      setReview(null)
      await load(month)
    } catch (e: any) {
      setFormError(e.message || t.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm(t.confirmDelete)) return
    try {
      const res = await fetch(`/api/journal/${id}`, { method: 'DELETE' })
      if (res.status === 401) { goLogin(); return }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || t.deleteFailed)
      setReview(null)
      await load(month)
    } catch (e: any) {
      setLoadError(e.message || t.deleteFailed)
    }
  }

  const handleReview = async () => {
    setReviewing(true)
    setReviewError(null)
    try {
      const res = await fetch('/api/journal/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      })
      if (res.status === 401) { goLogin(); return }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || t.reviewFailed)
      setReview(data.review ?? null)
    } catch (e: any) {
      setReviewError(e.message || t.reviewFailed)
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">{t.subtitle}</p>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => { if (e.target.value) setMonth(e.target.value) }}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm"
          aria-label={t.statsTitle}
        />
      </div>

      {loading ? (
        <div className="text-sm text-[var(--text-secondary)]">{dict.common.loading}</div>
      ) : loadError ? (
        <div className={`${cardCls} text-sm text-red-400`}>{loadError}</div>
      ) : (
        <>
          <section className={cardCls}>
            <h2 className="font-semibold mb-1">{t.statsTitle}（{month}）</h2>
            <p className="text-xs text-[var(--text-secondary)] mb-4">{t.statsFreeNote}</p>
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-xl bg-white/5 p-3">
                  <div className="text-xs text-[var(--text-secondary)]">{t.statCount}</div>
                  <div className="text-xl font-bold mt-1">{stats.count}</div>
                </div>
                <div className="rounded-xl bg-white/5 p-3">
                  <div className="text-xs text-[var(--text-secondary)]">{t.statWinRate}</div>
                  <div className="text-xl font-bold mt-1">{stats.winRate == null ? '—' : `${stats.winRate.toFixed(1)}%`}</div>
                </div>
                <div className="rounded-xl bg-white/5 p-3">
                  <div className="text-xs text-[var(--text-secondary)]">{t.statAvgPnl}</div>
                  <div className="text-xl font-bold mt-1">{fmt(stats.avgPnl)}</div>
                </div>
                <div className="rounded-xl bg-white/5 p-3">
                  <div className="text-xs text-[var(--text-secondary)]">{t.statMaxLoss}</div>
                  <div className="text-xl font-bold mt-1">
                    {stats.maxLossEntry ? `#${stats.maxLossEntry.id} ${fmt(stats.maxLossEntry.pnl)}` : t.statNoMaxLoss}
                  </div>
                  {stats.maxLossEntry && (
                    <div className="text-xs text-[var(--text-secondary)] mt-1">
                      {displayStockLabel(stats.maxLossEntry.symbol, locale, { names: stockNames[normalizeStockCode(stats.maxLossEntry.symbol)] })}｜{stats.maxLossEntry.tradeDate}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className={cardCls}>
            <h2 className="font-semibold">{t.reviewTitle}</h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1">{t.reviewDesc}</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1">{t.reviewQuotaNote}</p>
            <div className="mt-3">
              <button
                onClick={handleReview}
                disabled={reviewing}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                {reviewing ? t.btnReviewing : t.btnReview}
              </button>
            </div>
            {reviewError && <p className="text-sm text-red-400 mt-3">{reviewError}</p>}
            {review ? (
              <div className="mt-3 text-sm whitespace-pre-wrap leading-relaxed">{review}</div>
            ) : (
              !reviewError && <p className="text-xs text-[var(--text-secondary)] mt-3">{t.reviewEmpty}</p>
            )}
            <p className="text-xs text-[var(--text-secondary)] mt-3">{t.reviewDisclaimer}</p>
          </section>

          <section className={cardCls}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">{t.listTitle}</h2>
              <button
                onClick={openAdd}
                className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition"
              >
                {t.btnAdd}
              </button>
            </div>
            {entries.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">{t.listEmpty}</p>
            ) : (
              <ul className="space-y-2">
                {entries.map((e) => {
                  const pnl = computeJournalPnl(e)
                  return (
                    <li key={e.id} className="rounded-xl bg-white/5 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">
                          #{e.id}｜{e.trade_date.slice(0, 10)}｜{displayStockLabel(e.symbol, locale, { names: stockNames[normalizeStockCode(e.symbol)] })}｜{e.direction === 'short' ? t.directionShort : t.directionLong}
                          <span className={pnl >= 0 ? 'text-[var(--accent-green)]' : 'text-red-400'}>｜{fmt(pnl)}</span>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(e)} className="text-xs text-[var(--accent)] hover:underline">{t.btnEdit}</button>
                          <button onClick={() => handleDelete(e.id)} className="text-xs text-red-400 hover:underline">{t.btnDelete}</button>
                        </div>
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] mt-1">
                        {t.fieldEntryPrice} {fmt(e.entry_price)}／{t.fieldExitPrice} {fmt(e.exit_price)}／{t.fieldShares} {e.shares}／{t.fieldStopLoss}：{Number(e.stop_loss_obeyed) === 1 ? t.stopLossYes : t.stopLossNo}
                      </div>
                      <div className="text-xs mt-1 opacity-80">{e.reason}</div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setShowForm(false); resetForm() }} />
          <div className={`${cardCls} relative w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-3`}>
            <h3 className="font-semibold">{editingId ? t.formEditTitle : t.formAddTitle}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{t.fieldDate}</label>
                <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t.fieldSymbol}</label>
                <input value={fSymbol} onChange={(e) => setFSymbol(e.target.value)} placeholder="2330" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t.fieldDirection}</label>
                <select value={fDirection} onChange={(e) => setFDirection(e.target.value as 'long' | 'short' | '')} className={inputCls}>
                  <option value="">—</option>
                  <option value="long">{t.directionLong}</option>
                  <option value="short">{t.directionShort}</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>{t.fieldShares}</label>
                <input type="number" min="0" value={fShares} onChange={(e) => setFShares(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t.fieldEntryPrice}</label>
                <input type="number" min="0" value={fEntry} onChange={(e) => setFEntry(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t.fieldExitPrice}</label>
                <input type="number" min="0" value={fExit} onChange={(e) => setFExit(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>{t.fieldReason}</label>
              <textarea value={fReason} onChange={(e) => setFReason(e.target.value)} placeholder={t.fieldReasonPlaceholder} rows={3} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t.fieldStopLoss}</label>
              <select value={fStop} onChange={(e) => setFStop(e.target.value as 'yes' | 'no' | '')} className={inputCls}>
                <option value="">—</option>
                <option value="yes">{t.stopLossYes}</option>
                <option value="no">{t.stopLossNo}</option>
              </select>
            </div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowForm(false); resetForm() }} className="px-4 py-2 rounded-lg bg-white/10 text-sm hover:bg-white/15 transition">{t.btnCancel}</button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                {saving ? t.btnSaving : t.btnSave}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
