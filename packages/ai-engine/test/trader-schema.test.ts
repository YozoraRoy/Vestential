import test from 'node:test'
import assert from 'node:assert/strict'
import { TraderProposalSchema, createTrader } from '../src/agents/managers/trader.js'
import type { AnalysisState } from '@stock/core'
import type { LLMClient } from '../src/llm/client.js'

/** Issue #53：Trader schema 放寬 — invalidation／tranches 接受 string｜string[]。
 *  Fixture 取材自 #52 主 agent 補驗 comment：模型對兩欄位回傳 array（舊 schema 要 string 而拋錯）。 */

const failedRawOutput = {
  action: 'Buy',
  reasoning: '基本面穩健，技術面回測支撐，值得分批布局。',
  entryRangeLow: 1180,
  entryRangeHigh: 1220,
  stopLoss: 1150,
  invalidation: ['日收盤跌破支撐 1150', '催化劑未能兌現：營收連兩季衰退'],
  tranches: ['首批 50% 現價進場', '第二批 50% 回測支撐 1180 加碼'],
  maxPositionPct: 10,
}

function baseState(): AnalysisState {
  return {
    ticker: '2330.TW',
    tradeDate: '2026-10-01',
    instrumentContext: 'instrument',
    investmentPlan: 'plan',
    outputLanguage: 'zh-TW',
    outputInstruction: 'lang-instruction',
  } as AnalysisState
}

/** 模擬真實 generateObject 行為：以 zod schema 解析模型 raw output，通過才回傳。 */
function stubValidatingLLM(raw: unknown): LLMClient {
  return {
    model: 'stub',
    generate: async () => {
      throw new Error('not used')
    },
    generateObject: async (_s: string, _p: string, schema: any) => schema.parse(raw),
  } as LLMClient
}

test('Issue #53：曾失敗的 array 輸出能通過新 schema，且轉為字串', () => {
  const parsed = TraderProposalSchema.parse(failedRawOutput)
  assert.equal(typeof parsed.invalidation, 'string')
  assert.equal(typeof parsed.tranches, 'string')
  assert.match(parsed.invalidation as string, /日收盤跌破支撐/)
  assert.match(parsed.invalidation as string, /催化劑未能兌現/)
  assert.match(parsed.tranches as string, /首批 50%/)
  assert.match(parsed.tranches as string, /第二批 50%/)
})

test('Issue #53：string 輸入照舊通過（原語意不變）', () => {
  const parsed = TraderProposalSchema.parse({
    ...failedRawOutput,
    invalidation: '日收盤跌破支撐即出場',
    tranches: '分兩批：首批 50% 現價，第二批 50% 回測支撐',
  })
  assert.equal(parsed.invalidation, '日收盤跌破支撐即出場')
  assert.equal(parsed.tranches, '分兩批：首批 50% 現價，第二批 50% 回測支撐')
})

test('Issue #53：缺欄位（undefined）仍可選通過', () => {
  const { invalidation: _i, tranches: _t, ...rest } = failedRawOutput
  const parsed = TraderProposalSchema.parse(rest)
  assert.equal(parsed.invalidation, undefined)
  assert.equal(parsed.tranches, undefined)
})

test('Issue #53 續作：物件陣列 tranches 轉為可讀字串且含關鍵資訊', () => {
  const parsed = TraderProposalSchema.parse({
    ...failedRawOutput,
    tranches: [
      { trigger: '現價直接進場', sizePct: 50 },
      { percentage: 50, triggerPrice: 1180, description: '回測支撐 1180 加碼' },
    ],
  })
  assert.equal(typeof parsed.tranches, 'string')
  assert.match(parsed.tranches as string, /現價直接進場/)
  assert.match(parsed.tranches as string, /50/)
  assert.match(parsed.tranches as string, /1180/)
  assert.match(parsed.tranches as string, /回測支撐 1180 加碼/)
})

test('Issue #53 續作：未知形狀物件陣列以 JSON 兜底，不拋錯', () => {
  const parsed = TraderProposalSchema.parse({
    ...failedRawOutput,
    tranches: [{ foo: 'bar' }],
  })
  assert.equal(typeof parsed.tranches, 'string')
  assert.match(parsed.tranches as string, /bar/)
})

test('Issue #53：number／object／null／非字串非物件陣列仍拒絕', () => {
  for (const bad of [123, { cond: 'x' }, null, true, [1, 2], ['ok', 123], [null]]) {
    assert.throws(() => TraderProposalSchema.parse({ ...failedRawOutput, invalidation: bad }))
    assert.throws(() => TraderProposalSchema.parse({ ...failedRawOutput, tranches: bad }))
  }
})

test('Issue #53：端到端 — array 經 createTrader 組裝後下游 traderProposal 仍為字串', async () => {
  const trader = createTrader(stubValidatingLLM(failedRawOutput))
  const result = await trader(baseState())
  assert.equal(typeof result.traderProposal, 'string')
  assert.match(result.traderProposal as string, /\*\*Invalidation\*\*/)
  assert.match(result.traderProposal as string, /日收盤跌破支撐/)
  assert.match(result.traderProposal as string, /\*\*Phased Entry\*\*/)
  assert.match(result.traderProposal as string, /首批 50%/)
})

test('Issue #53：端到端 — 非法型別仍拋錯（partial 可觀測，不吞錯）', async () => {
  const trader = createTrader(stubValidatingLLM({ ...failedRawOutput, invalidation: 123 }))
  await assert.rejects(() => trader(baseState()))
})
