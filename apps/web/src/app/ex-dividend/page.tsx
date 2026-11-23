'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  Copy,
  Search,
  X,
  LayoutList,
  LayoutGrid,
  ExternalLink,
} from 'lucide-react'
import { TableSkeleton } from '@/components/table-skeleton'
import { WorkspaceBackLink } from '@/components/workspace-back-link'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'
import { classifyAssetKind } from '@/lib/ex-dividend-engine'
import { computeHealthTaxSafety } from '@/lib/etf-dividend-composition'
import { useI18n } from '@/i18n/LanguageProvider'
import { localizePath } from '@/i18n/paths'
import type { Locale } from '@/i18n/config'
import { displayStockName, type StockMultilingualName } from '@/lib/stock-display'

const EXDIV_COPY = {
  'zh-TW': {
    kindMap: { etf: 'ETF', stock: '個股', unknown: '其他' } as Record<'etf' | 'stock' | 'unknown', string>,
    statusMap: { filled: '已填息', filling: '填息中', discount: '貼息' } as Record<'filled' | 'filling' | 'discount', string>,
    cdExDone: '已除息',
    cdExToday: '今日除息',
    loadFail: '讀取失敗',
    shareTitle: '除權息填息統計',
    pageTitle: '除權息填息力統計與進度追蹤',
    pageSubtitle: '近期除息即時填息進度條 ＋ 未來 30 天上市與 ETF 預告，附 5 年歷史填息實證統計。',
    copiedBtn: '已複製連結',
    shareBtn: '分享頁面',
    loadingMsg: '載入除權息資料中…',
    loadingHint: '彙整 TWSE 預告與 5 年歷史回測數據，請稍候…',
    errPrefix: '讀取失敗：',
    noCache: '無快取紀錄',
    dataMeta: (cache: string, today: string, isTradingDay: boolean, winEnd: string, total: number, truncated: boolean) =>
      `資料時間：${cache}（今日 ${today}${isTradingDay ? '' : '，非交易日'}；預告窗口至 ${winEnd}，共 ${total} 檔${truncated ? '，僅顯示前 60 檔' : ''}）。`,
    degradedNotice: '預告快取非最新（降級顯示），除息日可能異動，請以 TWSE 公告為準。',
    tabTracking: '🔥 近期除息·填息進度追蹤',
    tabUpcoming: '📅 未來 30 天預告',
    searchPlaceholder: '搜尋代號或名稱，如 0056、台積電',
    filterAll: (n: number) => `全部 (${n})`,
    filterStock: (n: number) => `個股 (${n})`,
    filterEtf: (n: number) => `ETF (${n})`,
    sortLabel: '排序：',
    sortDate: '除息日',
    sortScore: '填息力',
    viewTableTitle: '列表表格檢視（預設）',
    viewTable: '列表表格',
    viewCardTitle: '卡片化檢視',
    viewCard: '卡片',
    emptyTrackingTitle: '查無符合條件的除息標的',
    emptyHint: '請嘗試調整搜尋關鍵字或分類篩選條件。',
    thStatus: '狀態',
    thSymbol: '標的',
    thExDate: '除息日',
    thDiv: '現金股利',
    thPrevRef: '除息前收 / 參考價',
    thCurr: '最新現價',
    thProgress: '填息進度',
    thBacktest: '量化回測',
    backtestTitle: '點擊直接進行量化回測',
    yahooTitle: (sym: string) => `在 Yahoo 奇摩股市查看 ${sym}`,
    daysSinceEx: (d: number) => `第 ${d} 交易日`,
    cardDaysSinceEx: (d: number) => `除息第 ${d} 交易日`,
    refLabel: (p: string) => `參考 ${p}`,
    progressLabel: '進度',
    fillProgressLabel: '填息進度',
    runBacktestArrow: '跑回測 →',
    runBacktestDirect: '直接跑回測 →',
    cardDivDateLabel: '除息日 / 股利',
    cardPrevRefLabel: '前收 / 參考價',
    cardCurrLabel: '最新現價',
    cardBacktestHint: '點擊代號直達自動回測',
    emptyUpcomingTitle: '查無符合條件的除權息預告',
    thCountdown: '倒數',
    thLastBuy: '最後買進日',
    thYield: '預估殖利率',
    thFillScore: '填息力評分',
    thActions: '操作',
    tbd: '待公告',
    scoreUnit: (s: number) => `${s} 分`,
    insufficientSample: '樣本不足',
    runBacktest: '跑回測',
    collapse: '收起',
    details: '明細',
    d1Prob: '次日填息機率 (D1)',
    d5Prob: '5日填息機率 (D5)',
    d20Prob: '20日填息機率 (D20)',
    maxDd: '貼息最大拉回幅度',
    backtestYears: (years: string, cnt: number, avg: string | number) =>
      `回溯期間：${years} 年（共 ${cnt} 次除息紀錄，平均 ${avg} 天填息）`,
    noRecord: '無紀錄',
    yahooTrend: 'Yahoo 奇摩股市走勢',
    runQuantNow: '立即自動執行量化回測 →',
    cardLastBuy: (d: string) => `最後買進 ${d}`,
    cardYieldVal: (y: string) => `殖利率 ${y}%`,
    cardYieldNone: '殖利率 —',
    cardFillScore: '填息力',
    cardAvgDays: (d: number) => `平均 ${d} 天`,
    cardPastProb: (cnt: number) => `過去填息機率（共 ${cnt} 次除息紀錄）`,
    d1Short: '次日 (D1)',
    d5Short: '5日 (D5)',
    d10Short: '10日 (D10)',
    d20Short: '20日 (D20)',
    maxUnfilledDd: '未填息最大拉回：',
    yearsBack: (years: string) => `回溯年份：${years} 年`,
    lessThan3: '歷史除權息紀錄少於 3 次，樣本不足以計算填息機率。',
    directQuantSymbol: (sym: string) => `直接自動量化回測 ${sym} →`,
    cardStatNote: '統計僅供參考，過去表現不代表未來獲利保證',
    disclaimerTitle: '⚠️ 除權息統計說明與合規聲明：',
    disclaimerFormulaPre: '1. 填息進度計算公式：',
    disclaimerFormulaCode: '(最新現價 - 除息參考價) / 現金股利 × 100%',
    disclaimerFormulaPost: '。現價收復除息前收盤價即判定已填息；跌破參考價則為貼息。所有價格數值以最多小數點 2 位格式化呈現。',
    disclaimer2: '2. 本頁所有「填息天數」、「填息機率」均為客觀歷史統計事實，不含任何主觀投資買賣建議或獲利保證。實際除權息日、參考價與配息金額請以台灣證券交易所（TWSE）正式公告為準。',
  },
  en: {
    kindMap: { etf: 'ETF', stock: 'Stock', unknown: 'Other' } as Record<'etf' | 'stock' | 'unknown', string>,
    statusMap: { filled: 'Gap Filled', filling: 'Filling', discount: 'Below Ref' } as Record<'filled' | 'filling' | 'discount', string>,
    cdExDone: 'Ex-Div',
    cdExToday: 'Today',
    loadFail: 'Failed to load',
    shareTitle: 'TWSE Ex-Dividend Fill Statistics',
    pageTitle: 'Ex-Dividend Fill Tracker & Statistics',
    pageSubtitle: 'Live ex-dividend price-recovery progress + 30-day upcoming TWSE stock & ETF calendar with 5-year historical fill statistics.',
    copiedBtn: 'Link Copied',
    shareBtn: 'Share Page',
    loadingMsg: 'Loading ex-dividend data…',
    loadingHint: 'Aggregating TWSE calendar & 5-year backtest stats, please wait…',
    errPrefix: 'Failed to load:',
    noCache: 'No cache',
    dataMeta: (cache: string, today: string, isTradingDay: boolean, winEnd: string, total: number, truncated: boolean) =>
      `As of: ${cache} (Today ${today}${isTradingDay ? '' : ', Market Closed'}; Calendar through ${winEnd}, ${total} tickers${truncated ? ', top 60 shown' : ''}).`,
    degradedNotice: 'Calendar cache is stale (degraded). Ex-dates may change; verify with official TWSE announcements.',
    tabTracking: '🔥 Live Fill Progress',
    tabUpcoming: '📅 Upcoming 30 Days',
    searchPlaceholder: 'Search ticker or name, e.g. 0056, 2330',
    filterAll: (n: number) => `All (${n})`,
    filterStock: (n: number) => `Stocks (${n})`,
    filterEtf: (n: number) => `ETFs (${n})`,
    sortLabel: 'Sort:',
    sortDate: 'Ex-Date',
    sortScore: 'Fill Score',
    viewTableTitle: 'Table View (Default)',
    viewTable: 'Table',
    viewCardTitle: 'Card View',
    viewCard: 'Cards',
    emptyTrackingTitle: 'No matching ex-dividend stocks found',
    emptyHint: 'Try adjusting your search query or asset filter.',
    thStatus: 'Status',
    thSymbol: 'Ticker',
    thExDate: 'Ex-Date',
    thDiv: 'Cash Div.',
    thPrevRef: 'Prev Close / Ref',
    thCurr: 'Last Price',
    thProgress: 'Fill Progress',
    thBacktest: 'Backtest',
    backtestTitle: 'Click to launch quantitative backtest',
    yahooTitle: (sym: string) => `View ${sym} on Yahoo Finance TW`,
    daysSinceEx: (d: number) => `Day ${d}`,
    cardDaysSinceEx: (d: number) => `Day ${d} post-ex`,
    refLabel: (p: string) => `Ref ${p}`,
    progressLabel: 'Progress',
    fillProgressLabel: 'Fill Progress',
    runBacktestArrow: 'Backtest →',
    runBacktestDirect: 'Run Backtest →',
    cardDivDateLabel: 'Ex-Date / Cash Div.',
    cardPrevRefLabel: 'Prev Close / Ref',
    cardCurrLabel: 'Last Price',
    cardBacktestHint: 'Click ticker for instant backtest',
    emptyUpcomingTitle: 'No matching upcoming ex-dividend events',
    thCountdown: 'T-Minus',
    thLastBuy: 'Last Cum-Date',
    thYield: 'Est. Yield',
    thFillScore: 'Fill Score',
    thActions: 'Actions',
    tbd: 'TBD',
    scoreUnit: (s: number) => `${s} pts`,
    insufficientSample: 'Low Sample',
    runBacktest: 'Backtest',
    collapse: 'Hide',
    details: 'Details',
    d1Prob: 'Next-Day Fill Rate (D1)',
    d5Prob: '5-Day Fill Rate (D5)',
    d20Prob: '20-Day Fill Rate (D20)',
    maxDd: 'Max Unfilled Drawdown',
    backtestYears: (years: string, cnt: number, avg: string | number) =>
      `Window: ${years} (${cnt} events, avg ${avg}d to fill)`,
    noRecord: 'N/A',
    yahooTrend: 'Yahoo Finance TW Chart',
    runQuantNow: 'Launch Quant Backtest Now →',
    cardLastBuy: (d: string) => `Last Buy ${d}`,
    cardYieldVal: (y: string) => `Yield ${y}%`,
    cardYieldNone: 'Yield —',
    cardFillScore: 'Fill Score',
    cardAvgDays: (d: number) => `Avg ${d}d`,
    cardPastProb: (cnt: number) => `Historical Fill Rates (${cnt} events)`,
    d1Short: 'D1',
    d5Short: 'D5',
    d10Short: 'D10',
    d20Short: 'D20',
    maxUnfilledDd: 'Max Unfilled Drawdown:',
    yearsBack: (years: string) => `Years: ${years}`,
    lessThan3: 'Fewer than 3 historical ex-dividend events; insufficient sample to compute fill probability.',
    directQuantSymbol: (sym: string) => `Run Quant Backtest for ${sym} →`,
    cardStatNote: 'Statistics are for reference only; past performance does not guarantee future returns',
    disclaimerTitle: '⚠️ Ex-Dividend Statistics & Compliance Notice:',
    disclaimerFormulaPre: '1. Fill Progress Formula: ',
    disclaimerFormulaCode: '(Last Price - Ex-Ref Price) / Cash Dividend × 100%',
    disclaimerFormulaPost: '. Reclaiming the pre-ex close counts as Filled; trading below the reference price counts as Discount. Prices are formatted up to 2 decimal places.',
    disclaimer2: '2. All "days to fill" and "fill probabilities" are objective historical statistics and do not constitute investment advice or return guarantees. Verify official ex-dates, reference prices, and payouts with TWSE.',
  },
  ja: {
    kindMap: { etf: 'ETF', stock: '個別株', unknown: 'その他' } as Record<'etf' | 'stock' | 'unknown', string>,
    statusMap: { filled: '配当落ち埋め完了', filling: '回復中', discount: '基準割れ' } as Record<'filled' | 'filling' | 'discount', string>,
    cdExDone: '権利落済',
    cdExToday: '本日権利落',
    loadFail: '読み込みに失敗しました',
    shareTitle: '権利落ち回復統計・進捗トラッカー',
    pageTitle: '権利落ち回復力統計 ＆ 進捗トラッカー',
    pageSubtitle: '直近の権利落ちリアルタイム回復バー ＋ 今後30日間の TWSE 上場株・ETF 予定表（5年統計付）。',
    copiedBtn: 'リンクをコピーしました',
    shareBtn: 'ページを共有',
    loadingMsg: '権利落ちデータを読み込み中…',
    loadingHint: 'TWSE 予定表と5年統計を集計しています。しばらくお待ちください…',
    errPrefix: '読み込み失敗：',
    noCache: 'キャッシュなし',
    dataMeta: (cache: string, today: string, isTradingDay: boolean, winEnd: string, total: number, truncated: boolean) =>
      `データ基準：${cache}（本日 ${today}${isTradingDay ? '' : '・休場'}；対象期間 〜${winEnd}、全 ${total} 銘柄${truncated ? '・上位60件表示' : ''}）。`,
    degradedNotice: '予定キャッシュが最新ではありません（縮退表示）。権利落ち日は変更の可能性があるため、TWSE 公式発表をご確認ください。',
    tabTracking: '🔥 直近の権利落ち・回復進捗',
    tabUpcoming: '📅 今後30日間の予定',
    searchPlaceholder: 'コードまたは銘柄名（例：0056、2330）',
    filterAll: (n: number) => `すべて (${n})`,
    filterStock: (n: number) => `個別株 (${n})`,
    filterEtf: (n: number) => `ETF (${n})`,
    sortLabel: '並替：',
    sortDate: '権利落ち日',
    sortScore: '回復スコア',
    viewTableTitle: 'テーブル表示（標準）',
    viewTable: 'テーブル',
    viewCardTitle: 'カード表示',
    viewCard: 'カード',
    emptyTrackingTitle: '条件に一致する権利落ち銘柄がありません',
    emptyHint: '検索キーワードや資産フィルターを調整してください。',
    thStatus: '状態',
    thSymbol: '銘柄',
    thExDate: '権利落ち日',
    thDiv: '現金配当',
    thPrevRef: '権利付終値 / 基準値',
    thCurr: '現在値',
    thProgress: '回復進捗',
    thBacktest: '定量検証',
    backtestTitle: 'クリックして定量バックテストを実行',
    yahooTitle: (sym: string) => `Yahoo!ファイナンス台湾で ${sym} を表示`,
    daysSinceEx: (d: number) => `${d}営業日目`,
    cardDaysSinceEx: (d: number) => `権利落後 ${d}営業日`,
    refLabel: (p: string) => `基準 ${p}`,
    progressLabel: '進捗',
    fillProgressLabel: '回復進捗',
    runBacktestArrow: '検証へ →',
    runBacktestDirect: 'バックテストを実行 →',
    cardDivDateLabel: '権利落ち日 / 配当',
    cardPrevRefLabel: '前日終値 / 基準値',
    cardCurrLabel: '現在値',
    cardBacktestHint: 'コードクリックで自動バックテストへ',
    emptyUpcomingTitle: '条件に一致する権利落ち予定はありません',
    thCountdown: '残日数',
    thLastBuy: '権利付最終日',
    thYield: '予想利回り',
    thFillScore: '回復スコア',
    thActions: '操作',
    tbd: '未公表',
    scoreUnit: (s: number) => `${s} 点`,
    insufficientSample: 'サンプル不足',
    runBacktest: '検証',
    collapse: '閉じる',
    details: '詳細',
    d1Prob: '翌日回復率 (D1)',
    d5Prob: '5日回復率 (D5)',
    d20Prob: '20日回復率 (D20)',
    maxDd: '未回復時最大下落',
    backtestYears: (years: string, cnt: number, avg: string | number) =>
      `対象年：${years}（全 ${cnt} 回、平均 ${avg} 日で回復）`,
    noRecord: '記録なし',
    yahooTrend: 'Yahoo!ファイナンスチャート',
    runQuantNow: '定量バックテストを今すぐ実行 →',
    cardLastBuy: (d: string) => `最終買付 ${d}`,
    cardYieldVal: (y: string) => `利回り ${y}%`,
    cardYieldNone: '利回り —',
    cardFillScore: '回復スコア',
    cardAvgDays: (d: number) => `平均 ${d} 日`,
    cardPastProb: (cnt: number) => `過去の回復確率（全 ${cnt} 回）`,
    d1Short: '翌日 (D1)',
    d5Short: '5日 (D5)',
    d10Short: '10日 (D10)',
    d20Short: '20日 (D20)',
    maxUnfilledDd: '未回復時最大下落：',
    yearsBack: (years: string) => `集計年：${years}`,
    lessThan3: '過去の権利落ち回数が3回未満のため、回復確率を算出できません。',
    directQuantSymbol: (sym: string) => `${sym} の定量バックテストを実行 →`,
    cardStatNote: '統計情報であり将来の利益を保証するものではありません',
    disclaimerTitle: '⚠️ 権利落ち統計に関する説明および免責事項：',
    disclaimerFormulaPre: '1. 回復進捗計算式：',
    disclaimerFormulaCode: '(現在値 - 権利落ち基準値) / 現金配当 × 100%',
    disclaimerFormulaPost: '。権利付最終日終値を上回ると回復完了、基準値を下回ると基準割れとなります。価格は小数点第2位まで表示されます。',
    disclaimer2: '2. 本ページの「回復日数」や「回復確率」は過去の客観的な統計データであり、売買推奨や利益保証を行うものではありません。正確な権利落ち日・基準価格・配当額は TWSE 公式発表をご確認ください。',
  },
} as const

