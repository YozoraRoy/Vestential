/**
 * Issue #71：籌碼雷達 email-only 通知（沿 `sendMarketFocusAlert` 模式，不新增渠道）。
 *
 * - 抓取失敗／降級：走既有 `lib/email.ts sendMarketFocusAlert` 信件管線告警，
 *   diff 不含 Telegram／LINE 等新渠道程式碼；
 * - 異常榜 digest：走 `lib/email.ts sendChipRadarDigest`（NOTIFY_TO＋既有
 *   market_focus_subscribers active 名單，不建新訂閱表）；
 * - 程序內 30 分鐘同 key 去重（沿 `lib/server-alert.ts` 去重語義），
 *   讀時順帶觸發不洗版；寄信失敗只 log，不 throw、不擋主流程；
 * - 呼叫端：`app/api/chip-radar/route.ts` 讀時順帶（best-effort），
 *   不新增 cron（沿 market-focus 排程順帶或讀時順帶語義）。
 */

import { sendMarketFocusAlert, sendChipRadarDigest, type ChipDigestItem } from './email'

const DEDUP_MS = 30 * 60 * 1000
const lastSentAt = new Map<string, number>()

function shouldSend(key: string): boolean {
  const now = Date.now()
  const last = lastSentAt.get(key) ?? 0
  if (now - last < DEDUP_MS) return false
  lastSentAt.set(key, now)
  return true
}

/** 法人抓取失敗／快取降級時告警（30 分鐘去重）。 */
export async function alertChipFetchFailed(reason: string): Promise<void> {
  try {
    if (!shouldSend('chip-radar:fetch-failed')) return
    await sendMarketFocusAlert('籌碼雷達抓取降級', `TWT38U/TWT44U 籌碼抓取降級顯示（${reason}）；頁面已標註資料時間，請檢查同步排程。`)
  } catch (e) {
    console.error('[ChipAlert] fetch-failed alert failed (non-blocking):', e)
  }
}

/** 當日異常榜 digest（有榜才寄；程序內 30 分鐘去重＋日別去重由 sendChipRadarDigest 把關）。 */
export async function alertChipDigest(asOf: string, items: ChipDigestItem[], scanned: number): Promise<void> {
  try {
    const list = (items ?? []).filter((i) => i?.symbol)
    if (!asOf || list.length === 0) return
    if (!shouldSend(`chip-radar:digest:${asOf}`)) return
    await sendChipRadarDigest(asOf, list, scanned)
  } catch (e) {
    console.error('[ChipAlert] digest alert failed (non-blocking):', e)
  }
}
