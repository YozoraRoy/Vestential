'use client'

import { useEffect, useState, Fragment } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarDays, ChevronDown, Info, Radar } from 'lucide-react'

// Issue #71：主力籌碼雷達 /chip-radar（MVP 純統計，免 AI）。
// 文案紅線：僅歷史統計＋免責「統計訊號非投資建議」，禁「預測/必漲」字眼；
// 融資未含（PoC FAIL）：融資欄固定「未含融資」，diverge 永不掛標籤（第二期）。
// 版面：手機優先（360px 無橫向溢出：max-w-3xl＋表格 overflow-x-auto，沿 ex-dividend 頁）。

interface ChipAnomalyRow {
  symbol: string
  name: string
  direction: 'buy' | 'sell'
  days: number
  netShares: number
  ratioPct: number
  trend: number[]
  diverge: boolean
  marginNote: string
}

interface ChipRadarResponse {
  success: boolean
  today: string
  as_of: string | null
  is_trading_day: boolean
  status: 'ok' | 'closed' | 'degraded'
  degraded: boolean
  degraded_reason: string | null
  notice: string
  source: string
  margin_available: boolean
  thresholds: { consec_days: number; ratio_pct: number; margin_diverge_on: boolean }
  window_days: string[]
  scanned: number
  items: ChipAnomalyRow[]
  error?: string
}

function fmtShares(n: number): string {
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (a >= 100_000_000) return `${sign}${(a / 100_000_000).toFixed(2)}億`
  if (a >= 10_000) return `${sign}${(a / 10_000).toFixed(1)}萬`
  return `${sign}${a.toLocaleString('en-US')}`
}

