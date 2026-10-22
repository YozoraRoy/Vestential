/**
 * 電子報寄送時段（Issue #91 後續）：排程四輪為 01:00／09:00／13:00／19:00（TW）。
 * 凌晨 01:00 那輪只刷新頁面，不寄電子報；否則「當日第一輪」會變成 01:00 寄信，
 * 09:00 那輪反而被 `email.last_sent_date` 的每日一封護欄略過。
 *
 * 08:00–13:59 涵蓋 09:00 正常寄送與 13:00 失敗補寄；14:00 之後不再寄。
 */

/** 台灣時間小時（0–23）。 */
export function getTaiwanHour(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  return Number.isFinite(hour) ? hour % 24 : 0
}

/** 是否落在電子報寄送時段（TW 08:00–13:59）。 */
export function isNewsletterSendWindow(hourTw: number): boolean {
  return hourTw >= 8 && hourTw < 14
}
