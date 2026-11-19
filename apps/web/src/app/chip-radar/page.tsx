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
import { useI18n } from '@/i18n/LanguageProvider'
import { localizePath } from '@/i18n/paths'
import type { Locale } from '@/i18n/config'

const CHIP_COPY = {
  'zh-TW': {
    badgePostMarket: '盤後統計',
    badgeListed: '上市',
    title: '主力籌碼雷達',
    subtitle: '每天盤後 1 分鐘看懂「今天誰被主力連買、誰被大戶倒貨」：外資＋投信連買／連賣天數＋佔成交額比，達門檻即上榜。',
    loadingMsg: '載入籌碼雷達資料中…',
    loadingHint: '盤後榜單讀時即算，約需數秒，請稍候',
    loadFail: '讀取失敗',
    orderPlanFetchFail: (sym: string, status: number) => `無法取得 ${sym} 掛單計畫（${status}）`,
    orderPlanLoadFail: '載入掛單計畫失敗',
    dataTime: (d: string) => `資料時間：${d}（盤後初值；上市；未含融資）`,
    afterHoursTag: '盤後初值',
    degraded: (r: string | null) => `降級顯示（${r ?? ''}）`,
    closedTitle: '休市無新盤',
    closedDesc: (d: string) => `今日為非交易日，榜單維持 ${d}（最近交易日）資料，不重抓。`,
    emptyTitle: '今日無異常標的',
    insufficientDays: '法人資料天數不足（缺檔），暫不列榜，請稍後再試。',
    scanNoMatch: (scanned: number, days: number, ratio: number) =>
      `掃描 ${scanned} 檔，無連買／賣達 ${days} 天且佔比達 ${ratio}% 者。`,
    thresholdBar: (days: number, ratio: number, scanned: number) =>
      `門檻：連買／賣 ≥${days} 天且佔比 ≥${ratio}%（後台可調）· 依佔比排序 · 掃描 ${scanned} 檔 · 點列展開近 5 日趨勢（趨勢軸僅站上提供，信內無）`,
    lendingFilterLabel: '借券動能篩選：',
    filterAllCount: (n: number) => `全部標的 (${n})`,
    filterAnomalyBtn: '借券異常',
    emptyAnomalyFilter: '目前篩選條件下無借券異常標的',
    colSymbol: '代號',
    colDirection: '方向',
    colNet: '當日淨超',
    colRatio: '佔比',
    sortAsc: '升冪',
    sortDesc: '降冪',
    sortTapToggle: '點按切換',
    sortTap: '點按排序',
    lendingAlert: '借券警戒',
    lendingWatch: '借券注意',
    lendingNormal: '借券正常',
    lendingTip: (days: number, z: string | number) => `借券連增 ${days} 天 · Z=${z}`,
    planLoading: '計算明日掛單計畫與風險邊界中…',
    planNoData: '暫無此標的之掛單計畫資料',
    planTitle: '明日掛單計畫',
    planMeta: (close: string, ma20: string, atr14: string) => `收盤 ${close} · MA20 ${ma20} · ATR(14) ${atr14}`,
    planRR: (rr: string) => `風險報酬比 ${rr}`,
    planInsufficient: (bars: number) => `歷史日線不足 60 個交易日（目前僅 ${bars} 日），支撐／壓力與均線僅供參考。`,
    planNegRR: '警示：目前為負或零風險報酬比（近月主力成本／停損價位貼近或高於參考掛單價，或上檔空間有限），請審慎評估風險。',
    limitBuy: '掛單參考價',
    chaseStop: '追價上限',
    stopLoss: '停損參考價',
    breakEven: '保本賣出價',
    supportResistance: (sup: string, res: string, vwap: string) => `60日支撐 ${sup} / 壓力 ${res} · 20日成本估算 ${vwap}`,
    posSize: (lots: number, shares: string) => `2% 風險建議：${lots} 張（${shares} 股，依 100 萬帳戶）`,
    planFootnoteSuffix: '保本價含買賣手續費 0.1425%＋證交稅 0.3%。僅為統計參考，非投資建議。',
    googleSearchAria: (sym: string, name: string) => `${sym}${name} Google 搜尋（另開新頁）`,
    googleSearchTitle: (sym: string, name: string) => `${sym}${name} Google 搜尋`,
    streakBuy: (d: number) => `連買${d}天`,
    streakSell: (d: number) => `連賣${d}天`,
    trendNote: '近 5 日法人合計淨超（外資＋投信，股數）',
    noDivergeNote: '· 無背離標籤（未含融資）',
    lendingDetail: (days: number, pct: string | number, z: string | number) =>
      ` · 借券餘額連增 ${days} 日 / 5日變化 ${pct}% / Z-Score ${z}`,
    disclaimer:
      '統計訊號僅為統計參考，非投資建議。法人＝外資合計（TWT38U）＋投信（TWT44U）；借券動能＝TWSE TWT93U 借券賣出餘額（連增天數＋20 日 Z-Score）；佔比＝|當日淨超×收盤|／成交額（STOCK_DAY_ALL）；上市標的為主（上櫃、分點集中度另案）；融資券本期未含（第二期）。',
    termsPrefix: '使用即代表同意',
    termsLink: '服務條款',
    termsSuffix: '。',
  },
  en: {
    badgePostMarket: 'Post-Market',
    badgeListed: 'TWSE Listed',
    title: 'Institutional Flow Radar',
    subtitle:
      'In 1 minute after market close, see which stocks institutions are accumulating or dumping: Foreign + Trust net buy/sell streaks and turnover ratio anomalies.',
    loadingMsg: 'Loading Institutional Flow Radar…',
    loadingHint: 'Calculating post-market rankings, please wait a few seconds',
    loadFail: 'Failed to load',
    orderPlanFetchFail: (sym: string, status: number) => `Failed to fetch order plan for ${sym} (${status})`,
    orderPlanLoadFail: 'Failed to load order plan',
    dataTime: (d: string) => `As of ${d} (Post-market prelim; TWSE; excl. margin)`,
    afterHoursTag: 'Prelim',
    degraded: (r: string | null) => `Degraded (${r ?? ''})`,
    closedTitle: 'Market Closed',
    closedDesc: (d: string) => `Non-trading day. Showing ${d} (last trading day) data without refetching.`,
    emptyTitle: 'No Anomalies Today',
    insufficientDays: 'Insufficient institutional data days; ranking temporarily unavailable.',
    scanNoMatch: (scanned: number, days: number, ratio: number) =>
      `Scanned ${scanned} stocks; none met ≥${days}d streak & ≥${ratio}% turnover ratio.`,
    thresholdBar: (days: number, ratio: number, scanned: number) =>
      `Threshold: ≥${days}d streak & ≥${ratio}% turnover ratio · Sorted by ratio · Scanned ${scanned} stocks · Click row for 5D trend`,
    lendingFilterLabel: 'Lending filter:',
    filterAllCount: (n: number) => `All (${n})`,
    filterAnomalyBtn: 'Lending Alert',
    emptyAnomalyFilter: 'No tickers match the securities lending anomaly filter.',
    colSymbol: 'Ticker',
    colDirection: 'Streak',
    colNet: 'Daily Net',
    colRatio: 'Ratio',
    sortAsc: 'Ascending',
    sortDesc: 'Descending',
    sortTapToggle: 'click to toggle',
    sortTap: 'click to sort',
    lendingAlert: 'Lending Alert',
    lendingWatch: 'Lending Watch',
    lendingNormal: 'Lending Normal',
    lendingTip: (days: number, z: string | number) => `Lending up ${days}d in a row · Z=${z}`,
    planLoading: 'Calculating next-day order plan & risk boundaries…',
    planNoData: 'No order plan available for this ticker',
    planTitle: 'Next-Day Order Plan',
    planMeta: (close: string, ma20: string, atr14: string) => `Close ${close} · MA20 ${ma20} · ATR(14) ${atr14}`,
    planRR: (rr: string) => `R/R Ratio ${rr}`,
    planInsufficient: (bars: number) => `Fewer than 60 trading days of history (${bars}d). Support/resistance and MAs are for reference only.`,
    planNegRR: 'Warning: Zero or negative risk-reward ratio (recent institutional cost/stop-loss is near or above the reference limit price, or upside is limited). Evaluate risk carefully.',
    limitBuy: 'Ref. Limit Buy',
    chaseStop: 'Max Chase Price',
    stopLoss: 'Ref. Stop-Loss',
    breakEven: 'Break-Even Sell',
    supportResistance: (sup: string, res: string, vwap: string) => `60D Sup ${sup} / Res ${res} · 20D Est. Cost ${vwap}`,
    posSize: (lots: number, shares: string) => `2% Risk Sizing: ${lots} lots (${shares} sh, NT$1M acct)`,
    planFootnoteSuffix: 'Break-even includes 0.1425% buy/sell commission + 0.3% STT. Statistical reference only, not investment advice.',
    googleSearchAria: (sym: string, name: string) => `Search ${sym} ${name} on Google (new tab)`,
    googleSearchTitle: (sym: string, name: string) => `Search ${sym} ${name} on Google`,
    streakBuy: (d: number) => `Buy ${d}d`,
    streakSell: (d: number) => `Sell ${d}d`,
    trendNote: '5-day combined institutional net flow (Foreign + Trust, shares)',
    noDivergeNote: '· No divergence tag (margin excluded)',
    lendingDetail: (days: number, pct: string | number, z: string | number) =>
      ` · Lending up ${days}d / 5D chg ${pct}% / Z-Score ${z}`,
    disclaimer:
      'Statistical signals are for reference only and do not constitute investment advice. Institutional = Foreign (TWT38U) + Investment Trust (TWT44U); Lending momentum = TWSE TWT93U short-sale lending balance (streak + 20D Z-Score); Ratio = |Net Flow × Close| / Turnover (STOCK_DAY_ALL); TWSE-listed stocks only (TPEx & broker concentration separate); margin trading excluded (Phase 2).',
    termsPrefix: 'By using this tool, you agree to the',
    termsLink: 'Terms of Service',
    termsSuffix: '.',
  },
  ja: {
    badgePostMarket: '大引け後統計',
    badgeListed: 'TWSE 上場',
    title: '機関投資家需給レーダー',
    subtitle:
      '大引け後1分で「機関が買い続けている銘柄・売り抜けている銘柄」を把握：外資系＋投信の連続売買日数と売買代金比率が基準を超えた銘柄をリストアップします。',
    loadingMsg: '需給レーダーを読み込み中…',
    loadingHint: '大引け後ランキングを計算中です。数秒お待ちください',
    loadFail: '読み込みに失敗しました',
    orderPlanFetchFail: (sym: string, status: number) => `${sym} の指値プラン取得に失敗しました（${status}）`,
    orderPlanLoadFail: '指値プランの読み込みに失敗しました',
    dataTime: (d: string) => `データ日時：${d}（大引け後速報；TWSE上場；信用取引除く）`,
    afterHoursTag: '速報値',
    degraded: (r: string | null) => `縮退表示（${r ?? ''}）`,
    closedTitle: '休場のため更新なし',
    closedDesc: (d: string) => `本日は休場日のため、直近営業日（${d}）のデータを維持しています。`,
    emptyTitle: '本日の異常銘柄なし',
    insufficientDays: '機関投資家データの日数が不足しているため、一時的にランキングを非表示にしています。',
    scanNoMatch: (scanned: number, days: number, ratio: number) =>
      `${scanned} 銘柄をスキャンしましたが、${days}日連続かつ売買代金比率 ${ratio}% 以上の銘柄はありませんでした。`,
    thresholdBar: (days: number, ratio: number, scanned: number) =>
      `抽出基準：${days}日以上連続かつ売買代金比 ${ratio}%以上 · 比率順 · ${scanned}銘柄スキャン · 行クリックで5日推移を表示`,
    lendingFilterLabel: '貸株フィルター：',
    filterAllCount: (n: number) => `すべて (${n})`,
    filterAnomalyBtn: '貸株注意・警戒',
    emptyAnomalyFilter: '現在の条件に一致する貸株異常銘柄はありません。',
    colSymbol: 'コード',
    colDirection: '連続売買',
    colNet: '当日純売買',
    colRatio: '比率',
    sortAsc: '昇順',
    sortDesc: '降順',
    sortTapToggle: 'クリックで切替',
    sortTap: 'クリックで並替',
    lendingAlert: '貸株警戒',
    lendingWatch: '貸株注意',
    lendingNormal: '貸株通常',
    lendingTip: (days: number, z: string | number) => `貸株 ${days} 日連続増加 · Z=${z}`,
    planLoading: '翌営業日の指値プランとリスク境界を算出中…',
    planNoData: 'この銘柄の指値プランデータはありません',
    planTitle: '翌営業日 指値プラン',
    planMeta: (close: string, ma20: string, atr14: string) => `終値 ${close} · MA20 ${ma20} · ATR(14) ${atr14}`,
    planRR: (rr: string) => `リスクリワード比 ${rr}`,
    planInsufficient: (bars: number) => `日足履歴が 60 営業日未満（現在 ${bars} 日）のため、支持線・抵抗線および移動平均は参考値です。`,
    planNegRR: '警告：リスクリワード比が 0 以下です（直近の機関コスト／損切りラインが参考指値に近いか上回っているため、慎重にリスク評価を行ってください）。',
    limitBuy: '参考買い指値',
    chaseStop: '追随上限価格',
    stopLoss: '参考損切り価格',
    breakEven: '損益分岐売り値',
    supportResistance: (sup: string, res: string, vwap: string) => `60日支持 ${sup} / 抵抗 ${res} · 20日推定コスト ${vwap}`,
    posSize: (lots: number, shares: string) => `2% リスク目安：${lots} 枚（${shares} 株、100万NT$口座基準）`,
    planFootnoteSuffix: '損益分岐値には売買手数料 0.1425%＋証券取引税 0.3% を含みます。統計参考値であり投資助言ではありません。',
    googleSearchAria: (sym: string, name: string) => `${sym} ${name} を Google 検索（新しいタブ）`,
    googleSearchTitle: (sym: string, name: string) => `${sym} ${name} を Google 検索`,
    streakBuy: (d: number) => `${d}日連続買`,
    streakSell: (d: number) => `${d}日連続売`,
    trendNote: '直近 5 営業日の機関合計純売買（外資＋投信、株数）',
    noDivergeNote: '· 乖離タグなし（信用取引未集計）',
    lendingDetail: (days: number, pct: string | number, z: string | number) =>
      ` · 貸株残 ${days} 日連増 / 5日変化 ${pct}% / Z-Score ${z}`,
    disclaimer:
      '本統計シグナルは参考情報であり、投資助言ではありません。機関＝外資合計（TWT38U）＋投信（TWT44U）；貸株モメンタム＝TWSE TWT93U 貸株売り残（連続増加日数＋20日 Z-Score）；比率＝|当日純売買×終値|／売買代金（STOCK_DAY_ALL）；TWSE 上場銘柄対象（TPEx・支店別集計は別対応）；信用取引は今回対象外（第2期）。',
    termsPrefix: 'ご利用により',
    termsLink: '利用規約',
    termsSuffix: 'に同意したものとみなされます。',
  },
} as const

