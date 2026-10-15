/**
 * #24 後端錯誤告警 — server 錯誤集中記錄＋30 分鐘去重＋寄 NOTIFY_TO。
 *
 * 取捨（spec 待確認項回覆）：
 * - 去重 store 用**記憶體 Map**（key → 上次發信 epoch ms）。理由：零 DB 寫入成本、
 *   邏輯簡單、告警本就允許偶發重發；代價是**進程重啟／多實例會遺失去重狀態**
 *   （重啟後同錯會再發一封，可接受）。若日後高頻洗版，再遷移到 DB（agent_settings
 *   類 kv）做跨實例去重。
 * - key = route＋status＋訊息摘要（正規化後前 120 字）。同 key 30 分鐘只發一封。
 * - 絕不含使用者個資：呼叫端只傳 route/status/message，禁止傳 user_id／email／
 *   持倉內容；message 進信前截斷 500 字。
 * - SMTP 缺設定（SMTP_USER/PASS/NOTIFY_TO 任一缺）→ 沿用 email.ts 的 console.warn
 *   路徑，只 log，不 throw、不影響主流程。
 * - 現階段只接 3 條關鍵 route（analyze／recognize／risk/summary）驗證機制，
 *   不全站鋪開。後續鋪開計畫：抽成 `withServerAlert(route, handler)` wrapper，
 *   逐批套到 journal／market-focus／sync 等 route，另案處理。
 */

import { sendMailCore } from './email'

const DEDUP_MS = 30 * 60 * 1000
const MAX_MESSAGE_LEN = 500

const lastSentAt = new Map<string, number>()

function nowMs(): number {
  return Date.now()
}

/** 台北時間字串（告警信內文用）。 */
function formatTaipeiNow(): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date())
}

/** 訊息摘要：壓空白、去換行、截斷，作為去重 key 的一部分。 */
export function summarizeErrorMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 120)
}

export function serverErrorKey(route: string, status: number, message: string): string {
  return `${route}|${status}|${summarizeErrorMessage(message)}`
}

export interface ServerErrorReport {
  /** route 識別，如 'POST /api/portfolio/analyze'（禁止夾帶 user_id 等個資） */
  route: string
  status: number
  /** 原始錯誤訊息（函式內會截斷＋摘要化，不含個資前提交由呼叫端保證） */
  error: unknown
}

function toMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'unknown error')
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LEN) || 'unknown error'
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 記錄 server 錯誤並在去重窗口外寄告警信。永不 throw（內部全捕捉），
 * SMTP 未設定時只 console.warn。呼叫端用 `void reportServerError(...)` fire-and-forget。
 */
export async function reportServerError(report: ServerErrorReport): Promise<boolean> {
  const message = toMessage(report.error)
  const key = serverErrorKey(report.route, report.status, message)
  const now = nowMs()
  const last = lastSentAt.get(key)
  if (last !== undefined && now - last < DEDUP_MS) {
    console.warn(`[ServerAlert] deduped (${report.route} ${report.status}) within 30min, skip mail`)
    return false
  }
  lastSentAt.set(key, now)

  const ts = formatTaipeiNow()
  const env = process.env.NODE_ENV ?? 'development'
  const subject = `⚠️ Vestential 後端告警 — ${report.route} (${report.status})`
  const text = `Vestential 後端錯誤告警

時間（台北）: ${ts}
路由 : ${report.route}
狀態 : ${report.status}
錯誤摘要 : ${message}
環境 : ${env}

（此信已去重：同 route＋status＋摘要 30 分鐘內只發一封）`
  const html = `
    <div style="background:#fffbeb;padding:24px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #fde68a;border-radius:12px;overflow:hidden;">
        <div style="background:#b45309;color:#ffffff;padding:16px 24px;font-weight:800;font-size:16px;">⚠️ Vestential 後端錯誤告警</div>
        <div style="padding:20px 24px;font-size:14px;color:#374151;line-height:1.8;">
          <div><b>時間（台北）</b>: ${escapeHtml(ts)}</div>
          <div><b>路由</b>: ${escapeHtml(report.route)}</div>
          <div><b>狀態</b>: ${escapeHtml(String(report.status))}</div>
          <div><b>錯誤摘要</b>: ${escapeHtml(message)}</div>
          <div><b>環境</b>: ${escapeHtml(env)}</div>
          <div style="margin-top:14px;font-size:13px;color:#6b7280;">同 route＋status＋摘要 30 分鐘內只發一封；重啟後去重狀態會重置。</div>
        </div>
      </div>
    </div>`

  try {
    // sendMailCore 缺 SMTP 設定時回傳 false＋console.warn，不 throw。
    const ok = await sendMailCore(subject, text, html)
    if (!ok) {
      console.warn(`[ServerAlert] mail not sent (${report.route} ${report.status}), see [Notify] log above`)
    }
    return ok
  } catch (e) {
    console.error('[ServerAlert] unexpected failure (must not affect main flow):', e)
    return false
  }
}
