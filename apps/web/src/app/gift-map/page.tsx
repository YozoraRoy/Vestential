'use client'

import React, { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useI18n } from '@/i18n/LanguageProvider'
import { localizePath } from '@/i18n/paths'
import type { Locale } from '@/i18n/config'
import { displayStockName } from '@/lib/stock-display'
import {
  GiftCalendarItem,
  GiftCalendarSummary,
} from '@/lib/gift-map'

const GIFT_COPY: Record<
  Locale,
  {
    backHome: string
    oddLotInfo: string
    breadcrumbGift: string
    seasonActive: string
    seasonReview: string
    title: string
    subtitle: string
    tabActive: string
    tabReview: string
    statToday: string
    statTodaySub: string
    statT3: string
    statT3Sub: string
    statOneShare: string
    statOneShareSub: string
    statTotal: string
    statTotalSub: (yr: number) => string
    unitCount: string
    searchPlaceholder: string
    filterAll: string
    filterOneShare: string
    filterVote: string
    filterMeeting: string
    filterNoGift: string
    filterUnknown: string
    onlyPopular: string
    loading: string
    emptyTitle: string
    emptyHint: string
    popularBadge: string
    meetingDateLabel: string
    pending: string
    giftLabel: string
    lastBuyLabel: string
    eligibilityLabel: string
    distMethodLabel: string
    collapseMops: string
    expandMops: string
    viewOddLot: string
    sourceUrl: string
    disclaimerTitle: string
  }