type ChipCopy = (typeof CHIP_COPY)[Locale]

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
  const { locale } = useI18n()
  const copy = CHIP_COPY[locale]
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
          throw new Error(json?.error || copy.orderPlanFetchFail(symbol, res.status))
        }
        setOrderPlanMap((prev) => ({
          ...prev,
          [symbol]: { loading: false, data: json as OrderPlanData },
        }))
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : copy.orderPlanLoadFail
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
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">{copy.badgePostMarket}</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">{copy.badgeListed}</span>
      </div>
      <h1 className="text-3xl font-bold mb-3">{copy.title}</h1>
      <div className="mb-6 w-16 h-1 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-green)]" />
      <p className="max-w-2xl text-base text-[var(--text-secondary)] leading-relaxed mb-6">
        {copy.subtitle}
      </p>

      {loading ? (
        <TableSkeleton message={copy.loadingMsg} hint={copy.loadingHint} />
      ) : error ? (
        <div className="rounded-xl border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/5 px-4 py-3 text-sm text-[var(--text-primary)] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent-red)]" />
          <span>{copy.loadFail}：{error}</span>
        </div>
      ) : data ? (
        <>
          {/* 資料時間＋盤後初值標註 */}
          <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-[var(--text-secondary)]">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" />
              {copy.dataTime(fmtDate(data.as_of))}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-300 border border-amber-400/20">{copy.afterHoursTag}</span>
            {data.degraded && data.degraded_reason !== 'non-trading-day' ? (
              <span className="px-2 py-0.5 rounded-full bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/20">
                {copy.degraded(data.degraded_reason)}
              </span>
            ) : null}
          </div>

          {/* 休市 */}
          {!data.is_trading_day || data.status === 'closed' ? (
            <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 px-6 py-10 text-center">
              <p className="text-lg font-semibold text-[var(--text-primary)] mb-2">{copy.closedTitle}</p>
              <p className="text-sm text-[var(--text-secondary)]">
                {copy.closedDesc(fmtDate(data.as_of))}
              </p>
            </div>
          ) : data.items.length === 0 ? (
            <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 px-6 py-10 text-center">
              <p className="text-base font-semibold text-[var(--text-primary)] mb-2">{copy.emptyTitle}</p>
              <p className="text-sm text-[var(--text-secondary)]">
                {data.degraded_reason === 'insufficient-days'
                  ? copy.insufficientDays
                  : copy.scanNoMatch(data.scanned, data.thresholds.consec_days, data.thresholds.ratio_pct)}
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-[var(--text-secondary)] mb-3">
                {copy.thresholdBar(data.thresholds.consec_days, data.thresholds.ratio_pct, data.scanned)}
              </p>
              {/* Issue #151：借券異常快速篩選 */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xs text-[var(--text-secondary)]">{copy.lendingFilterLabel}</span>
                <button
                  type="button"
                  onClick={() => setLendingFilter('all')}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                    lendingFilter === 'all'
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {copy.filterAllCount(data.items.length)}
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
                  {copy.filterAnomalyBtn}
                </button>
              </div>
              {sortedItems.length === 0 ? (
                <div className="rounded-xl bg-[var(--bg-card)] border border-white/5 px-6 py-8 text-center mb-6 text-sm text-[var(--text-secondary)]">
                  {copy.emptyAnomalyFilter}
                </div>
              ) : (
              <div className="overflow-x-auto rounded-xl border border-white/5 mb-6">
                <table className={tableClass(typo, 'w-full min-w-[560px]')}>
                  <thead>
                    <tr className={headTrClass(typo, 'text-left text-[var(--text-secondary)] bg-white/5')}>
                      <SortTh
                        label={copy.colSymbol}
                        sortKey="symbol"
                        activeKey={sortKey}
                        dir={sortDir}
                        onToggle={() => toggleSort('symbol')}
                        copy={copy}
                      />
                      <SortTh
                        label={copy.colDirection}
                        sortKey="direction"
                        activeKey={sortKey}
                        dir={sortDir}
                        onToggle={() => toggleSort('direction')}
                        copy={copy}
                      />
                      <SortTh
                        label={copy.colNet}
                        sortKey="netShares"
                        activeKey={sortKey}
                        dir={sortDir}
                        onToggle={() => toggleSort('netShares')}
                        align="right"
                        copy={copy}
                      />
                      <SortTh
                        label={copy.colRatio}
                        sortKey="ratioPct"
                        activeKey={sortKey}
                        dir={sortDir}
                        onToggle={() => toggleSort('ratioPct')}
                        copy={copy}
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
                          copy={copy}
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
          <span>{copy.disclaimer}</span>
        </p>
        <p>
          {copy.termsPrefix} <Link href={localizePath(locale, '/terms')} className="underline hover:text-[var(--text-primary)]">{copy.termsLink}</Link>{copy.termsSuffix}
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
  copy,
}: {
  label: string
  sortKey: ChipSortKey
  activeKey: ChipSortKey
  dir: ChipSortDir
  onToggle: () => void
  align?: 'right'
  copy: ChipCopy
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
        aria-label={active ? `${label}（${dir === 'asc' ? copy.sortAsc : copy.sortDesc}，${copy.sortTapToggle}）` : `${label}（${copy.sortTap}）`}
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

function LendingBadge({ lending, copy }: { lending?: LendingBadgeInfo; copy: ChipCopy }) {
  if (!lending) return null
  const cfg =
    lending.level === 'alert'
      ? { label: copy.lendingAlert, cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30' }
      : lending.level === 'watch'
        ? { label: copy.lendingWatch, cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' }
        : { label: copy.lendingNormal, cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
  const tip = copy.lendingTip(lending.consecutiveIncreaseDays, lending.zScore ?? '—')
  return (
    <span
      title={tip}
      className={`ml-1.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  )
}

function OrderPlanDrawer({ planState, copy }: { planState?: OrderPlanState; copy: ChipCopy }) {
  if (!planState || planState.loading) {
    return (
      <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs text-[var(--text-secondary)]">
        {copy.planLoading}
      </div>
    )
  }
  if (planState.error || !planState.data) {
    return (
      <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
        {planState.error ?? copy.planNoData}
      </div>
    )
  }

  const p = planState.data
  const rrText = p.riskRewardRatio !== null ? `${p.riskRewardRatio.toFixed(2)}x` : '—'

  return (
    <div className="mt-2.5 rounded-xl border border-white/10 bg-[#0d1118]/70 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--text-primary)]">{copy.planTitle}</span>
          <span className="text-[11px] text-[var(--text-secondary)]">
            {copy.planMeta(p.lastClose.toFixed(2), p.ma20.toFixed(2), p.atr14.toFixed(2))}
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
          {copy.planRR(rrText)}
        </span>
      </div>

      {p.insufficientData ? (
        <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
          {copy.planInsufficient(p.barsCount)}
        </p>
      ) : null}

      {p.negativeRiskReward ? (
        <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">
          {copy.planNegRR}
        </p>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-2">
          <div className="text-[10px] text-[var(--text-secondary)]">{copy.limitBuy}</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--accent-green)]">
            {p.limitBuyPrice.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-2">
          <div className="text-[10px] text-[var(--text-secondary)]">{copy.chaseStop}</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-amber-300">
            {p.chaseStopPrice.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-2">
          <div className="text-[10px] text-[var(--text-secondary)]">{copy.stopLoss}</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-rose-400">
            {p.stopLossPrice.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-2">
          <div className="text-[10px] text-[var(--text-secondary)]">{copy.breakEven}</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--text-primary)]">
            {p.breakEvenPrice.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
        <span>
          {copy.supportResistance(p.support60.toFixed(2), p.resistance60.toFixed(2), p.vwap20.toFixed(2))}
        </span>
        <span>
          {copy.posSize(p.positionSizeSuggestion.suggestedLots, p.positionSizeSuggestion.suggestedShares.toLocaleString('en-US'))}
        </span>
      </div>
      <p className="text-[10px] text-[var(--text-secondary)]/80">
        {p.vwapMethodology}；{copy.planFootnoteSuffix}
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
  copy,
}: {
  it: ChipAnomalyRow
  isOpen: boolean
  onToggle: () => void
  windowDays: string[]
  lending?: LendingBadgeInfo
  orderPlan?: OrderPlanState
  copy: ChipCopy
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
            aria-label={copy.googleSearchAria(it.symbol, it.name)}
            title={copy.googleSearchTitle(it.symbol, it.name)}
            onClick={(e) => e.stopPropagation()}
            className="mr-1 inline-flex align-middle text-[var(--text-secondary)] opacity-60 hover:opacity-100 hover:text-[var(--accent)] transition"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
          <span className="font-semibold">{it.symbol}</span>
          <span className="ml-1.5 text-xs text-[var(--text-secondary)]">{it.name}</span>
          <LendingBadge lending={lending} copy={copy} />
        </td>
        <td className="px-3 py-2.5">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
              buy ? 'bg-[var(--accent-green)]/10 text-[var(--accent-green)]' : 'bg-[var(--accent-red)]/10 text-[var(--accent-red)]'
            }`}
          >
            {buy ? copy.streakBuy(it.days) : copy.streakSell(it.days)}
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
              {copy.trendNote}{it.diverge ? '' : copy.noDivergeNote}
              {lending
                ? copy.lendingDetail(lending.consecutiveIncreaseDays, lending.pctChange5d ?? '—', lending.zScore ?? '—')
                : ''}
            </p>
            <OrderPlanDrawer planState={orderPlan} copy={copy} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
}
