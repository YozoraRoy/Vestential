import type { LLMClient, LLMConfig, LLMCallInfo, LLMUsage } from './client.js'
import { AIError } from '@stock/core'
import { jitterDelay, shrinkBudgetForRetry } from './budget.js'

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export class OpenAICompatibleClient implements LLMClient {
  onUsage?: (usage: LLMUsage) => void
  onCall?: (info: LLMCallInfo) => void
  onRetry?: (retryAfterMs: number) => void

  constructor(private config: LLMConfig) {}

  get model(): string {
    return this.config.model
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.callAPI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ])
  }

  async generateObject<T>(_systemPrompt: string, _userPrompt: string, schema: any): Promise<T> {
    const prompt = `${_systemPrompt}\n\n${_userPrompt}\n\nRespond with valid JSON only. No markdown, no explanation.`
    // #46：原始呼叫先壓住 hook（fireHooks: false），驗證成功後才親發 usage/call。
    // 否則 HTTP 成功但 JSON parse/validation 失敗時已記一筆 phantom row，
    // 外層 FallbackClient 切備援成功再記一筆 → 一次邏輯呼叫兩筆。
    const { text: raw, usage } = await this.callAPIWithUsage(
      [
        { role: 'system', content: 'You output valid JSON matching the requested schema. Never include markdown or extra text.' },
        { role: 'user', content: prompt },
      ],
      false,
    )

    let cleaned = ''
    try {
      cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const parsed = JSON.parse(cleaned)
      const result = schema.parse(parsed) as T
      if (usage) this.onUsage?.(usage)
      this.onCall?.({ model: this.config.model, usedFallback: false })
      return result
    } catch (e: any) {
      console.error('[OpenAIClient] failed to parse or validate JSON object.')
      console.error('[OpenAIClient] raw response:', raw)
      console.error('[OpenAIClient] cleaned response:', cleaned)
      throw new AIError(`LLM structured generation failed: ${e.message}. Raw output: ${raw}`)
    }
  }

  async generateWithImage(systemPrompt: string, userPrompt: string, imageDataUrl: string): Promise<string> {
    return this.callAPI([
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ] as ContentPart[],
      },
    ])
  }

  private async callAPI(messages: { role: string; content: string | ContentPart[] }[]): Promise<string> {
    const { text } = await this.callAPIWithUsage(messages, true)
    return text
  }

  /**
   * 帶重試的底層呼叫。fireHooks=true 時成功即發 onUsage/onCall（generate／generateWithImage
   * 路徑）；generateObject 傳 false 自行在驗證成功後補發，避免 phantom row（#46）。
   * 重試迴圈全用區域變數，並行呼叫互不干擾。
   */
  private async callAPIWithUsage(
    messages: { role: string; content: string | ContentPart[] }[],
    fireHooks: boolean,
  ): Promise<{ text: string; usage: LLMUsage | null }> {
    const maxRetries = Number(process.env.LLM_MAX_RETRIES) || 5
    const timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || 180_000
    // 靜態預算（config 傳入／env 預設）：全程不改；429 時只縮小「當次重試」的
    // effectiveMaxTokens（Issue #32 執行期自適應）。
    const baseMaxTokens = this.config.maxTokens ?? (Number(process.env.LLM_MAX_TOKENS) || 8192)
    let effectiveMaxTokens = baseMaxTokens
    const disableThinking = (process.env.LLM_DISABLE_THINKING ?? 'true').toLowerCase() !== 'false'

    let lastError: any = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const requestBody: Record<string, any> = {
        model: this.config.model,
        messages,
        temperature: this.config.temperature,
        max_tokens: effectiveMaxTokens,
      }

      // 推理型模型（如 big-pickle/deepseek-v4-flash）會把 token 預算全燒在
      // reasoning_content，導致 content 為空或逾時。OpenCode Zen 支援停用
      // thinking，讓模型直接輸出答案，避免「No content」與 60s abort。
      if (disableThinking && this.config.baseUrl?.includes('opencode.ai')) {
        requestBody.thinking = { type: 'disabled' }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!res.ok) {
          const errText = await res.text()
          const retryAfter = this.parseRetryAfter(res, errText)
          const quotaBlocked = res.status === 429 && retryAfter > 30
          // 400, 401, 403, 404 等客戶端致命錯誤（如認證失敗、FreeTier 限制、端點不存在）：重試無法解決，直接跳過重試讓 Fallback 接手
          const fatalClientError = res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404
          const err = new AIError(
            `API ${res.status}: ${errText}${retryAfter > 0 ? ` (retry after ~${Math.round(retryAfter / 60)} min)` : ''}`,
          )
          // 帳戶層級配額封鎖或客戶端驗證錯誤：重試無意義，直接拋出讓 Fallback 接手。
          if (quotaBlocked || fatalClientError) {
            err.retryable = false
          }
          // Issue #32：429（非配額封鎖型）先在執行期縮小 budget 再重試，
          // 降下一次命中的 OTPM 佔用；靜態 max_tokens 不動。
          if (res.status === 429 && !quotaBlocked) {
            const shrunk = shrinkBudgetForRetry(effectiveMaxTokens)
            if (shrunk < effectiveMaxTokens) {
              console.warn(
                `[OpenAIClient] 429 rate-limit：本次重試 max_tokens ${effectiveMaxTokens} → ${shrunk}（執行期自適應，靜態設定不變）`,
              )
              effectiveMaxTokens = shrunk
            }
          }
          throw err
        }

        const data: any = await res.json()

        const captured: LLMUsage | null = data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
            }
          : null

        const message = data.choices?.[0]?.message
        if (message?.content) {
          if (fireHooks) {
            if (captured) this.onUsage?.(captured)
            this.onCall?.({ model: this.config.model, usedFallback: false })
          }
          return { text: message.content, usage: captured }
        }
        if (message?.reasoning_content) {
          if (fireHooks) {
            if (captured) this.onUsage?.(captured)
            this.onCall?.({ model: this.config.model, usedFallback: false })
          }
          return { text: message.reasoning_content, usage: captured }
        }
        throw new AIError('No content in model response')

      } catch (e: any) {
        clearTimeout(timeoutId)
        lastError = e

        const isTimeout = e.name === 'AbortError'
        const isRetryable = isTimeout || e.message?.includes('fetch failed') || e.message?.includes('network error') || (e instanceof AIError && e.retryable !== false)

        console.warn(`[OpenAIClient] Attempt ${attempt}/${maxRetries} failed: ${e.message || e}`)

        if (attempt < maxRetries && isRetryable) {
          // Groq 等低 TPM 服務會回「Please try again in Xs」：等過視窗再重試，
          // 比固定 1.5s 背退更能讓該次呼叫真正成功。
          const tpm = e?.message?.match(/try again in ([\d.]+)s/i)
          const tpmWaitMs = tpm ? Number(tpm[1]) * 1000 : 0
          // 等待 API 建議的時間 + 緩衝，避免 TPM 尚未完全重置
          const baseWaitMs = tpmWaitMs > 0
            ? Math.min(tpmWaitMs + 5000, 90_000)
            : Math.min(3000 * attempt, 30_000)
          // Issue #32：退避加 jitter（±25%），避免多個呼叫對齊同一分鐘窗重試、
          // 集體再打爆 OTPM。
          const waitMs = jitterDelay(baseWaitMs)
          console.warn(`[OpenAIClient] retrying in ${Math.round(waitMs / 1000)}s (base ${Math.round(baseWaitMs / 1000)}s + jitter)`)
          this.onRetry?.(waitMs)
          await new Promise((r) => setTimeout(r, waitMs))
          continue
        }
        break
      }
    }

    throw new AIError(`LLM API connection failed after ${maxRetries} attempts: ${lastError?.message || lastError}`)
  }

  private parseRetryAfter(res: Response, errText: string): number {
    const header = res.headers.get('retry-after')
    if (header) {
      const sec = Number(header)
      if (!Number.isNaN(sec) && sec > 0) return sec
    }
    const m = errText.match(/"retryAfter"?\s*:\s*(\d+)/i)
    return m ? Number(m[1]) : 0
  }
}
