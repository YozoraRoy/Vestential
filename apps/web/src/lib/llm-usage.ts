import { LLMUsageTracker } from '@stock/ai-engine'
import type { LLMClient } from '@stock/ai-engine'
import { logApiError, logLlmUsage } from '@stock/database'

/**
 * 為一組 createQuickLLM() 產出的 client 掛上 LLM 用量記錄：每次成功呼叫以
 * fire-and-forget 寫入 llm_usage_logs（agent 由呼叫方命名，如 market-focus.summary）。
 * 若觸發了 Fallback 備援，同步記錄一筆 ai_quota（recovered: true）至 api_error_logs，
 * 讓 /admin/errors 能追蹤免費／主力模型額度耗盡事件。
 */
export function attachLlmUsageRecorder(llm: LLMClient, agent: string): void {
  const tracker = new LLMUsageTracker()
  tracker.setCurrentAgent(agent)
  tracker.onCallRecorded = (entry) => {
    void logLlmUsage(entry)
    if (entry.usedFallback) {
      void logApiError({
        category: 'ai_quota',
        route: `llm:${entry.agent || agent}`,
        method: 'LLM',
        statusCode: 429,
        durationMs: 0,
        actorType: 'guest',
        recovered: true,
        errorMessage: `主模型異常或額度用盡，已自動由備援模型 ${entry.model} 接手`,
      })
    }
  }
  tracker.attach(llm)
}