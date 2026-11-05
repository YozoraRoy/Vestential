/**
 * Issue #118 股東會紀念品最後買進倒數＋代領攻略地圖 核心邏輯
 */

import { dbQueryAll } from '@stock/database'
import { taipeiTodayStr } from './twse-calendar'

export type GiftEligibility =
  | 'ONE_SHARE'      // 一股即可領（全體股東）
  | 'VOTE_REQUIRED'  // 須電子投票後始得領取
  | 'MEETING_ONLY'   // 限親自出席
  | 'NO_GIFT'        // 不發放紀念品
  | 'UNKNOWN'        // 待公司公告

export type CountdownTag =
  | 'TODAY'     // 今日最後買進
  | 'T_3'       // 3 天內截止
  | 'T_7'       // 7 天內截止
  | 'UPCOMING'  // 尚未截止（7天以上）
  | 'EXPIRED'   // 已截止
  | 'TBD'       // 日期未定

export interface GiftCalendarItem {
  id: string
  stockId: string
  stockName: string
  giftName: string
  meetingDate: string | null
  lastBuyDate: string | null
  lastBuyDateFull: string | null
  daysLeft: number | null
  countdownTag: CountdownTag
  countdownLabel: string
  eligibility: GiftEligibility
  eligibilityLabel: string
  eligibilityColor: 'green' | 'amber' | 'blue' | 'gray' | 'purple'
  distributionMethod: string | null
  distributionLocation: string | null
  mopsGiftText: string | null
  mopsSourceUrl: string | null
  isPopular: boolean
}

export interface GiftCalendarSummary {
  todayCount: number
  t3Count: number
  t7Count: number
  oneShareCount: number
  totalCount: number
  dataYear: number
}

/** 熱門知名股東會紀念品常客 */
const POPULAR_STOCKS = new Set([
  '1432', // 大魯閣
  '2002', // 中鋼
  '2303', // 聯電
  '2887', // 台新新光金
  '2884', // 玉山金
  '2885', // 元大金
  '2727', // 王品
  '2609', // 陽明
  '2603', // 長榮
  '2330', // 台積電
  '3034', // 聯詠
  '2340', // 台亞
])

/**
 * 判定標的是否為 ETF、債券 ETF、REITs、ETN 或各類基金等非普通股標的。
 * 法令與金融實務上，ETF 僅有受益人會議，絕不會發放股東會紀念品，應統一自紀念品地圖與日曆中剔除。
 */
export function isEtfOrFund(stockId: string, stockName?: string | null): boolean {
  const id = (stockId ?? '').trim().toUpperCase()
  const name = (stockName ?? '').trim().toUpperCase()
  // 台股 00 開頭為 ETF、01 開頭為 REITs / 受益證券、02 開頭為 ETN
  if (/^0[0-2]/.test(id)) return true
  if (
    name.includes('ETF') ||
    name.includes('債券') ||
    name.includes('指數') ||
    name.includes('反1') ||
    name.includes('正2') ||
    name.includes('證券投資信託基金') ||
    name.includes('受益憑證') ||
    name.includes('收益分配')
  ) {
    return true
  }
  return false
}

/**
 * 依 claim_rule、mops_gift_text 與 gift_name 綜合判斷零股領取資格
 */
