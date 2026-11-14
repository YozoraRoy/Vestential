'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarDays, Flame, Info, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react'
import { TableSkeleton } from '@/components/table-skeleton'
import { googleStockSearchUrl } from '@/lib/stock-search-url'

interface MoverQuoteItem {
  code: string
  name: string
  close: number
  change: number
  changePct: number
  volume: number
  tradeValue: number
  volumeRatio: number | null
  limitStatus: 'limit_up' | 'limit_down' | 'none'
  exDividendNote?: boolean
}

interface AnnouncementItem {
  type: 'punish' | 'notice'
  code: string
  name: string
  date: string
  announcementNo: string
  reason: string
  dedupKey: string
  isNew: boolean
}

interface InstMoverItem {
  code: string
  name: string
  netShares: number
  close: number | null
  tradeValue: number | null
}

interface DailyMoversResponse {
  success: boolean
  availableDates: string[]
  tradeDate: string
  summaryText: string
  breadth: {
    total: number
    up: number
    down: number
    flat: number
    limitUp: number
    limitDown: number
  }
  limitUp: MoverQuoteItem[]
  limitDown: MoverQuoteItem[]
  volumeSurge: MoverQuoteItem[]
  punish: AnnouncementItem[]
  notice: AnnouncementItem[]
  instBuy: InstMoverItem[]
  instSell: InstMoverItem[]
  degraded: boolean
  degradedReason: string | null
  error?: string
}

function fmtBillion(val: number): string {
  if (val >= 100_000_000) return `${(val / 100_000_000).toFixed(1)}億`
  if (val >= 10_000) return `${Math.round(val / 10_000)}萬`
  return val.toLocaleString('en-US')
}

function fmtShares(n: number): string {
  const lots = Math.round(n / 1000)
  const sign = lots >= 0 ? '+' : '−'
  return `${sign}${Math.abs(lots).toLocaleString('en-US')}張`
}