> = {
  'zh-TW': {
    backHome: '← 回首頁',
    oddLotInfo: '零股情報',
    breadcrumbGift: '紀念品攻略',
    seasonActive: '2027 旺季預備',
    seasonReview: '2026 股東會回顧',
    title: '股東會紀念品最後買進倒數＆領取攻略',
    subtitle: '專為台股零股存股族設計！一眼看清還來得及買哪幾檔、零股能不能領、要不要電子投票，不錯過一年一度的股東會紀念品紅利。',
    tabActive: '🔥 即將截止倒數（2027 旺季預備）',
    tabReview: '🏆 2026 股東會熱門回顧（示範庫）',
    statToday: '今日最後買進',
    statTodaySub: '今天 13:30 盤後截止',
    statT3: 'T-3 內即將截止',
    statT3Sub: '剩餘 1~3 天可下單',
    statOneShare: '零股即可領取',
    statOneShareSub: '一股可領 / 含電子投票',
    statTotal: '已建檔紀念品',
    statTotalSub: (yr) => `${yr} 年度追蹤`,
    unitCount: '檔',
    searchPlaceholder: '搜尋股票代號、名稱、或紀念品關鍵字（如：大魯閣、超商卡、中鋼...）',
    filterAll: '全部資格',
    filterOneShare: '零股可領',
    filterVote: '須電子投票',
    filterMeeting: '限親自出席',
    filterNoGift: '不發放紀念品',
    filterUnknown: '待公司公告',
    onlyPopular: '★ 只看熱門常客',
    loading: '載入股東會紀念品攻略中...',
    emptyTitle: '沒有符合篩選條件的紀念品',
    emptyHint: '建議切換視圖至「🏆 2026 股東會熱門回顧」或清除搜尋字串',
    popularBadge: '熱門',
    meetingDateLabel: '開會日',
    pending: '待公告',
    giftLabel: '股東會紀念品',
    lastBuyLabel: '最後買進日：',
    eligibilityLabel: '零股領取資格：',
    distMethodLabel: '發放管道：',
    collapseMops: '▼ 收合公告說明',
    expandMops: '▶ 查看 MOPS 官方公告原文',
    viewOddLot: '查看盤後零股行情',
    sourceUrl: '來源公告',
    disclaimerTitle: '合規警語與免責聲明',
  },
  en: {
    backHome: '← Home',
    oddLotInfo: 'Odd-Lot Radar',
    breadcrumbGift: 'Shareholder Gifts',
    seasonActive: '2027 Peak Prep',
    seasonReview: '2026 AGM Review',
    title: 'Shareholder Gift Map & Last-Buy Countdown',
    subtitle: 'Built for TWSE odd-lot investors: check which tickers still qualify, 1-share eligibility, e-voting rules, and pickup locations.',
    tabActive: '🔥 Upcoming Deadlines (2027 Prep)',
    tabReview: '🏆 2026 Popular AGM Gifts (Archive)',
    statToday: 'Last Buy Today',
    statTodaySub: 'Cutoff today at 13:30 TWSE',
    statT3: 'Due Within T-3',
    statT3Sub: '1–3 trading days remaining',
    statOneShare: '1-Share Eligible',
    statOneShareSub: 'Odd-lot / e-voting supported',
    statTotal: 'Indexed Gifts',
    statTotalSub: (yr) => `${yr} Season Tracker`,
    unitCount: '',
    searchPlaceholder: 'Search ticker, company, or gift keyword…',
    filterAll: 'All Eligibility',
    filterOneShare: '1-Share Eligible',
    filterVote: 'E-Voting Required',
    filterMeeting: 'In-Person Only',
    filterNoGift: 'No Gift',
    filterUnknown: 'Pending Announcement',
    onlyPopular: '★ Popular Only',
    loading: 'Loading shareholder gift calendar…',
    emptyTitle: 'No matching shareholder gifts',
    emptyHint: 'Try switching to "2026 Popular AGM Gifts" or clearing the search filter.',
    popularBadge: 'Popular',
    meetingDateLabel: 'AGM Date',
    pending: 'Pending',
    giftLabel: 'Shareholder Gift',
    lastBuyLabel: 'Last Buy Date:',
    eligibilityLabel: 'Odd-Lot Rule:',
    distMethodLabel: 'Distribution:',
    collapseMops: '▼ Hide MOPS Notice',
    expandMops: '▶ View Official MOPS Text',
    viewOddLot: 'Check Odd-Lot Quotes',
    sourceUrl: 'Source',
    disclaimerTitle: 'Compliance & Disclaimer',
  },
  ja: {
    backHome: '← ホーム',
    oddLotInfo: '単元未満株情報',
    breadcrumbGift: '株主優待マップ',
    seasonActive: '2027年シーズン準備',
    seasonReview: '2026年総会アーカイブ',
    title: '株主総会記念品・最終買付カウントダウン',
    subtitle: '台湾株の1株投資家向け：まだ間に合う銘柄、1株で受取可能か、電子議決権行使の要否を一覧で確認できます。',
    tabActive: '🔥 締切間近（2027年準備）',
    tabReview: '🏆 2026年人気銘柄アーカイブ',
    statToday: '本日最終買付',
    statTodaySub: '本日 13:30 引けまで',
    statT3: '3営業日以内締切',
    statT3Sub: '残り1〜3日で購入可能',
    statOneShare: '1株で受取可',
    statOneShareSub: '単元未満・電子投票含む',
    statTotal: '登録記念品数',
    statTotalSub: (yr) => `${yr}年度トラッキング`,
    unitCount: '社',
    searchPlaceholder: '銘柄コード・企業名・記念品キーワードで検索…',
    filterAll: 'すべての条件',
    filterOneShare: '1株で受取可',
    filterVote: '電子投票必須',
    filterMeeting: '会場出席限定',
    filterNoGift: '記念品なし',
    filterUnknown: '未公表',
    onlyPopular: '★ 人気銘柄のみ',
    loading: '株主優待データを読み込み中…',
    emptyTitle: '条件に一致する記念品がありません',
    emptyHint: '「2026年人気銘柄アーカイブ」へ切り替えるか検索条件をクリアしてください。',
    popularBadge: '人気',
    meetingDateLabel: '総会日',
    pending: '未公表',
    giftLabel: '株主総会記念品',
    lastBuyLabel: '最終買付日：',
    eligibilityLabel: '単元未満株条件：',
    distMethodLabel: '配布方法：',
    collapseMops: '▼ 公表原文を閉じる',
    expandMops: '▶ MOPS 公式原文を見る',
    viewOddLot: '単元未満株の相場を見る',
    sourceUrl: '公式ソース',
    disclaimerTitle: '免責事項',
  },
}

