import test from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_KEYS } from '@stock/core'
import { createBullResearcher } from '../src/agents/researchers/bull.js'
import { createBearResearcher } from '../src/agents/researchers/bear.js'
import { createAggressiveDebator } from '../src/agents/risk/aggressive.js'
import { createConservativeDebator } from '../src/agents/risk/conservative.js'
import { createNeutralDebator } from '../src/agents/risk/neutral.js'
import { createResearchManager } from '../src/agents/managers/research.js'
import { createPortfolioManager } from '../src/agents/managers/portfolio.js'
import type { AnalysisState } from '@stock/core'
import type { LLMClient } from '../src/llm/client.js'

/** Issue #52：12 節點寫死順序（Bull↔Bear 一輪；風險三方各一次；不進後台）。 */

function stubGenerate(reply: string, capture?: { system?: string; prompt?: string }): LLMClient {
  return {
    model: 'stub',
    generate: async (system: string, prompt: string) => {
      if (capture) {
        capture.system = system
        capture.prompt = prompt
      }
      return reply
    },
    generateObject: async (_s: string, _p: string, _schema: any) => {
      throw new Error('stub generateObject not configured')
    },
  } as LLMClient
}

function baseState(): AnalysisState {
  return {
    ticker: '2330.TW',
    tradeDate: '2026-10-01',
    assetType: 'stock' as any,
    instrumentContext: 'instrument',
    pastContext: 'past',
    outputLanguage: 'zh-TW',
    outputInstruction: 'lang-instruction',
    marketReport: 'market',
    sentimentReport: 'sentiment',
    newsReport: 'news',
    fundamentalsReport: 'fundamentals',
    investDebate: {
      bullHistory: '',
      bearHistory: '',
      history: '',
      currentResponse: '',
      judgeDecision: '',
      round: 0,
    },
    investmentPlan: '',
    traderProposal: 'trader proposal: Buy with stop loss',
    riskDebate: {
      aggressiveHistory: '',
      conservativeHistory: '',
      neutralHistory: '',
      history: '',
      latestSpeaker: '',
      judgeDecision: '',
      round: 0,
    },
    finalDecision: '',
  }
}

// ─── AGENT_KEYS 順序 ─────────────────────────────────────────────

test('AGENT_KEYS - 12 節點寫死順序：Bear 在 Bull 之後、風險三方在 Trader 之後 Portfolio 之前', () => {
  assert.equal(AGENT_KEYS.length, 12)
  const idx = (k: string) => (AGENT_KEYS as readonly string[]).indexOf(k)
  assert.ok(idx('Bull Researcher') >= 0)
  assert.equal(idx('Bear Researcher'), idx('Bull Researcher') + 1)
  assert.equal(idx('Research Manager'), idx('Bear Researcher') + 1)
  assert.equal(idx('Aggressive Analyst'), idx('Trader') + 1)
  assert.equal(idx('Conservative Analyst'), idx('Aggressive Analyst') + 1)
  assert.equal(idx('Neutral Analyst'), idx('Conservative Analyst') + 1)
  assert.equal(idx('Portfolio Manager'), idx('Neutral Analyst') + 1)
})

// ─── Bull→Bear 一輪辯論 ─────────────────────────────────────────

test('Bull→Bear - 一輪辯論後 bullHistory／bearHistory 皆非空、round 遞增', async () => {
  let state = baseState()
  const bull = createBullResearcher(stubGenerate('看多：成長潛力強'))
  const bear = createBearResearcher(stubGenerate('看空：估值過高風險大'))

  state = { ...state, ...(await bull(state)) }
  assert.match(state.investDebate.bullHistory, /看多/)
  assert.equal(state.investDebate.round, 1)

  state = { ...state, ...(await bear(state)) }
  assert.match(state.investDebate.bearHistory, /看空/)
  assert.match(state.investDebate.history, /看多/)
  assert.match(state.investDebate.history, /看空/)
  assert.equal(state.investDebate.round, 2)
})

test('Bear - prompt 帶 outputInstruction（三語系）且回應多方論點', async () => {
  const capture: { system?: string; prompt?: string } = {}
  const state = {
    ...baseState(),
    investDebate: {
      ...baseState().investDebate,
      currentResponse: 'Bull Analyst: 成長潛力強',
      history: 'Bull Analyst: 成長潛力強',
      bullHistory: 'Bull Analyst: 成長潛力強',
      round: 1,
    },
  }
  const bear = createBearResearcher(stubGenerate('看空回應', capture))
  await bear(state)
  assert.match(capture.prompt ?? '', /Last bull argument/)
  assert.match(capture.prompt ?? '', /lang-instruction/)
})

// ─── 風險三方 ────────────────────────────────────────────────────

