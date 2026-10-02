import { getMarketFocusMeta, getMarketFocus, getAgentSetting, saveSocialCardImage, getSocialCardImage } from '@stock/database'
import { sleep, getChainPaceMs } from '@stock/ai-engine'
import type { SocialPostPlatform } from '@stock/database'
import { generateSocialCaptions, generateMemeConcept, IG_DRIVE_COMMENT, type SocialCaptions } from '@/lib/social'
import { renderSocialCard, type SocialCardStyle } from '@/lib/social-canvas'
import { generateSocialBackgroundImage, generateSocialArtworkImage } from '@/lib/social-ai-image'
import { publishSocialPost, alreadyPosted, postInstagramComment } from '@/lib/social-publish'
import { publishThreadsReply } from '@/lib/threads-reply'
import {
  generateFirstReplyQuestion,
  getFirstReplyMode,
  hasFirstReplyPosted,
  recordFirstReplyFailed,
  recordFirstReplyPosted,
  type FirstReplyMode,
  type FirstReplyQuestion,
} from '@/lib/social-first-reply'
import { sendMarketFocusAlert } from '@/lib/email'
import { buildFirstReplyFailMessage, buildSocialPartialFailMessage } from '@/lib/social-alert'

// ─── 社群發布協調層 ───────────────────────────────────────────────
// 供 market-focus/refresh 尾端內嵌觸發，也可由 publish route 獨立呼叫。

const SITE_BASE = process.env.AUTH_BASE_URL ?? 'https://vestential.com'

export interface SocialPublishOutcome {
  triggered: boolean
  skipped?: boolean
  editionKey?: string | null
  dryRun?: boolean
  message?: string
  results?: { platform: SocialPostPlatform; status: string; error?: string | null; commentStatus?: string | null; firstReplyStatus?: string | null }[]
  /** 僅 dryRun 時回傳：目前 social.card_style 設定值（作為預設選卡）。 */
  cardStyle?: SocialCardStyle
  /** 僅 dryRun 時回傳：IG 一律使用 AI 吉祥物全圖卡（ai）。 */
  igCardStyle?: 'ai' | 'meme'
  /** 僅 dryRun 時回傳：classic 品牌卡 + meme 梗圖大字卡 + ai 全圖藝術卡，各一張 data URL。 */
  cards?: { classic: string; meme: string; ai: string }
  captions?: SocialCaptions
  meme?: { title: string; punchline: string } | null
  /** 僅 dryRun 時回傳：IG 發布後會自動貼上的第一則留言。 */
  igDriveComment?: string
  /**
   * Issue #31：僅 dryRun 時回傳本次首回覆問題預覽（含 @meta.ai、四類輪換結果、≤100 字）。
   * enabled=false（開關 off）時仍預覽「若開啟會發的文案」，實發時則跳過不發。
   */
  firstReply?: {
    text: string
    category: string
    categoryLabel: string
    source: 'llm' | 'fallback'
    tagged: boolean
    mode: FirstReplyMode
    enabled: boolean
  } | null
  error?: string
}

/**
 * 依目前市場焦點總覽執行社群發布（有新版 edition 才發）。
 * @param dryRun 只生成文案＋圖卡（classic＋meme 兩版）供預覽，不動 Meta API、不寫去重。
 * @param platforms 預設兩平台皆發。
 * @param force 發布時忽略去重強制重發（乾跑不受影響）。
 * @param imageUrl+captions 手動發布：用乾跑後上傳的圖卡 URL 與改寫後的文案（不再自動生成）。
 */