function fmtDate(maybeIso: string | null): string {
  if (!maybeIso) return '—'
  const m = maybeIso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[1]}/${m[2]}/${m[3]}` : maybeIso
}

/** 單檔 mini 趨勢軸：近 5 日法人淨超橫條（紅＝賣超／綠＝買超，股數）。 */
function MiniTrend({ trend, days }: { trend: number[]; days: string[] }) {
  const max = Math.max(...trend.map((v) => Math.abs(v)), 1)
  return (
    <div className="space-y-1.5 py-1">
      {trend.map((v, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px]">
          <span className="w-14 shrink-0 text-[var(--text-secondary)]">{fmtDate(days[i] ?? null).slice(5)}</span>
          <div className="flex-1 h-3 rounded bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded ${v >= 0 ? 'bg-[var(--accent-green)]/70' : 'bg-[var(--accent-red)]/70'}`}
              style={{ width: `${Math.max(2, (Math.abs(v) / max) * 100)}%` }}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-[var(--text-primary)]">
            {v >= 0 ? '+' : '−'}{fmtShares(Math.abs(v))}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function ChipRadarPage() {
  const [data, setData] = useState<ChipRadarResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    fetch('/api/chip-radar')
      .then((res) => res.json())
      .then((json: ChipRadarResponse) => {
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

  return (
    <div className="max-w-3xl mx-auto w-full px-4 py-8 md:py-10">
      <div className="flex items-center gap-2 mb-3">
        <Radar className="w-6 h-6 text-[var(--accent)]" />
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">盤後統計</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">上市</span>
      </div>
      <h1 className="text-3xl font-bold mb-3">主力籌碼雷達</h1>
      <div className="mb-6 w-16 h-1 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-green)]" />
      <p className="max-w-2xl text-base text-[var(--text-secondary)] leading-relaxed mb-6">
        每天盤後 1 分鐘看懂「今天誰被主力連買、誰被大戶倒貨」：外資＋投信連買／連賣天數＋佔成交額比，達門檻即上榜。
      </p>

      {loading ? (
        <p className="text-sm text-[var(--text-secondary)]">載入中…</p>
      ) : error ? (
        <div className="rounded-xl border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/5 px-4 py-3 text-sm text-[var(--text-primary)] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent-red)]" />
          <span>讀取失敗：{error}</span>
        </div>
      ) : data ? (
        <>
          {/* 資料時間＋盤後初值標註 */}
          <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-[var(--text-secondary)]">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" />
              資料時間：{fmtDate(data.as_of)}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-300 border border-amber-400/20">盤後初值</span>
            {data.degraded && data.degraded_reason !== 'non-trading-day' ? (
              <span className="px-2 py-0.5 rounded-full bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/20">
                降級顯示（{data.degraded_reason}）
              </span>
            ) : null}
          </div>

          {/* 休市 */}
          {!data.is_trading_day || data.status === 'closed' ? (
            <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 px-6 py-10 text-center">
              <p className="text-lg font-semibold text-[var(--text-primary)] mb-2">休市無新盤</p>
              <p className="text-sm text-[var(--text-secondary)]">
                今日為非交易日，榜單維持 {fmtDate(data.as_of)}（最近交易日）資料，不重抓。
              </p>
            </div>
          ) : data.items.length === 0 ? (
            <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 px-6 py-10 text-center">
              <p className="text-base font-semibold text-[var(--text-primary)] mb-2">今日無異常標的</p>
              <p className="text-sm text-[var(--text-secondary)]">
                {data.degraded_reason === 'insufficient-days'
                  ? '法人資料天數不足（缺檔），暫不列榜，請稍後再試。'
                  : `掃描 ${data.scanned} 檔，無連買／賣達 ${data.thresholds.consec_days} 天且佔比達 ${data.thresholds.ratio_pct}% 者。`}
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-[var(--text-secondary)] mb-3">
                門檻：連買／賣 ≥{data.thresholds.consec_days} 天且佔比 ≥{data.thresholds.ratio_pct}%（後台可調）· 掃描 {data.scanned} 檔 · 點列展開近 5 日趨勢
              </p>
              <div className="overflow-x-auto rounded-xl border border-white/5 mb-6">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="text-left text-xs text-[var(--text-secondary)] bg-white/5">
                      <th className="px-3 py-2.5 font-medium">代號</th>
                      <th className="px-3 py-2.5 font-medium">方向</th>
                      <th className="px-3 py-2.5 font-medium text-right">當日淨超</th>
                      <th className="px-3 py-2.5 font-medium text-right">佔比</th>
                      <th className="px-3 py-2.5 font-medium">融資變動</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((it) => {
                      const isOpen = expanded.has(it.symbol)
                      return (
                        <FragmentRow
                          key={it.symbol}
                          it={it}
                          isOpen={isOpen}
                          onToggle={() => toggle(it.symbol)}
                          windowDays={data.window_days}
                        />
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      ) : null}

      <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 text-xs text-[var(--text-secondary)] leading-relaxed space-y-2">
        <p className="flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent)]" />
          <span>
            統計訊號非投資建議。法人＝外資合計（TWT38U）＋投信（TWT44U）；佔比＝|當日淨超×收盤|／成交額（STOCK_DAY_ALL）；
            上市標的為主（上櫃、分點集中度另案）；融資券本期未含（第二期）。
          </span>
        </p>
        <p>
          使用即代表同意 <Link href="/terms" className="underline hover:text-[var(--text-primary)]">服務條款</Link>。
        </p>
      </div>
    </div>
  )
}

function FragmentRow({
  it,
  isOpen,
  onToggle,
  windowDays,
}: {
  it: ChipAnomalyRow
  isOpen: boolean
  onToggle: () => void
  windowDays: string[]
}) {
  const buy = it.direction === 'buy'
  return (
    <Fragment>
      <tr
        className="border-t border-white/5 text-[var(--text-primary)] cursor-pointer hover:bg-white/5"
        onClick={onToggle}
      >
        <td className="px-3 py-2.5">
          <span className="font-semibold">{it.symbol}</span>
          <span className="ml-1.5 text-xs text-[var(--text-secondary)]">{it.name}</span>
        </td>
        <td className="px-3 py-2.5">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
              buy ? 'bg-[var(--accent-green)]/10 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/10 text-[var(--accent-red)]'
            }`}
          >
            {buy ? `連買${it.days}天` : `連賣${it.days}天`}
            <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </span>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {it.netShares >= 0 ? '+' : '−'}{fmtShares(Math.abs(it.netShares))}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{it.ratioPct.toFixed(2)}%</td>
        <td className="px-3 py-2.5 text-xs text-[var(--text-secondary)]">未含融資</td>
      </tr>
      {isOpen ? (
        <tr className="border-t border-white/5 bg-white/[0.02]">
          <td colSpan={5} className="px-3 py-2">
            <MiniTrend trend={it.trend} days={windowDays} />
            <p className="text-[11px] text-[var(--text-secondary)] pb-1">
              近 5 日法人合計淨超（外資＋投信，股數）{it.diverge ? '' : '· 無背離標籤（未含融資）'}
            </p>
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
}