export function classifyGiftEligibility(
  claimRule?: string | null,
  mopsText?: string | null,
  giftName?: string | null,
): { eligibility: GiftEligibility; label: string; color: GiftCalendarItem['eligibilityColor'] } {
  const combined = `${claimRule ?? ''} ${mopsText ?? ''} ${giftName ?? ''}`.trim()

  // 明確不發放（優先權高於待公告，避免公告內文已寫明未編製卻被品名待公告覆蓋）
  if (
    combined.includes('不發放') ||
    combined.includes('不編製') ||
    combined.includes('未編製') ||
    combined.includes('本公司未發放') ||
    giftName === '無' ||
    giftName === '-' ||
    giftName === '不發放紀念品'
  ) {
    return { eligibility: 'NO_GIFT', label: '不發放紀念品', color: 'gray' }
  }

  if (!combined || giftName === '待公告' || combined === '待公告') {
    return { eligibility: 'UNKNOWN', label: '待公司公告', color: 'blue' }
  }

  // 須電子投票
  if (
    combined.includes('電子方式') ||
    combined.includes('電子投票') ||
    combined.includes('表決權者得領取') ||
    combined.includes('行使表決權')
  ) {
    return { eligibility: 'VOTE_REQUIRED', label: '須電子投票', color: 'amber' }
  }

  // 限親自出席
  if (
    (combined.includes('親自出席') || combined.includes('限親領')) &&
    !combined.includes('電子')
  ) {
    return { eligibility: 'MEETING_ONLY', label: '限親自出席', color: 'purple' }
  }

  // 零股 / 一股可領
  if (
    combined.includes('全體股東') ||
    combined.includes('無限制') ||
    combined.includes('零股可領') ||
    combined.includes('一股可領') ||
    combined.includes('均予發放')
  ) {
    return { eligibility: 'ONE_SHARE', label: '零股可領', color: 'green' }
  }

  // 預設若有品名且未載明限制，多為電子投票或發放
  if (giftName && giftName !== '待公告' && giftName.length > 1) {
    return { eligibility: 'ONE_SHARE', label: '零股可領（預估）', color: 'green' }
  }

  return { eligibility: 'UNKNOWN', label: '待公司公告', color: 'blue' }
}

/**
 * 將 MM/DD 格式的日期字串補齊為指定年度的 YYYY-MM-DD
 */