type ExDivCopy = (typeof EXDIV_COPY)[Locale]

// Issue #67 & #93 & #123 & #125：除權息填息力預測＋填息進度追蹤
// 文案紅線：僅歷史統計＋免責，禁「預測/保證」字眼；機率＝過去填息事件佔比。
// 支援：ETF精確分類（00開頭/主動型）、代號直達回測、Yahoo外部連結、小數點2位、表格精簡。

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
  names?: StockMultilingualName
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

/** Issue #93：填息追蹤項目 */
interface ExDividendTrackingItem {
  symbol: string
  name: string | null
  names?: StockMultilingualName
  ex_date: string
  cash_dividend: number
  prev_close: number
  reference_price: number
  current_price: number
  progress_pct: number
  status: 'filled' | 'filling' | 'discount'
  status_label: string
  filled_in_days: number | null
  days_since_ex: number
  asset_kind: 'etf' | 'stock' | 'unknown'
  asset_label: string
  avg_fill_days: number | null
  fill_score: number | null
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
  tracking_items?: ExDividendTrackingItem[]
  cached_at?: string
  from_cache?: boolean
  error?: string
}

function fmtPct(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(1)}%`
}

/** 價格與股利格式化（Issue #125：最多小數點 2 位） */
function fmtPrice(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return '—'
  return val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function countdownBadge(days: number | null, copy: ExDivCopy): { text: string; hot: boolean } {
  if (days == null) return { text: '—', hot: false }
  if (days < 0) return { text: copy.cdExDone, hot: false }
  if (days === 0) return { text: copy.cdExToday, hot: true }
  return { text: `T-${days}`, hot: days <= 3 }
}

export default function ExDividendPage() {
  const { locale } = useI18n()
  const copy = EXDIV_COPY[locale]
  const [data, setData] = useState<ExDividendResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'tracking' | 'upcoming'>('tracking')
  const [assetFilter, setAssetFilter] = useState<'all' | 'stock' | 'etf'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table')
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
        else setError(json?.error ?? copy.loadFail)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : copy.loadFail)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [copy.loadFail])

  const toggle = (symbol: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(symbol)) next.delete(symbol)
      else next.add(symbol)
      return next
    })
  }

  const share = async () => {
    try {
      const url = window.location.href
      if (navigator.share) {
        await navigator.share({ title: copy.shareTitle, url })
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

  // 前端精確判定資產種類（Issue #125：結合代號正規式 + 名稱關鍵字 + KY判斷）
  const resolveKind = (quoteType: string | undefined, symbol: string, name: string | null | undefined) => {
    return classifyAssetKind(quoteType, symbol, name)
  }

  // 排序未來預告標的
  const sortedUpcomingItems = [...(data?.items ?? [])].sort((a, b) => {
    if (sortBy === 'score') {
      const sa = a.stats?.fillScore ?? -1
      const sb = b.stats?.fillScore ?? -1
      if (sb !== sa) return sb - sa
    }
    return a.ex_date < b.ex_date ? -1 : a.ex_date > b.ex_date ? 1 : a.symbol.localeCompare(b.symbol)
  })

  // 搜尋與種類過濾：填息追蹤
  const filteredTrackingItems = (data?.tracking_items ?? []).filter((item) => {
    const kind = resolveKind(undefined, item.symbol, item.name)
    if (assetFilter === 'etf' && kind !== 'etf') return false
    if (assetFilter === 'stock' && kind !== 'stock') return false
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      const matchSymbol = item.symbol.toLowerCase().includes(q)
      const matchName = item.name ? item.name.toLowerCase().includes(q) : false
      if (!matchSymbol && !matchName) return false
    }
    return true
  })

  // 搜尋與種類過濾：未來預告
  const filteredUpcomingItems = sortedUpcomingItems.filter((item) => {
    const kind = resolveKind(item.quote_type, item.symbol, item.name)
    if (assetFilter === 'etf' && kind !== 'etf') return false
    if (assetFilter === 'stock' && kind !== 'stock') return false
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      const matchSymbol = item.symbol.toLowerCase().includes(q)
      const matchName = item.name ? item.name.toLowerCase().includes(q) : false
      if (!matchSymbol && !matchName) return false
    }
    return true
  })

  // 數量統計（以強化後的精準分類為基準）
  const totalTrackingCount = data?.tracking_items?.length ?? 0
  const etfTrackingCount = data?.tracking_items?.filter((i) => resolveKind(undefined, i.symbol, i.name) === 'etf').length ?? 0
  const stockTrackingCount = data?.tracking_items?.filter((i) => resolveKind(undefined, i.symbol, i.name) === 'stock').length ?? 0

  const totalUpcomingCount = data?.items?.length ?? 0
  const etfUpcomingCount = data?.items?.filter((i) => resolveKind(i.quote_type, i.symbol, i.name) === 'etf').length ?? 0
  const stockUpcomingCount = data?.items?.filter((i) => resolveKind(i.quote_type, i.symbol, i.name) === 'stock').length ?? 0

  const currentAllCount = tab === 'tracking' ? totalTrackingCount : totalUpcomingCount
  const currentStockCount = tab === 'tracking' ? stockTrackingCount : stockUpcomingCount
  const currentEtfCount = tab === 'tracking' ? etfTrackingCount : etfUpcomingCount

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6 min-w-0">
      <WorkspaceBackLink />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--text-primary)]">
            {copy.pageTitle}
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1.5 leading-relaxed">
            {copy.pageSubtitle}
          </p>
        </div>
        <button
          onClick={share}
          className="shrink-0 self-start sm:self-auto inline-flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-lg bg-[var(--bg-card)] border border-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-white/20 transition"
        >
          <Copy className="w-3.5 h-3.5" />
          {copied ? copy.copiedBtn : copy.shareBtn}
        </button>
      </div>

      {loading && (
        <TableSkeleton message={copy.loadingMsg} hint={copy.loadingHint} />
      )}

      {!loading && error && (
        <div className="rounded-xl bg-[var(--bg-card)] border border-red-500/30 p-4 text-sm text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{copy.errPrefix} {error}</span>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* 資料時間與說明條 */}
          <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-3.5 text-xs text-[var(--text-secondary)] leading-relaxed space-y-1">
            <p className="flex items-start gap-2">
              <CalendarDays className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent)]" />
              <span>
                {copy.dataMeta(
                  data.cache_as_of ?? copy.noCache,
                  data.today,
                  data.is_trading_day,
                  data.window_end,
                  data.total,
                  data.truncated
                )}
              </span>
            </p>
            {data.degraded && (
              <p className="flex items-start gap-2 text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{copy.degradedNotice}</span>
              </p>
            )}
            {!data.degraded && <p>{data.notice}</p>}
          </div>

          {/* Tab 切換：近期填息追蹤 vs 未來預告 */}
          <div className="flex border-b border-white/10 gap-6 pt-1">
            <button
              onClick={() => setTab('tracking')}
              className={`pb-2.5 text-sm font-semibold border-b-2 transition flex items-center gap-1.5 ${
                tab === 'tracking'
                  ? 'border-[var(--accent)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              <span>{copy.tabTracking}</span>
              <span className="text-xs px-1.5 py-0.2 rounded-full bg-white/10 font-mono">
                {totalTrackingCount}
              </span>
            </button>
            <button
              onClick={() => setTab('upcoming')}
              className={`pb-2.5 text-sm font-semibold border-b-2 transition flex items-center gap-1.5 ${
                tab === 'upcoming'
                  ? 'border-[var(--accent)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              <span>{copy.tabUpcoming}</span>
              <span className="text-xs px-1.5 py-0.2 rounded-full bg-white/10 font-mono">
                {totalUpcomingCount}
              </span>
            </button>
          </div>

          {/* 綜合工具列：搜尋框 + ETF/個股分類篩選 + 視圖切換 (Table / Card) */}
          <div className="p-3 rounded-xl bg-[var(--bg-card)] border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* 搜尋與分類 */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1 min-w-0">
              {/* 搜尋框 */}
              <div className="relative flex-1 min-w-[180px] max-w-sm">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={copy.searchPlaceholder}
                  className="w-full pl-8 pr-7 py-1.5 bg-black/20 border border-white/10 rounded-lg text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* ETF / 個股 分類篩選（Issue #123 & #125） */}
              <div className="inline-flex rounded-lg bg-black/20 p-0.5 border border-white/10 self-start sm:self-auto shrink-0">
                <button
                  type="button"
                  onClick={() => setAssetFilter('all')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    assetFilter === 'all'
                      ? 'bg-[var(--accent)] text-black font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  {copy.filterAll(currentAllCount)}
                </button>
                <button
                  type="button"
                  onClick={() => setAssetFilter('stock')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    assetFilter === 'stock'
                      ? 'bg-[var(--accent)] text-black font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  {copy.filterStock(currentStockCount)}
                </button>
                <button
                  type="button"
                  onClick={() => setAssetFilter('etf')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    assetFilter === 'etf'
                      ? 'bg-[var(--accent)] text-black font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  {copy.filterEtf(currentEtfCount)}
                </button>
              </div>
            </div>

            {/* 右側：視圖切換器（表格 vs 卡片）與排序 */}
            <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
              {tab === 'upcoming' && (
                <div className="flex items-center gap-1 text-xs text-[var(--text-secondary)] mr-1">
                  <span>{copy.sortLabel}</span>
                  <button
                    onClick={() => setSortBy('date')}
                    className={`px-2 py-1 rounded border text-xs transition ${
                      sortBy === 'date'
                        ? 'border-[var(--accent)] text-[var(--text-primary)] bg-white/5'
                        : 'border-white/10 text-[var(--text-secondary)]'
                    }`}
                  >
                    {copy.sortDate}
                  </button>
                  <button
                    onClick={() => setSortBy('score')}
                    className={`px-2 py-1 rounded border text-xs transition ${
                      sortBy === 'score'
                        ? 'border-[var(--accent)] text-[var(--text-primary)] bg-white/5'
                        : 'border-white/10 text-[var(--text-secondary)]'
                    }`}
                  >
                    {copy.sortScore}
                  </button>
                </div>
              )}

              {/* 視圖切換器（預設表格） */}
              <div className="inline-flex rounded-lg bg-black/20 p-0.5 border border-white/10">
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  title={copy.viewTableTitle}
                  className={`px-2 py-1 rounded-md text-xs flex items-center gap-1 transition ${
                    viewMode === 'table'
                      ? 'bg-white/15 text-[var(--text-primary)] font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  <LayoutList className="w-3.5 h-3.5" />
                  <span>{copy.viewTable}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('card')}
                  title={copy.viewCardTitle}
                  className={`px-2 py-1 rounded-md text-xs flex items-center gap-1 transition ${
                    viewMode === 'card'
                      ? 'bg-white/15 text-[var(--text-primary)] font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>{copy.viewCard}</span>
                </button>
              </div>
            </div>
          </div>

          {/* ═══════════ Tab 1: 近期除息·填息進度追蹤 ═══════════ */}
          {tab === 'tracking' && (
            <>
              {filteredTrackingItems.length === 0 ? (
                <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-8 text-sm text-[var(--text-secondary)] text-center space-y-1">
                  <p className="font-medium text-[var(--text-primary)]">{copy.emptyTrackingTitle}</p>
                  <p className="text-xs">{copy.emptyHint}</p>
                </div>
              ) : viewMode === 'table' ? (
                /* ── 列表表格模式（Table View，預設，已精簡欄位） ── */
                <div className="overflow-x-auto rounded-xl border border-white/5 bg-[var(--bg-card)]">
                  <table className={tableClass(typo, 'w-full text-xs')}>
                    <thead>
                      <tr className={headTrClass(typo, 'text-left text-[var(--text-secondary)] bg-white/[0.02] border-b border-white/5 whitespace-nowrap')}>
                        <th className="px-3.5 py-2.5 font-medium">{copy.thStatus}</th>
                        <th className="px-3.5 py-2.5 font-medium">{copy.thSymbol}</th>
                        <th className="px-3.5 py-2.5 font-medium">{copy.thExDate}</th>
                        <th className="px-3.5 py-2.5 font-medium text-right">{copy.thDiv}</th>
                        <th className="px-3.5 py-2.5 font-medium text-right">{copy.thPrevRef}</th>
                        <th className="px-3.5 py-2.5 font-medium text-right">{copy.thCurr}</th>
                        <th className="px-3.5 py-2.5 font-medium min-w-[160px]">{copy.thProgress}</th>
                        <th className="px-3.5 py-2.5 font-medium text-right">{copy.thBacktest}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredTrackingItems.map((item) => {
                        const isFilled = item.status === 'filled'
                        const isFilling = item.status === 'filling'
                        const barWidth = Math.min(100, Math.max(0, item.progress_pct))
                        const kind = resolveKind(undefined, item.symbol, item.name)
                        const label = copy.kindMap[kind]

                        return (
                          <tr key={item.symbol} className="hover:bg-white/[0.02] transition">
                            {/* 狀態標籤 */}
                            <td className="px-3.5 py-3 whitespace-nowrap">
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded font-semibold border ${
                                  isFilled
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                    : isFilling
                                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                                      : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                                }`}
                              >
                                {copy.statusMap[item.status]}
                              </span>
                            </td>

                            {/* 標的代號、名稱、分類標籤、Yahoo超連結（Issue #125） */}
                            <td className="px-3.5 py-3 whitespace-nowrap">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Link
                                  href={localizePath(locale, `/backtest?symbol=${item.symbol}`)}
                                  className="font-bold text-sm font-mono text-[var(--accent)] hover:underline"
                                  title={copy.backtestTitle}
                                >
                                  {item.symbol}
                                </Link>
                                {(() => {
                                  const dName = displayStockName(item.symbol, locale, { fallbackName: item.name, names: item.names })
                                  return dName && dName !== item.symbol ? (
                                    <span className="text-xs text-[var(--text-primary)] max-w-[110px] truncate" title={dName}>
                                      {dName}
                                    </span>
                                  ) : null
                                })()}
                                <span className="text-[10px] px-1 py-px rounded border border-white/10 text-[var(--text-secondary)]">
                                  {label}
                                </span>
                                <a
                                  href={`https://tw.stock.yahoo.com/quote/${item.symbol}.TW`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-0.5 text-[10px] text-zinc-400 hover:text-white px-1.5 py-px rounded bg-white/5 border border-white/10 transition"
                                  title={copy.yahooTitle(item.symbol)}
                                >
                                  <span>Yahoo</span>
                                  <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                                </a>
                              </div>
                            </td>

                            {/* 除息日 */}
                            <td className="px-3.5 py-3 whitespace-nowrap">
                              <span className="font-mono text-zinc-300">{item.ex_date}</span>
                              <span className="text-[10px] text-[var(--text-secondary)] block">
                                {copy.daysSinceEx(item.days_since_ex)}
                              </span>
                            </td>

                            {/* 現金股利（格式化至 2 位小數） */}
                            <td className="px-3.5 py-3 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                              NT$ {fmtPrice(item.cash_dividend)}
                            </td>

                            {/* 前收 / 參考價（格式化至 2 位小數） */}
                            <td className="px-3.5 py-3 text-right font-mono whitespace-nowrap text-zinc-300">
                              <div>{fmtPrice(item.prev_close)}</div>
                              <div className="text-[10px] text-zinc-400">{copy.refLabel(fmtPrice(item.reference_price))}</div>
                            </td>

                            {/* 最新現價（格式化至 2 位小數） */}
                            <td className="px-3.5 py-3 text-right font-mono font-bold text-sm text-zinc-100 whitespace-nowrap">
                              {fmtPrice(item.current_price)}
                            </td>

                            {/* 填息進度條 */}
                            <td className="px-3.5 py-3 min-w-[160px]">
                              <div className="space-y-1">
                                <div className="flex justify-between items-center text-[11px] font-mono">
                                  <span className="text-[var(--text-secondary)]">{copy.progressLabel}</span>
                                  <span
                                    className={`font-bold ${
                                      isFilled ? 'text-emerald-400' : isFilling ? 'text-blue-400' : 'text-rose-400'
                                    }`}
                                  >
                                    {fmtPrice(item.progress_pct)}%
                                  </span>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${
                                      isFilled
                                        ? 'bg-emerald-500'
                                        : isFilling
                                          ? 'bg-blue-500'
                                          : 'bg-rose-500'
                                    }`}
                                    style={{ width: `${barWidth}%` }}
                                  />
                                </div>
                              </div>
                            </td>

                            {/* 操作：點擊直達回測 */}
                            <td className="px-3.5 py-3 text-right whitespace-nowrap">
                              <Link
                                href={localizePath(locale, `/backtest?symbol=${item.symbol}`)}
                                className="text-xs text-[var(--accent)] hover:underline font-medium"
                              >
                                {copy.runBacktestArrow}
                              </Link>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* ── 卡片模式（Card View） ── */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredTrackingItems.map((item) => {
                    const isFilled = item.status === 'filled'
                    const isFilling = item.status === 'filling'
                    const barWidth = Math.min(100, Math.max(0, item.progress_pct))
                    const kind = resolveKind(undefined, item.symbol, item.name)
                    const label = copy.kindMap[kind]

                    return (
                      <div key={item.symbol} className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 min-w-0 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-wrap">
                            <Link
                              href={localizePath(locale, `/backtest?symbol=${item.symbol}`)}
                              className="font-bold text-base font-mono text-[var(--text-primary)] hover:text-[var(--accent)] transition"
                              title={copy.backtestTitle}
                            >
                              {item.symbol}
                            </Link>
                            {(() => {
                              const dName = displayStockName(item.symbol, locale, { fallbackName: item.name, names: item.names })
                              return dName && dName !== item.symbol ? (
                                <span className="text-xs text-[var(--text-secondary)] truncate">{dName}</span>
                              ) : null
                            })()}
                            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-[var(--text-secondary)]">
                              {label}
                            </span>
                            <a
                              href={`https://tw.stock.yahoo.com/quote/${item.symbol}.TW`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-[10px] text-zinc-400 hover:text-white px-1.5 py-0.5 rounded bg-white/5 border border-white/10 transition"
                              title={copy.yahooTitle(item.symbol)}
                            >
                              <span>Yahoo</span>
                              <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                            </a>
                          </div>

                          <span
                            className={`text-[11px] px-2 py-0.5 rounded font-medium border ${
                              isFilled
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : isFilling
                                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            }`}
                          >
                            {copy.statusMap[item.status]}
                          </span>
                        </div>

                        {/* 價格與股利 3 欄（小數點格式化至 2 位） */}
                        <div className="grid grid-cols-3 gap-2 text-center text-xs py-2 bg-black/20 rounded-lg">
                          <div>
                            <div className="text-[10px] text-[var(--text-secondary)]">{copy.cardDivDateLabel}</div>
                            <div className="font-semibold text-zinc-200 mt-0.5">{item.ex_date}</div>
                            <div className="text-[11px] text-emerald-400 font-mono mt-0.5">NT$ {fmtPrice(item.cash_dividend)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-[var(--text-secondary)]">{copy.cardPrevRefLabel}</div>
                            <div className="font-mono text-zinc-300 mt-0.5">{fmtPrice(item.prev_close)}</div>
                            <div className="text-[11px] text-zinc-400 font-mono mt-0.5">{copy.refLabel(fmtPrice(item.reference_price))}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-[var(--text-secondary)]">{copy.cardCurrLabel}</div>
                            <div className="font-mono font-bold text-base text-zinc-100 mt-0.5">{fmtPrice(item.current_price)}</div>
                            <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">{copy.cardDaysSinceEx(item.days_since_ex)}</div>
                          </div>
                        </div>

                        {/* 填息進度條 */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs">
                            <span className="text-[var(--text-secondary)]">{copy.fillProgressLabel}</span>
                            <span
                              className={`font-mono font-semibold ${
                                isFilled ? 'text-emerald-400' : isFilling ? 'text-blue-400' : 'text-rose-400'
                              }`}
                            >
                              {fmtPrice(item.progress_pct)}%
                            </span>
                          </div>

                          <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isFilled
                                  ? 'bg-emerald-500'
                                  : isFilling
                                    ? 'bg-blue-500'
                                    : 'bg-rose-500'
                              }`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>

                        {/* 直達回測超連結 */}
                        <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] pt-1 border-t border-white/5">
                          <span className="text-zinc-400">{copy.cardBacktestHint}</span>
                          <Link
                            href={localizePath(locale, `/backtest?symbol=${item.symbol}`)}
                            className="text-[var(--accent)] hover:underline font-medium"
                          >
                            {copy.runBacktestDirect}
                          </Link>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* ═══════════ Tab 2: 未來 30 天預告 ═══════════ */}
          {tab === 'upcoming' && (
            <>
              {filteredUpcomingItems.length === 0 ? (
                <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-8 text-sm text-[var(--text-secondary)] text-center space-y-1">
                  <p className="font-medium text-[var(--text-primary)]">{copy.emptyUpcomingTitle}</p>
                  <p className="text-xs">{copy.emptyHint}</p>
                </div>
              ) : viewMode === 'table' ? (
                /* ── 列表表格模式（Table View，預設） ── */
                <div className="overflow-x-auto rounded-xl border border-white/5 bg-[var(--bg-card)]">
                  <table className={tableClass(typo, 'w-full text-xs')}>
                    <thead>
                      <tr className={headTrClass(typo, 'text-left text-[var(--text-secondary)] bg-white/[0.02] border-b border-white/5 whitespace-nowrap')}>
                        <th className="px-3.5 py-2.5 font-medium">{copy.thCountdown}</th>
                        <th className="px-3.5 py-2.5 font-medium">{copy.thSymbol}</th>
                        <th className="px-3.5 py-2.5 font-medium">{copy.thExDate}</th>
                        <th className="px-3.5 py-2.5 font-medium">{copy.thLastBuy}</th>
                        <th className="px-3.5 py-2.5 font-medium text-right">{copy.thDiv}</th>
                        <th className="px-3.5 py-2.5 font-medium text-right">{copy.thYield}</th>
                        <th className="px-3.5 py-2.5 font-medium text-right">{copy.thFillScore}</th>
                        <th className="px-3.5 py-2.5 font-medium text-right">{copy.thActions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredUpcomingItems.map((item) => {
                        const cd = countdownBadge(item.days_to_ex, copy)
                        const st = item.stats
                        const open = expanded.has(item.symbol)
                        const kind = resolveKind(item.quote_type, item.symbol, item.name)
                        const label = copy.kindMap[kind]

                        return (
                          <>
                            <tr key={item.symbol} className="hover:bg-white/[0.02] transition">
                              {/* 倒數標籤 */}
                              <td className="px-3.5 py-3 whitespace-nowrap">
                                <span
                                  className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                                    cd.hot ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-[var(--text-secondary)]'
                                  }`}
                                >
                                  {cd.text}
                                </span>
                              </td>

                              {/* 標的 */}
                              <td className="px-3.5 py-3 whitespace-nowrap">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <Link
                                    href={localizePath(locale, `/backtest?symbol=${item.symbol}`)}
                                    className="font-bold text-sm font-mono text-[var(--accent)] hover:underline"
                                    title={copy.backtestTitle}
                                  >
                                    {item.symbol}
                                  </Link>
                                  {(() => {
                                    const dName = displayStockName(item.symbol, locale, { fallbackName: item.name, names: item.names })
                                    return dName && dName !== item.symbol ? (
                                      <span className="text-xs text-[var(--text-primary)] max-w-[120px] truncate" title={dName}>
                                        {dName}
                                      </span>
                                    ) : null
                                  })()}
                                  <span className="text-[10px] px-1 py-px rounded border border-white/10 text-[var(--text-secondary)]">
                                    {label}
                                  </span>
                                  <a
                                    href={`https://tw.stock.yahoo.com/quote/${item.symbol}.TW`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 text-[10px] text-zinc-400 hover:text-white px-1.5 py-px rounded bg-white/5 border border-white/10 transition"
                                    title={copy.yahooTitle(item.symbol)}
                                  >
                                    <span>Yahoo</span>
                                    <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                                  </a>
                                </div>
                              </td>

                              {/* 除息日 */}
                              <td className="px-3.5 py-3 font-mono font-medium text-zinc-200 whitespace-nowrap">
                                {item.ex_date}
                              </td>

                              {/* 最後買進日 */}
                              <td className="px-3.5 py-3 font-mono text-zinc-300 whitespace-nowrap">
                                {item.ex_last_buy_date || '—'}
                              </td>

                              {/* 現金股利 */}
                              <td className="px-3.5 py-3 text-right font-mono font-bold whitespace-nowrap">
                                {item.cash_dividend > 0 ? (
                                  <span className="text-emerald-400">NT$ {fmtPrice(item.cash_dividend)}</span>
                                ) : (
                                  <span className="text-amber-400/90 text-xs font-normal px-2 py-0.5 rounded bg-amber-400/10 border border-amber-400/20">
                                    {copy.tbd}
                                  </span>
                                )}
                              </td>

                              {/* 預估殖利率 */}
                              <td className="px-3.5 py-3 text-right font-mono font-medium text-zinc-100 whitespace-nowrap">
                                {item.yield_pct != null && item.yield_pct > 0 ? `${fmtPrice(item.yield_pct)}%` : '—'}
                              </td>

                              {/* 填息力評分 */}
                              <td className="px-3.5 py-3 text-right font-mono whitespace-nowrap">
                                {st && st.fillScore != null ? (
                                  <span className="font-bold text-amber-400">{copy.scoreUnit(st.fillScore)}</span>
                                ) : (
                                  <span className="text-zinc-400">{copy.insufficientSample}</span>
                                )}
                              </td>

                              {/* 操作 */}
                              <td className="px-3.5 py-3 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-2">
                                  <Link
                                    href={localizePath(locale, `/backtest?symbol=${item.symbol}`)}
                                    className="text-xs text-[var(--accent)] hover:underline font-medium"
                                  >
                                    {copy.runBacktest}
                                  </Link>
                                  <button
                                    type="button"
                                    onClick={() => toggle(item.symbol)}
                                    className="text-xs text-zinc-400 hover:text-white inline-flex items-center gap-0.5"
                                  >
                                    <span>{open ? copy.collapse : copy.details}</span>
                                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                                  </button>
                                </div>
                              </td>
                            </tr>

                            {/* 展開之歷史填息明細行 */}
                            {open && (
                              <tr key={`${item.symbol}-detail`} className="bg-black/30">
                                <td colSpan={8} className="px-4 py-3 border-b border-white/5 space-y-2">
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                    <div className="p-2 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">{copy.d1Prob}</div>
                                      <div className="font-mono font-bold text-zinc-200">{fmtPct(st?.fillRateD1 ?? null)}</div>
                                    </div>
                                    <div className="p-2 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">{copy.d5Prob}</div>
                                      <div className="font-mono font-bold text-zinc-200">{fmtPct(st?.fillRateD5 ?? null)}</div>
                                    </div>
                                    <div className="p-2 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">{copy.d20Prob}</div>
                                      <div className="font-mono font-bold text-zinc-200">{fmtPct(st?.fillRateD20 ?? null)}</div>
                                    </div>
                                    <div className="p-2 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">{copy.maxDd}</div>
                                      <div className="font-mono font-bold text-rose-400">
                                        {st?.maxUnfilledDrawdownPct != null ? `-${(st.maxUnfilledDrawdownPct * 100).toFixed(1)}%` : '—'}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] pt-1">
                                    <span>
                                      {copy.backtestYears(
                                        st?.yearsCovered?.join(', ') ?? copy.noRecord,
                                        st?.eventCount ?? 0,
                                        st?.avgFillDays ?? '—'
                                      )}
                                    </span>
                                    <div className="flex items-center gap-3">
                                      <a
                                        href={`https://tw.stock.yahoo.com/quote/${item.symbol}.TW`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-zinc-400 hover:text-white inline-flex items-center gap-1"
                                      >
                                        <span>{copy.yahooTrend}</span>
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                      <Link href={localizePath(locale, `/backtest?symbol=${item.symbol}`)} className="text-[var(--accent)] hover:underline font-semibold">
                                        {copy.runQuantNow}
                                      </Link>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* ── 卡片模式（Card View） ── */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredUpcomingItems.map((item) => {
                    const cd = countdownBadge(item.days_to_ex, copy)
                    const open = expanded.has(item.symbol)
                    const st = item.stats
                    const kind = resolveKind(item.quote_type, item.symbol, item.name)
                    const label = copy.kindMap[kind]

                    return (
                      <div key={item.symbol} className="rounded-xl bg-[var(--bg-card)] border border-white/5 p-4 min-w-0">
                        <button onClick={() => toggle(item.symbol)} className="w-full text-left min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                              <span className="font-bold font-mono text-[var(--text-primary)]">{item.symbol}</span>
                              {(() => {
                                const dName = displayStockName(item.symbol, locale, { fallbackName: item.name, names: item.names })
                                return dName && dName !== item.symbol ? (
                                  <span className="text-xs text-[var(--text-secondary)] truncate">{dName}</span>
                                ) : null
                              })()}
                              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-[var(--text-secondary)]">
                                {label}
                              </span>
                              <span
                                onClick={(e) => {
                                  e.stopPropagation()
                                  window.open(`https://tw.stock.yahoo.com/quote/${item.symbol}.TW`, '_blank')
                                }}
                                className="inline-flex items-center gap-0.5 text-[10px] text-zinc-400 hover:text-white px-1.5 py-0.5 rounded bg-white/5 border border-white/10 transition"
                                title={copy.yahooTitle(item.symbol)}
                              >
                                <span>Yahoo</span>
                                <ExternalLink className="w-2.5 h-2.5 opacity-70" />
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
                              <div className="text-[10px] text-[var(--text-secondary)]">{copy.thExDate}</div>
                              <div className="text-xs font-semibold text-[var(--text-primary)]">{item.ex_date}</div>
                              <div className="text-[10px] text-[var(--text-secondary)] truncate">
                                {copy.cardLastBuy(item.ex_last_buy_date || '—')}
                              </div>
                            </div>
                            <div className="min-w-0">
                              <div className="text-[10px] text-[var(--text-secondary)]">{copy.thDiv}</div>
                              <div className="text-xs font-semibold font-mono">
                                {item.cash_dividend > 0 ? (
                                  <span className="text-emerald-400">NT$ {fmtPrice(item.cash_dividend)}</span>
                                ) : (
                                  <span className="text-amber-400/90 font-normal">{copy.tbd}</span>
                                )}
                              </div>
                              <div className="text-[10px] text-[var(--text-secondary)]">
                                {item.yield_pct != null && item.yield_pct > 0 ? copy.cardYieldVal(fmtPrice(item.yield_pct)) : copy.cardYieldNone}
                              </div>
                            </div>
                            <div className="min-w-0">
                              <div className="text-[10px] text-[var(--text-secondary)]">{copy.cardFillScore}</div>
                              <div className="text-xs font-semibold text-[var(--accent)] font-mono">
                                {st && st.fillScore != null ? copy.scoreUnit(st.fillScore) : copy.insufficientSample}
                              </div>
                              <div className="text-[10px] text-[var(--text-secondary)]">
                                {st && st.avgFillDays != null ? copy.cardAvgDays(st.avgFillDays) : '—'}
                              </div>
                            </div>
                          </div>
                        </button>

                        {open && (
                          <div className="mt-3 pt-3 border-t border-white/5 space-y-3 text-xs">
                            {st && !st.insufficient ? (
                              <>
                                <div>
                                  <div className="text-[11px] font-semibold text-[var(--text-primary)] mb-1.5">
                                    {copy.cardPastProb(st.eventCount)}
                                  </div>
                                  <div className="grid grid-cols-4 gap-1.5 text-center text-[11px]">
                                    <div className="p-1.5 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">{copy.d1Short}</div>
                                      <div className="font-mono text-zinc-200">{fmtPct(st.fillRateD1)}</div>
                                    </div>
                                    <div className="p-1.5 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">{copy.d5Short}</div>
                                      <div className="font-mono text-zinc-200">{fmtPct(st.fillRateD5)}</div>
                                    </div>
                                    <div className="p-1.5 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">{copy.d10Short}</div>
                                      <div className="font-mono text-zinc-200">{fmtPct(st.fillRateD10)}</div>
                                    </div>
                                    <div className="p-1.5 rounded bg-white/5">
                                      <div className="text-[10px] text-[var(--text-secondary)]">{copy.d20Short}</div>
                                      <div className="font-mono text-zinc-200">{fmtPct(st.fillRateD20)}</div>
                                    </div>
                                  </div>
                                </div>

                                <div className="p-2 rounded bg-white/5 text-[11px] text-[var(--text-secondary)] space-y-0.5">
                                  <div>
                                    {copy.maxUnfilledDd}
                                    <span className="text-rose-400 font-mono">
                                      {st.maxUnfilledDrawdownPct != null ? `-${(st.maxUnfilledDrawdownPct * 100).toFixed(1)}%` : '—'}
                                    </span>
                                  </div>
                                  <div>{copy.yearsBack(st.yearsCovered.join(', '))}</div>
                                </div>
                              </>
                            ) : (
                              <div className="p-3 rounded bg-white/5 text-[11px] text-[var(--text-secondary)]">
                                {copy.lessThan3}
                              </div>
                            )}

                            <div className="flex justify-between items-center pt-1 text-[11px] flex-wrap gap-2">
                              <Link
                                href={localizePath(locale, `/backtest?symbol=${item.symbol}`)}
                                className="text-[var(--accent)] hover:underline font-semibold"
                              >
                                {copy.directQuantSymbol(item.symbol)}
                              </Link>
                              <span className="text-[10px] text-[var(--text-secondary)]">
                                {copy.cardStatNote}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* 底部免責宣告 */}
          <div className="rounded-xl bg-black/20 border border-white/5 p-3 text-[11px] text-[var(--text-secondary)] leading-relaxed space-y-1">
            <p className="font-medium text-zinc-300">{copy.disclaimerTitle}</p>
            <p>
              {copy.disclaimerFormulaPre}<code className="text-zinc-200">{copy.disclaimerFormulaCode}</code>{copy.disclaimerFormulaPost}
            </p>
            <p>
              {copy.disclaimer2}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