export async function triggerSocialPublish(
  options: {
    dryRun?: boolean
    platforms?: SocialPostPlatform[]
    force?: boolean
    imageUrl?: string | null
    imageUrls?: Partial<Record<SocialPostPlatform, string | null>>
    captions?: SocialCaptions
  } = {},
): Promise<SocialPublishOutcome> {
  const dryRun = options.dryRun ?? false
  const force = options.force ?? false
  const platforms = options.platforms?.length ? options.platforms : (['instagram', 'threads', 'facebook'] as SocialPostPlatform[])
  const manual = !!((options.imageUrl || options.imageUrls) && options.captions)

  const meta = await getMarketFocusMeta()
  if (!meta?.summary) {
    return { triggered: false, skipped: true, error: 'market_focus_meta 尚無內容' }
  }

  const editionKey = meta.generated_at
  const items = await getMarketFocus(6, 2)

  // #31 首回覆開關（讀 social.reply_tag_metaai；off＝不發首回覆；editor＝降級去 tag 版）。
  const firstReplyMode: FirstReplyMode = await getFirstReplyMode().catch(() => 'editor' as FirstReplyMode)

  // 乾跑保持單純：不讀去重、不寫任何發布狀態。固定產生 classic＋meme＋ai 三版圖卡供選。
  // Issue #32：LLM 呼叫序列＋間隔（captions→meme→首回覆預覽）；底圖走 FLUX 圖像池
  // 非 Groq OTPM 池，可與 LLM 序列重疊並行。
  if (dryRun) {
    const bgPromise = generateSocialBackgroundImage({ headline: items[0]?.title, summary: meta.summary, items }).catch(() => null)
    const captions = await generateSocialCaptions(meta, items)
    await sleep(getChainPaceMs())
    const meme = await generateMemeConcept(meta, items)
    const bgImage = await bgPromise
    // ai 全圖卡：依梗圖主軸另生成專屬不打字藝術構圖（無梗圖或生圖失敗時以一般底圖兜底）
    const aiArt = meme?.title ? await generateSocialArtworkImage(meme).catch(() => null) : null
    const cardStyle = ((await getAgentSetting('social.card_style').catch(() => null)) ?? 'ai') as SocialCardStyle
    const igCardStyle: 'ai' | 'meme' = 'ai'
    // #31 乾跑預覽本次首回覆問題（off 時仍預覽 on 版文案＋標示 enabled=false，實發時跳過）。
    const firstReplyPreview = await generateFirstReplyQuestion(meta, items, meme, {
      editionKey: editionKey ?? '',
      mode: firstReplyMode === 'editor' ? 'editor' : 'on',
    }).catch(() => null)
    const toDataUrl = (buf: Buffer) => `data:image/jpeg;base64,${buf.toString('base64')}`
    const [classicBuf, memeBuf, aiBuf] = await Promise.all([
      renderSocialCard({ meta, items }, { style: 'classic', backgroundImage: bgImage }),
      renderSocialCard({ meta, items }, { style: 'meme', meme, backgroundImage: bgImage }),
      renderSocialCard({ meta, items }, { style: 'ai', meme, backgroundImage: aiArt ?? bgImage }),
    ])
    return {
      triggered: true,
      editionKey,
      dryRun: true,
      cardStyle,
      igCardStyle,
      cards: { classic: toDataUrl(classicBuf), meme: toDataUrl(memeBuf), ai: toDataUrl(aiBuf) },
      captions,
      meme,
      igDriveComment: IG_DRIVE_COMMENT,
      firstReply: firstReplyPreview
        ? {
            text: firstReplyPreview.text,
            category: firstReplyPreview.category,
            categoryLabel: firstReplyPreview.categoryLabel,
            source: firstReplyPreview.source,
            tagged: firstReplyPreview.tagged,
            mode: firstReplyMode,
            enabled: firstReplyMode !== 'off',
          }
        : null,
      results: platforms.map((p) => ({ platform: p, status: 'dry_run', error: null })),
    }
  }

  // 發布：去重與發布綁定。force 重發時清除去重紀錄並全部重跑；否則只處理未發布過的平台。
  const unresolved = force
    ? platforms.map((p) => ({ platform: p, posted: false }))
    : (
        await Promise.all(platforms.map(async (p) => ({ platform: p, posted: await alreadyPosted(p, editionKey!) })))
      ).filter((x) => !x.posted)

  if (unresolved.length === 0) {
    return { triggered: false, skipped: true, editionKey, message: 'edition 已發布或無新內容' }
  }

  // 手動發布（乾跑後選定圖卡＋改文案）：直接用指定的圖與文字；自動發布則產出文案＋og 圖。
  const contentByPlatform = manual ? options.captions! : await generateSocialCaptions(meta, items)

  // #31 首回覆題目：同 edition 全平台共用同一題（類別依 edition 輪換，與乾跑預覽一致）。
  // 成本即規格所列「多 1 次 LLM」：meme 概念提前生成一次，同時供提問＋圖卡共用。
  // Issue #32：captions→meme→首回覆序列＋間隔（原已序列，加錯峰）。
  let firstReply: FirstReplyQuestion | null = null
  let replyMeme: { title: string; punchline: string } | null = null
  if (firstReplyMode !== 'off') {
    try {
      if (!manual) await sleep(getChainPaceMs())
      replyMeme = await generateMemeConcept(meta, items)
      await sleep(getChainPaceMs())
      firstReply = await generateFirstReplyQuestion(meta, items, replyMeme, {
        editionKey: editionKey!,
        mode: firstReplyMode, // 'on'→@meta.ai 版；'editor'→降級去 tag 小編提問版
      })
    } catch (e) {
      // 題目準備失敗只記 log（generate 內部已有題庫兜底，此處為額外保險），主文照發。
      console.error('[Social] 首回覆題目準備失敗（主文不受影響）:', e)
    }
  }

  // 確保自動發布所需的圖卡快照皆已預先繪製並快取至 DB，避免 Meta API 抓取時動態調用 LLM 導致逾時 (9004)
  // FB / IG / Threads 一律用 AI 吉祥物全圖卡（ai）
  const stylesNeeded = new Set<SocialCardStyle>()
  for (const { platform } of unresolved) {
    if (!options.imageUrls?.[platform] && !options.imageUrl) {
      stylesNeeded.add('ai')
    }
  }

  if (stylesNeeded.size > 0) {
    const missingStyles: SocialCardStyle[] = []
    for (const style of stylesNeeded) {
      const existing = await getSocialCardImage(editionKey!, style).catch(() => null)
      if (!existing) {
        missingStyles.push(style)
      }
    }

    if (missingStyles.length > 0) {
      const sharedBg = await generateSocialBackgroundImage({
        headline: items[0]?.title,
        summary: meta.summary,
        items,
      }).catch(() => null)

      for (const style of missingStyles) {
        // 首回覆已預生成的 meme 概念優先共用，避免重複呼叫 LLM。
        let meme = replyMeme
        if (!meme && (style === 'meme' || style === 'ai')) {
          meme = await generateMemeConcept(meta, items)
        }
        // ai 全圖卡以 FLUX 專屬吉祥物藝術圖為主，失敗時退回一般底圖
        let backgroundImage = sharedBg
        if (style === 'ai' && meme?.title) {
          backgroundImage = (await generateSocialArtworkImage(meme).catch(() => null)) ?? sharedBg
        }
        const buf = await renderSocialCard({ meta, items }, { style, meme, backgroundImage })
        await saveSocialCardImage(editionKey!, style, buf).catch((e) => {
          console.warn(`[Social] 預先快取 ${style} 圖卡失敗:`, e)
        })
      }
    }
  }

  const results: SocialPublishOutcome['results'] = []
  for (const { platform } of unresolved) {
    const content = platform === 'instagram' ? contentByPlatform.instagram : platform === 'facebook' ? contentByPlatform.facebook : contentByPlatform.threads
    // FB / IG / Threads 一律 AI 吉祥物全圖卡
    const defaultStyle: SocialCardStyle = 'ai'
    const imageUrl =
      options.imageUrls?.[platform] ??
      options.imageUrl ??
      buildCardImageUrl(editionKey!, defaultStyle)

    const res = await publishSocialPost(platform, editionKey!, content, imageUrl, false, force)
    // #31 主文發完後串首回覆（best-effort：失敗記狀態＋告警，不動主文 status）。
    let firstReplyStatus: string | null = null
    if (firstReply && res.status === 'published' && res.externalId) {
      firstReplyStatus = await postFirstReplyBestEffort(platform, editionKey!, res.externalId, firstReply)
    }
    results.push({ platform, status: res.status, error: res.error, commentStatus: res.commentStatus, firstReplyStatus })
  }

  const failed = results.filter((r) => r.status === 'failed')
  if (failed.length > 0) {
    // Issue #57：告警內文改由 social-alert.ts 純函式組裝（含內容名／成功／失敗＋錯誤原文／重試／edition）。
    await sendMarketFocusAlert('社群發布部分失敗', buildSocialPartialFailMessage(editionKey!, results))
  }

  return { triggered: true, editionKey, dryRun: false, results }
}

