'use client'

import { useEffect, useMemo, useState, Fragment } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarDays, ChevronDown, ExternalLink, Info, Radar } from 'lucide-react'
import { TableSkeleton } from '@/components/table-skeleton'
import { googleStockSearchUrl } from '@/lib/stock-search-url'
import { sortChipRows, type ChipSortDir, type ChipSortKey } from '@/lib/chip-sort'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'
import type { LendingLevel } from '@/lib/securities-lending'

// Issue #71：主力籌碼雷達 /chip-radar（MVP 純統計，免 AI）。
// 文案紅線：僅歷史統計＋免責「統計訊號非投資建議」，禁「預測/必漲」字眼；
// 融資未含（PoC FAIL）：融資變動欄已刪（全同值放註腳），diverge 永不掛標籤（第二期）。
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

interface LendingBadgeInfo {
  level: LendingLevel
  consecutiveIncreaseDays: number
  zScore: number | null
  pctChange5d: number | null
  pctChange20d: number | null
  latestBalance: number | null
  insufficientData: boolean
}

interface OrderPlanData {
  symbol: string
  insufficientData: boolean
  barsCount: number
  lastClose: number
  todayVwap: number
  vwap20: number
  ma20: number
  atr14: number
  support60: number
  resistance60: number
  limitBuyPrice: number
  chaseStopPrice: number
  stopLossPrice: number
  breakEvenPrice: number
  riskRewardRatio: number | null
  negativeRiskReward: boolean
  positionSizeSuggestion: {
    capital: number
    riskBudget: number
    riskPerShare: number
    suggestedShares: number
    suggestedLots: number
  }
  vwapMethodology: string
}

interface OrderPlanState {
  loading: boolean
  error?: string
  data?: OrderPlanData
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
  const [lendingMap, setLendingMap] = useState<Record<string, LendingBadgeInfo>>({})
  const [lendingFilter, setLendingFilter] = useState<'all' | 'anomaly'>('all')
  const [orderPlanMap, setOrderPlanMap] = useState<Record<string, OrderPlanState>>({})
  // Issue #75：四欄排序（預設佔比↓＝引擎 ratioPct desc＝API／信件順序）。
  const [sortKey, setSortKey] = useState<ChipSortKey>('ratioPct')
  const [sortDir, setSortDir] = useState<ChipSortDir>('desc')
  const typo = useTableTypography()

