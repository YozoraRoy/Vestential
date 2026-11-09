/**
 * Issue #67：除權息 email-only 通知（沿 `sendMarketFocusAlert` 模式，不新增渠道）。
 *
 * - 三種信：預告抓取失敗／最後買進日倒數（T-1）／填息完成；
 *   一律走 `lib/email.ts sendMarketFocusAlert` 信件管線，
 *   diff 不含 Telegram／LINE 等新渠道程式碼；
 * - 讀時順帶觸發不洗版；寄信失敗只 log，不 throw、不擋主流程；
 * - 去重：預告失敗沿用 30 分鐘同 key（沿 `lib/server-alert.ts` 語義）；
 *   最後買進日／填息完成改為「類型＋台北日期」，每日最多一封
 *   （2026-11-05 事故：原 30 分鐘去重＋無時間窗，導致 00:20 半夜寄信）；
 * - 呼叫端：`app/api/ex-dividend/route.ts` 讀時順帶（best-effort），
 *   不新增 cron（排程順帶更新語義沿既有同步鈕／16:00 排程）。
 */

import { sendMarketFocusAlert } from './email'
import { escapeHtml } from './html-escape'

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
  name?: string | null
  ex_date: string
  ex_last_buy_date: string
}

export interface FillCompletedItem {
  symbol: string
  name?: string | null
  ex_date: string
  daysToFill: number
}

/** 信件顯示用標籤：有中文名稱時顯示「代號 名稱」，否則只有代號。 */
export function stockDisplayLabel(symbol: string, name?: string | null): string {
  const trimmed = (name ?? '').trim()
  return trimmed ? `${symbol} ${trimmed}` : symbol
}

function listHtml(rows: string[], total: number): string {
  const more = total > 20 ? `<div style="color:#6b7280;margin-top:4px;">…等共 ${total} 檔</div>` : ''
  return `${rows.join('')}${more}`
}

/** 服務通知 HTML：最後買進日提醒（股票代號＋名稱粗體）。 */
export function buildExLastBuyCountdownHtml(items: ExLastBuyCountdownItem[]): string {
  const list = (items ?? []).filter((i) => i?.symbol && i?.ex_last_buy_date)
  const rows = list
    .slice(0, 20)
    .map(
      (i) =>
        `<div>• <b>${escapeHtml(stockDisplayLabel(i.symbol, i.name))}</b>：除息日 ${escapeHtml(i.ex_date)}，最後買進日 ${escapeHtml(i.ex_last_buy_date)}（今日）</div>`,
    )
  return `<div>以下標的今日為除息最後買進日（ex_last_buy_date）：</div>${listHtml(rows, list.length)}`
}

/** 服務通知 HTML：填息完成（股票代號＋名稱粗體）。 */
export function buildFillCompletedHtml(items: FillCompletedItem[]): string {
  const list = (items ?? []).filter((i) => i?.symbol && i?.ex_date)
  const rows = list
    .slice(0, 20)
    .map(
      (i) =>
        `<div>• <b>${escapeHtml(stockDisplayLabel(i.symbol, i.name))}</b>：${escapeHtml(i.ex_date)} 除息，已於 ${i.daysToFill} 個交易日內填息</div>`,
    )
  return `<div>以下標的已完成填息（收盤重返除息前收盤）：</div>${listHtml(rows, list.length)}`
}

/**
 * 檢查當前台灣時間是否在告警時間窗內（08:30 ~ 23:59）。
 * 凌晨至清晨非交易時段（00:00 ~ 08:29）暫緩告警，避免排程同步時間差造成半夜誤報打擾。
 */
export function isExDividendAlertWindow(now: Date = new Date()): boolean {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const timeStr = formatter.format(now) // "HH:mm"
  return timeStr >= '08:30'
}

/** 台灣日期鍵（YYYY-MM-DD），用來把「每日一封」的去重做成跨程序重啟也穩定。 */
export function taiwanDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now)
}

/** TWT48U 預告抓取失敗／快取過期降級時告警（30 分鐘去重，且僅在 08:30 後發送）。 */
export async function alertExDividendFetchFailed(reason: string, now: Date = new Date()): Promise<void> {
  try {
    if (!isExDividendAlertWindow(now)) return
    if (!shouldSend('ex-dividend:fetch-failed')) return
    await sendMarketFocusAlert('除權息預告抓取失敗', `TWT48U 除權息預告降級顯示（${reason}）；頁面已標註資料時間，請檢查同步排程。`)
  } catch (e) {
    console.error('[ExDividendAlert] fetch-failed alert failed (non-blocking):', e)
  }
}

/**
 * 最後買進日倒數 T-1 提醒（有當日最後買進日標的才寄；08:30 後、每日一封）。
 *
 * 2026-11-05：先前只在「讀取 API」時觸發且無時間窗，實測 00:20 被爬蟲／訪客讀到
 * 就寄出半夜信；現比照預告失敗告警套 `isExDividendAlertWindow`，並把去重鍵改成
 * 「日期＋類型」，確保每天最多一封、且不會在盤前 08:30 前打擾。
 */
export async function alertExLastBuyCountdown(items: ExLastBuyCountdownItem[], now: Date = new Date()): Promise<void> {
  try {
    if (!isExDividendAlertWindow(now)) return
    const list = (items ?? []).filter((i) => i?.symbol && i?.ex_last_buy_date)
    if (list.length === 0) return
    if (!shouldSend(`ex-dividend:last-buy-countdown:${taiwanDateKey(now)}`)) return
    const lines = list
      .slice(0, 20)
      .map((i) => `- ${stockDisplayLabel(i.symbol, i.name)}：除息日 ${i.ex_date}，最後買進日 ${i.ex_last_buy_date}（今日）`)
    const more = list.length > 20 ? `\n…等共 ${list.length} 檔` : ''
    await sendMarketFocusAlert(
      '除權息最後買進日提醒',
      `以下標的今日為除息最後買進日（ex_last_buy_date）：\n${lines.join('\n')}${more}`,
      { variant: 'notice', htmlDetail: buildExLastBuyCountdownHtml(list) },
    )
  } catch (e) {
    console.error('[ExDividendAlert] countdown alert failed (non-blocking):', e)
  }
}

/** 填息完成通知（近期除息且收盤重返除息前收盤；08:30 後、每日一封）。 */
export async function alertFillCompleted(items: FillCompletedItem[], now: Date = new Date()): Promise<void> {
  try {
    if (!isExDividendAlertWindow(now)) return
    const list = (items ?? []).filter((i) => i?.symbol && i?.ex_date)
    if (list.length === 0) return
    if (!shouldSend(`ex-dividend:fill-completed:${taiwanDateKey(now)}`)) return
    const lines = list
      .slice(0, 20)
      .map((i) => `- ${stockDisplayLabel(i.symbol, i.name)}：${i.ex_date} 除息，已於 ${i.daysToFill} 個交易日內填息`)
    const more = list.length > 20 ? `\n…等共 ${list.length} 檔` : ''
    await sendMarketFocusAlert(
      '除權息填息完成',
      `以下標的已完成填息（收盤重返除息前收盤）：\n${lines.join('\n')}${more}`,
      { variant: 'notice', htmlDetail: buildFillCompletedHtml(list) },
    )
  } catch (e) {
    console.error('[ExDividendAlert] fill-completed alert failed (non-blocking):', e)
  }
}
