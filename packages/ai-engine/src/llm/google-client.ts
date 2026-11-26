import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText, generateObject } from 'ai'
import type { LLMClient, LLMConfig, LLMCallInfo, LLMUsage } from './client.js'
import { AIError } from '@stock/core'

function parseRetryDelay(msg: string): number | null {
  const m = msg.match(/retry in (\d+(?:\.\d+)?)s/i)
  return m ? Math.ceil(parseFloat(m[1])) : null
}

function isPermanentQuotaError(err: any): boolean {
  const msg = err?.message?.toLowerCase() ?? ''
  return [
    'quota exceeded', 'exceeded your current quota', 'current quota',
    'resource exhausted', '429', 'free_tier_requests',
  ].some(k => msg.includes(k))
}

const TRANSIENT_RETRYABLE = [
  'high demand', '503', '500', 'fetch failed', 'socket hang up', 'econnreset',
]

function isTransientRetryable(err: any): boolean {
  const msg = err?.message?.toLowerCase() ?? ''
  return TRANSIENT_RETRYABLE.some(k => msg.includes(k))
}

export class GoogleClient implements LLMClient {
  onUsage?: (usage: LLMUsage) => void
  onCall?: (info: LLMCallInfo) => void
  onRetry?: (retryAfterMs: number) => void
  private apiKeys: string[] = []
  private currentKeyIndex = 0
  private lastCallTime = 0
  private readonly minInterval = 1000

  constructor(private config: LLMConfig) {
    const rawKey = config.apiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY || ''
    this.apiKeys = rawKey.split(',').map(k => k.trim()).filter(Boolean)
  }

  get model(): string {
    return this.config.model
  }

  private getProvider(apiKey?: string) {
    const key = apiKey || this.apiKeys[this.currentKeyIndex] || ''
    const baseURL = this.config.baseUrl?.trim() || undefined
    return createGoogleGenerativeAI({
      apiKey: key,
      ...(baseURL ? { baseURL } : {}),
    })
  }

  private async waitForQuota() {
    const now = Date.now()
    const elapsed = now - this.lastCallTime
    if (elapsed < this.minInterval) {
      await new Promise(r => setTimeout(r, this.minInterval - elapsed))
    }
    this.lastCallTime = Date.now()
  }

  private async executeWithKeyRotation<T>(
    runWithProvider: (provider: ReturnType<typeof createGoogleGenerativeAI>) => Promise<T>
  ): Promise<T> {
    const totalKeys = Math.max(1, this.apiKeys.length)
    let lastErr: any = null

    for (let attempt = 0; attempt < totalKeys; attempt++) {
      const activeIndex = (this.currentKeyIndex + attempt) % totalKeys
      const provider = this.getProvider(this.apiKeys[activeIndex])

      // 單一 key 只做最多 2 次瞬時網路重試，遇到 429 配額超額絕不死等 60 秒
      for (let retry = 0; retry < 2; retry++) {
        try {
          await this.waitForQuota()
          const result = await runWithProvider(provider)
          this.currentKeyIndex = activeIndex
          return result
        } catch (e: any) {
          lastErr = e
          if (isPermanentQuotaError(e)) {
            console.warn(`[Google] Key #${activeIndex + 1} quota exceeded (429), switching to next key or fallback immediately without long wait:`, e?.message?.slice(0, 100))
            // 立即跳出重試循環，換下一把 key
            break
          }

          if (retry === 0 && isTransientRetryable(e)) {
            const delay = 1500
            console.log(`[Google] transient error, quick retry after 1.5s: ${e?.message?.slice(0, 60)}`)
            this.onRetry?.(delay)
            await new Promise(r => setTimeout(r, delay))
            continue
          }

          // 非可重試錯誤，直接拋出
          throw e
        }
      }
    }

    // 所有 key 皆失敗或額度耗盡，快速拋出 AIError 讓外層 FallbackClient 立即熔斷接手
    throw new AIError(`Google LLM failed: all keys exhausted or quota exceeded: ${lastErr?.message}`)
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.executeWithKeyRotation(async (provider) => {
      const { text, usage } = await generateText({
        model: provider(this.config.model),
        system: systemPrompt,
        prompt: userPrompt,
        temperature: this.config.temperature,
        maxRetries: 0,
        ...(this.config.maxTokens ? { maxOutputTokens: this.config.maxTokens } : {}),
      })
      this.reportUsage(usage)
      this.onCall?.({ model: this.config.model, usedFallback: false })
      return text
    })
  }

  async generateWithImage(systemPrompt: string, userPrompt: string, imageDataUrl: string): Promise<string> {
    return this.executeWithKeyRotation(async (provider) => {
      const { text, usage } = await generateText({
        model: provider(this.config.model),
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image', image: imageDataUrl },
            ],
          },
        ],
        temperature: this.config.temperature,
        maxRetries: 0,
        ...(this.config.maxTokens ? { maxOutputTokens: this.config.maxTokens } : {}),
      })
      this.reportUsage(usage)
      this.onCall?.({ model: this.config.model, usedFallback: false })
      return text
    })
  }

  async generateObject<T>(systemPrompt: string, userPrompt: string, schema: any): Promise<T> {
    return this.executeWithKeyRotation(async (provider) => {
      const { object, usage } = await generateObject({
        model: provider(this.config.model),
        system: systemPrompt,
        prompt: userPrompt,
        schema,
        temperature: this.config.temperature,
        maxRetries: 0,
        ...(this.config.maxTokens ? { maxOutputTokens: this.config.maxTokens } : {}),
      })
      this.reportUsage(usage)
      this.onCall?.({ model: this.config.model, usedFallback: false })
      return object as T
    })
  }

  private reportUsage(usage: { promptTokens?: number; completionTokens?: number } | undefined) {
    this.onUsage?.({
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
    })
  }
}