export function normalizeDateToYear(dateStr: string | null | undefined, year: number): string | null {
  if (!dateStr || dateStr === '等待' || dateStr === '待公告') return null

  // 已是完整 ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) return dateStr.replace(/\//g, '-')

  // MM/DD 或 MM-DD
  const m = dateStr.match(/^(\d{1,2})[/-](\d{1,2})$/)
  if (m) {
    const month = m[1]!.padStart(2, '0')
    const day = m[2]!.padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  return null
}

/**
 * 計算相對於基準日（今日）的倒數天數與分類標籤
 */
export function computeCountdown(
  targetDateIso: string | null,
  todayIso: string,
): { daysLeft: number | null; tag: CountdownTag; label: string } {
  if (!targetDateIso) {
    return { daysLeft: null, tag: 'TBD', label: '日期待公告' }
  }

  const targetTs = Date.parse(`${targetDateIso}T12:00:00+08:00`)
  const todayTs = Date.parse(`${todayIso}T12:00:00+08:00`)
  if (Number.isNaN(targetTs) || Number.isNaN(todayTs)) {
    return { daysLeft: null, tag: 'TBD', label: '日期待公告' }
  }

  const diffDays = Math.round((targetTs - todayTs) / 86400000)

  if (diffDays < 0) {
    return { daysLeft: diffDays, tag: 'EXPIRED', label: `已截止（${Math.abs(diffDays)}天前）` }
  }
  if (diffDays === 0) {
    return { daysLeft: 0, tag: 'TODAY', label: '🔥 今日最後買進！' }
  }
  if (diffDays <= 3) {
    return { daysLeft: diffDays, tag: 'T_3', label: `⚠️ 剩餘 ${diffDays} 天` }
  }
  if (diffDays <= 7) {
    return { daysLeft: diffDays, tag: 'T_7', label: `倒數 ${diffDays} 天` }
  }

  return { daysLeft: diffDays, tag: 'UPCOMING', label: `剩餘 ${diffDays} 天` }
}

export interface GetGiftCalendarOptions {
  view?: 'active' | 'review'
  q?: string
  eligibility?: GiftEligibility | 'ALL'
  limit?: number
}

/**
 * 查詢股東會紀念品倒數與攻略清單
 */
export async function getGiftCalendarData(options: GetGiftCalendarOptions = {}): Promise<{
  summary: GiftCalendarSummary
  items: GiftCalendarItem[]
}> {
  const { view = 'active', q, eligibility, limit = 100 } = options
  const today = taipeiTodayStr()
  const currentYear = Number(today.slice(0, 4)) // 2026
  const targetYear = view === 'active' ? currentYear + 1 : currentYear // active 瞄準 2027，review 看 2026

  let rawRows: any[] = []
  try {
    rawRows = await dbQueryAll(`
      SELECT stock_id, stock_name, meeting_date, last_buy_date, gift_name,
             distribution_method, distribution_location, source_url,
             gift_status, claim_rule, claim_rule_source, mops_gift_text,
             validation_status, twse_meeting_date
      FROM shareholder_gifts
      WHERE stock_id NOT LIKE '00%'
        AND stock_id NOT LIKE '01%'
        AND stock_id NOT LIKE '02%'
        AND (stock_name IS NULL OR stock_name NOT LIKE '%ETF%')
      ORDER BY 
        CASE WHEN gift_name IS NOT NULL AND gift_name != '待公告' AND gift_name != '無' AND gift_name != '-' THEN 0 ELSE 1 END,
        last_buy_date ASC
      LIMIT 1200
    `)
  } catch (e) {
    console.warn('[GiftMap] Failed to query shareholder_gifts:', e)
  }

  const items: GiftCalendarItem[] = []
  let todayCount = 0
  let t3Count = 0
  let t7Count = 0
  let oneShareCount = 0

  for (const r of rawRows) {
    const stockId = String(r.stock_id ?? '').trim()
    const stockName = String(r.stock_name ?? '').trim()
    const giftName = String(r.gift_name ?? '').trim()
    if (!stockId || isEtfOrFund(stockId, stockName)) continue

    const { eligibility: el, label: elLabel, color: elColor } = classifyGiftEligibility(
      r.claim_rule,
      r.mops_gift_text,
      giftName,
    )

    if (el === 'ONE_SHARE' || el === 'VOTE_REQUIRED') {
      oneShareCount++
    }

    // 篩選：資格篩選
    if (eligibility && eligibility !== 'ALL' && el !== eligibility) {
      continue
    }

    // 篩選：關鍵字
    if (q) {
      const kw = q.trim().toLowerCase()
      const match =
        stockId.toLowerCase().includes(kw) ||
        stockName.toLowerCase().includes(kw) ||
        giftName.toLowerCase().includes(kw)
      if (!match) continue
    }

    const meetingDateFull = normalizeDateToYear(r.meeting_date ?? r.twse_meeting_date, targetYear)
    const lastBuyDateFull = normalizeDateToYear(r.last_buy_date, targetYear)
    const { daysLeft, tag, label } = computeCountdown(lastBuyDateFull, today)

    if (tag === 'TODAY') todayCount++
    if (tag === 'T_3') t3Count++
    if (tag === 'T_7') t7Count++

    items.push({
      id: `${stockId}-${r.meeting_date ?? 'nodate'}`,
      stockId,
      stockName,
      giftName: giftName || '待公告',
      meetingDate: r.meeting_date ?? null,
      lastBuyDate: r.last_buy_date ?? null,
      lastBuyDateFull,
      daysLeft,
      countdownTag: tag,
      countdownLabel: label,
      eligibility: el,
      eligibilityLabel: elLabel,
      eligibilityColor: elColor,
      distributionMethod: r.distribution_method ?? null,
      distributionLocation: r.distribution_location ?? null,
      mopsGiftText: r.mops_gift_text ?? null,
      mopsSourceUrl: r.source_url ?? null,
      isPopular: POPULAR_STOCKS.has(stockId),
    })
  }

  // 排序：熱門或近期最後買進在前
  items.sort((a, b) => {
    // 若為 review 模式，熱門優先
    if (view === 'review') {
      if (a.isPopular && !b.isPopular) return -1
      if (!a.isPopular && b.isPopular) return 1
    }
    // 有倒數天數者排前面
    if (a.daysLeft != null && b.daysLeft != null) {
      if (a.daysLeft >= 0 && b.daysLeft < 0) return -1
      if (a.daysLeft < 0 && b.daysLeft >= 0) return 1
      return a.daysLeft - b.daysLeft
    }
    if (a.daysLeft != null) return -1
    if (b.daysLeft != null) return 1
    return a.stockId.localeCompare(b.stockId)
  })

  const limitedItems = items.slice(0, limit)

  return {
    summary: {
      todayCount,
      t3Count,
      t7Count,
      oneShareCount,
      totalCount: items.length,
      dataYear: targetYear,
    },
    items: limitedItems,
  }
}

