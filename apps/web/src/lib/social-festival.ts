import { createQuickLLM, FALLBACK_SAFE_MAX_TOKENS } from '@stock/ai-engine'
import { dataBlock, injectionGuardNote } from '@stock/ai-engine'
import { loadConfig } from '@stock/core'
import { TAIWAN_MARKET_HOLIDAYS } from '@/utils/taiwan-calendar'
import { attachLlmUsageRecorder } from '@/lib/llm-usage'
import type { FestivalId } from '@/lib/festival-calendar'
import type { SocialPostPlatform } from '@stock/database'

// ─── 節慶賀詞生成（中秋 MVP）───────────────────────────────────────
// 三平台差異化、speak-human-tw 語氣（無說教贅詞），LLM 失敗以標題拼接
// fallback 兜底（仿 social.ts buildFallbackCaptions），絕不 throw。

export interface SocialCaptions {
  instagram: string
  threads: string
  facebook: string
}

type PlatformKey = keyof SocialCaptions

const FESTIVAL_MAX_CHARS = 500

const PLATFORM_LABELS: Record<PlatformKey, string> = {
  instagram: 'Instagram',
  threads: 'Threads',
  facebook: 'Facebook',
}

function festivalTheme(id: FestivalId): string {
  if (id === 'mid-autumn') return '中秋節（月圓團圓，吃月餅、柚子、烤肉）'
  return id
}

/** 該節慶當天台股是否休市（命中休市日表即加一句休市問候，如 2026-09-25）。 */
export function isFestivalMarketClosed(dateStr: string): boolean {
  return TAIWAN_MARKET_HOLIDAYS.has(dateStr)
}

/**
 * 生成節慶賀詞。LLM 單平台失敗以對應 fallback 覆蓋，整體不 throw。
 * @param dateStr Asia/Taipei 的 YYYY-MM-DD（決定是否加休市問候），預設取今日。
 * @param platforms 要實際生成賀詞的平台（正式流程只傳 ['threads']；
 *   省略時維持三平台，供既有測試／日後恢復使用）。
 */
export async function generateFestivalCaptions(
  id: FestivalId = 'mid-autumn',
  dateStr?: string,
  platforms: SocialPostPlatform[] = ['instagram', 'threads', 'facebook'],
): Promise<SocialCaptions> {
  const day = dateStr ?? ''
  try {
    const config = loadConfig()
    const { llm } = createQuickLLM(config, { maxTokens: FALLBACK_SAFE_MAX_TOKENS })
    attachLlmUsageRecorder(llm, 'social.festival-captions')

    const marketClosed = day ? isFestivalMarketClosed(day) : false
    const userPrompt = [
      dataBlock('festival', festivalTheme(id), 60),
      dataBlock('date', day, 20),
      marketClosed ? dataBlock('note', '當天台股休市，文案需含一句休市問候（如：台股休市一天，部位先放著，好好吃一頓）。', 80) : '',
    ]
      .filter(Boolean)
      .join('\n')

    const fallback = buildFestivalFallbackCaptions(id, day)
    const result: SocialCaptions = { ...fallback }

    const allPlans: { key: PlatformKey; system: string }[] = [
      { key: 'instagram', system: buildFestivalSystemPrompt(id, 'instagram', day) },
      { key: 'threads', system: buildFestivalSystemPrompt(id, 'threads', day) },
      { key: 'facebook', system: buildFestivalSystemPrompt(id, 'facebook', day) },
    ]
    const plans = allPlans.filter((plan) => platforms.includes(plan.key))
    for (const { key, system } of plans) {
      try {
        const raw = await llm.generate(system, `${userPrompt}\n\n請撰寫 ${PLATFORM_LABELS[key]} 賀節文案。`)
        const text = raw.trim().replace(/```(?:json|text)?\s*([\s\S]*?)```/gi, '$1').trim()
        if (text) result[key] = trimToChars(text, FESTIVAL_MAX_CHARS)
      } catch (e) {
        console.error(`[SocialFestival] ${PLATFORM_LABELS[key]} caption generation failed, using fallback:`, e)
      }
    }
    return result
  } catch (e) {
    console.error('[SocialFestival] captions generation failed, using fallback:', e)
    return buildFestivalFallbackCaptions(id, day)
  }
}

function buildFestivalSystemPrompt(id: FestivalId, platform: PlatformKey, dateStr: string): string {
  void id
  const marketClosed = dateStr ? isFestivalMarketClosed(dateStr) : false
  const platformRule: Record<PlatformKey, string> = {
    instagram: '文風：短版節慶賀卡體。開頭一句有記憶點的中秋 hook，配 3~5 個 hashtag（如 #中秋節 #台股 #Vestential）。',
    threads: '文風：短、有對話感，像朋友傳訊息祝賀，一句 hook 加一句陪伴。',
    facebook: '文風：短版祝福＋一句 Vestential 陪伴投資路的收尾，配 2~3 個 hashtag。',
  }
  return `你是 Vestential（台灣股票投資資訊平台）的社群小編，撰寫中秋節當天自動發布到 ${PLATFORM_LABELS[platform]} 的賀節貼文。
${injectionGuardNote()}
嚴守以下規則：
1. 只撰寫 ${PLATFORM_LABELS[platform]} 單一平台的文案。
2. 用繁體中文（台灣用語），全形標點，直接講重點，不說教、不當人生導師。
3. ${platformRule[platform]}
4. ${marketClosed ? '台股當天休市，必須含一句休市問候（部位先放著、好好過節的意思）。' : '不要提及休市。'}
5. 提到 Vestential 陪大家過節一次即可。
6. 總長度不超過 ${FESTIVAL_MAX_CHARS} 字；文中不要放網址。
7. 禁用贅詞（值得注意的是、不可否認、總而言之、總結來說）；禁用「不是 A 而是 B」句型。
8. 只輸出文案本身，不要輸出 JSON 或其他文字。`
}

/** LLM 失敗時的標題拼接兜底（固定賀詞＋休市問候），絕不 throw。 */
export function buildFestivalFallbackCaptions(id: FestivalId, dateStr?: string): SocialCaptions {
  void id
  const day = dateStr ?? ''
  const closedLine = day && isFestivalMarketClosed(day) ? '台股今天休市，部位先放著，好好吃一頓。' : ''
  const year = day.slice(0, 4)
  const core = `🌕 中秋快樂${year ? `（${year}）` : ''}！Vestential 陪你賞月吃月餅。${closedLine}`
  return {
    instagram: trimToChars(`${core}\n\n月圓，部位也要圓。\n\n#中秋節 #台股 #Vestential #月餅節快樂`, FESTIVAL_MAX_CHARS),
    threads: trimToChars(`${core}今晚抬頭看看月亮吧。`, FESTIVAL_MAX_CHARS),
    facebook: trimToChars(`${core}\n\n團圓的日子，Vestential 陪你走長期投資的路。\n\n#中秋節 #Vestential`, FESTIVAL_MAX_CHARS),
  }
}

function trimToChars(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('')
}
