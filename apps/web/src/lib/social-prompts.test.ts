import { describe, it, expect } from 'vitest'
import {
  findSocialPromptDef,
  parsePromptHistory,
  pushPromptHistory,
  PROMPT_HISTORY_MAX_ITEMS,
  SOCIAL_PROMPT_DEFS,
} from './social-prompts'

describe('AI Control Center #23 social-prompts helpers', () => {
  it('包含 5 個社群小編 Prompt 映射且鍵值唯一', () => {
    expect(SOCIAL_PROMPT_DEFS).toHaveLength(5)
    const ids = new Set(SOCIAL_PROMPT_DEFS.map((d) => d.id))
    const keys = new Set(SOCIAL_PROMPT_DEFS.map((d) => d.settingKey))
    expect(ids.size).toBe(5)
    expect(keys.size).toBe(5)
    expect(findSocialPromptDef('first-reply')?.settingKey).toBe('social.first_reply_prompt')
    expect(findSocialPromptDef('topic-reply')?.settingKey).toBe('social.topic_reply_prompt')
    expect(findSocialPromptDef('unknown')).toBeUndefined()
  })

  it('pushPromptHistory 遞增版本號並限制上限 10 筆', () => {
    let history = parsePromptHistory(null)
    for (let i = 1; i <= 12; i++) {
      history = pushPromptHistory(history, `prompt-v${i}`, 'ai-control-center', `2026-11-15T00:00:${String(i).padStart(2, '0')}Z`)
    }
    expect(history).toHaveLength(PROMPT_HISTORY_MAX_ITEMS)
    expect(history[0]?.version).toBe(12)
    expect(history[0]?.value).toBe('prompt-v12')
    expect(history[9]?.version).toBe(3)
  })

  it('parsePromptHistory 遇到毀損 JSON 安全回傳空陣列', () => {
    expect(parsePromptHistory('{invalid json')).toEqual([])
    expect(parsePromptHistory('null')).toEqual([])
  })
})
