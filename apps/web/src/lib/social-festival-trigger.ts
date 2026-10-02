import { saveSocialCardImage, logMarketFocusEvent } from '@stock/database'
import type { SocialPostPlatform } from '@stock/database'
import { sendMarketFocusAlert } from '@/lib/email'
import { buildFestivalPartialFailMessage } from '@/lib/social-alert'
import { getTaiwanDateStr } from '@/lib/auth'
import { getTodayFestival, type FestivalId } from '@/lib/festival-calendar'
import { generateFestivalCaptions, type SocialCaptions } from '@/lib/social-festival'
import { renderSocialCard } from '@/lib/social-canvas'
import { generateFestivalArtworkImage } from '@/lib/social-ai-image'
import { publishSocialPost, alreadyPosted } from '@/lib/social-publish'

// ─── 節慶發布協調層（中秋 MVP）────────────────────────────────────
// 複用 social-publish.ts alreadyPosted / publishSocialPost 去重＋發布。
// 去重 edition_key = festival:mid-autumn:YYYY-MM-DD（三平台各一筆＋social_card_images）。

const SITE_BASE = process.env.AUTH_BASE_URL ?? 'https://vestential.com'

const FESTIVAL_PLATFORMS: SocialPostPlatform[] = ['instagram', 'threads', 'facebook']

export interface FestivalPublishOutcome {
  triggered: boolean
  skipped?: boolean
  festival?: FestivalId | null
  editionKey?: string | null
  dryRun?: boolean
  message?: string
  results?: { platform: SocialPostPlatform; status: string; error?: string | null }[]
  /** 僅 dryRun：賀圖 data URL 預覽。 */
  card?: string
  captions?: SocialCaptions
  error?: string
}

export function buildFestivalEditionKey(dateStr: string, festival: FestivalId = 'mid-autumn'): string {
  return `festival:${festival}:${dateStr}`
}

export function buildFestivalCardImageUrl(editionKey: string): string {
  return `${SITE_BASE}/api/social/card-image?edition=${encodeURIComponent(editionKey)}&style=festival`
}

/**
 * 節慶排程觸發：非節日一律 skip（不發文、不寫 DB、不打外部 API）。
 * @param dryRun 只生成三平台文案＋賀圖預覽，不寫 social_posts、不打外部 API。
 * @param force 忽略去重強制重發（dryRun 不受影響）。
 * @param dateOverride 覆寫判定日期（Asia/Taipei YYYY-MM-DD；測試／手動補發用）。
 */
export async function triggerFestivalPublish(
  options: { dryRun?: boolean; force?: boolean; dateOverride?: string } = {},
): Promise<FestivalPublishOutcome> {
  const dryRun = options.dryRun ?? false
  const force = options.force ?? false
  const todayStr = options.dateOverride ?? getTaiwanDateStr()
  const festival = getTodayFestival(todayStr)
  if (!festival) {
    return { triggered: false, skipped: true, festival: null, message: `非節慶日（${todayStr}），skip` }
  }

  const editionKey = buildFestivalEditionKey(todayStr, festival.id)

  // ── 乾跑：只生成文案＋賀圖預覽，不讀去重、不寫 DB、不打 Meta API ──
  if (dryRun) {
    const [captions, art] = await Promise.all([
      generateFestivalCaptions(festival.id, todayStr),
      generateFestivalArtworkImage(festival.id).catch(() => null),
    ])
    // FLUX 失敗兜底：backgroundImage=null → canvas 金綠漸層仍可產圖
    const buf = await renderSocialCard(
      { meta: { summary: null, generated_at: todayStr }, items: [] },
      { style: 'festival', backgroundImage: art },
    )
    return {
      triggered: true,
      festival: festival.id,
      editionKey,
      dryRun: true,
      card: `data:image/jpeg;base64,${buf.toString('base64')}`,
      captions,
    }
  }

  // ── 發布：去重（force 時由 publishSocialPost 內部清除重發） ──
  const unresolved = force
    ? FESTIVAL_PLATFORMS.map((p) => ({ platform: p, posted: false }))
    : (
        await Promise.all(FESTIVAL_PLATFORMS.map(async (p) => ({ platform: p, posted: await alreadyPosted(p, editionKey) })))
      ).filter((x) => !x.posted)

  if (unresolved.length === 0) {
    return { triggered: false, skipped: true, festival: festival.id, editionKey, message: 'edition 已發布，skip' }
  }

  const captions = await generateFestivalCaptions(festival.id, todayStr)

  // 賀圖：FLUX 失敗回 null → canvas 金綠漸層兜底，仍可發出
  const art = await generateFestivalArtworkImage(festival.id).catch(() => null)
  const buf = await renderSocialCard(
    { meta: { summary: null, generated_at: todayStr }, items: [] },
    { style: 'festival', backgroundImage: art },
  )
  await saveSocialCardImage(editionKey, 'festival', buf).catch((e) => {
    console.warn('[SocialFestival] 快取節慶圖卡失敗:', e)
  })
  const imageUrl = buildFestivalCardImageUrl(editionKey)

  const results: NonNullable<FestivalPublishOutcome['results']> = []
  for (const { platform } of unresolved) {
    const content = platform === 'instagram' ? captions.instagram : platform === 'facebook' ? captions.facebook : captions.threads
    const res = await publishSocialPost(platform, editionKey, content, imageUrl, false, force)
    results.push({ platform, status: res.status, error: res.error })
  }

  const failed = results.filter((r) => r.status === 'failed')
  if (failed.length > 0) {
    // Issue #57：節慶版告警內文同改（含節慶名＋日期／成功／失敗＋錯誤原文／重試／edition）。
    // 事件紀錄沿用既有 logMarketFocusEvent；另經既有 sendMarketFocusAlert 信件管線通知（不新增渠道）。
    const alertBody = buildFestivalPartialFailMessage(festival.id, todayStr, editionKey, results)
    await logMarketFocusEvent({
      source: 'festival',
      level: 'warn',
      code: 'FESTIVAL_PUBLISH_PARTIAL_FAIL',
      editionKey,
      message: alertBody,
    }).catch(() => null)
    await sendMarketFocusAlert('節慶發布部分失敗', alertBody).catch(() => null)
  }

  return { triggered: true, festival: festival.id, editionKey, dryRun: false, results }
}
