'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarDays, Flame, Info, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react'
import { TableSkeleton } from '@/components/table-skeleton'
import { googleStockSearchUrl } from '@/lib/stock-search-url'
import { useI18n } from '@/i18n/LanguageProvider'
import { localizePath } from '@/i18n/paths'
import type { Locale } from '@/i18n/config'

const MOVERS_COPY: Record<
  Locale,
  {
    badgePostMarket: string
    badgeTwse: string
    selectDateAria: string
    title: string
    loadingMsg: string
    loadingHint: string
    loadFail: string
    loadErrFallback: string
    summaryTag: (d: string) => string
    degradedTag: (r: string | null) => string
    upCount: string
    downCount: string
    flatCount: string
    limitUpCount: string
    limitDownCount: string
    punishTitle: (p: number, n: number) => string
    punishEmpty: string
    punishBadge: string
    noticeBadge: string
    newBadge: string
    announceDate: (d: string) => string
    limitUpTitle: string
    limitUpEmpty: string
    limitDownTitle: string
    limitDownEmpty: string
    volumeSurgeTitle: string
    volumeSurgeEmpty: string
    instBuyTitle: string
    instSellTitle: string
    instEmpty: string
    exNote: string
    disclaimerPre: string
    disclaimerLink: string
    termsPre: string
    termsLink: string
  }