export default function GiftMapPage() {
  const { locale } = useI18n()
  const t = GIFT_COPY[locale] ?? GIFT_COPY['zh-TW']
  const [view, setView] = useState<'active' | 'review'>('active')
  const [search, setSearch] = useState('')
  const [eligibilityFilter, setEligibilityFilter] = useState<string>('ALL')
  const [onlyPopular, setOnlyPopular] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<GiftCalendarSummary | null>(null)
  const [items, setItems] = useState<GiftCalendarItem[]>([])
  const [disclaimer, setDisclaimer] = useState<string>('')

  // 載入資料
  useEffect(() => {
    let active = true
    setLoading(true)

    fetch(`/api/gifts/calendar?view=${view}&limit=200`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        if (data.success) {
          setSummary(data.summary)
          setItems(data.items ?? [])
          setDisclaimer(data.disclaimer ?? '')
        }
      })
      .catch((err) => console.error('Fetch gift calendar failed:', err))
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [view])

  // 前端即時過濾
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (search.trim()) {
        const kw = search.trim().toLowerCase()
        const match =
          item.stockId.toLowerCase().includes(kw) ||
          item.stockName.toLowerCase().includes(kw) ||
          item.giftName.toLowerCase().includes(kw)
        if (!match) return false
      }

      if (eligibilityFilter !== 'ALL' && item.eligibility !== eligibilityFilter) {
        return false
      }

      if (onlyPopular && !item.isPopular) {
        return false
      }

      return true
    })
  }, [items, search, eligibilityFilter, onlyPopular])

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 pb-16 font-sans">
      {/* 頂部導航 */}
      <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link
              href={localizePath(locale, '/')}
              className="text-xs text-zinc-400 hover:text-white transition flex items-center gap-1"
            >
              <span>{t.backHome}</span>
            </Link>
            <span className="text-zinc-600">/</span>
            <Link
              href={localizePath(locale, '/odd-lot')}
              className="text-xs text-zinc-400 hover:text-white transition"
            >
              {t.oddLotInfo}
            </Link>
            <span className="text-zinc-600">/</span>
            <span className="text-xs text-emerald-400 font-medium">{t.breadcrumbGift}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-950 text-emerald-400 border border-emerald-800">
              {view === 'active' ? t.seasonActive : t.seasonReview}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pt-6 space-y-6">
        {/* Title Banner */}
        <div className="bg-gradient-to-r from-emerald-950/60 via-zinc-900 to-zinc-900 border border-emerald-800/40 rounded-2xl p-6 relative overflow-hidden">
          <div className="relative z-10 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🎁</span>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                {t.title}
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl">
              {t.subtitle}
            </p>

            {/* 視圖切換 */}
            <div className="pt-2 flex flex-wrap gap-2">
              <button
                onClick={() => setView('active')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  view === 'active'
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
                    : 'bg-zinc-800/80 text-zinc-400 hover:text-white hover:bg-zinc-700'
                }`}
              >
                {t.tabActive}
              </button>
              <button
                onClick={() => setView('review')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  view === 'review'
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
                    : 'bg-zinc-800/80 text-zinc-400 hover:text-white hover:bg-zinc-700'
                }`}
              >
                {t.tabReview}
              </button>
            </div>
          </div>
        </div>

        {/* 4 大關鍵指標 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-4">
            <div className="text-[11px] text-zinc-400 mb-1">{t.statToday}</div>
            <div className="text-2xl font-bold text-rose-400">
              {summary ? summary.todayCount : '—'}
              {t.unitCount && <span className="text-xs font-normal text-zinc-500 ml-1">{t.unitCount}</span>}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">{t.statTodaySub}</div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-4">
            <div className="text-[11px] text-zinc-400 mb-1">{t.statT3}</div>
            <div className="text-2xl font-bold text-amber-400">
              {summary ? summary.t3Count : '—'}
              {t.unitCount && <span className="text-xs font-normal text-zinc-500 ml-1">{t.unitCount}</span>}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">{t.statT3Sub}</div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-4">
            <div className="text-[11px] text-zinc-400 mb-1">{t.statOneShare}</div>
            <div className="text-2xl font-bold text-emerald-400">
              {summary ? summary.oneShareCount : '—'}
              {t.unitCount && <span className="text-xs font-normal text-zinc-500 ml-1">{t.unitCount}</span>}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">{t.statOneShareSub}</div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-4">
            <div className="text-[11px] text-zinc-400 mb-1">{t.statTotal}</div>
            <div className="text-2xl font-bold text-zinc-200">
              {summary ? summary.totalCount : '—'}
              {t.unitCount && <span className="text-xs font-normal text-zinc-500 ml-1">{t.unitCount}</span>}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">{t.statTotalSub(summary?.dataYear ?? 2026)}</div>
          </div>
        </div>

        {/* 搜尋與過濾列 */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder={t.searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs sm:text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-2.5 text-xs text-zinc-500 hover:text-zinc-300"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={eligibilityFilter}
                onChange={(e) => setEligibilityFilter(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs sm:text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="ALL">{t.filterAll}</option>
                <option value="ONE_SHARE">{t.filterOneShare}</option>
                <option value="VOTE_REQUIRED">{t.filterVote}</option>
                <option value="MEETING_ONLY">{t.filterMeeting}</option>
                <option value="NO_GIFT">{t.filterNoGift}</option>
                <option value="UNKNOWN">{t.filterUnknown}</option>
              </select>

              <button
                onClick={() => setOnlyPopular(!onlyPopular)}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition whitespace-nowrap ${
                  onlyPopular
                    ? 'bg-amber-950/80 border-amber-700 text-amber-300'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t.onlyPopular}
              </button>
            </div>
          </div>
        </div>

        {/* 列表內容 */}
        {loading ? (
          <div className="py-20 text-center text-zinc-500 text-sm">
            {t.loading}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-16 text-center bg-zinc-900/40 border border-dashed border-zinc-800 rounded-2xl space-y-2">
            <div className="text-3xl">🔍</div>
            <div className="text-sm text-zinc-300 font-medium">{t.emptyTitle}</div>
            <p className="text-xs text-zinc-500">
              {t.emptyHint}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map((item) => {
              const isExpanded = expandedId === item.id

              return (
                <div
                  key={item.id}
                  className={`bg-zinc-900 border rounded-xl p-4 flex flex-col justify-between transition hover:border-zinc-700 ${
                    item.isPopular ? 'border-amber-800/40 bg-zinc-900/90' : 'border-zinc-800'
                  }`}
                >
                  <div className="space-y-3">
                    {/* Header: 代號 + 股名 + 倒數標籤 */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={localizePath(locale, `/odd-lot?symbol=${item.stockId}`)}
                            className="font-bold text-base text-zinc-100 hover:text-emerald-400 transition"
                          >
                            {item.stockId}{' '}
                            {displayStockName(item.stockId, locale, { fallbackName: item.stockName })}
                          </Link>
                          {item.isPopular && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-400 border border-amber-800 font-medium">
                              {t.popularBadge}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {t.meetingDateLabel}: {item.meetingDate ?? t.pending}
                        </div>
                      </div>

                      {/* 倒數標籤 */}
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                          item.countdownTag === 'TODAY'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800 animate-pulse'
                            : item.countdownTag === 'T_3'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : item.countdownTag === 'T_7'
                                ? 'bg-yellow-950 text-yellow-300 border border-yellow-800'
                                : item.countdownTag === 'EXPIRED'
                                  ? 'bg-zinc-800 text-zinc-400'
                                  : 'bg-zinc-800/70 text-zinc-400'
                        }`}
                      >
                        {item.countdownLabel}
                      </span>
                    </div>

                    {/* 紀念品品名 */}
                    <div className="p-3 bg-zinc-950/70 border border-zinc-800/60 rounded-lg">
                      <div className="text-[10px] text-zinc-500 mb-0.5">{t.giftLabel}</div>
                      <div className="font-semibold text-sm text-emerald-300 line-clamp-2">
                        {item.giftName}
                      </div>
                    </div>

                    {/* 關鍵時效與資格 */}
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between items-center text-zinc-400">
                        <span>{t.lastBuyLabel}</span>
                        <span className="font-mono font-medium text-zinc-200">
                          {item.lastBuyDateFull ?? item.lastBuyDate ?? t.pending}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-zinc-400">
                        <span>{t.eligibilityLabel}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                            item.eligibilityColor === 'green'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : item.eligibilityColor === 'amber'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : item.eligibilityColor === 'purple'
                                  ? 'bg-purple-950 text-purple-300 border border-purple-800'
                                  : item.eligibilityColor === 'gray'
                                    ? 'bg-zinc-800 text-zinc-400'
                                    : 'bg-blue-950 text-blue-300 border border-blue-800'
                          }`}
                        >
                          {item.eligibilityLabel}
                        </span>
                      </div>

                      {item.distributionMethod && (
                        <div className="flex justify-between items-start text-zinc-400 pt-1 border-t border-zinc-800/60">
                          <span className="shrink-0 text-[11px]">{t.distMethodLabel}</span>
                          <span className="text-[11px] text-zinc-300 text-right line-clamp-1">
                            {item.distributionMethod}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 展開公告原文 */}
                    {item.mopsGiftText && (
                      <div className="pt-1">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : item.id)}
                          className="text-[11px] text-zinc-400 hover:text-emerald-400 transition flex items-center gap-1"
                        >
                          <span>{isExpanded ? t.collapseMops : t.expandMops}</span>
                        </button>

                        {isExpanded && (
                          <div className="mt-2 p-2.5 bg-zinc-950 border border-zinc-800 rounded text-[11px] text-zinc-300 whitespace-pre-wrap leading-relaxed">
                            {item.mopsGiftText}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 底部行動按鈕 */}
                  <div className="pt-3 mt-3 border-t border-zinc-800/70 flex items-center justify-between">
                    <Link
                      href={localizePath(locale, `/odd-lot?symbol=${item.stockId}`)}
                      className="text-xs text-emerald-400 hover:text-emerald-300 transition font-medium flex items-center gap-1"
                    >
                      <span>{t.viewOddLot}</span>
                      <span>→</span>
                    </Link>

                    {item.mopsSourceUrl && (
                      <a
                        href={item.mopsSourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-zinc-500 hover:text-zinc-300 transition underline"
                      >
                        {t.sourceUrl}
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 免責聲明 */}
        <div className="mt-12 p-4 bg-zinc-900/40 border border-zinc-800/80 rounded-xl text-[11px] text-zinc-500 leading-relaxed space-y-1">
          <div className="font-semibold text-zinc-400">{t.disclaimerTitle}</div>
          <p>{disclaimer}</p>
        </div>
      </main>
    </div>
  )
}
