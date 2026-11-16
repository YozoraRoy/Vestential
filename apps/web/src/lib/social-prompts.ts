/**
 * AI Control Center #23：社群小編 Prompt 動態託管映射與版本歷史管理。
 * - 複用既有的 `agent_settings` 鍵值表（無須新增 DB migration）。
 * - 歷史版本存於 `social.prompt_history.<id>`（JSON 陣列，保留最近 10 筆）。
 */

export type SocialPromptId = 'news-summary' | 'tech-meme' | 'first-reply' | 'platform-styles' | 'topic-reply'

export interface SocialPromptDef {
  id: SocialPromptId
  settingKey: string
  historyKey: string
  category: 'summary' | 'meme' | 'first-reply' | 'style' | 'topic-reply'
  label: string
}

export interface SocialPromptHistoryEntry {
  version: number
  value: string
  updatedAt: string
  updatedBy: string
}

export const PROMPT_HISTORY_MAX_ITEMS = 10

export const SOCIAL_PROMPT_DEFS: readonly SocialPromptDef[] = [
  {
    id: 'news-summary',
    settingKey: 'market_focus.summary_prompt',
    historyKey: 'social.prompt_history.news-summary',
    category: 'summary',
    label: '每日新聞焦點總覽 Prompt',
  },
  {
    id: 'tech-meme',
    settingKey: 'social.meme_prompt',
    historyKey: 'social.prompt_history.tech-meme',
    category: 'meme',
    label: '科技／台股梗圖企劃 Prompt',
  },
  {
    id: 'first-reply',
    settingKey: 'social.first_reply_prompt',
    historyKey: 'social.prompt_history.first-reply',
    category: 'first-reply',
    label: '首則互動留言 Prompt',
  },
  {
    id: 'platform-styles',
    settingKey: 'social.threads_prompt',
    historyKey: 'social.prompt_history.platform-styles',
    category: 'style',
    label: '社群平台風格排版 Prompt（Threads）',
  },
  {
    id: 'topic-reply',
    settingKey: 'social.topic_reply_prompt',
    historyKey: 'social.prompt_history.topic-reply',
    category: 'topic-reply',
    label: '第 2 小編：海巡說人話回覆 Prompt',
  },
] as const

export function findSocialPromptDef(id: string): SocialPromptDef | undefined {
  return SOCIAL_PROMPT_DEFS.find((d) => d.id === id)
}

export function parsePromptHistory(raw: string | null | undefined): SocialPromptHistoryEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is SocialPromptHistoryEntry =>
        item != null &&
        typeof item === 'object' &&
        typeof item.version === 'number' &&
        typeof item.value === 'string' &&
        typeof item.updatedAt === 'string' &&
        typeof item.updatedBy === 'string',
    )
  } catch {
    return []
  }
}

export function pushPromptHistory(
  existing: readonly SocialPromptHistoryEntry[],
  newValue: string,
  updatedBy: string,
  nowIso: string = new Date().toISOString(),
): SocialPromptHistoryEntry[] {
  const nextVersion = existing.length > 0 ? Math.max(...existing.map((e) => e.version)) + 1 : 1
  const entry: SocialPromptHistoryEntry = {
    version: nextVersion,
    value: newValue,
    updatedAt: nowIso,
    updatedBy: updatedBy || 'admin',
  }
  return [entry, ...existing].slice(0, PROMPT_HISTORY_MAX_ITEMS)
}
