// ─── 社群發布異常告警訊息組裝（Issue #57 純函式）─────────────────────
// 三處呼叫點共用：日常版（social-trigger.ts）、節慶版
// （social-festival-trigger.ts）、首回覆 best-effort 失敗版（social-trigger.ts
// postFirstReplyBestEffort）。只組字串，不碰發布／重試／去重邏輯。
//
// LINE 截斷規則（寫明以供驗收）：
// - LINE Messaging API push 單則文字上限為 5000 字元；本告警管線目前走信件
//   （sendMarketFocusAlert，無硬上限），但訊息體共用、未來可直送 LINE，故統一
//   設 SOCIAL_ALERT_LINE_MAX_CHARS = 5000 為全文上限。
// - 截斷策略：優先保留「內容名／成功平台／重試方式／edition key」等頭尾欄位，
//   只捨「失敗平台＋錯誤原文」尾段。分兩層處理：(1) 單則錯誤先截至
//   SOCIAL_ALERT_MAX_ERROR_CHARS（1000 字，沿用 social-publish.ts slice(0, 1000)
//   慣例）——三平台全失敗約 3000 字＋表頭，實務上即不超 LINE 上限；(2) 全文仍
//   超限則尾部截斷並附「…（訊息過長已截斷，全文共 N 字）」標記（防禦層，
//   因應未來平台增加或表頭變長）。字數一律以 Array.from 計
//   （code point，避免 emoji 被切半）。
// - 重試路徑（真實存在）：admin 後台頁 /admin/social（「強制重發選定平台」鈕，
//   見 SocialClient.tsx）→ POST /api/admin/social/publish（body { force: true }，
//   見 app/api/admin/social/publish/route.ts）。

export const SOCIAL_ALERT_LINE_MAX_CHARS = 5000

/** 單則平台錯誤原文上限（沿用 social-publish.ts slice(0, 1000) 慣例）。 */
export const SOCIAL_ALERT_MAX_ERROR_CHARS = 1000

export type SocialAlertPlatform = 'instagram' | 'threads' | 'facebook'

export interface SocialAlertFailure {
  platform: SocialAlertPlatform
  error?: string | null
}

/** 重試方式（一句，路徑真實存在，見檔頭註解）。 */
export const SOCIAL_ALERT_RETRY_HINT =
  '至 admin 後台 /admin/social 按「強制重發選定平台」（POST /api/admin/social/publish，force:true）重發失敗平台'

const PLATFORM_LABELS: Record<SocialAlertPlatform, string> = {
  instagram: 'IG',
  threads: 'Threads',
  facebook: 'FB',
}

export function socialPlatformLabel(platform: SocialAlertPlatform): string {
  return PLATFORM_LABELS[platform] ?? platform
}

const ALL_PLATFORMS: SocialAlertPlatform[] = ['instagram', 'threads', 'facebook']

/** 全文字數（code point）超過上限則尾部截斷＋附全文總字數標記。 */
export function truncateAlertText(text: string, maxChars: number = SOCIAL_ALERT_LINE_MAX_CHARS): string {
  const chars = Array.from(text)
  if (chars.length <= maxChars) return text
  const marker = `\n…（訊息過長已截斷，全文共 ${chars.length} 字）`
  return chars.slice(0, maxChars - Array.from(marker).length).join('') + marker
}

/** 單則錯誤原文截斷（保留原文，超長只截尾＋附標記）。 */
export function truncateAlertError(error: string, maxChars: number = SOCIAL_ALERT_MAX_ERROR_CHARS): string {
  const chars = Array.from(error)
  if (chars.length <= maxChars) return error
  return `${chars.slice(0, maxChars).join('')}…（錯誤過長已截斷）`
}

/** 由 editionKey 取 YYYY-MM-DD（日常版 ISO／節慶版 festival:<id>:YYYY-MM-DD 皆取得到；取不到回原文）。 */
export function alertDateOf(editionKey: string): string {
  const m = editionKey.match(/(\d{4}-\d{2}-\d{2})/)
  return m?.[1] ?? editionKey
}

export function dailyContentName(editionKey: string): string {
  return `今日市場焦點總覽 ${alertDateOf(editionKey)}`
}

const FESTIVAL_NAMES: Record<string, string> = {
  'mid-autumn': '中秋節',
}

export function festivalContentName(festivalId: string, dateStr: string): string {
  return `${FESTIVAL_NAMES[festivalId] ?? festivalId}賀文 ${dateStr}`
}

interface AlertBodyInput {
  contentName: string
  editionKey: string
  /** 本次有處理的平台（未失敗者即成功；首回覆語境可只傳 [platform]）。 */
  attempted: SocialAlertPlatform[]
  failed: SocialAlertFailure[]
  /** 首回覆語境用：主文不受影響的補充說明。 */
  note?: string
}

function buildAlertBody(input: AlertBodyInput): string {
  const failedPlatforms = new Set(input.failed.map((f) => f.platform))
  const succeeded = input.attempted.filter((p) => !failedPlatforms.has(p))
  const succeededText = succeeded.length > 0 ? succeeded.map(socialPlatformLabel).join('、') : '無（全部失敗）'
  const failedText = input.failed
    .map((f) => `- ${socialPlatformLabel(f.platform)}: ${truncateAlertError(f.error ?? 'unknown error')}`)
    .join('\n')
  const lines = [
    `內容：${input.contentName}`,
    `成功：${succeededText}`,
    '失敗：',
    failedText,
    `重試：${SOCIAL_ALERT_RETRY_HINT}`,
    `edition: ${input.editionKey}`,
  ]
  if (input.note) lines.push(`備註：${input.note}`)
  return truncateAlertText(lines.join('\n'))
}

/** 日常版：results 為 triggerSocialPublish 本輪各平台結果。 */
export function buildSocialPartialFailMessage(
  editionKey: string,
  results: { platform: SocialAlertPlatform; status: string; error?: string | null }[],
): string {
  return buildAlertBody({
    contentName: dailyContentName(editionKey),
    editionKey,
    attempted: results.map((r) => r.platform),
    failed: results.filter((r) => r.status === 'failed'),
  })
}

/** 節慶版：results 為 triggerFestivalPublish 本輪各平台結果。 */
export function buildFestivalPartialFailMessage(
  festivalId: string,
  dateStr: string,
  editionKey: string,
  results: { platform: SocialAlertPlatform; status: string; error?: string | null }[],
): string {
  return buildAlertBody({
    contentName: festivalContentName(festivalId, dateStr),
    editionKey,
    attempted: results.map((r) => r.platform),
    failed: results.filter((r) => r.status === 'failed'),
  })
}

/** 首回覆 best-effort 失敗版（單平台；主文不受影響）。 */
export function buildFirstReplyFailMessage(
  platform: SocialAlertPlatform,
  error: string,
  editionKey: string,
): string {
  return buildAlertBody({
    contentName: `${dailyContentName(editionKey)}首回覆`,
    editionKey,
    attempted: [platform],
    failed: [{ platform, error }],
    note: '首回覆為 best-effort，主文已發不受影響',
  })
}

/** 成功平台清單（供呼叫端／測試直接驗算，不經字串解析）。 */
export function succeededPlatforms(
  attempted: SocialAlertPlatform[] = ALL_PLATFORMS,
  failed: SocialAlertFailure[] = [],
): SocialAlertPlatform[] {
  const failedSet = new Set(failed.map((f) => f.platform))
  return attempted.filter((p) => !failedSet.has(p))
}
