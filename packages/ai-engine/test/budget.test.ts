import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FALLBACK_SAFE_MAX_TOKENS,
  chunkByOutputBudget,
  mergeChunkEntries,
  DEFAULT_CHAIN_PACE_MS,
  DEFAULT_SUMMARY_PACE_MS,
  RETRY_BUDGET_FLOOR_TOKENS,
  getChainPaceMs,
  getSummaryPaceMs,
  jitterDelay,
  shrinkBudgetForRetry,
  DEFAULT_META_PACE_MS,
  DEFAULT_META_RETRY_BASE_MS,
  META_RETRY_MAX_MS,
  META_RETRY_MAX_ATTEMPTS,
  getMetaPaceMs,
  getMetaRetryBaseMs,
  isMetaRateLimit,
  isMetaTransient,
  getMetaBackoffMs,
  META_SPAM_SUBCODE_2207051,
  MetaSpamSuspectedError,
  extractMetaError,
  isMetaSpamSuspected,
  isSocialEditionTime,
  getNextSocialEditionAt,
} from '../src/llm/budget.js'

// ─── FALLBACK_SAFE_MAX_TOKENS ────────────────────────────────────

test('FALLBACK_SAFE_MAX_TOKENS equals 1000', () => {
  assert.equal(FALLBACK_SAFE_MAX_TOKENS, 1000)
})

// ─── chunkByOutputBudget ─────────────────────────────────────────

test('chunkByOutputBudget - 空陣列回傳 []', () => {
  const result = chunkByOutputBudget([], 100, () => 10, 10)
  assert.deepEqual(result, [])
})

test('chunkByOutputBudget - 單筆估算即超 budget 時仍自成一批', () => {
  // estimate=200 exceeds budget=100, still produces sole-element batch
  const items = ['a']
  const result = chunkByOutputBudget(items, 100, () => 200, 10)
  assert.equal(result.length, 1)
  assert.deepEqual(result[0], ['a'])
})