  useEffect(() => {
    let cancelled = false
    fetch('/api/chip-radar')
      .then((res) => res.json())
      .then((json: ChipRadarResponse) => {
        if (cancelled) return
        if (json?.success) {
          setData(json)
          if (Array.isArray(json.items) && json.items.length > 0) {
            const syms = json.items.map((x) => x.symbol).join(',')
            fetch(`/api/securities-lending?symbols=${encodeURIComponent(syms)}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((lendingJson) => {
                if (!cancelled && lendingJson?.success && lendingJson.items) {
                  setLendingMap(lendingJson.items as Record<string, LendingBadgeInfo>)
                }
              })
              .catch(() => {})
          }
        }
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

  const toggleSort = (key: ChipSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    // 新欄預設方向：代號 asc／方向 asc（連買在前）／淨超與佔比 desc。
    setSortKey(key)
    setSortDir(key === 'symbol' || key === 'direction' ? 'asc' : 'desc')
  }

  // 排序只重排主列；展開列以代號 key 維持，不受影響。
  const sortedItems = useMemo(() => {
    const base = data ? sortChipRows(data.items, sortKey, sortDir) : []
    if (lendingFilter === 'anomaly') {
      return base.filter((it) => {
        const l = lendingMap[it.symbol]
        return l && (l.level === 'alert' || l.level === 'watch')
      })
    }
    return base
  }, [data, sortKey, sortDir, lendingFilter, lendingMap])

  const loadOrderPlan = (symbol: string) => {
    const existing = orderPlanMap[symbol]
    if (existing && (existing.loading || existing.data)) return
    setOrderPlanMap((prev) => ({ ...prev, [symbol]: { loading: true } }))
    fetch(`/api/chip-radar/order-plan?symbol=${encodeURIComponent(symbol)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || `無法取得 ${symbol} 掛單計畫（${res.status}）`)
        }
        setOrderPlanMap((prev) => ({
          ...prev,
          [symbol]: { loading: false, data: json as OrderPlanData },
        }))
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : '載入掛單計畫失敗'
        setOrderPlanMap((prev) => ({
          ...prev,
          [symbol]: { loading: false, error: msg },
        }))
      })
  }

  const toggle = (symbol: string) => {
    const willOpen = !expanded.has(symbol)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(symbol)) next.delete(symbol)
      else next.add(symbol)
      return next
    })
    if (willOpen) {
      loadOrderPlan(symbol)
    }
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
        <TableSkeleton message="載入籌碼雷達資料中…" hint="盤後榜單讀時即算，約需數秒，請稍候" />
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
              資料時間：{fmtDate(data.as_of)}（盤後初值；上市；未含融資）
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
                門檻：連買／賣 ≥{data.thresholds.consec_days} 天且佔比 ≥{data.thresholds.ratio_pct}%（後台可調）·
                依佔比排序 · 掃描 {data.scanned} 檔 · 點列展開近 5 日趨勢（趨勢軸僅站上提供，信內無）
              </p>
              {/* Issue #151：借券異常快速篩選 */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xs text-[var(--text-secondary)]">借券動能篩選：</span>
                <button
                  type="button"
                  onClick={() => setLendingFilter('all')}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                    lendingFilter === 'all'
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  全部標的 ({data.items.length})
                </button>
                <button
                  type="button"
                  onClick={() => setLendingFilter('anomaly')}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                    lendingFilter === 'anomaly'
                      ? 'bg-rose-500/80 text-white'
                      : 'bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  借券異常
                </button>
              </div>
              {sortedItems.length === 0 ? (
                <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 px-6 py-8 text-center mb-6 text-sm text-[var(--text-secondary)]">
                  目前篩選條件下無借券異常標的
                </div>
              ) : (
              <div className="overflow-x-auto rounded-xl border border-white/5 mb-6">
                <table className={tableClass(typo, 'w-full min-w-[560px]')}>
                  <thead>
                    <tr className={headTrClass(typo, 'text-left text-[var(--text-secondary)] bg-white/5')}>
                      <SortTh
                        label="代號"
                        sortKey="symbol"
                        activeKey={sortKey}
                        dir={sortDir}
                        onToggle={() => toggleSort('symbol')}
                      />
                      <SortTh
                        label="方向"
                        sortKey="direction"
                        activeKey={sortKey}
                        dir={sortDir}
                        onToggle={() => toggleSort('direction')}
                      />
                      <SortTh
                        label="當日淨超"
                        sortKey="netShares"
                        activeKey={sortKey}
                        dir={sortDir}
                        onToggle={() => toggleSort('netShares')}
                        align="right"
                      />
                      <SortTh
                        label="佔比"
                        sortKey="ratioPct"
                        activeKey={sortKey}
                        dir={sortDir}
                        onToggle={() => toggleSort('ratioPct')}
                        align="right"
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map((it) => {
                      const isOpen = expanded.has(it.symbol)
                      return (
                        <FragmentRow
                          key={it.symbol}
                          it={it}
                          isOpen={isOpen}
                          onToggle={() => toggle(it.symbol)}
                          windowDays={data.window_days}
                          lending={lendingMap[it.symbol]}
                          orderPlan={orderPlanMap[it.symbol]}
                        />
                      )
                    })}
                  </tbody>
                </table>
              </div>
              )}
            </>
          )}
        </>
      ) : null}

      <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 text-xs text-[var(--text-secondary)] leading-relaxed space-y-2">
        <p className="flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent)]" />
          <span>
            統計訊號僅為統計參考，非投資建議。法人＝外資合計（TWT38U）＋投信（TWT44U）；借券動能＝TWSE TWT93U 借券賣出餘額（連增天數＋20 日 Z-Score）；佔比＝|當日淨超×收盤|／成交額（STOCK_DAY_ALL）；
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

/** Issue #75 可排序表頭：button 切換 asc/desc，aria-sort 落在 th。 */
function SortTh({
  label,
  sortKey,
  activeKey,
  dir,
  onToggle,
  align,
}: {
  label: string
  sortKey: ChipSortKey
  activeKey: ChipSortKey
  dir: ChipSortDir
  onToggle: () => void
  align?: 'right'
}) {
  const active = activeKey === sortKey
  return (
    <th
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-3 py-2.5 font-medium${align === 'right' ? ' text-right' : ''}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={active ? `${label}（${dir === 'asc' ? '升冪' : '降冪'}，點按切換）` : `${label}（點按排序）`}
        className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] transition"
      >
        {label}
        <span aria-hidden className={`text-[10px] ${active ? 'text-[var(--accent)]' : 'opacity-30'}`}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '▲▼'}
        </span>
      </button>
    </th>
  )
}

