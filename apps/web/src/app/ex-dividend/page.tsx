'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarDays, ChevronDown, Copy, Info } from 'lucide-react'
import { TableSkeleton } from '@/components/table-skeleton'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'

// Issue #67：AI 填息王 /ex-dividend（MVP 純統計，免 AI）。
// 文案紅線：僅歷史統計＋免責，禁「預測/保證」字眼；機率＝過去填息事件佔比。
// 版面：手機優先（360px 無橫向溢出：max-w-3xl＋表格 overflow-x-auto）。

interface ExDividendEventFill {
  exDate: string
  preClose: number
  cashDividend: number | null
  filled: boolean
  daysToFill: number | null
  matured: boolean
  maxDrawdownPct: number
}

interface ExDividendStats {
  eventCount: number
  insufficient: boolean
  fillRateD1: number | null
  fillRateD5: number | null
  fillRateD10: number | null
  fillRateD20: number | null
  fillRateD40: number | null
  expiryFillRate: number | null
  maturedCount: number
  avgFillDays: number | null
  maxUnfilledDrawdownPct: number | null
  fillScore: number | null
  events: ExDividendEventFill[]
  yearsCovered: string[]
  years_incomplete: boolean
  history_since: string | null
}

interface ExDividendItem {
  symbol: string
  name: string | null
  ex_date: string
  ex_last_buy_date: string
  days_to_ex: number | null
  cash_dividend: number
  yield_pct: number | null
  quote_type: string
  asset_kind: 'etf' | 'stock' | 'unknown'
  asset_label: string
  stats: ExDividendStats | null
  stats_reason: 'ok' | 'insufficient' | 'no-history'
}

interface ExDividendResponse {
  success: boolean
  today: string
  window_end: string
  cache_as_of: string | null
  is_trading_day: boolean
  degraded: boolean
  notice: string
  source: string
  truncated: boolean
  total: number
  items: ExDividendItem[]
  error?: string
}

