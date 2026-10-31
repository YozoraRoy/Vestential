'use client'

import { useState, useMemo, useCallback } from 'react'
import {
  Gift,
  Search,
  Calendar,
  Filter,
  ChevronRight,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  HelpCircle,
  TrendingUp,
  BarChart3,
  ExternalLink,
  History,
  X,
  RefreshCw,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import {
  isTaiwanMarketTradingDay,
  getLastMarketTradingDay,
  formatLastBuyDateWithYear,
  formatTradingDayWithWeekday,
} from '@/utils/taiwan-calendar'
import { useI18n } from '@/i18n/LanguageProvider'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'
import {
  INDUSTRY_ALL,
  INDUSTRY_BOND_ETF,
  INDUSTRY_DR,
  INDUSTRY_ETF,
  INDUSTRY_UNCLASSIFIED,
  countByIndustry,
  industryLabel,
  matchesIndustry,
  splitIndustryChips,
} from '@/lib/industry'

export interface OddLotItem {
  date: string
  stock_id: string
  stock_name: string
  price: number
  volume: number
  bid_price: number | null
  bid_volume: number | null
  ask_price: number | null
  ask_volume: number | null
  gift_name?: string | null
  meeting_date?: string | null
  last_buy_date?: string | null
  distribution_method?: string | null
  current_price?: number | null
  gift_status?: string | null
  claim_rule?: string | null
  claim_rule_source?: string | null
  mops_gift_text?: string | null
  validation_status?: string | null
  validation_reason?: string | null
  twse_meeting_date?: string | null
  industry_code?: string | null
  industry_name?: string | null
}

export type GiftCategory = 'ALL' | 'EGIFT' | 'CARD' | 'KITCHEN' | 'CARE' | 'LIFESTYLE' | 'PENDING' | 'NO_GIFT' | 'OTHER'

export type SortField =
  | 'default'
  | 'stock'
  | 'industry'
  | 'gift'
  | 'category'
  | 'last_buy_date'
  | 'unit_price'
  | 'total_amount'
  | 'volume'
  | 'cp_ratio'
  | 'restriction'

export type SortOrder = 'asc' | 'desc' | 'none'

export function normalizePriceAndVolume(
  price: number | null | undefined,
  volume: number | null | undefined,
  stockId?: string,
  currentPrice?: number | null
): { unitPrice: number | null; totalAmount: number | null; volume: number | null; isEstimated: boolean } {
  if (price == null || isNaN(price) || price <= 0) {
    if (currentPrice != null && currentPrice > 0) {
      const vol = volume ?? 0
      return {
        unitPrice: currentPrice,
        totalAmount: vol > 0 ? currentPrice * vol : null,
        volume: vol,
        isEstimated: true,
      }
    }
    return { unitPrice: null, totalAmount: null, volume: volume ?? 0, isEstimated: false }
  }

  const vol = volume ?? 0
  return {
    unitPrice: price,
    totalAmount: vol > 0 ? price * vol : null,
    volume: vol,
    isEstimated: false,
  }
}

export function getSingleSharePrice(
  price: number | null | undefined,
  volume: number | null | undefined,
  stockId?: string,
  currentPrice?: number | null
): number | null {
  const norm = normalizePriceAndVolume(price, volume, stockId, currentPrice)
  return norm.unitPrice
}

export function formatSingleSharePrice(
  price: number | null | undefined,
  volume: number | null | undefined,
  stockId?: string,
  currentPrice?: number | null,
  ui?: { noTrade?: string; currency?: string }
): { text: string; isEstimated: boolean } {
  const norm = normalizePriceAndVolume(price, volume, stockId, currentPrice)
  if (norm.unitPrice == null || norm.unitPrice <= 0) return { text: ui?.noTrade ?? '未成交', isEstimated: false }
  return {
    text: `${ui?.currency ?? 'NT$'} ${norm.unitPrice.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    isEstimated: norm.isEstimated,
  }
}

export function formatTotalAmount(
  price: number | null | undefined,
  volume?: number | null | undefined,
  stockId?: string,
  currentPrice?: number | null,
  ui?: { currency?: string; yiUnit?: string; wanUnit?: string }
): string {
  const norm = normalizePriceAndVolume(price, volume, stockId, currentPrice)
  if (norm.totalAmount == null || norm.totalAmount <= 0) return '—'
  const cur = ui?.currency ?? 'NT$'
  const total = norm.totalAmount
  if (total >= 100000000) {
    const yi = total / 100000000
    return `${cur} ${yi.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}${ui?.yiUnit ?? ' 億'}`
  }
  if (total >= 10000) {
    const wan = total / 10000
    return `${cur} ${wan.toLocaleString('zh-TW', { maximumFractionDigits: 1 })}${ui?.wanUnit ?? ' 萬'}`
  }
  return `${cur} ${Math.round(total).toLocaleString('zh-TW')}`
}

export function formatVolume(
  vol: number | null | undefined,
  ui?: { zeroShares?: string; sharesUnit?: string; wanSharesUnit?: string }
): string {
  if (vol == null || isNaN(vol)) return ui?.zeroShares ?? '0 股'
  if (vol >= 10000) {
    const wan = vol / 10000
    return `${wan.toLocaleString('zh-TW', { maximumFractionDigits: 1 })}${ui?.wanSharesUnit ?? ' 萬股'}`
  }
  return `${vol.toLocaleString('zh-TW')}${ui?.sharesUnit ?? ' 股'}`
}

export function estimateGiftValue(giftName?: string | null): number {
  const cat = classifyGift(giftName)
  switch (cat) {
    case 'EGIFT':
    case 'CARD':
      return 50
    case 'KITCHEN':
      return 120
    case 'LIFESTYLE':
      return 100
    case 'CARE':
      return 80
    case 'OTHER':
      return 60
    case 'PENDING':
    case 'NO_GIFT':
    default:
      return 0
  }
}

export function calculateCpRatio(
  price: number | null | undefined,
  giftName?: string | null,
  volume?: number | null | undefined,
  currentPrice?: number | null
): number {
  if (!volume || volume <= 0) return 0
  const unitP = getSingleSharePrice(price, volume, undefined, currentPrice)
  if (!unitP || unitP <= 0) return 0
  const estimatedValue = estimateGiftValue(giftName)
  if (estimatedValue <= 0) return 0
  return estimatedValue / unitP
}

export function getMonthDayWeight(dateStr?: string | null): number {
  if (!dateStr || dateStr === '—' || dateStr === 'null') return -1
  const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (!match) return -1
  const month = parseInt(match[1], 10)
  const day = parseInt(match[2], 10)
  return month * 100 + day
}

/**
 * 「最新日期優先」：在 stock.gift 日期與 TWSE 官方日期之間，擇較新者作為有效股東會日期。
 * 回傳顯示用的月份日（MM/DD）與是否採用官方(TWSE)日期。
 */
export function getEffectiveMeetingDate(
  meetingDate?: string | null,
  twseMeetingDate?: string | null,
): { date: string | null; source: 'stockgift' | 'twse' } {
  const stockWeight = getMonthDayWeight(meetingDate)
  const twseWeight = getMonthDayWeight(twseMeetingDate)

  const twseDate: string | null = twseMeetingDate && twseWeight >= 0 ? twseMeetingDate : null
  const stockDate: string | null = meetingDate && stockWeight >= 0 ? meetingDate : null

  if (twseWeight >= 0 && twseWeight > stockWeight) {
    return { date: twseDate, source: 'twse' }
  }
  if (stockWeight >= 0) {
    return { date: stockDate, source: 'stockgift' }
  }
  if (twseWeight >= 0) {
    return { date: twseDate, source: 'twse' }
  }
  return { date: null, source: 'stockgift' }
}

export function formatCpRatio(ratio: number): { label: string; badgeClass: string } {
  if (ratio <= 0) return { label: '—', badgeClass: 'text-white/30' }
  const pct = Math.round(ratio * 100)
  if (ratio >= 2.0) {
    return { label: `🔥 ${ratio.toFixed(2)}x (${pct}%)`, badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-bold' }
  }
  if (ratio >= 1.0) {
    return { label: `✨ ${ratio.toFixed(2)}x (${pct}%)`, badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold' }
  }
  if (ratio >= 0.5) {
    return { label: `👍 ${ratio.toFixed(2)}x`, badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' }
  }
  return { label: `${ratio.toFixed(2)}x`, badgeClass: 'bg-white/5 text-white/60 border-white/10' }
}

export type RestrictionStatus = 'ALLOW_AGENT' | 'REQUIRE_EVOTE_OR_ATTEND' | 'NO_ODD_LOT_GIFT' | 'UNKNOWN'

function getOfficialRuleMap(ui: {
  restrictOneShare: string; restrictFullLot: string;
  restrictNoGift: string; restrictMeetingOnly: string;
}): Record<string, { status: RestrictionStatus; label: string; badgeClass: string }> {
  return {
    ONE_SHARE: {
      status: 'ALLOW_AGENT',
      label: ui.restrictOneShare,
      badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    },
    FULL_LOT: {
      status: 'NO_ODD_LOT_GIFT',
      label: ui.restrictFullLot,
      badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    },
    NO_GIFT: {
      status: 'NO_ODD_LOT_GIFT',
      label: ui.restrictNoGift,
      badgeClass: 'bg-white/5 text-white/40 border-white/15',
    },
    MEETING_ONLY: {
      status: 'REQUIRE_EVOTE_OR_ATTEND',
      label: ui.restrictMeetingOnly,
      badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    },
  }
}

export function getOddLotRestriction(
  giftName?: string | null,
  distributionMethod?: string | null,
  claimRule?: string | null,
  claimRuleSource?: string | null,
  ui?: {
    restrictOneShare?: string; restrictFullLot?: string; restrictNoGift?: string;
    restrictMeetingOnly?: string; restrictEvoteOrAttend?: string;
    restrictOddLotNoGift?: string; restrictPending?: string;
    restrictAgentClaimable?: string; sourceOfficial?: string; sourceEstimated?: string;
  }
): {
  status: RestrictionStatus
  label: string
  badgeClass: string
  source: string
  officialText?: string | null
} {
  const ruleMap = getOfficialRuleMap({
    restrictOneShare: ui?.restrictOneShare ?? '✅ 1股可領',
    restrictFullLot: ui?.restrictFullLot ?? '❌ 需滿千股',
    restrictNoGift: ui?.restrictNoGift ?? '➖ 無紀念品',
    restrictMeetingOnly: ui?.restrictMeetingOnly ?? '⚠️ 需出席/電投',
  })

  if (claimRule && claimRuleSource === 'MOPS' && claimRule !== 'UNKNOWN' && ruleMap[claimRule]) {
    const cfg = ruleMap[claimRule]
    return { ...cfg, source: 'MOPS' }
  }

  const text = `${giftName || ''} ${distributionMethod || ''}`.toLowerCase()

  if (text.includes('親領') || text.includes('電子投票') || text.includes('電投') || text.includes('出席')) {
    return {
      status: 'REQUIRE_EVOTE_OR_ATTEND',
      label: ui?.restrictEvoteOrAttend ?? '⚠️ 需電投/親領',
      badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      source: '推估',
    }
  }
  if (text.includes('不發') || text.includes('滿一張')) {
    return {
      status: 'NO_ODD_LOT_GIFT',
      label: ui?.restrictOddLotNoGift ?? '❌ 零股不發放',
      badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
      source: '推估',
    }
  }
  if (!giftName || giftName === '-' || giftName === '待公告' || classifyGift(giftName) === 'NO_GIFT') {
    return {
      status: 'UNKNOWN',
      label: ui?.restrictPending ?? '⏳ 待公告',
      badgeClass: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
      source: '推估',
    }
  }

  return {
    status: 'ALLOW_AGENT',
    label: ui?.restrictAgentClaimable ?? '✅ 零股可代領',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    source: '推估',
  }
}

export function getValidationBadge(
  status?: string | null,
  ui?: {
    validationOk?: string; validationNoGift?: string; validationDateMismatch?: string;
    validationGiftConflict?: string; validationUnverified?: string;
  },
): { icon: string; label: string; badgeClass: string } | null {
  switch (status) {
    case 'OK': return { icon: '✅', label: ui?.validationOk ?? '已驗證', badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' }
    case 'NO_GIFT': return { icon: '➖', label: ui?.validationNoGift ?? '未發放', badgeClass: 'bg-white/5 text-white/40 border-white/15' }
    case 'DATE_MISMATCH': return { icon: '⚠️', label: ui?.validationDateMismatch ?? '日期不符', badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40' }
    case 'GIFT_CONFLICT': return { icon: '🚨', label: ui?.validationGiftConflict ?? '贈品衝突', badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40' }
    case 'UNVERIFIED': return { icon: '⏳', label: ui?.validationUnverified ?? '未驗證', badgeClass: 'bg-slate-500/20 text-slate-300 border-slate-500/30' }
    default: return null
  }
}

export function classifyGift(giftName?: string | null): GiftCategory {
  if (!giftName || giftName === '-' || giftName === '無' || giftName === 'null') return 'NO_GIFT'
  const name = giftName.toLowerCase()

  if (name.includes('待') || name.includes('未') || name.includes('尚未')) {
    return 'PENDING'
  }
  if (
    name.includes('egift') ||
    name.includes('e-gift') ||
    name.includes('電子')
  ) {
    return 'EGIFT'
  }

  if (
    name.includes('卡') ||
    name.includes('超商') ||
    name.includes('禮券') ||
    name.includes('商品券') ||
    name.includes('7-11') ||
    name.includes('全家') ||
    name.includes('義美') ||
    name.includes('萊爾富') ||
    name.includes('ok超') ||
    name.includes('50元') ||
    name.includes('100元') ||
    name.includes('兌換') ||
    name.includes('折扣') ||
    name.includes('提領')
  ) {
    return 'CARD'
  }
  if (
    name.includes('碗') ||
    name.includes('盤') ||
    name.includes('杯') ||
    name.includes('鍋') ||
    name.includes('壺') ||
    name.includes('保鮮盒') ||
    name.includes('餐具') ||
    name.includes('廚') ||
    name.includes('保溫') ||
    name.includes('刀') ||
    name.includes('洗碗') ||
    name.includes('便當') ||
    name.includes('筷') ||
    name.includes('墊') ||
    name.includes('餐墊') ||
    name.includes('隔熱')
  ) {
    return 'KITCHEN'
  }
  if (
    name.includes('洗') ||
    name.includes('皂') ||
    name.includes('沐浴') ||
    name.includes('洗髮') ||
    name.includes('牙') ||
    name.includes('護手') ||
    name.includes('面霜') ||
    name.includes('清潔') ||
    name.includes('防蚊') ||
    name.includes('衛生') ||
    name.includes('乳液')
  ) {
    return 'CARE'
  }
  if (
    name.includes('充') ||
    name.includes('線') ||
    name.includes('扇') ||
    name.includes('傘') ||
    name.includes('毛巾') ||
    name.includes('袋') ||
    name.includes('包') ||
    name.includes('電') ||
    name.includes('筆記') ||
    name.includes('工具') ||
    name.includes('帽') ||
    name.includes('布') ||
    name.includes('手套')
  ) {
    return 'LIFESTYLE'
  }

  return 'OTHER'
}

export function getCategoryConfig(ui: {
  categoryAll: string; categoryEgift: string; categoryCard: string;
  categoryKitchen: string; categoryCare: string; categoryLifestyle: string;
  categoryPending: string; categoryNoGift: string; categoryOther: string;
}): Record<GiftCategory, { label: string; icon: string; badgeClass: string }> {
  return {
    ALL:      { label: ui.categoryAll,       icon: '✨', badgeClass: 'bg-white/10 text-white border-white/20' },
    EGIFT:    { label: ui.categoryEgift,     icon: '📱', badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30 font-bold' },
    CARD:     { label: ui.categoryCard,      icon: '💳', badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
    KITCHEN:  { label: ui.categoryKitchen,   icon: '🥣', badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
    CARE:     { label: ui.categoryCare,      icon: '🧴', badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/30' },
    LIFESTYLE:{ label: ui.categoryLifestyle, icon: '🔌', badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
    PENDING:  { label: ui.categoryPending,   icon: '⏳', badgeClass: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
    NO_GIFT:  { label: ui.categoryNoGift,    icon: '➖', badgeClass: 'bg-white/5 text-white/40 border-white/10' },
    OTHER:    { label: ui.categoryOther,     icon: '🎁', badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
  }
}

const PAGE_SIZE = 100

interface OddLotViewProps {
  initialItems: OddLotItem[]
  latestDate?: string
  initialQuery?: string
}

export function OddLotView({ initialItems, latestDate, initialQuery = '' }: OddLotViewProps) {
  const { dict, locale } = useI18n()
  const ui = dict.oddLot
  const typo = useTableTypography()

  const [selectedCategory, setSelectedCategory] = useState<GiftCategory>('ALL')
  const [selectedIndustry, setSelectedIndustry] = useState<string>(INDUSTRY_ALL)
  const [industryExpanded, setIndustryExpanded] = useState(false)
  const [searchQuery, setSearchQuery] = useState(initialQuery)
  const [page, setPage] = useState(1)

  const [sortField, setSortField] = useState<SortField>('default')
  const [sortOrder, setSortOrder] = useState<SortOrder>('none')
  const [showAiTooltip, setShowAiTooltip] = useState(false)
  const [hideNoGift, setHideNoGift] = useState(true)
  const [onlyAllowAgent, setOnlyAllowAgent] = useState(false)
  const [onlyHighCp, setOnlyHighCp] = useState(false)
  const [hideExpired, setHideExpired] = useState(true)

  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleRefresh = async () => {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const res = await fetch('/api/odd-lot/refresh', { method: 'POST' })
      const json = await res.json()
      if (res.status === 401) {
        const url = `/login?redirect=${encodeURIComponent('/odd-lot')}`
        window.location.href = url
        return
      }
      if (json.success) {
        if (json.throttled) {
          setRefreshMsg({ type: 'error', text: ui.refreshThrottled })
        } else {
          setRefreshMsg({ type: 'success', text: ui.refreshSuccess.replace('{oddLotCount}', String(json.oddLotCount)).replace('{giftCount}', String(json.giftCount)) })
          setTimeout(() => window.location.reload(), 1200)
        }
      } else {
        setRefreshMsg({ type: 'error', text: json.error || ui.refreshFailed })
      }
    } catch {
      setRefreshMsg({ type: 'error', text: ui.refreshNetworkError })
    } finally {
      setRefreshing(false)
    }
  }

  const [historyModalStock, setHistoryModalStock] = useState<{ stock_id: string; stock_name: string } | null>(null)
  const [historyData, setHistoryData] = useState<{ year: number; gift_name: string }[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const openHistoryModal = async (stockId: string, stockName: string) => {
    setHistoryModalStock({ stock_id: stockId, stock_name: stockName })
    setLoadingHistory(true)
    try {
      const res = await fetch(`/api/gifts/history?stock_id=${stockId}`)
      const json = await res.json()
      if (json.success && json.history) {
        setHistoryData(json.history)
      }
    } catch (e) {
      console.error('Failed to fetch gift history:', e)
    } finally {
      setLoadingHistory(false)
    }
  }

  const categoryConfig = useMemo(() => getCategoryConfig(ui), [ui])

  const summaryItem = useMemo(() => {
    return initialItems.find(item => item.stock_name === '合計' || item.stock_id === '' || item.stock_id === '-')
  }, [initialItems])

  const dedupedItems = useMemo(() => {
    const seen = new Set<string>()
    return initialItems.filter(item => {
      if (item.stock_name === '合計' || !item.stock_id || item.stock_id === '-') return false

      const key = `${item.date}-${item.stock_id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [initialItems])

  const categoryCounts = useMemo(() => {
    const counts: Record<GiftCategory, number> = {
      ALL: dedupedItems.length,
      EGIFT: 0, CARD: 0, KITCHEN: 0, CARE: 0, LIFESTYLE: 0, PENDING: 0, NO_GIFT: 0, OTHER: 0,
    }
    for (const item of dedupedItems) {
      const cat = classifyGift(item.gift_name)
      counts[cat] = (counts[cat] || 0) + 1
    }
    return counts
  }, [dedupedItems])

  // ── 板塊（Issue #121）：DB 只存官方中文名，顯示依當前語系轉換 ──
  const industryDisplay = useCallback((name?: string | null): string => {
    const raw = (name ?? '').trim()
    if (!raw) return ''
    if (raw === INDUSTRY_ETF) return ui.industryEtf
    if (raw === INDUSTRY_BOND_ETF) return ui.industryBondEtf
    if (raw === INDUSTRY_DR) return ui.industryDr
    return industryLabel(raw, locale)
  }, [locale, ui])
  const industryChipLabel = (key: string): string =>
    key === INDUSTRY_UNCLASSIFIED ? ui.industryUnclassified : industryDisplay(key) || key
  const industrySortKey = (item: OddLotItem): string =>
    (item.industry_name ?? '').trim() || INDUSTRY_UNCLASSIFIED

  const industryChips = useMemo(
    () => splitIndustryChips(countByIndustry(dedupedItems)),
    [dedupedItems],
  )

  const isLastBuyDateExpired = (lastBuyDate: string | null | undefined, meetingDate?: string | null): boolean => {
    if (!lastBuyDate) return false
    const match = lastBuyDate.match(/^(\d{1,2})\/(\d{1,2})$/)
    if (!match) return false

    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1
    const month = parseInt(match[1], 10)
    const day = parseInt(match[2], 10)

    let year = currentYear
    if (meetingDate) {
      const meetingFull = meetingDate.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/)
      const meetingMd = meetingDate.match(/^(\d{1,2})[\/-](\d{1,2})$/)
      if (meetingFull) {
        year = parseInt(meetingFull[1], 10)
      } else if (meetingMd) {
        const meetMonth = parseInt(meetingMd[1], 10)
        if (meetMonth < currentMonth) {
          year = currentYear
        } else if (meetMonth >= currentMonth + 6) {
          year = currentYear - 1
        } else {
          year = currentYear
        }
      }
    } else {
      if (currentMonth >= 11 && month <= 4) {
        year = currentYear + 1
      }
    }

    let buyDate = new Date(year, month - 1, day)

    if (!isTaiwanMarketTradingDay(buyDate)) {
      buyDate = getLastMarketTradingDay(buyDate)
    }

    const today = new Date(currentYear, now.getMonth(), now.getDate())
    return buyDate < today
  }

  const filteredItems = useMemo(() => {
    return dedupedItems.filter(item => {
      const cat = classifyGift(item.gift_name)

      if (hideExpired && isLastBuyDateExpired(item.last_buy_date, item.meeting_date)) {
        return false
      }

      if (hideNoGift && selectedCategory === 'ALL' && cat === 'NO_GIFT') {
        return false
      }

      if (onlyAllowAgent) {
        const rest = getOddLotRestriction(item.gift_name, item.distribution_method, item.claim_rule, item.claim_rule_source)
        if (rest.status !== 'ALLOW_AGENT') return false
      }

      if (onlyHighCp) {
        const cp = calculateCpRatio(item.price, item.gift_name, item.volume, item.current_price)
        if (cp < 1.0) return false
      }

      if (selectedCategory !== 'ALL') {
        if (cat !== selectedCategory) return false
      }
      if (selectedIndustry !== INDUSTRY_ALL) {
        if (!matchesIndustry(item, selectedIndustry)) return false
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase()
        const matchId = item.stock_id.toLowerCase().includes(q)
        const matchName = item.stock_name.toLowerCase().includes(q)
        const matchGift = (item.gift_name ?? '').toLowerCase().includes(q)
        const matchIndustry =
          (item.industry_name ?? '').toLowerCase().includes(q) ||
          industryDisplay(item.industry_name).toLowerCase().includes(q)
        return matchId || matchName || matchGift || matchIndustry
      }
      return true
    })
  }, [dedupedItems, hideNoGift, hideExpired, onlyAllowAgent, onlyHighCp, selectedCategory, selectedIndustry, searchQuery, industryDisplay])

  const sortedItems = useMemo(() => {
    if (sortField === 'default' || sortOrder === 'none') {
      return filteredItems
    }
    const items = [...filteredItems]
    const modifier = sortOrder === 'asc' ? 1 : -1

    items.sort((a, b) => {
      switch (sortField) {
        case 'stock':
          return a.stock_id.localeCompare(b.stock_id) * modifier
        case 'industry':
          return industrySortKey(a).localeCompare(industrySortKey(b), 'zh-TW') * modifier
        case 'gift':
          return (a.gift_name || '').localeCompare(b.gift_name || '', 'zh-TW') * modifier
        case 'category':
          return classifyGift(a.gift_name).localeCompare(classifyGift(b.gift_name)) * modifier
        case 'last_buy_date': {
          const wA = getMonthDayWeight(a.last_buy_date)
          const wB = getMonthDayWeight(b.last_buy_date)
          return (wA - wB) * modifier
        }
        case 'unit_price': {
          const pA = getSingleSharePrice(a.price, a.volume, a.stock_id, a.current_price) ?? -1
          const pB = getSingleSharePrice(b.price, b.volume, b.stock_id, b.current_price) ?? -1
          return (pA - pB) * modifier
        }
        case 'total_amount': {
          const totA = getSingleSharePrice(a.price, a.volume, a.stock_id, a.current_price) != null
            ? (getSingleSharePrice(a.price, a.volume, a.stock_id, a.current_price) ?? 0) * (a.volume ?? 0)
            : 0
          const totB = getSingleSharePrice(b.price, b.volume, b.stock_id, b.current_price) != null
            ? (getSingleSharePrice(b.price, b.volume, b.stock_id, b.current_price) ?? 0) * (b.volume ?? 0)
            : 0
          return (totA - totB) * modifier
        }
        case 'volume':
          return ((a.volume ?? 0) - (b.volume ?? 0)) * modifier
        case 'cp_ratio':
          return (
            (calculateCpRatio(a.price, a.gift_name, a.volume, a.current_price) - calculateCpRatio(b.price, b.gift_name, b.volume, b.current_price)) *
            modifier
          )
        case 'restriction':
          return (
            getOddLotRestriction(a.gift_name, a.distribution_method, a.claim_rule, a.claim_rule_source).status.localeCompare(
              getOddLotRestriction(b.gift_name, b.distribution_method, b.claim_rule, b.claim_rule_source).status
            ) * modifier
          )
        default:
          return 0
      }
    })
    return items
  }, [filteredItems, sortField, sortOrder])

  const handleSort = (field: SortField) => {
    if (sortField !== field) {
      setSortField(field)
      setSortOrder('asc')
    } else {
      if (sortOrder === 'asc') setSortOrder('desc')
      else if (sortOrder === 'desc') {
        setSortField('default')
        setSortOrder('none')
      } else {
        setSortOrder('asc')
      }
    }
    setPage(1)
  }

  const handleCategoryChange = (cat: GiftCategory) => {
    setSelectedCategory(cat)
    setPage(1)
  }
  const handleIndustryChange = (industry: string) => {
    setSelectedIndustry(industry)
    setPage(1)
  }
  const handleSearchChange = (q: string) => {
    setSearchQuery(q)
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE))
  const pagedItems = sortedItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const renderSortHeader = (label: string, field: SortField, alignRight = false) => {
    const isActive = sortField === field && sortOrder !== 'none'
    return (
      <th
        onClick={() => handleSort(field)}
        className={`px-4 py-3.5 font-semibold cursor-pointer select-none hover:text-white transition-colors ${
          alignRight ? 'text-right' : ''
        }`}
      >
        <div className={`inline-flex items-center gap-1.5 ${alignRight ? 'justify-end w-full' : ''}`}>
          <span>{label}</span>
          <span className="text-white/40">
            {isActive ? (
              sortOrder === 'asc' ? (
                <ArrowUp className="w-3.5 h-3.5 text-[var(--accent)]" />
              ) : (
                <ArrowDown className="w-3.5 h-3.5 text-[var(--accent)]" />
              )
            ) : (
              <ArrowUpDown className="w-3 h-3 opacity-40 hover:opacity-100" />
            )}
          </span>
        </div>
      </th>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[var(--bg-card)] border border-white/10 rounded-2xl p-4 flex items-center gap-3.5">
          <div className="p-3 rounded-xl bg-[var(--accent)]/10 text-[var(--accent)] shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-[var(--text-secondary)] mb-0.5">
              {ui.statsLatestDay} {latestDate ? `(${formatTradingDayWithWeekday(latestDate)})` : ''} {ui.statsTotalOddLotAmount}
            </div>
            <div className="text-base md:text-lg font-mono font-bold text-white">
              {(() => {
                const totalAmt = dedupedItems.reduce((acc, item) => acc + (item.price ?? 0) * (item.volume ?? 0), 0)
                return totalAmt > 0 ? formatTotalAmount(totalAmt, 1, undefined, undefined, ui) : (summaryItem ? formatTotalAmount(summaryItem.price, summaryItem.volume, undefined, undefined, ui) : '—')
              })()}
            </div>
          </div>
        </div>

        <div className="bg-[var(--bg-card)] border border-white/10 rounded-2xl p-4 flex items-center gap-3.5">
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 shrink-0">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-[var(--text-secondary)] mb-0.5">
              {ui.statsLatestDay} {latestDate ? `(${formatTradingDayWithWeekday(latestDate)})` : ''} {ui.statsTotalOddLotVolume}
            </div>
            <div className="text-base md:text-lg font-mono font-bold text-white">
              {(() => {
                const totalVol = dedupedItems.reduce((acc, item) => acc + (item.volume ?? 0), 0)
                return totalVol > 0 ? formatVolume(totalVol, ui) : (summaryItem ? formatVolume(summaryItem.volume, ui) : '—')
              })()}
            </div>
          </div>
        </div>

        <div className="bg-[var(--bg-card)] border border-white/10 rounded-2xl p-4 flex items-center gap-3.5">
          <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400 shrink-0">
            <Gift className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-[var(--text-secondary)] mb-0.5">{ui.statsTotalStocks}</div>
            <div className="text-base md:text-lg font-mono font-bold text-white">
              {ui.stocksCount.replace('{n}', dedupedItems.length.toLocaleString())}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[var(--bg-card)] border border-white/5 rounded-2xl p-4 md:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[var(--text-secondary)] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder={ui.searchPlaceholder}
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setHideNoGift(prev => !prev)
                setPage(1)
              }}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer select-none ${
                hideNoGift
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 shadow-lg shadow-amber-500/10'
                  : 'bg-white/5 text-[var(--text-secondary)] border-white/10 hover:text-white hover:border-white/20'
              }`}
            >
              <span
                className={`w-3 h-3 rounded-full border flex items-center justify-center transition-colors ${
                  hideNoGift ? 'border-amber-400 bg-amber-400' : 'border-white/30'
                }`}
              >
                {hideNoGift && <span className="w-1 h-1 rounded-full bg-slate-950" />}
              </span>
              <span>{ui.toggleHideNoGift}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setOnlyAllowAgent(prev => !prev)
                setPage(1)
              }}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer select-none ${
                onlyAllowAgent
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 shadow-lg shadow-emerald-500/10'
                  : 'bg-white/5 text-[var(--text-secondary)] border-white/10 hover:text-white hover:border-white/20'
              }`}
            >
              <span
                className={`w-3 h-3 rounded-full border flex items-center justify-center transition-colors ${
                  onlyAllowAgent ? 'border-emerald-400 bg-emerald-400' : 'border-white/30'
                }`}
              >
                {onlyAllowAgent && <span className="w-1 h-1 rounded-full bg-slate-950" />}
              </span>
              <span>{ui.toggleOnlyAllowAgent}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setOnlyHighCp(prev => !prev)
                setPage(1)
              }}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer select-none ${
                onlyHighCp
                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/30 shadow-lg shadow-rose-500/10'
                  : 'bg-white/5 text-[var(--text-secondary)] border-white/10 hover:text-white hover:border-white/20'
              }`}
            >
              <span
                className={`w-3 h-3 rounded-full border flex items-center justify-center transition-colors ${
                  onlyHighCp ? 'border-rose-400 bg-rose-400' : 'border-white/30'
                }`}
              >
                {onlyHighCp && <span className="w-1 h-1 rounded-full bg-slate-950" />}
              </span>
              <span>{ui.toggleOnlyHighCp}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setHideExpired(prev => !prev)
                setPage(1)
              }}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer select-none ${
                hideExpired
                  ? 'bg-sky-500/15 text-sky-300 border-sky-500/30 shadow-lg shadow-sky-500/10'
                  : 'bg-white/5 text-[var(--text-secondary)] border-white/10 hover:text-white hover:border-white/20'
              }`}
            >
              <span
                className={`w-3 h-3 rounded-full border flex items-center justify-center transition-colors ${
                  hideExpired ? 'border-sky-400 bg-sky-400' : 'border-white/30'
                }`}
              >
                {hideExpired && <span className="w-1 h-1 rounded-full bg-slate-950" />}
              </span>
              <span>{ui.toggleHideExpired}</span>
            </button>

            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer select-none ${
                refreshing
                  ? 'bg-blue-500/15 text-blue-300 border-blue-500/30 animate-pulse'
                  : 'bg-blue-500/10 text-blue-300 border-blue-500/30 hover:bg-blue-500/20 hover:text-blue-200'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? ui.refreshing : ui.manualRefresh}</span>
            </button>
          </div>

          {refreshMsg && (
            <div
              className={`text-xs px-3 py-1.5 rounded-lg ${
                refreshMsg.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
              }`}
            >
              {refreshMsg.text}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] mb-2.5 font-medium">
            <Filter className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span>{ui.filterLabel}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(categoryConfig) as GiftCategory[]).map(catKey => {
              const cfg = categoryConfig[catKey]
              const isSelected = selectedCategory === catKey
              const count = categoryCounts[catKey] || 0

              return (
                <button
                  key={catKey}
                  onClick={() => handleCategoryChange(catKey)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-lg shadow-[var(--accent)]/20'
                      : 'bg-white/5 text-[var(--text-secondary)] border-white/5 hover:border-white/20 hover:text-white'
                  }`}
                >
                  <span>{cfg.icon}</span>
                  <span>{cfg.label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-white/10 text-[var(--text-secondary)]'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Issue #121：板塊（TWSE 官方產業別）篩選；依當日筆數前 10 大 + 「其他板塊 (N)」展開 */}
        <div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] mb-2.5 font-medium">
            <Layers className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span>{ui.industryFilterLabel}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleIndustryChange(INDUSTRY_ALL)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                selectedIndustry === INDUSTRY_ALL
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-lg shadow-[var(--accent)]/20'
                  : 'bg-white/5 text-[var(--text-secondary)] border-white/5 hover:border-white/20 hover:text-white'
              }`}
            >
              <span>{ui.industryAll}</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                  selectedIndustry === INDUSTRY_ALL ? 'bg-white/20 text-white' : 'bg-white/10 text-[var(--text-secondary)]'
                }`}
              >
                {dedupedItems.length.toLocaleString()}
              </span>
            </button>

            {industryChips.top.map(({ name, count }) => (
              <button
                key={name}
                onClick={() => handleIndustryChange(name)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                  selectedIndustry === name
                    ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-lg shadow-[var(--accent)]/20'
                    : 'bg-white/5 text-[var(--text-secondary)] border-white/5 hover:border-white/20 hover:text-white'
                }`}
              >
                <span>{industryChipLabel(name)}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                    selectedIndustry === name ? 'bg-white/20 text-white' : 'bg-white/10 text-[var(--text-secondary)]'
                  }`}
                >
                  {count}
                </span>
              </button>
            ))}

            {industryChips.rest.length > 0 && (
              <button
                onClick={() => setIndustryExpanded(prev => !prev)}
                aria-expanded={industryExpanded}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-white/10 bg-white/5 text-[var(--text-secondary)] hover:border-white/20 hover:text-white transition-all cursor-pointer"
              >
                <span>{ui.industryOther.replace('{n}', String(industryChips.rest.length))}</span>
                {industryExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                <span className="sr-only">{industryExpanded ? ui.industryCollapse : ui.industryExpand}</span>
              </button>
            )}

            {industryExpanded &&
              industryChips.rest.map(({ name, count }) => (
                <button
                  key={name}
                  onClick={() => handleIndustryChange(name)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                    selectedIndustry === name
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-lg shadow-[var(--accent)]/20'
                      : 'bg-white/5 text-[var(--text-secondary)] border-white/5 hover:border-white/20 hover:text-white'
                  }`}
                >
                  <span>{industryChipLabel(name)}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                      selectedIndustry === name ? 'bg-white/20 text-white' : 'bg-white/10 text-[var(--text-secondary)]'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              ))}
          </div>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="bg-[var(--bg-card)] border border-white/5 rounded-2xl p-12 text-center text-sm text-[var(--text-secondary)]">
          <Gift className="w-8 h-8 text-[var(--text-secondary)] mx-auto mb-3 opacity-50" />
          <p className="font-medium text-base text-white mb-1">{ui.emptyTitle}</p>
          <p className="text-xs">
            {hideNoGift || onlyAllowAgent || onlyHighCp || selectedIndustry !== INDUSTRY_ALL
              ? ui.emptyFilteredHint
              : ui.emptySearchHint}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] px-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span>
                {ui.totalRecords.replace('{n}', filteredItems.length.toLocaleString())}
              </span>
              {hideNoGift && selectedCategory === 'ALL' && (
                <span className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
                  {ui.statusHiddenNoGift}
                </span>
              )}
              {onlyAllowAgent && (
                <span className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                  {ui.statusOnlyAgentClaimable}
                </span>
              )}
              {onlyHighCp && (
                <span className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-md">
                  {ui.statusOnlyHighCp}
                </span>
              )}
              {hideExpired && (
                <span className="text-[11px] text-sky-300 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-md">
                  {ui.statusHiddenExpired}
                </span>
              )}
              {selectedCategory !== 'ALL' && (
                <span className="text-[11px] text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/20 px-2 py-0.5 rounded-md">
                  {ui.statusFilteredByCategory}
                </span>
              )}
              {selectedIndustry !== INDUSTRY_ALL && (
                <span className="text-[11px] text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/20 px-2 py-0.5 rounded-md">
                  {ui.statusFilteredByIndustry.replace('{name}', industryChipLabel(selectedIndustry))}
                </span>
              )}
            </div>
            <span>
              {ui.pageInfo
                .replace('{page}', String(page))
                .replace('{totalPages}', String(totalPages))
                .replace('{pageSize}', String(PAGE_SIZE))}
            </span>
          </div>

          <div className="w-full overflow-x-auto rounded-2xl border border-white/5 bg-[var(--bg-card)]">
            <table className={tableClass(typo, 'min-w-max w-full text-left')}>
              <thead>
                <tr className={headTrClass(typo, 'border-b border-white/10 bg-white/[0.02] text-[var(--text-secondary)]')}>
                  <th
                    onClick={() => handleSort('default')}
                    className="px-4 py-3.5 font-semibold cursor-pointer hover:text-white transition-colors"
                    title={ui.resetSortTitle}
                  >
                    #
                  </th>
                  {renderSortHeader(ui.colStock, 'stock')}
                  {renderSortHeader(ui.colIndustry, 'industry')}
                  {renderSortHeader(ui.colGift, 'gift')}
                  {renderSortHeader(ui.colCategory, 'category')}
                  {renderSortHeader(ui.colRestriction, 'restriction')}
                  {renderSortHeader(ui.colLastBuyDate, 'last_buy_date')}
                  {renderSortHeader(ui.colUnitPrice, 'unit_price', true)}
                  {renderSortHeader(ui.colCpRatio, 'cp_ratio', true)}
                  {renderSortHeader(ui.colTotalAmount, 'total_amount', true)}
                  {renderSortHeader(ui.colVolume, 'volume', true)}

                  <th className="px-4 py-3.5 font-semibold text-center relative">
                    <div className="inline-flex items-center justify-center gap-1.5">
                      <span>{ui.colAiEstimate}</span>
                      <div
                        className="relative flex items-center"
                        onMouseEnter={() => setShowAiTooltip(true)}
                        onMouseLeave={() => setShowAiTooltip(false)}
                        onClick={() => setShowAiTooltip(prev => !prev)}
                      >
                        <HelpCircle className="w-3.5 h-3.5 text-white/50 hover:text-white cursor-pointer transition-colors" />

                        {showAiTooltip && (
                          <div className="absolute right-0 top-full mt-2 w-64 bg-slate-900/95 backdrop-blur-md border border-white/20 p-3 rounded-xl shadow-2xl text-left z-50 pointer-events-none">
                            <div className="text-xs font-bold text-white mb-1 flex items-center gap-1">
                              <span>{ui.aiTooltipTitle}</span>
                            </div>
                            <p className="text-[11px] text-white/80 leading-relaxed">
                              {ui.aiTooltipDesc}
                            </p>
                            <div className="mt-1.5 pt-1.5 border-t border-white/10 text-[10px] text-[var(--accent)]">
                              {ui.aiTooltipHint}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {pagedItems.map((item, idx) => {
                  const giftName = item.gift_name && item.gift_name !== 'null' ? item.gift_name : null
                  const categoryKey = classifyGift(giftName)
                  const catConfig = categoryConfig[categoryKey]
                  const rowNum = (page - 1) * PAGE_SIZE + idx + 1

                  return (
                    <tr key={`${item.date}-${item.stock_id}-${idx}`} className="hover:bg-white/[0.03] transition-colors">
                      <td className="px-4 py-3.5 text-xs text-white/30 font-mono">{rowNum}</td>

                      <td className="px-4 py-3.5">
                        <a
                          href={`https://tw.stock.yahoo.com/quote/${item.stock_id}.TW`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 group transition"
                          title={ui.yahooLinkTitle.replace('{name}', item.stock_name).replace('{id}', item.stock_id)}
                        >
                          <span className="font-bold text-white text-base group-hover:text-[var(--accent)] group-hover:underline transition-colors">
                            {item.stock_name}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-[var(--accent)] font-mono group-hover:bg-[var(--accent)] group-hover:text-white transition-colors inline-flex items-center gap-1">
                            <span>{item.stock_id}</span>
                            <ExternalLink className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                          </span>
                        </a>
                      </td>

                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {(() => {
                          const industryText = industryDisplay(item.industry_name)
                          if (!industryText) return <span className="text-white/30 text-xs">—</span>
                          return (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-white/5 text-white/70 border-white/10">
                              {industryText}
                            </span>
                          )
                        })()}
                      </td>

                      <td className="px-4 py-3.5">
                        {giftName ? (
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Gift className="w-4 h-4 text-[var(--accent-green)] shrink-0" />
                              <span className="font-medium text-white truncate">{giftName}</span>
                            </div>
                            <button
                              onClick={() => openHistoryModal(item.stock_id, item.stock_name)}
                              title={ui.giftHistoryTitle}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/30 border border-indigo-500/20 transition-all shrink-0 cursor-pointer"
                            >
                              <History className="w-3 h-3 text-indigo-400" />
                              <span>{ui.last5Years}</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-white/30 text-xs">—</span>
                        )}
                        {(() => {
                          const cfg = getValidationBadge(item.validation_status, ui)
                          if (!cfg) return null
                          return (
                            <span
                              title={item.validation_reason || cfg.label}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${cfg.badgeClass} ml-1`}
                            >
                              {cfg.icon} {cfg.label}
                            </span>
                          )
                        })()}
                      </td>

                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${catConfig.badgeClass}`}>
                          {catConfig.icon} {catConfig.label}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 whitespace-nowrap text-xs">
                        {(() => {
                          const { label, badgeClass, source, officialText } = getOddLotRestriction(
                            giftName,
                            item.distribution_method,
                            item.claim_rule,
                            item.claim_rule_source,
                            ui,
                          )
                          const tip =
                            source === 'MOPS'
                              ? `${ui.sourceMopsTip}${officialText ? `\n${officialText}` : ''}`
                              : ui.sourceEstimateTip
                          return (
                            <span
                              title={tip}
                              className={`px-2.5 py-0.5 rounded-full border font-medium text-xs ${badgeClass}`}
                            >
                              {label}
                              <span className="ml-1 opacity-70 text-[10px]">
                                {source === 'MOPS' ? ui.sourceOfficial : ui.sourceEstimated}
                              </span>
                            </span>
                          )
                        })()}
                      </td>

                      <td className="px-4 py-3.5 whitespace-nowrap text-xs text-[var(--text-secondary)]">
                        {(() => {
                          const eff = getEffectiveMeetingDate(item.meeting_date, item.twse_meeting_date)
                          const dateInfo = formatLastBuyDateWithYear(item.last_buy_date, eff.date)
                          if (!dateInfo) return <span className="text-white/40">-</span>
                          return (
                            <div className="flex items-center gap-1.5 font-medium">
                              <Calendar className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <span className={dateInfo.isCrossYear ? 'text-amber-300 font-bold' : 'text-emerald-400'}>
                                {dateInfo.formattedDate}
                              </span>
                              {dateInfo.isCrossYear && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  {ui.crossYear}
                                </span>
                              )}
                              {eff.source === 'twse' && item.meeting_date && item.meeting_date !== item.twse_meeting_date && (
                                <span
                                  title={ui.officialDateTip}
                                  className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30"
                                >
                                  {ui.officialDate}
                                </span>
                              )}
                            </div>
                          )
                        })()}
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono font-bold whitespace-nowrap">
                        {(() => {
                          const { text, isEstimated } = formatSingleSharePrice(item.price, item.volume, item.stock_id, item.current_price, ui)
                          if (text === ui.noTrade) return <span className="text-white/40">{ui.noTrade}</span>
                          return (
                            <span className={isEstimated ? 'text-cyan-400' : 'text-emerald-400'}>
                              {text}
                              {isEstimated && (
                                <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" title={ui.estimatedTip}>
                                  {ui.estimated}
                                </span>
                              )}
                            </span>
                          )
                        })()}
                      </td>

                      <td className="px-4 py-3.5 text-right whitespace-nowrap font-mono text-xs">
                        {(() => {
                          const cpRatio = calculateCpRatio(item.price, giftName, item.volume, item.current_price)
                          const { label, badgeClass } = formatCpRatio(cpRatio)
                          return (
                            <span className={`px-2.5 py-0.5 rounded-lg border text-xs ${badgeClass}`}>
                              {label}
                            </span>
                          )
                        })()}
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono text-xs text-white/80 whitespace-nowrap">
                        {formatTotalAmount(item.price, item.volume, item.stock_id, item.current_price, ui)}
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono text-xs text-[var(--text-secondary)] whitespace-nowrap">
                        {formatVolume(item.volume, ui)}
                      </td>

                      <td className="px-4 py-3.5 text-center whitespace-nowrap">
                        <a
                          href={`/analyze?symbol=${item.stock_id}.TW`}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)] hover:text-white transition"
                        >
                          <span>{ui.aiAnalysis}</span>
                          <ChevronRight className="w-3 h-3" />
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 py-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 bg-white/5 text-[var(--text-secondary)] hover:text-white hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <ChevronLeftIcon className="w-3.5 h-3.5" />
                {ui.prevPage}
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                  .reduce<(number | '...')[]>((acc, p, i, arr) => {
                    if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...')
                    acc.push(p)
                    return acc
                  }, [])
                  .map((p, i) =>
                    p === '...' ? (
                      <span key={`ellipsis-${i}`} className="px-2 text-white/30 text-xs">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setPage(p as number)}
                        className={`w-8 h-8 rounded-lg text-xs font-semibold transition ${
                          page === p
                            ? 'bg-[var(--accent)] text-white shadow-lg shadow-[var(--accent)]/20'
                            : 'bg-white/5 text-[var(--text-secondary)] hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}
              </div>

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 bg-white/5 text-[var(--text-secondary)] hover:text-white hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                {ui.nextPage}
                <ChevronRightIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] px-2">
            <span>
              {ui.displayRange
                .replace('{from}', String((page - 1) * PAGE_SIZE + 1))
                .replace('{to}', String(Math.min(page * PAGE_SIZE, filteredItems.length)))
                .replace('{total}', String(filteredItems.length))}
            </span>
            <span>{ui.dataSource}</span>
          </div>
        </div>
      )}

      {historyModalStock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-[var(--bg-card)] border border-white/20 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5 relative">
            <button
              onClick={() => setHistoryModalStock(null)}
              className="absolute top-4 right-4 p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 pr-8">
              <div className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-400 shrink-0">
                <History className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  {historyModalStock.stock_name} ({historyModalStock.stock_id})
                </h3>
                <p className="text-xs text-[var(--text-secondary)]">{ui.historyModalSubtitle}</p>
              </div>
            </div>

            {loadingHistory ? (
              <div className="py-8 text-center text-white/50 space-y-2">
                <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs">{ui.historyLoading}</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
                {historyData.map((h) => {
                  const cat = classifyGift(h.gift_name)
                  const config = categoryConfig[cat]
                  return (
                    <div key={h.year} className="flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/10 hover:border-indigo-500/30 transition-all">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-sm text-indigo-300 bg-indigo-500/10 px-2.5 py-1 rounded-lg border border-indigo-500/20">
                          {h.year}{ui.historyYearSuffix ? ` ${ui.historyYearSuffix}` : ''}
                        </span>
                        <span className="font-medium text-white text-sm">{h.gift_name}</span>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${config.badgeClass}`}>
                        {config.icon} {config.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="pt-2">
              <button
                onClick={() => setHistoryModalStock(null)}
                className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-sm transition-all cursor-pointer text-center"
              >
                {ui.historyClose}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