/**
 * Issue #31 首回覆實發（best-effort，不拖垮主文）：
 * - Threads：自回覆（reply_to_id＝自家主文 media_id，沿用 threads-reply.ts publishThreadsReply）。
 * - IG：第二則留言（第一則導流留言由 social-publish.ts 維持不動，此處另發一則）。
 * - 去重：同 edition 已 posted 即回 skipped_duplicate 不重發。
 *   force 重發會清整列（含首回覆欄位），故重發時會重貼，特此註記。
 * - 失敗：記 first_reply_status='failed'＋沿用 sendMarketFocusAlert 告警管線（不新增信件），主文 status 不變。
 */
async function postFirstReplyBestEffort(
  platform: SocialPostPlatform,
  editionKey: string,
  mainExternalId: string,
  q: FirstReplyQuestion,
): Promise<string | null> {
  if (platform !== 'threads' && platform !== 'instagram') return null
  if (await hasFirstReplyPosted(platform, editionKey).catch(() => false)) {
    return 'skipped_duplicate'
  }
  try {
    if (platform === 'threads') {
      const { replyMediaId } = await publishThreadsReply(q.text, mainExternalId)
      await recordFirstReplyPosted(platform, editionKey, { externalId: replyMediaId, text: q.text, category: q.category })
      return 'posted'
    }
    const token = process.env.IG_ACCESS_TOKEN
    if (!token) throw new Error('IG_ACCESS_TOKEN 未設定')
    const commentId = await postInstagramComment(mainExternalId, q.text, token)
    await recordFirstReplyPosted(platform, editionKey, { externalId: commentId, text: q.text, category: q.category })
    return 'posted'
  } catch (e: any) {
    const msg = (e?.message || String(e)).slice(0, 1000)
    console.error(`[Social/${platform}] 首回覆失敗（主文不受影響）:`, msg)
    await recordFirstReplyFailed(platform, editionKey, { error: msg, text: q.text, category: q.category })
    // Issue #57：告警內文改由 social-alert.ts 純函式組裝（保留錯誤原文＋edition key，另含內容名／重試方式）。
    await sendMarketFocusAlert('社群首回覆失敗', buildFirstReplyFailMessage(platform, msg, editionKey)).catch(() => {})
    return 'failed'
  }
}

export function buildImageUrl(editionKey: string, style: SocialCardStyle = 'classic'): string {
  return `${SITE_BASE}/api/social/og?edition=${encodeURIComponent(editionKey)}&style=${style}`
}

/** 手動發布用的圖卡快照 URL（乾跑後選定上傳的那張，與預覽完全一致）。 */
export function buildCardImageUrl(editionKey: string, style: SocialCardStyle): string {
  return `${SITE_BASE}/api/social/card-image?edition=${encodeURIComponent(editionKey)}&style=${style}`
}