test('風險三方 - aggressive→conservative→neutral 各發言一次，history 三方皆非空', async () => {
  let state = baseState()
  const agg = createAggressiveDebator(stubGenerate('積極：放大部位'))
  const con = createConservativeDebator(stubGenerate('保守：縮小部位保本'))
  const neu = createNeutralDebator(stubGenerate('中性：適度部位平衡'))

  state = { ...state, ...(await agg(state)) }
  assert.equal(state.riskDebate.latestSpeaker, 'Aggressive')
  state = { ...state, ...(await con(state)) }
  assert.equal(state.riskDebate.latestSpeaker, 'Conservative')
  state = { ...state, ...(await neu(state)) }
  assert.equal(state.riskDebate.latestSpeaker, 'Neutral')

  assert.match(state.riskDebate.aggressiveHistory, /積極/)
  assert.match(state.riskDebate.conservativeHistory, /保守/)
  assert.match(state.riskDebate.neutralHistory, /中性/)
  assert.match(state.riskDebate.history, /積極/)
  assert.match(state.riskDebate.history, /保守/)
  assert.match(state.riskDebate.history, /中性/)
})

test('風險三方 - prompt 帶 outputInstruction（三語系）', async () => {
  for (const factory of [createAggressiveDebator, createConservativeDebator, createNeutralDebator]) {
    const capture: { system?: string; prompt?: string } = {}
    await factory(stubGenerate('reply', capture))(baseState())
    assert.match(capture.prompt ?? '', /lang-instruction/)
  }
})

// ─── Manager 綜合引用正反方 ─────────────────────────────────────

test('Research Manager - prompt 同時引用 bullHistory 與 bearHistory', async () => {
  let captured = ''
  const llm = {
    model: 'stub',
    generate: async () => {
      throw new Error('not used')
    },
    generateObject: async (_s: string, p: string, _schema: any) => {
      captured = p
      return { recommendation: 'Hold', rationale: '多空並陳', strategicActions: '觀望' }
    },
  } as unknown as LLMClient
  const state = {
    ...baseState(),
    investDebate: {
      ...baseState().investDebate,
      bullHistory: 'Bull Analyst: 成長潛力強勁',
      bearHistory: 'Bear Analyst: 估值過高風險',
    },
  }
  await createResearchManager(llm)(state)
  assert.match(captured, /成長潛力強勁/)
  assert.match(captured, /估值過高風險/)
})

test('Portfolio Manager - prompt 引用風險三方 history', async () => {
  let captured = ''
  const llm = {
    model: 'stub',
    generate: async () => {
      throw new Error('not used')
    },
    generateObject: async (_s: string, p: string, _schema: any) => {
      captured = p
      return { rating: 'Hold', executiveSummary: 'summary', investmentThesis: 'thesis' }
    },
  } as unknown as LLMClient
  const state = {
    ...baseState(),
    riskDebate: {
      ...baseState().riskDebate,
      aggressiveHistory: 'Aggressive Analyst: 放大部位',
      conservativeHistory: 'Conservative Analyst: 保本優先',
      neutralHistory: 'Neutral Analyst: 適度平衡',
      history: 'Aggressive Analyst: 放大部位\nConservative Analyst: 保本優先\nNeutral Analyst: 適度平衡',
    },
  }
  await createPortfolioManager(llm)(state)
  assert.match(captured, /放大部位/)
  assert.match(captured, /保本優先/)
  assert.match(captured, /適度平衡/)
})

// ─── 舊快照續跑相容 ─────────────────────────────────────────────

test('舊快照相容 - 缺 bearHistory／riskDebate 三方欄位時以預設兜底不炸', () => {
  // 模擬舊 job state_snapshot（只有 bullHistory，無 bearHistory 與 riskDebate 三方欄位）
  const defaultInvestDebate = {
    bullHistory: '',
    bearHistory: '',
    history: '',
    currentResponse: '',
    judgeDecision: '',
    round: 0,
  }
  const defaultRiskDebate = {
    aggressiveHistory: '',
    conservativeHistory: '',
    neutralHistory: '',
    history: '',
    latestSpeaker: '',
    judgeDecision: '',
    round: 0,
  }
  const oldSnapshot: any = {
    ticker: '2330.TW',
    investDebate: { bullHistory: 'Bull Analyst: 舊多方', history: 'Bull Analyst: 舊多方', round: 1 },
    riskDebate: { history: '', round: 0 },
  }
  // 與 engine.ts 相同的深合併語意
  const mergedInvest = { ...defaultInvestDebate, ...(oldSnapshot.investDebate ?? {}) }
  const mergedRisk = { ...defaultRiskDebate, ...(oldSnapshot.riskDebate ?? {}) }
  assert.equal(mergedInvest.bullHistory, 'Bull Analyst: 舊多方')
  assert.equal(mergedInvest.bearHistory, '')
  assert.equal(mergedRisk.aggressiveHistory, '')
  assert.equal(mergedRisk.conservativeHistory, '')
  assert.equal(mergedRisk.neutralHistory, '')
  // 續跑起點解析：舊 enabledAgents（8 節點）仍是新 AGENT_KEYS 子集
  const oldEnabled = [
    'Market Analyst',
    'Sentiment Analyst',
    'News Analyst',
    'Fundamentals Analyst',
    'Bull Researcher',
    'Research Manager',
    'Trader',
    'Portfolio Manager',
  ]
  const keySet = new Set<string>(AGENT_KEYS as readonly string[])
  assert.ok(oldEnabled.every((k) => keySet.has(k)))
})
