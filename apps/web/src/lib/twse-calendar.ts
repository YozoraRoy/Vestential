/**
 * 台股交易日判斷（單一正源＋週末判斷）。
 *
 * 休市日正源：`@/utils/taiwan-calendar` 的 `TAIWAN_MARKET_HOLIDAYS`
 *（臺灣證券交易所「交易日及例假日」年度休市表快照，詳見該檔註解）。
 * 本檔不再維護獨立的日期字面量——`TWSE_HOLIDAYS` 僅為正源的唯讀別名，
 * 避免雙源分叉（Issue #70：曾缺 2026-09-28、2026-10-26、2026-12-25）。
 * 假日異動請只改正源一處；函式本身為純函式、可單測。
 *
 * 驗證方式：
 * - 週末：`isTwseTradingDay('2026-09-19') === false`（週六）、
 *   `isTwseTradingDay('2026-09-18') === true`（週五，非假日）。
 * - 國定假日：`isTwseTradingDay('2026-01-01') === false`（元旦），
 *   對照 TWSE 上述頁面年度表即可驗證。
 */

import { TAIWAN_MARKET_HOLIDAYS } from '@/utils/taiwan-calendar'

/** TWSE 公告休市的平日（YYYY-MM-DD；正源別名，週末休市由星期判斷，不列於此）。 */
const TWSE_HOLIDAYS: ReadonlySet<string> = TAIWAN_MARKET_HOLIDAYS

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 週末或 TWSE 公告休市日 → 非交易日。非 YYYY-MM-DD 格式視為非交易日（保守）。 */
export function isTwseTradingDay(dateStr: string): boolean {
  if (!DATE_RE.test(dateStr)) return false
  const d = new Date(`${dateStr}T12:00:00+08:00`)
  if (Number.isNaN(d.getTime())) return false
  const dow = d.getDay()
  if (dow === 0 || dow === 6) return false
  return !TWSE_HOLIDAYS.has(dateStr)
}

/** 台北時區今日（YYYY-MM-DD）。 */
export function taipeiTodayStr(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now)
}

export type RoundFreshness =
  | { kind: 'latest' }
  | { kind: 'stale'; roundDate: string }
  | { kind: 'closed'; roundDate: string }

/**
 * 輪次新鮮度：選中輪次即今日最新 → latest；
 * 今日為非交易日 → closed（休市無新盤，截至 roundDate）；
 * 否則（交易日但選中舊篇）→ stale（舊篇截至 roundDate）。
 */
export function roundFreshness(roundDate: string, todayStr: string): RoundFreshness {
  if (roundDate >= todayStr) return { kind: 'latest' }
  if (!isTwseTradingDay(todayStr)) return { kind: 'closed', roundDate }
  return { kind: 'stale', roundDate }
}