function fmtPct(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(1)}%`
}

function countdownBadge(days: number | null): { text: string; hot: boolean } {
  if (days == null) return { text: '—', hot: false }
  if (days < 0) return { text: '已除息', hot: false }
  if (days === 0) return { text: '今日除息', hot: true }
  return { text: `T-${days}`, hot: days <= 3 }
}

export default function ExDividendPage() {
  const [data, setData] = useState<ExDividendResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'date' | 'score'>('date')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const typo = useTableTypography()

  useEffect(() => {
    let cancelled = false
    fetch('/api/ex-dividend')
      .then((res) => res.json())
      .then((json: ExDividendResponse) => {
        if (cancelled) return
        if (json?.success) setData(json)
        else setError(json?.error ?? '讀取失敗')
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '讀取失敗')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = (symbol: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(symbol)) next.delete(symbol)
      else next.add(symbol)
      return next
    })
  }

  const items = [...(data?.items ?? [])].sort((a, b) => {
    if (sortBy === 'score') {
      const sa = a.stats?.fillScore ?? -1
      const sb = b.stats?.fillScore ?? -1
      if (sb !== sa) return sb - sa
    }
    return a.ex_date < b.ex_date ? -1 : a.ex_date > b.ex_date ? 1 : a.symbol.localeCompare(b.symbol)
  })

  const share = async () => {
    try {
      const url = window.location.href
      if (navigator.share) {
        await navigator.share({ title: '除權息填息統計', url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      try {
        await navigator.clipboard.writeText(window.location.href)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {}
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-3 py-6 space-y-4 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-[var(--text-primary)]">除權息填息統計</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
            未來 30 天上市＋ETF除權息清單，附過去填息統計（歷史佔比，非投資建議）。
          </p>
        </div>
        <button
          onClick={share}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <Copy className="w-3.5 h-3.5" />
          {copied ? '已複製' : '分享'}
        </button>
      </div>

      {loading && (
        <TableSkeleton message="載入除權息資料中…" hint="首次載入需彙整預告與歷史回測，約需數秒，請稍候" />
      )}

      {!loading && error && (
        <div className="rounded-xl bg-[var(--bg-card)] border border-red-500/30 p-4 text-sm text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>讀取失敗：{error}</span>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 text-xs text-[var(--text-secondary)] leading-relaxed space-y-1.5">
            <p className="flex items-start gap-2">
              <CalendarDays className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent)]" />
              <span>
                資料時間：{data.cache_as_of ?? '無快取紀錄'}（今日 {data.today}
                {data.is_trading_day ? '' : '，非交易日'}；窗口至 {data.window_end}，共 {data.total} 檔
                {data.truncated ? '（僅顯示前 60 檔）' : ''}）。
              </span>
            </p>
            <p>{data.source}。</p>
            {data.degraded && (
              <p className="flex items-start gap-2 text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>預告快取非最新（降級顯示），除息日可能異動，請以 TWSE 公告為準。</span>
              </p>
            )}
            {!data.degraded && <p>{data.notice}</p>}
          </div>

          {items.length === 0 ? (
            <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-6 text-sm text-[var(--text-secondary)] text-center">
              未來 30 天無上市＋ETF除權息預告。
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[var(--text-secondary)]">排序：</span>
                <button
                  onClick={() => setSortBy('date')}
                  className={`px-3 py-1.5 rounded-lg border ${sortBy === 'date' ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-white/10 text-[var(--text-secondary)]'}`}
                >
                  除息日
                </button>
                <button
                  onClick={() => setSortBy('score')}
                  className={`px-3 py-1.5 rounded-lg border ${sortBy === 'score' ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-white/10 text-[var(--text-secondary)]'}`}
                >
                  填息力
                </button>
              </div>

              <div className="space-y-3">
                {items.map((item) => {
                  const cd = countdownBadge(item.days_to_ex)
                  const open = expanded.has(item.symbol)
                  const st = item.stats
                  return (
                    <div key={item.symbol} className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 min-w-0">
                      <button onClick={() => toggle(item.symbol)} className="w-full text-left min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold text-[var(--text-primary)]">{item.symbol}</span>
                            {item.name && (
                              <span className="text-xs text-[var(--text-secondary)] truncate">{item.name}</span>
                            )}
                            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-[var(--text-secondary)]">
                              {item.asset_label}
                            </span>
                          </div>
                          <span className="flex items-center gap-1 shrink-0">
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-full ${cd.hot ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-[var(--text-secondary)]'}`}
                            >
                              {cd.text}
                            </span>
                            <ChevronDown className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`} />
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                          <div className="min-w-0">
                            <div className="text-[10px] text-[var(--text-secondary)]">除息日</div>
                            <div className="text-xs font-semibold text-[var(--text-primary)]">{item.ex_date}</div>
                            <div className="text-[10px] text-[var(--text-secondary)] truncate">
                              最後買進 {item.ex_last_buy_date || '—'}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] text-[var(--text-secondary)]">填息機率(D20)</div>
                            <div className="text-xs font-semibold text-[var(--text-primary)]">
                              {st && !st.insufficient ? fmtPct(st.fillRateD20) : '樣本不足'}
                            </div>
                            <div className="text-[10px] text-[var(--text-secondary)]">
                              到期 {st && !st.insufficient ? fmtPct(st.expiryFillRate) : '—'}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] text-[var(--text-secondary)]">平均填息天數</div>
                            <div className="text-xs font-semibold text-[var(--text-primary)]">
                              {st && !st.insufficient && st.avgFillDays != null ? `${st.avgFillDays} 天` : '—'}
                            </div>
                            <div className="text-[10px] text-[var(--text-secondary)]">
                              殖利率 {item.yield_pct != null ? `${item.yield_pct}%` : '—'}
                            </div>
                          </div>
                        </div>
                        {st && !st.insufficient && st.fillScore != null && (
                          <div className="mt-2.5 flex items-center gap-2">
                            <span className="text-[10px] text-[var(--text-secondary)] shrink-0">填息力 {st.fillScore}</span>
                            <div className="h-1.5 flex-1 rounded-full bg-white/5 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[var(--accent)]"
                                style={{ width: `${Math.max(0, Math.min(100, st.fillScore))}%` }}
                              />
                            </div>
                          </div>
                        )}
                        {item.ex_last_buy_date === data.today && (
                          <p className="mt-2 text-[11px] text-amber-300">今日為除息最後買進日（ex_last_buy_date）。</p>
                        )}
                      </button>

                      {open && (
                        <div className="mt-3 pt-3 border-t border-white/5 space-y-2 min-w-0">
                          {item.stats_reason === 'no-history' && (
                            <p className="text-xs text-[var(--text-secondary)]">
                              尚無還原股價或歷史除息紀錄可回測（樣本不足）。
                            </p>
                          )}
                          {st && st.insufficient && (
                            <p className="text-xs text-amber-300 flex items-start gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>樣本不足（{st.eventCount} 筆事件，需 ≥3 筆才評分），不顯示機率硬分數。</span>
                            </p>
                          )}
                          {st && !st.insufficient && (
                            <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
                              D1 {fmtPct(st.fillRateD1)}／D5 {fmtPct(st.fillRateD5)}／D10 {fmtPct(st.fillRateD10)}／
                              D20 {fmtPct(st.fillRateD20)}／D40 {fmtPct(st.fillRateD40)}；到期填息{' '}
                              {fmtPct(st.expiryFillRate)}（{st.maturedCount} 筆滿窗）；最大未填息幅度{' '}
                              {st.maxUnfilledDrawdownPct != null ? `${st.maxUnfilledDrawdownPct}%` : '—'}。
                            </div>
                          )}
                          {st && st.years_incomplete && (
                            <p className="text-[11px] text-[var(--text-secondary)]">
                              年份不全（還原股價自 {st.history_since} 起，涵蓋 {st.yearsCovered.join('、') || '無'}）。
                            </p>
                          )}
                          {st && st.events.length > 0 && (
                            <div className="overflow-x-auto -mx-1 px-1">
                              <table className={tableClass(typo, 'w-full whitespace-nowrap', 'text-[11px]')}>
                                <thead>
                                  <tr className={headTrClass(typo, 'text-[var(--text-secondary)] text-left', '')}>
                                    <th className="py-1 pr-3 font-medium">除息日</th>
                                    <th className="py-1 pr-3 font-medium">除息前收盤</th>
                                    <th className="py-1 pr-3 font-medium">填息</th>
                                    <th className="py-1 font-medium">天數</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[...st.events].reverse().slice(0, 12).map((e) => (
                                    <tr key={e.exDate} className="border-t border-white/5 text-[var(--text-primary)]">
                                      <td className="py-1 pr-3">{e.exDate}</td>
                                      <td className="py-1 pr-3">{e.preClose.toFixed(2)}</td>
                                      <td className="py-1 pr-3">{e.filled ? '是' : '否'}</td>
                                      <td className="py-1">{e.daysToFill ?? '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 text-xs text-[var(--text-secondary)] leading-relaxed space-y-2">
        <p className="flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent)]" />
          <span>
            機率為過去填息事件的歷史統計，不代表未來表現，亦非投資建議。填息定義為收盤重返除息前收盤；
            價格採 Yahoo 還原權值，除息事件採 TWSE TWT48U 預告累積＋本地快取（上櫃標的不含）。
          </span>
        </p>
        <p>
          使用即代表同意 <Link href="/terms" className="underline hover:text-[var(--text-primary)]">服務條款</Link>。
        </p>
      </div>
    </div>
  )
}
