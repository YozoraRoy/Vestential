/**
 * 台灣證券交易所 (TWSE) 國定假日與休市日處理工具
 */

// 台灣股市國定休市日與封關日清單 (格式：YYYY-MM-DD)
// 包含 2024~2026 常見國定假日、農曆春節封關與補假休市日
export const TAIWAN_MARKET_HOLIDAYS = new Set<string>([
  // 2024
  '2024-01-01', // 開國紀念日
  '2024-02-06', '2024-02-07', '2024-02-08', '2024-02-09', '2024-02-12', '2024-02-13', '2024-02-14', // 春節休市
  '2024-02-28', // 和平紀念日
  '2024-04-04', '2024-04-05', // 兒童節/清明節
  '2024-05-01', // 勞動節
  '2024-06-10', // 端午節
  '2024-09-17', // 中秋節
  '2024-10-10', // 國慶日

  // 2025
  '2025-01-01', // 元旦
  '2025-01-24', '2025-01-27', '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-03', // 春節休市
  '2025-02-28', // 和平紀念日
  '2025-04-03', '2025-04-04', // 兒童節/清明節
  '2025-05-01', // 勞動節
  '2025-05-30', // 端午節
  '2025-10-06', // 中秋節
  '2025-10-10', // 國慶日

  // 2026
  '2026-01-01', // 元旦
  '2026-02-12', '2026-02-13', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', // 春節封關與假期
  '2026-02-27', // 和平紀念日補假（官方僅 02/27，無 03-02）
  '2026-04-03', '2026-04-06', // 兒童節/清明節
  '2026-05-01', // 勞動節 (股市休市)
  '2026-06-19', // 端午節
  '2026-09-25', // 中秋節
  '2026-09-28', // 孔子誕辰紀念日/教師節
  '2026-10-09', // 國慶日補假（官方 10 月僅 10/09，無 10-12）
  '2026-10-26', // 光復節補假
  '2026-12-25', // 行憲紀念日
])

const WEEKDAY_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']

/**
 * 格式化 Date 物件為 YYYY-MM-DD
 */
export function formatDateIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 判斷給定日期是否為台灣股市的開市交易日（非六日、非國定休市日）
 */
export function isTaiwanMarketTradingDay(date: Date): boolean {
  const dayOfWeek = date.getDay()
  // 週六 (6) 或 週日 (0) 不開市
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false
  }

  const isoStr = formatDateIso(date)
  // 若包含在國定休市日名單中則不開市
  if (TAIWAN_MARKET_HOLIDAYS.has(isoStr)) {
    return false
  }

  return true
}

/**
 * 取得給定日期（或今天）之前「最後一個開市開盤上班日」
 */
export function getLastMarketTradingDay(fromDate?: Date): Date {
  const current = fromDate ? new Date(fromDate) : new Date()
  
  for (let i = 0; i < 15; i++) {
    if (isTaiwanMarketTradingDay(current)) {
      return current
    }
    // 往前推一天
    current.setDate(current.getDate() - 1)
  }
  return current
}

/**
 * 格式化字串日期 (YYYYMMDD 或 YYYY-MM-DD) 為「YYYY-MM-DD (週X)」
 */
export function formatTradingDayWithWeekday(dateStr?: string | null): string {
  if (!dateStr) return '—'
  const cleaned = dateStr.replace(/-/g, '')
  if (cleaned.length !== 8) return dateStr

  const year = parseInt(cleaned.substring(0, 4), 10)
  const month = parseInt(cleaned.substring(4, 6), 10) - 1
  const day = parseInt(cleaned.substring(6, 8), 10)

  const dateObj = new Date(year, month, day)
  const weekday = WEEKDAY_NAMES[dateObj.getDay()]
  const isoStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  return `${isoStr} (${weekday})`
}

/**
 * 檢查目前日期是否為非交易日（週末或國定假日）
 */
export function isCurrentlyHolidayOrWeekend(nowDate: Date = new Date()): {
  isHoliday: boolean
  reason?: string
} {
  const dayOfWeek = nowDate.getDay()
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { isHoliday: true, reason: `一般週末 (${WEEKDAY_NAMES[dayOfWeek]}) 休市` }
  }

  const isoStr = formatDateIso(nowDate)
  if (TAIWAN_MARKET_HOLIDAYS.has(isoStr)) {
    return { isHoliday: true, reason: '國定假日 / 封關休市日' }
  }

  return { isHoliday: false }
}

/**
 * 將最後買進日帶上年份與跨年智慧判斷 (例: 06/29 -> 2026/06/29 (週一))
 * 若提供 meeting_date，優先使用股東會日期推斷正確年份
 */
export function formatLastBuyDateWithYear(lastBuyDate?: string | null, meetingDate?: string | null): {
  formattedDate: string
  yearDateStr: string
  year: number
  month: number
  day: number
  isCrossYear: boolean
} | null {
  if (!lastBuyDate || lastBuyDate === '—' || lastBuyDate === 'null') return null

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const fullMatch = lastBuyDate.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/)
  let year = currentYear
  let month = 1
  let day = 1

  if (fullMatch) {
    year = parseInt(fullMatch[1], 10)
    month = parseInt(fullMatch[2], 10)
    day = parseInt(fullMatch[3], 10)
  } else {
    const mdMatch = lastBuyDate.match(/^(\d{1,2})[/-](\d{1,2})$/)
    if (!mdMatch) return null

    month = parseInt(mdMatch[1], 10)
    day = parseInt(mdMatch[2], 10)

    // 優先使用 meeting_date 推斷年份
    if (meetingDate) {
      const meetingFull = meetingDate.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/)
      const meetingMd = meetingDate.match(/^(\d{1,2})[/-](\d{1,2})$/)

      if (meetingFull) {
        // meeting_date 已含年份，直接使用同年
        year = parseInt(meetingFull[1], 10)
      } else if (meetingMd) {
        const meetMonth = parseInt(meetingMd[1], 10)
        // 根據股東會月份推斷年份：若股東會已過（月份 < 當前月份），則為今年
        // 若股東會月份 > 當前月份 + 6 個月，可能是去年的股東會
        if (meetMonth < currentMonth) {
          year = currentYear
        } else if (meetMonth >= currentMonth + 6) {
          year = currentYear - 1
        } else {
          year = currentYear
        }
      } else {
        // meeting_date 格式不明，退回跨年邏輯
        if (currentMonth >= 11 && month <= 4) {
          year = currentYear + 1
        } else {
          year = currentYear
        }
      }
    } else {
      // 無 meeting_date 時使用跨年邏輯
      if (currentMonth >= 11 && month <= 4) {
        year = currentYear + 1
      } else {
        year = currentYear
      }
    }
  }

  const d = new Date(year, month - 1, day)
  const isCrossYear = year > currentYear
  const monthStr = String(month).padStart(2, '0')
  const dayStr = String(day).padStart(2, '0')

  const weekday = WEEKDAY_NAMES[d.getDay()]

  return {
    formattedDate: `${year}/${monthStr}/${dayStr} (${weekday})`,
    yearDateStr: `${year}-${monthStr}-${dayStr}`,
    year,
    month,
    day,
    isCrossYear,
  }
}
