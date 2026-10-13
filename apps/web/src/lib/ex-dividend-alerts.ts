/**
 * Issue #67：除權息 email-only 通知（沿 `sendMarketFocusAlert` 模式，不新增渠道）。
 *
 * - 三種信：預告抓取失敗／最後買進日倒數（T-1）／填息完成；
 *   一律走 `lib/email.ts sendMarketFocusAlert` 信件管線，
 *   diff 不含 Telegram／LINE 等新渠道程式碼；
 * - 程序內 30 分鐘同 key 去重（沿 `lib/server-alert.ts` 去重語義），
 *   讀時順帶觸發不洗版；寄信失敗只 log，不 throw、不擋主流程；
 * - 呼叫端：`app/api/ex-dividend/route.ts` 讀時順帶（best-effort），
 *   不新增 cron（排程順帶更新語義沿既有同步鈕／16:00 排程）。
 */

import { sendMarketFocusAlert } from './email'

const DEDUP_MS = 30 * 60 * 1000
const lastSentAt = new Map<string, number>()

function shouldSend(key: string): boolean {
  const now = Date.now()
  const last = lastSentAt.get(key) ?? 0
  if (now - last < DEDUP_MS) return false
  lastSentAt.set(key, now)
  return true
}

export interface ExLastBuyCountdownItem {
  symbol: string
  ex_date: string
  ex_last_buy_date: string
}

export interface FillCompletedItem {
  symbol: string
  ex_date: string
  daysToFill: number
}

/** TWT48U 預告抓取失敗／快取過期降級時告警（30 分鐘去重）。 */
export async function alertExDividendFetchFailed(reason: string): Promise<void> {
  try {
    if (!shouldSend('ex-dividend:fetch-failed')) return
    await sendMarketFocusAlert('除權息預告抓取失敗', `TWT48U 除權息預告降級顯示（${reason}）；頁面已標註資料時間，請檢查同步排程。`)
  } catch (e) {
    console.error('[ExDividendAlert] fetch-failed alert failed (non-blocking):', e)
  }
}

/** 最後買進日倒數 T-1 提醒（有當日最後買進日標的才寄；30 分鐘去重）。 */
export async function alertExLastBuyCountdown(items: ExLastBuyCountdownItem[]): Promise<void> {
  try {
    const list = (items ?? []).filter((i) => i?.symbol && i?.ex_last_buy_date)
    if (list.length === 0) return
    if (!shouldSend('ex-dividend:last-buy-countdown')) return
    const lines = list.slice(0, 20).map((i) => `- ${i.symbol}：除息日 ${i.ex_date}，最後買進日 ${i.ex_last_buy_date}（今日）`)
    const more = list.length > 20 ? `\n…等共 ${list.length} 檔` : ''
    await sendMarketFocusAlert('除權息最後買進日提醒', `以下標的今日為除息最後買進日（ex_last_buy_date）：\n${lines.join('\n')}${more}`)
  } catch (e) {
    console.error('[ExDividendAlert] countdown alert failed (non-blocking):', e)
  }
}

/** 填息完成通知（近期除息且收盤重返除息前收盤；30 分鐘去重）。 */
export async function alertFillCompleted(items: FillCompletedItem[]): Promise<void> {
  try {
    const list = (items ?? []).filter((i) => i?.symbol && i?.ex_date)
    if (list.length === 0) return
    if (!shouldSend('ex-dividend:fill-completed')) return
    const lines = list.slice(0, 20).map((i) => `- ${i.symbol}：${i.ex_date} 除息，已於 ${i.daysToFill} 個交易日內填息`)
    const more = list.length > 20 ? `\n…等共 ${list.length} 檔` : ''
    await sendMarketFocusAlert('除權息填息完成', `以下標的已完成填息（收盤重返除息前收盤）：\n${lines.join('\n')}${more}`)
  } catch (e) {
    console.error('[ExDividendAlert] fill-completed alert failed (non-blocking):', e)
  }
}