> = {
  'zh-TW': {
    badgePostMarket: '盤後快訊',
    badgeTwse: '上市',
    selectDateAria: '選擇日報日期',
    title: '台股收盤異動日報',
    loadingMsg: '彙整今日收盤異動資料中…',
    loadingHint: '整合漲跌停、爆量、處置注意股與法人動向',
    loadFail: '讀取失敗：',
    loadErrFallback: '載入失敗',
    summaryTag: (d) => `今日一句話（${d}）`,
    degradedTag: (r) => `部分盤後資料尚待更新（${r ?? ''}）`,
    upCount: '上漲家數',
    downCount: '下跌家數',
    flatCount: '平盤家數',
    limitUpCount: '漲停家數',
    limitDownCount: '跌停家數',
    punishTitle: (p, n) => `處置與注意股公告（處置 ${p} · 注意 ${n}）`,
    punishEmpty: '今日無處置／注意股公告資料。',
    punishBadge: '處置',
    noticeBadge: '注意',
    newBadge: '新增',
    announceDate: (d) => `公告日 ${d}`,
    limitUpTitle: '漲停焦點 Top 10',
    limitUpEmpty: '今日無漲停個股',
    limitDownTitle: '跌停焦點 Top 10',
    limitDownEmpty: '今日無跌停個股',
    volumeSurgeTitle: '爆量／成交焦點 Top 10',
    volumeSurgeEmpty: '暫無爆量資料',
    instBuyTitle: '外資＋投信買超 Top 10',
    instSellTitle: '外資＋投信賣超 Top 10',
    instEmpty: '盤後法人資料尚未公布或無紀錄',
    exNote: '（參考價例外）',
    disclaimerPre:
      '僅為統計參考，非投資建議。資料來源為 TWSE OpenAPI（STOCK_DAY_ALL、處置／注意公告、TWT38U/TWT44U）；若遇除權息參考價調整或盤後資料延遲，系統將標註並保留最近交易日快照。訂閱收盤異動通知沿用 ',
    disclaimerLink: '市場焦點訂閱名單',
    termsPre: '使用即代表同意 ',
    termsLink: '服務條款',
  },
  en: {
    badgePostMarket: 'After-Hours',
    badgeTwse: 'TWSE',
    selectDateAria: 'Select report date',
    title: 'TWSE Daily Market Movers',
    loadingMsg: 'Loading daily closing movers…',
    loadingHint: 'Aggregating limit-up/down, volume surges, disposition notices & institutional flows',
    loadFail: 'Failed to load: ',
    loadErrFallback: 'Failed to load',
    summaryTag: (d) => `Daily Takeaway (${d})`,
    degradedTag: (r) => `Some after-hours data pending (${r ?? ''})`,
    upCount: 'Advancers',
    downCount: 'Decliners',
    flatCount: 'Unchanged',
    limitUpCount: 'Limit Up',
    limitDownCount: 'Limit Down',
    punishTitle: (p, n) => `Disposition & Attention Stocks (Disp. ${p} · Attn. ${n})`,
    punishEmpty: 'No disposition or attention notices today.',
    punishBadge: 'Disposition',
    noticeBadge: 'Attention',
    newBadge: 'New',
    announceDate: (d) => `Announced ${d}`,
    limitUpTitle: 'Limit-Up Top 10',
    limitUpEmpty: 'No limit-up stocks today',
    limitDownTitle: 'Limit-Down Top 10',
    limitDownEmpty: 'No limit-down stocks today',
    volumeSurgeTitle: 'Volume Surge Top 10',
    volumeSurgeEmpty: 'No volume surge data',
    instBuyTitle: 'Foreign + Trust Net Buy Top 10',
    instSellTitle: 'Foreign + Trust Net Sell Top 10',
    instEmpty: 'Institutional flow data pending or unavailable',
    exNote: '(Ex-Ref)',
    disclaimerPre:
      'Statistical reference only, not investment advice. Data sourced from TWSE OpenAPI. Daily close alerts share ',
    disclaimerLink: 'Market Focus Subscription List',
    termsPre: 'By using this tool, you agree to our ',
    termsLink: 'Terms of Service',
  },
  ja: {
    badgePostMarket: '大引け後速報',
    badgeTwse: 'TWSE 上場',
    selectDateAria: 'レポート日付を選択',
    title: '台湾株 引け後値動き日報',
    loadingMsg: '本日の引け後データを集計中…',
    loadingHint: 'ストップ高/安、出来高急増、注意処置銘柄および機関投資家動向を統合',
    loadFail: '読み込み失敗：',
    loadErrFallback: '読み込み失敗',
    summaryTag: (d) => `本日の一言（${d}）`,
    degradedTag: (r) => `一部データ更新待ち（${r ?? ''}）`,
    upCount: '値上がり',
    downCount: '値下がり',
    flatCount: '変わらず',
    limitUpCount: 'ストップ高',
    limitDownCount: 'ストップ安',
    punishTitle: (p, n) => `処置・注意銘柄（処置 ${p} · 注意 ${n}）`,
    punishEmpty: '本日の処置・注意公表はありません。',
    punishBadge: '処置',
    noticeBadge: '注意',
    newBadge: '新規',
    announceDate: (d) => `公表日 ${d}`,
    limitUpTitle: 'ストップ高 Top 10',
    limitUpEmpty: '本日のストップ高銘柄なし',
    limitDownTitle: 'ストップ安 Top 10',
    limitDownEmpty: '本日のストップ安銘柄なし',
    volumeSurgeTitle: '出来高急増 Top 10',
    volumeSurgeEmpty: '出来高急増データなし',
    instBuyTitle: '外資＋投信 買い越し Top 10',
    instSellTitle: '外資＋投信 売り越し Top 10',
    instEmpty: '機関投資家売買データは未公表または記録なし',
    exNote: '（権利落基準値例外）',
    disclaimerPre:
      '統計参考情報であり投資助言ではありません。TWSE OpenAPI の公開データを利用しています。配信通知は ',
    disclaimerLink: '市場フォーカス購読リスト',
    termsPre: 'ご利用にあたり ',
    termsLink: '利用規約',
  },
}

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
  const { locale } = useI18n()
  const t = MOVERS_COPY[locale] ?? MOVERS_COPY['zh-TW']
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
          setError(json?.error ?? t.loadErrFallback)
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : t.loadErrFallback)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="max-w-4xl mx-auto w-full px-4 py-8 md:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Flame className="w-6 h-6 text-[var(--accent)]" />
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">
            {t.badgePostMarket}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">
            {t.badgeTwse}
          </span>
        </div>
        {data && data.availableDates.length > 0 ? (
          <div className="flex items-center gap-2 text-xs">
            <CalendarDays className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            <select
              aria-label={t.selectDateAria}
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

      <h1 className="text-3xl font-bold mb-3">{t.title}</h1>
      <div className="mb-5 w-16 h-1 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-green)]" />

      {loading ? (
        <TableSkeleton message={t.loadingMsg} hint={t.loadingHint} />
      ) : error ? (
        <div className="rounded-xl border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/5 px-4 py-3 text-sm text-[var(--text-primary)] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent-red)]" />
          <span>{t.loadFail}{error}</span>
        </div>
      ) : data ? (
        <div className="space-y-5">
          {/* 今日一句話 */}
          <div className="rounded-xl border border-white/10 bg-[var(--bg-card)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-semibold text-[var(--accent)]">{t.summaryTag(data.tradeDate)}</span>
              {data.degraded ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  {t.degradedTag(data.degradedReason)}
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
              <div className="text-[11px] text-[var(--text-secondary)]">{t.upCount}</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-[var(--accent-red)]">{data.breadth.up}</div>
            </div>
            <div className="rounded-xl border border-white/5 bg-[var(--bg-card)] p-3">
              <div className="text-[11px] text-[var(--text-secondary)]">{t.downCount}</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-[var(--accent-green)]">{data.breadth.down}</div>
            </div>
            <div className="rounded-xl border border-white/5 bg-[var(--bg-card)] p-3">
              <div className="text-[11px] text-[var(--text-secondary)]">{t.flatCount}</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-[var(--text-primary)]">{data.breadth.flat}</div>
            </div>
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
              <div className="text-[11px] text-rose-300">{t.limitUpCount}</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-rose-400">{data.breadth.limitUp}</div>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="text-[11px] text-emerald-300">{t.limitDownCount}</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-emerald-400">{data.breadth.limitDown}</div>
            </div>
          </div>

          {/* 處置與注意股警示 */}
          <div className="rounded-xl border border-amber-500/20 bg-[var(--bg-card)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {t.punishTitle(data.punish.length, data.notice.length)}
              </h2>
            </div>
            {data.punish.length === 0 && data.notice.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">{t.punishEmpty}</p>
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
                          {item.type === 'punish' ? t.punishBadge : t.noticeBadge}
                        </span>
                        {item.isNew ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-300">
                            {t.newBadge}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)] line-clamp-2">
                      {item.reason || t.announceDate(item.date)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 漲停 & 跌停 Top 10 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MoverQuoteCard
              title={t.limitUpTitle}
              icon={<TrendingUp className="w-4 h-4 text-rose-400" />}
              items={data.limitUp}
              emptyText={t.limitUpEmpty}
              accent="up"
              exNoteText={t.exNote}
            />
            <MoverQuoteCard
              title={t.limitDownTitle}
              icon={<TrendingDown className="w-4 h-4 text-emerald-400" />}
              items={data.limitDown}
              emptyText={t.limitDownEmpty}
              accent="down"
              exNoteText={t.exNote}
            />
          </div>

          {/* 爆量 Top 10 */}
          <MoverQuoteCard
            title={t.volumeSurgeTitle}
            icon={<Flame className="w-4 h-4 text-amber-400" />}
            items={data.volumeSurge}
            emptyText={t.volumeSurgeEmpty}
            accent="neutral"
            showVolumeRatio
            exNoteText={t.exNote}
          />

          {/* 法人買賣超 Top 10 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InstListCard title={t.instBuyTitle} items={data.instBuy} buy emptyText={t.instEmpty} />
            <InstListCard title={t.instSellTitle} items={data.instSell} buy={false} emptyText={t.instEmpty} />
          </div>
        </div>
      ) : null}

      <div className="mt-6 rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 text-xs text-[var(--text-secondary)] leading-relaxed space-y-2">
        <p className="flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent)]" />
          <span>
            {t.disclaimerPre}
            <Link href={localizePath(locale, '/market-focus')} className="underline hover:text-[var(--text-primary)]">
              {t.disclaimerLink}
            </Link>
            。
          </span>
        </p>
        <p>
          {t.termsPre}
          <Link href={localizePath(locale, '/terms')} className="underline hover:text-[var(--text-primary)]">
            {t.termsLink}
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
  exNoteText = '（參考價例外）',
}: {
  title: string
  icon: React.ReactNode
  items: MoverQuoteItem[]
  emptyText: string
  accent: 'up' | 'down' | 'neutral'
  showVolumeRatio?: boolean
  exNoteText?: string
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
                  <span className="ml-1.5 text-[10px] text-amber-300">{exNoteText}</span>
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
  emptyText = '盤後法人資料尚未公布或無紀錄',
}: {
  title: string
  items: InstMoverItem[]
  buy: boolean
  emptyText?: string
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-[var(--bg-card)] p-4">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{title}</h2>
      {items.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">{emptyText}</p>
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