export default function DailyMoversPage() {
  const [data, setData] = useState<DailyMoversResponse | null>(null)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = (date?: string) => {
    setLoading(true)
    setError(null)
    const qs = date ? `?date=${encodeURIComponent(date)}` : ''
    fetch(`/api/daily-movers${qs}`)
      .then((res) => res.json())
      .then((json: DailyMoversResponse) => {
        if (json?.success) {
          setData(json)
          setSelectedDate(json.tradeDate)
        } else {
          setError(json?.error ?? '載入失敗')
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '載入失敗')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [])

  return (
    <div className="max-w-4xl mx-auto w-full px-4 py-8 md:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Flame className="w-6 h-6 text-[var(--accent)]" />
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">
            盤後快訊
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">
            上市
          </span>
        </div>
        {data && data.availableDates.length > 0 ? (
          <div className="flex items-center gap-2 text-xs">
            <CalendarDays className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            <select
              aria-label="選擇日報日期"
              value={selectedDate}
              onChange={(e) => loadData(e.target.value)}
              className="rounded-lg border border-white/10 bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
            >
              {data.availableDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <h1 className="text-3xl font-bold mb-3">台股收盤異動日報</h1>
      <div className="mb-5 w-16 h-1 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-green)]" />

      {loading ? (
        <TableSkeleton message="彙整今日收盤異動資料中…" hint="整合漲跌停、爆量、處置注意股與法人動向" />
      ) : error ? (
        <div className="rounded-xl border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/5 px-4 py-3 text-sm text-[var(--text-primary)] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent-red)]" />
          <span>讀取失敗：{error}</span>
        </div>
      ) : data ? (
        <div className="space-y-5">
          {/* 今日一句話 */}
          <div className="rounded-xl border border-white/10 bg-[var(--bg-card)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-semibold text-[var(--accent)]">今日一句話（{data.tradeDate}）</span>
              {data.degraded ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  部分盤後資料尚待更新（{data.degradedReason}）
                </span>
              ) : null}
            </div>
            <p className="text-sm sm:text-base font-medium text-[var(--text-primary)] leading-relaxed">
              {data.summaryText}
            </p>
          </div>

          {/* 市場 Breadth 條 */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            <div className="rounded-xl border border-white/5 bg-[var(--bg-card)] p-3">
              <div className="text-[11px] text-[var(--text-secondary)]">上漲家數</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-[var(--accent-red)]">{data.breadth.up}</div>
            </div>
            <div className="rounded-xl border border-white/5 bg-[var(--bg-card)] p-3">
              <div className="text-[11px] text-[var(--text-secondary)]">下跌家數</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-[var(--accent-green)]">{data.breadth.down}</div>
            </div>
            <div className="rounded-xl border border-white/5 bg-[var(--bg-card)] p-3">
              <div className="text-[11px] text-[var(--text-secondary)]">平盤家數</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-[var(--text-primary)]">{data.breadth.flat}</div>
            </div>
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
              <div className="text-[11px] text-rose-300">漲停家數</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-rose-400">{data.breadth.limitUp}</div>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="text-[11px] text-emerald-300">跌停家數</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-emerald-400">{data.breadth.limitDown}</div>
            </div>
          </div>

          {/* 處置與注意股警示 */}
          <div className="rounded-xl border border-amber-500/20 bg-[var(--bg-card)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                處置與注意股公告（處置 {data.punish.length} · 注意 {data.notice.length}）
              </h2>
            </div>
            {data.punish.length === 0 && data.notice.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">今日無處置／注意股公告資料。</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                {[...data.punish, ...data.notice].slice(0, 12).map((item) => (
                  <div
                    key={item.dedupKey}
                    className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={googleStockSearchUrl(item.code, item.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-[var(--text-primary)] hover:text-[var(--accent)]"
                      >
                        {item.code} {item.name}
                      </a>
                      <div className="flex items-center gap-1">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            item.type === 'punish'
                              ? 'bg-rose-500/15 text-rose-300'
                              : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {item.type === 'punish' ? '處置' : '注意'}
                        </span>
                        {item.isNew ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-300">
                            新增
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)] line-clamp-2">
                      {item.reason || `公告日 ${item.date}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 漲停 & 跌停 Top 10 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MoverQuoteCard
              title="漲停焦點 Top 10"
              icon={<TrendingUp className="w-4 h-4 text-rose-400" />}
              items={data.limitUp}
              emptyText="今日無漲停個股"
              accent="up"
            />
            <MoverQuoteCard
              title="跌停焦點 Top 10"
              icon={<TrendingDown className="w-4 h-4 text-emerald-400" />}
              items={data.limitDown}
              emptyText="今日無跌停個股"
              accent="down"
            />
          </div>

          {/* 爆量 Top 10 */}
          <MoverQuoteCard
            title="爆量／成交焦點 Top 10"
            icon={<Flame className="w-4 h-4 text-amber-400" />}
            items={data.volumeSurge}
            emptyText="暫無爆量資料"
            accent="neutral"
            showVolumeRatio
          />

          {/* 法人買賣超 Top 10 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InstListCard title="外資＋投信買超 Top 10" items={data.instBuy} buy />
            <InstListCard title="外資＋投信賣超 Top 10" items={data.instSell} buy={false} />
          </div>
        </div>
      ) : null}

      <div className="mt-6 rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 text-xs text-[var(--text-secondary)] leading-relaxed space-y-2">
        <p className="flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent)]" />
          <span>
            僅為統計參考，非投資建議。資料來源為 TWSE OpenAPI（STOCK_DAY_ALL、處置／注意公告、TWT38U/TWT44U）；
            若遇除權息參考價調整或盤後資料延遲，系統將標註並保留最近交易日快照。訂閱收盤異動通知沿用{' '}
            <Link href="/market-focus" className="underline hover:text-[var(--text-primary)]">
              市場焦點訂閱名單
            </Link>
            。
          </span>
        </p>
        <p>
          使用即代表同意{' '}
          <Link href="/terms" className="underline hover:text-[var(--text-primary)]">
            服務條款
          </Link>
          。
        </p>
      </div>
    </div>
  )
}

function MoverQuoteCard({
  title,
  icon,
  items,
  emptyText,
  accent,
  showVolumeRatio = false,
}: {
  title: string
  icon: React.ReactNode
  items: MoverQuoteItem[]
  emptyText: string
  accent: 'up' | 'down' | 'neutral'
  showVolumeRatio?: boolean
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-[var(--bg-card)] p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">{emptyText}</p>
      ) : (
        <div className="space-y-1.5 text-xs">
          {items.map((q) => (
            <div
              key={q.code}
              className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.02] px-2.5 py-1.5"
            >
              <div className="min-w-0 truncate">
                <a
                  href={googleStockSearchUrl(q.code, q.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-[var(--text-primary)] hover:text-[var(--accent)]"
                >
                  {q.code} {q.name}
                </a>
                {q.exDividendNote ? (
                  <span className="ml-1.5 text-[10px] text-amber-300">（參考價例外）</span>
                ) : null}
              </div>
              <div className="flex items-center gap-3 shrink-0 tabular-nums">
                <span className="text-[var(--text-secondary)]">{q.close.toFixed(2)}</span>
                <span
                  className={
                    accent === 'up' || q.changePct > 0
                      ? 'text-rose-400 font-semibold'
                      : accent === 'down' || q.changePct < 0
                        ? 'text-emerald-400 font-semibold'
                        : 'text-[var(--text-primary)]'
                  }
                >
                  {q.changePct > 0 ? '+' : ''}
                  {q.changePct.toFixed(2)}%
                </span>
                {showVolumeRatio ? (
                  <span className="text-[11px] text-amber-300">
                    {q.volumeRatio !== null ? `${q.volumeRatio}x` : fmtBillion(q.tradeValue)}
                  </span>
                ) : (
                  <span className="text-[11px] text-[var(--text-secondary)]">{fmtBillion(q.tradeValue)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function InstListCard({
  title,
  items,
  buy,
}: {
  title: string
  items: InstMoverItem[]
  buy: boolean
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-[var(--bg-card)] p-4">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{title}</h2>
      {items.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">盤後法人資料尚未公布或無紀錄</p>
      ) : (
        <div className="space-y-1.5 text-xs">
          {items.map((it) => (
            <div
              key={it.code}
              className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.02] px-2.5 py-1.5"
            >
              <a
                href={googleStockSearchUrl(it.code, it.name)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] truncate"
              >
                {it.code} {it.name}
              </a>
              <span
                className={`shrink-0 font-semibold tabular-nums ${
                  buy ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {fmtShares(it.netShares)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