function LendingBadge({ lending }: { lending?: LendingBadgeInfo }) {
  if (!lending) return null
  const cfg =
    lending.level === 'alert'
      ? { label: '借券警戒', cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30' }
      : lending.level === 'watch'
        ? { label: '借券注意', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' }
        : { label: '借券正常', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
  const tip = `借券連增 ${lending.consecutiveIncreaseDays} 天 · Z=${lending.zScore ?? '—'}`
  return (
    <span
      title={tip}
      className={`ml-1.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  )
}

function OrderPlanDrawer({ planState }: { planState?: OrderPlanState }) {
  if (!planState || planState.loading) {
    return (
      <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs text-[var(--text-secondary)]">
        計算明日掛單計畫與風險邊界中…
      </div>
    )
  }
  if (planState.error || !planState.data) {
    return (
      <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
        {planState.error ?? '暫無此標的之掛單計畫資料'}
      </div>
    )
  }

  const p = planState.data
  const rrText = p.riskRewardRatio !== null ? `${p.riskRewardRatio.toFixed(2)}x` : '—'

  return (
    <div className="mt-2.5 rounded-xl border border-white/10 bg-[#0d1118]/70 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--text-primary)]">明日掛單計畫</span>
          <span className="text-[11px] text-[var(--text-secondary)]">
            收盤 {p.lastClose.toFixed(2)} · MA20 {p.ma20.toFixed(2)} · ATR(14) {p.atr14.toFixed(2)}
          </span>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            p.negativeRiskReward
              ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
              : (p.riskRewardRatio ?? 0) >= 1.5
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
          }`}
        >
          風險報酬比 {rrText}
        </span>
      </div>

      {p.insufficientData ? (
        <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
          歷史日線不足 60 個交易日（目前僅 {p.barsCount} 日），支撐／壓力與均線僅供參考。
        </p>
      ) : null}

      {p.negativeRiskReward ? (
        <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">
          警示：目前為負或零風險報酬比（近月主力成本／停損價位貼近或高於參考掛單價，或上檔空間有限），請審慎評估風險。
        </p>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-2">
          <div className="text-[10px] text-[var(--text-secondary)]">掛單參考價</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--accent-green)]">
            {p.limitBuyPrice.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-2">
          <div className="text-[10px] text-[var(--text-secondary)]">追價上限</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-amber-300">
            {p.chaseStopPrice.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-2">
          <div className="text-[10px] text-[var(--text-secondary)]">停損參考價</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-rose-400">
            {p.stopLossPrice.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-2">
          <div className="text-[10px] text-[var(--text-secondary)]">保本賣出價</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--text-primary)]">
            {p.breakEvenPrice.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
        <span>
          60日支撐 {p.support60.toFixed(2)} / 壓力 {p.resistance60.toFixed(2)} · 20日成本估算 {p.vwap20.toFixed(2)}
        </span>
        <span>
          2% 風險建議：{p.positionSizeSuggestion.suggestedLots} 張（{p.positionSizeSuggestion.suggestedShares.toLocaleString('en-US')} 股，依 100 萬帳戶）
        </span>
      </div>
      <p className="text-[10px] text-[var(--text-secondary)]/80">
        {p.vwapMethodology}；保本價含買賣手續費 0.1425%＋證交稅 0.3%。僅為統計參考，非投資建議。
      </p>
    </div>
  )
}

function FragmentRow({
  it,
  isOpen,
  onToggle,
  windowDays,
  lending,
  orderPlan,
}: {
  it: ChipAnomalyRow
  isOpen: boolean
  onToggle: () => void
  windowDays: string[]
  lending?: LendingBadgeInfo
  orderPlan?: OrderPlanState
}) {
  const buy = it.direction === 'buy'
  return (
    <Fragment>
      <tr
        className="border-t border-white/5 text-[var(--text-primary)] cursor-pointer hover:bg-white/5"
        onClick={onToggle}
      >
        <td className="px-3 py-2.5">
          <a
            href={googleStockSearchUrl(it.symbol, it.name)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${it.symbol}${it.name} Google 搜尋（另開新頁）`}
            title={`${it.symbol}${it.name} Google 搜尋`}
            onClick={(e) => e.stopPropagation()}
            className="mr-1 inline-flex align-middle text-[var(--text-secondary)] opacity-60 hover:opacity-100 hover:text-[var(--accent)] transition"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
          <span className="font-semibold">{it.symbol}</span>
          <span className="ml-1.5 text-xs text-[var(--text-secondary)]">{it.name}</span>
          <LendingBadge lending={lending} />
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
      </tr>
      {isOpen ? (
        <tr className="border-t border-white/5 bg-white/[0.02]">
          <td colSpan={4} className="px-3 py-2">
            <MiniTrend trend={it.trend} days={windowDays} />
            <p className="text-[11px] text-[var(--text-secondary)] pb-1">
              近 5 日法人合計淨超（外資＋投信，股數）{it.diverge ? '' : '· 無背離標籤（未含融資）'}
              {lending
                ? ` · 借券餘額連增 ${lending.consecutiveIncreaseDays} 日 / 5日變化 ${lending.pctChange5d ?? '—'}% / Z-Score ${lending.zScore ?? '—'}`
                : ''}
            </p>
            <OrderPlanDrawer planState={orderPlan} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
}
