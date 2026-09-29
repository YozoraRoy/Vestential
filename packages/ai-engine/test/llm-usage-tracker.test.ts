import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { LLMUsageTracker, type LlmUsageEntry } from '../src/llm/usage.js'
import { FallbackClient } from '../src/llm/fallback-client.js'
import { OpenAICompatibleClient } from '../src/llm/openai-client.js'
import type { LLMClient } from '../src/llm/client.js'

// ─── Issue #46：一次邏輯呼叫只記一筆、重試風暴只記一筆、flag 正確 ────

/** 可控樁 client：成功時按真實客戶端順序發 onUsage 再發 onCall；失敗時靜默 throw（不發 hook）。 */
function stubClient(
  model: string,
  opts: { fail?: boolean; prompt?: number; completion?: number } = {},
): LLMClient {
  const prompt = opts.prompt ?? 10
  const completion = opts.completion ?? 5
  const c: LLMClient = {
    model,
    onUsage: undefined,
    onCall: undefined,
    onRetry: undefined,
    async generate() {
      if (opts.fail) throw new Error(`${model} boom`)
      c.onUsage?.({ promptTokens: prompt, completionTokens: completion })
      c.onCall?.({ model, usedFallback: false })
      return 'ok'
    },
    async generateObject() {
      return {} as any
    },
  }
  return c
}

function wire(agent = 'TestAgent'): { tracker: LLMUsageTracker; entries: LlmUsageEntry[] } {
  const tracker = new LLMUsageTracker()
  const entries: LlmUsageEntry[] = []
  tracker.setCurrentAgent(agent)
  tracker.onCallRecorded = (e) => {
    entries.push(e)
  }
  return { tracker, entries }
}

test('一次成功呼叫只記一筆（primary，usedFallback=false）', async () => {
  const { tracker, entries } = wire()
  const llm = tracker.attach(new FallbackClient(stubClient('primary-m'), [stubClient('fb-m')]))
  await llm.generate('sys', 'hi')
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.agent, 'TestAgent')
  assert.equal(entries[0]!.model, 'primary-m')
  assert.equal(entries[0]!.usedFallback, false)
  assert.equal(entries[0]!.promptTokens, 10)
  assert.equal(entries[0]!.completionTokens, 5)
  assert.equal(entries[0]!.totalTokens, 15)
  assert.equal(tracker.getAgent('TestAgent')?.fallbackCalls, 0)
})

test('重試情境只記一筆（primary 失敗→備援成功，usedFallback=true）', async () => {
  const { tracker, entries } = wire()
  const llm = tracker.attach(
    new FallbackClient(stubClient('primary-m', { fail: true }), [stubClient('fb-m', { prompt: 7, completion: 3 })]),
  )
  await llm.generate('sys', 'hi')
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.model, 'fb-m')
  assert.equal(entries[0]!.usedFallback, true)
  assert.equal(entries[0]!.totalTokens, 10)
  assert.equal(tracker.getAgent('TestAgent')?.fallbackCalls, 1)
})

test('重試風暴只記一筆（primary＋tier1 皆失敗→tier2 成功）', async () => {
  const { tracker, entries } = wire()
  const llm = tracker.attach(
    new FallbackClient(stubClient('primary-m', { fail: true }), [
      stubClient('fb1-m', { fail: true }),
      stubClient('fb2-m', { prompt: 4, completion: 1 }),
    ]),
  )
  await llm.generate('sys', 'hi')
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.usedFallback, true)
  assert.equal(entries[0]!.model, 'fb2-m')
})

test('generateObject：primary 回壞 JSON＋備援成功只記一筆（#46 phantom row）', async () => {
  const origFetch = globalThis.fetch
  const okJson = (body: any) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  ;(globalThis as any).fetch = async (url: any) => {
    if (String(url).includes('primary.test')) {
      // HTTP 成功但內容非 JSON：舊碼會先記一筆 phantom row 再切備援
      return okJson({ choices: [{ message: { content: 'not-json{{{' } }], usage: { prompt_tokens: 100, completion_tokens: 20 } })
    }
    return okJson({ choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 50, completion_tokens: 10 } })
  }
  try {
    const { tracker, entries } = wire()
    const primary = new OpenAICompatibleClient({ provider: 'openai', model: 'm-primary', baseUrl: 'https://primary.test' })
    const fallback = new OpenAICompatibleClient({ provider: 'openai', model: 'm-fb', baseUrl: 'https://fallback.test' })
    const llm = tracker.attach(new FallbackClient(primary, [fallback]))
    const out = await llm.generateObject('sys', 'hi', z.object({ a: z.number() }))
    assert.deepEqual(out, { a: 1 })
    // 關鍵：只有備援成功那一筆，沒有 primary 的 phantom row
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.model, 'm-fb')
    assert.equal(entries[0]!.usedFallback, true)
    assert.equal(entries[0]!.promptTokens, 50)
    assert.equal(entries[0]!.completionTokens, 10)
    assert.equal(entries[0]!.totalTokens, 60)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('generateObject 驗證成功仍正常記錄（無迴歸）', async () => {
  const origFetch = globalThis.fetch
  ;(globalThis as any).fetch = async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: '{"a":2}' } }], usage: { prompt_tokens: 11, completion_tokens: 3 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  try {
    const { tracker, entries } = wire()
    const primary = new OpenAICompatibleClient({ provider: 'openai', model: 'm-primary', baseUrl: 'https://solo.test' })
    const llm = tracker.attach(new FallbackClient(primary, []))
    const out = await llm.generateObject('sys', 'hi', z.object({ a: z.number() }))
    assert.deepEqual(out, { a: 2 })
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.usedFallback, false)
    assert.equal(entries[0]!.totalTokens, 14)
  } finally {
    globalThis.fetch = origFetch
  }
})