test('chunkByOutputBudget - 多筆貪婪合批恆滿足 Σestimate + baseOverhead ≤ budget', () => {
  // budget=150, baseOverhead=10, each item estimate=20
  // effective budget per chunk = 150 - 10 = 140 → 7 items per chunk
  const items = Array.from({ length: 20 }, (_, i) => i)
  const budget = 150
  const baseOverhead = 10
  const result = chunkByOutputBudget(items, budget, () => 20, baseOverhead)

  // 20 items / 7 per chunk = 2 full chunks (7+7) + 1 partial (6 items)
  assert.equal(result.length, 3)
  assert.deepEqual(result[0], [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(result[1], [7, 8, 9, 10, 11, 12, 13])
  assert.deepEqual(result[2], [14, 15, 16, 17, 18, 19])

  // Verify invariant for EVERY chunk
  for (const chunk of result) {
    const totalEstimate = chunk.length * 20
    assert.ok(
      totalEstimate + baseOverhead <= budget,
      `Chunk of size ${chunk.length}: ${totalEstimate} + ${baseOverhead} = ${totalEstimate + baseOverhead} > ${budget}`,
    )
  }
})

test('chunkByOutputBudget - 不同 estimate 函數正確計算', () => {
  // Variable estimates: items [10, 30, 20, 50, 10, 40]
  // budget=100, overhead=0
  // greedy: 10+30+20=60 ≤100, +50=110 >100 → chunk1=[10,30,20]
  //         50+10=60, +40=100 ≤100 → chunk2=[50,10,40]
  const items = [10, 30, 20, 50, 10, 40]
  const result = chunkByOutputBudget(items, 100, (x) => x, 0)
  assert.equal(result.length, 2)
  assert.deepEqual(result[0], [10, 30, 20])
  assert.deepEqual(result[1], [50, 10, 40])
})

// ─── mergeChunkEntries ──────────────────────────────────────────

test('mergeChunkEntries - offset 合併正確', () => {
  const dst = new Map<number, string>()
  mergeChunkEntries(dst, [
    { index: 0, value: 'a' },
    { index: 1, value: 'b' },
  ], 5)
  assert.equal(dst.get(5), 'a')
  assert.equal(dst.get(6), 'b')
  assert.equal(dst.size, 2)
})

test('mergeChunkEntries - 既有 key 被批次值覆寫', () => {
  const dst = new Map<number, string>([[10, 'old']])
  mergeChunkEntries(dst, [{ index: 0, value: 'new' }], 10)
  assert.equal(dst.get(10), 'new')
})

test('mergeChunkEntries - 模型缺漏的 index 不移除既有值', () => {
  const dst = new Map<number, string>([
    [0, 'keep0'],
    [2, 'keep2'],
  ])
  // Batch only provides index=1 (offset=0)
  mergeChunkEntries(dst, [{ index: 1, value: 'batch1' }], 0)
  assert.equal(dst.get(0), 'keep0')
  assert.equal(dst.get(1), 'batch1')
  assert.equal(dst.get(2), 'keep2')
  assert.equal(dst.size, 3)
})

test('mergeChunkEntries - 空 entries 不影響既有值', () => {
  const dst = new Map<number, string>([[0, 'existing']])
  mergeChunkEntries(dst, [], 0)
  assert.equal(dst.size, 1)
  assert.equal(dst.get(0), 'existing')
})

test('mergeChunkEntries - 多次合併正確累加', () => {
  const dst = new Map<number, string>()
  // First chunk: items 0-2 (offset=0)
  mergeChunkEntries(dst, [
    { index: 0, value: 's0' },
    { index: 1, value: 's1' },
  ], 0)
  // Second chunk: items 3-5 (offset=3), only provides index 0 and 2
  mergeChunkEntries(dst, [
    { index: 0, value: 's3' },
    { index: 2, value: 's5' },
  ], 3)
  assert.equal(dst.get(0), 's0')
  assert.equal(dst.get(1), 's1')
  assert.equal(dst.get(3), 's3')
  assert.equal(dst.get(5), 's5')
  assert.equal(dst.size, 4)
  // index 4 (from second chunk, local 1) is missing — not in dst
  assert.equal(dst.has(4), false)
})

// ─── Issue #32：jitterDelay（退避 ±25%，避免對齊同分鐘窗）────────────

test('jitterDelay - 輸出恆落在 base ±25% 內', () => {
  for (let i = 0; i < 200; i++) {
    const w = jitterDelay(10_000)
    assert.ok(w >= 7500 && w <= 12_500, `jitter out of range: ${w}`)
  }
})

test('jitterDelay - 可注入 random（確定性）', () => {
  assert.equal(jitterDelay(1000, () => 0), 750)
  assert.equal(jitterDelay(1000, () => 0.5), 1000)
  assert.equal(jitterDelay(1000, () => 1), 1250)
})

test('jitterDelay - 非正數 base 回傳 0', () => {
  assert.equal(jitterDelay(0), 0)
  assert.equal(jitterDelay(-5), 0)
})

// ─── Issue #32：shrinkBudgetForRetry（執行期自適應縮 budget）──────────

test('shrinkBudgetForRetry - 每次 ×0.6', () => {
  assert.equal(shrinkBudgetForRetry(1000), 600)
  assert.equal(shrinkBudgetForRetry(600), 360)
  assert.equal(shrinkBudgetForRetry(360), 216)
})

test('shrinkBudgetForRetry - floor 鎖底（預設 200），低於 floor 不再縮', () => {
  assert.equal(RETRY_BUDGET_FLOOR_TOKENS, 200)
  assert.equal(shrinkBudgetForRetry(300), 200)
  assert.equal(shrinkBudgetForRetry(200), 200)
  assert.equal(shrinkBudgetForRetry(150), 150)
})

// ─── Issue #32：錯峰間隔（env 覆寫／預設）─────────────────────────────

test('getChainPaceMs/getSummaryPaceMs - 預設值', () => {
  assert.equal(DEFAULT_CHAIN_PACE_MS, 8000)
  assert.equal(DEFAULT_SUMMARY_PACE_MS, 20000)
  assert.equal(getChainPaceMs({}), 8000)
  assert.equal(getSummaryPaceMs({}), 20000)
})

test('getChainPaceMs/getSummaryPaceMs - env 覆寫與非法值回退', () => {
  assert.equal(getChainPaceMs({ LLM_CHAIN_PACE_MS: '1000' }), 1000)
  assert.equal(getChainPaceMs({ LLM_CHAIN_PACE_MS: 'abc' }), 8000)
  assert.equal(getChainPaceMs({ LLM_CHAIN_PACE_MS: '-5' }), 8000)
  assert.equal(getSummaryPaceMs({ LLM_SUMMARY_PACE_MS: '60000' }), 60000)
  assert.equal(getSummaryPaceMs({ LLM_SUMMARY_PACE_MS: '' }), 20000)
})

// ─── Issue #58：Meta 節流（錯峰間隔＋退避序列＋限流判定）──────────────

test('getMetaPaceMs/getMetaRetryBaseMs - 預設值與 env 覆寫', () => {
  assert.equal(DEFAULT_META_PACE_MS, 5000)
  assert.equal(DEFAULT_META_RETRY_BASE_MS, 15_000)
  assert.equal(META_RETRY_MAX_ATTEMPTS, 3)
  assert.equal(getMetaPaceMs({}), 5000)
  assert.equal(getMetaRetryBaseMs({}), 15_000)
  assert.equal(getMetaPaceMs({ META_PACE_MS: '1000' }), 1000)
  assert.equal(getMetaPaceMs({ META_PACE_MS: 'abc' }), 5000)
  assert.equal(getMetaRetryBaseMs({ META_RETRY_BASE_MS: '100' }), 100)
  assert.equal(getMetaRetryBaseMs({ META_RETRY_BASE_MS: '' }), 15_000)
})

test('getMetaBackoffMs - 退避序列：base×2^n（random=0.5 時 jitter 係數為 1，無偏移）', () => {
  const half = () => 0.5
  const env = { META_RETRY_BASE_MS: '15000' }
  assert.equal(getMetaBackoffMs(0, env, half), 15_000)
  assert.equal(getMetaBackoffMs(1, env, half), 30_000)
  assert.equal(getMetaBackoffMs(2, env, half), 60_000)
  assert.equal(getMetaBackoffMs(3, env, half), 120_000)
})

test('getMetaBackoffMs - 封頂 META_RETRY_MAX_MS；非法 attempt 視為 0', () => {
  const half = () => 0.5
  assert.equal(META_RETRY_MAX_MS, 600_000)
  assert.equal(getMetaBackoffMs(99, {}, half), 600_000)
  assert.equal(getMetaBackoffMs(-1, { META_RETRY_BASE_MS: '1000' }, half), 1000)
  assert.equal(getMetaBackoffMs(Number.NaN, { META_RETRY_BASE_MS: '1000' }, half), 1000)
})

test('isMetaRateLimit - HTTP 429／Graph 限流碼／限流訊息才判 true', () => {
  assert.equal(isMetaRateLimit(429), true)
  assert.equal(isMetaRateLimit(400, { error: { code: 4, message: 'Application request limit reached' } }), true)
  assert.equal(isMetaRateLimit(400, { error: { code: 17, message: 'User request limit reached' } }), true)
  assert.equal(isMetaRateLimit(400, { error: { code: 32 } }), true)
  assert.equal(isMetaRateLimit(400, { error: { code: 613 } }), true)
  assert.equal(isMetaRateLimit(500, { error: { message: 'Calls to this api have exceeded the rate limit.' } }), true)
  assert.equal(isMetaRateLimit(200), false)
  assert.equal(isMetaRateLimit(400, { error: { code: 190, message: 'Invalid OAuth access token' } }), false)
  assert.equal(isMetaRateLimit(500, { error: { message: 'Internal error' } }), false)
  assert.equal(isMetaRateLimit(400, null), false)
})

// ─── Issue #59：isMetaTransient（暫態錯誤分類）────────────────────────

test('isMetaTransient - HTTP 5xx 即判 true（不看 body）', () => {
  assert.equal(isMetaTransient(500, { error: { message: 'Internal error' } }), true)
  assert.equal(isMetaTransient(502), true)
  assert.equal(isMetaTransient(503, null), true)
  assert.equal(isMetaTransient(599), true)
  assert.equal(isMetaTransient(400, null), false)
  assert.equal(isMetaTransient(429), false)
  assert.equal(isMetaTransient(200), false)
})

test('isMetaTransient - Graph code -1 即判 true', () => {
  assert.equal(isMetaTransient(400, { error: { code: -1, message: 'Fatal' } }), true)
  assert.equal(isMetaTransient(400, { error: { code: -1 } }), true)
  assert.equal(isMetaTransient(400, { error: { code: 190, message: 'Invalid OAuth access token' } }), false)
})

test('isMetaTransient - message 含 Fatal（大小寫皆可）即判 true', () => {
  assert.equal(isMetaTransient(400, { error: { code: 1, message: 'Fatal error occurred' } }), true)
  assert.equal(isMetaTransient(400, { error: { message: 'FATAL' } }), true)
  assert.equal(isMetaTransient(400, { error: { message: 'fatal' } }), true)
  assert.equal(isMetaTransient(400, { error: { message: 'Internal error' } }), false)
})

test('isMetaTransient - is_transient=true 即判 true', () => {
  assert.equal(isMetaTransient(400, { error: { code: 1, message: 'busy', is_transient: true } }), true)
  assert.equal(isMetaTransient(400, { error: { code: 1, message: 'busy' } }), false)
})

test('isMetaTransient - 真 4xx（190／100／2207040）一律 false', () => {
  assert.equal(isMetaTransient(400, { error: { code: 190, message: 'Invalid OAuth access token' } }), false)
  assert.equal(isMetaTransient(400, { error: { code: 100, message: 'Invalid parameter' } }), false)
  assert.equal(isMetaTransient(400, { error: { code: 2207040, message: 'Content violates policy' } }), false)
})

// ─── Issue #62：2207051 疑似洗版分類（走冷卻，不走熱重試）─────────────

test('META_SPAM_SUBCODE_2207051 equals 2207051', () => {
  assert.equal(META_SPAM_SUBCODE_2207051, 2207051)
})

test('isMetaSpamSuspected - code=4＋subcode=2207051 即判 true', () => {
  assert.equal(
    isMetaSpamSuspected(403, { error: { code: 4, error_subcode: 2207051, message: 'suspected spam' } }),
    true,
  )
  assert.equal(isMetaSpamSuspected(400, { error: { code: 4, error_subcode: 2207051 } }), true)
})

test('isMetaSpamSuspected - wrapped／雙層 error.error 照樣命中', () => {
  const wrapped = { error: { error: { code: 4, error_subcode: 2207051, message: 'suspected spam' } } }
  assert.equal(isMetaSpamSuspected(403, wrapped as never), true)
  const extracted = extractMetaError(wrapped as never)
  assert.equal(extracted.code, 4)
  assert.equal(extracted.subcode, 2207051)
})

test('isMetaSpamSuspected - 其餘 code=4（無／錯 subcode）一律 false（維持 #58 限流）', () => {
  assert.equal(isMetaSpamSuspected(403, { error: { code: 4, message: 'Application request limit reached' } }), false)
  assert.equal(isMetaSpamSuspected(403, { error: { code: 4, error_subcode: 2207085 } }), false)
  assert.equal(isMetaSpamSuspected(400, { error: { code: -1, message: 'Fatal' } }), false)
  assert.equal(isMetaSpamSuspected(400, { error: { code: 190, message: 'Invalid OAuth access token' } }), false)
  assert.equal(isMetaSpamSuspected(400, null), false)
  assert.equal(isMetaSpamSuspected(200), false)
})

test('isMetaSpamSuspected - 2207085 不命中（維持 #59 熱重試）', () => {
  assert.equal(isMetaSpamSuspected(400, { error: { code: -1, error_subcode: 2207085, message: 'Fatal' } }), false)
})

test('MetaSpamSuspectedError - name/subcode 正確', () => {
  const err = new MetaSpamSuspectedError('spam suspected, subcode 2207051')
  assert.ok(err instanceof Error)
  assert.equal(err.name, 'MetaSpamSuspectedError')
  assert.equal(err.subcode, 2207051)
  assert.match(err.message, /2207051/)
})

test('extractMetaError - 平面／空 body 不報錯', () => {
  assert.deepEqual(extractMetaError(null), { code: null, subcode: null, message: '' })
  assert.deepEqual(extractMetaError({ error: { code: 4 } }), { code: 4, subcode: null, message: '' })
})

// ─── Issue #62：社群降頻（僅 00 UTC）＋下一 00 UTC 到期 ────────────────
// Issue #79：isSocialEditionTime 已標 @deprecated（gate 改走 DB），以下斷言僅
// 鎖定「舊函式行為不變、引用不斷」，新程式碼請勿使用；getNextSocialEditionAt
// 維持不動（social-publish.ts next_retry_at 仍依賴它）。

test('isSocialEditionTime - 僅 UTC 0 時回 true（deprecated 行為凍結）', () => {
  assert.equal(isSocialEditionTime(new Date('2026-10-13T00:00:00Z')), true)
  assert.equal(isSocialEditionTime(new Date('2026-10-13T00:59:59Z')), true)
  assert.equal(isSocialEditionTime(new Date('2026-10-13T06:00:00Z')), false)
  assert.equal(isSocialEditionTime(new Date('2026-10-13T12:00:00Z')), false)
  assert.equal(isSocialEditionTime(new Date('2026-10-13T18:00:00Z')), false)
  assert.equal(isSocialEditionTime(new Date('2026-10-13T23:59:59Z')), false)
})

test('getNextSocialEditionAt - 下一個 00 UTC（嚴格大於 from）', () => {
  assert.equal(
    getNextSocialEditionAt(new Date('2026-10-12T05:00:00Z')).toISOString(),
    '2026-10-13T00:00:00.000Z',
  )
  assert.equal(
    getNextSocialEditionAt(new Date('2026-10-12T23:59:00Z')).toISOString(),
    '2026-10-13T00:00:00.000Z',
  )
  // 00 UTC 執行中產生的 deferred 排到「明天」，不會被同一輪 redrive 撿走
  assert.equal(
    getNextSocialEditionAt(new Date('2026-10-13T00:00:05Z')).toISOString(),
    '2026-10-14T00:00:00.000Z',
  )
  assert.equal(
    getNextSocialEditionAt(new Date('2026-10-13T00:00:00.000Z')).toISOString(),
    '2026-10-14T00:00:00.000Z',
  )
})
