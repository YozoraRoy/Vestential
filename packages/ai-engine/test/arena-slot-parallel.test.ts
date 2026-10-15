import test from 'node:test'
import assert from 'node:assert/strict'
import { runArenaRound, arenaSlotConcurrency, arenaAgentTimeoutMs } from '../src/arena/engine.js'
import type { ArenaStore, ArenaAgentRecord, ArenaHolding } from '../src/arena/store.js'

// Issue #80：slot 段曾逐 agent 串行＋無單 agent 超時，三連掛 watchdog 12min。
// 改為限並行 decide＋單 agent 超時（HOLD＋error 繼續）、persist 串行。

function makeAgent(id: number): ArenaAgentRecord {
  return {
    id,
    ownerUserId: '0',
    name: `agent${id}`,
    division: 'season',
    strategyId: 'trend',
    tone: 'neutral',
    initialCapital: 500000,
    cash: 500000,
    status: 'active',
    lastRoundDate: null,
    seasonId: 1,
    seasonName: null,
    personality: null,
    strategyParams: { maxPositionPct: 30, stopLossPct: 15, minCashBufferPct: 5, maxTradesPerSlot: 3 },
  }
}

function makeFakeStore(ids: number[], log: string[]): ArenaStore {
  const agents = new Map(ids.map((id) => [id, makeAgent(id)]))
  return {
    async listActiveAgents() {
      return [...agents.values()]
    },
    async getHoldings() {
      return [] as ArenaHolding[]
    },
    async replaceHoldings() {},
    async insertTrade() {},
    async getRoundTrades() {
      return []
    },
    async insertSnapshot() {},
    async advanceRound() {},
    async saveIntradayPrices() {},
    async saveMarketBriefing() {},
    async getMarketBriefing() {
      return null
    },
    async insertDecisionLog(r) {
      log.push(`decision:${r.agentId}:${r.phase}`)
    },
    async saveDiscussion() {},
    async getDividendsInWindow() {
      return []
    },
    async saveDividendCredit() {
      return false
    },
    async hasDividendCredit() {
      return false
    },
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function slotParams(store: ArenaStore, strategist: { decide: (...args: never[]) => Promise<never> }) {
  return {
    store,
    strategist: strategist as never,
    prices: { '2330': { symbol: '2330', symbolName: '台積電', price: 1000, date: '2026-10-15' } },
    history: {},
    universe: [{ symbol: '2330', name: '台積電' }],
    roundDate: '2026-10-15',
    phase: 'slot' as const,
    slotIndex: 0,
    liveMark: { '2330': 1000 },
  }
}

test('#80 並行上限：預設 3、env 可調、鉗制 1..8', () => {
  const env = process.env
  delete env.ARENA_SLOT_CONCURRENCY
  assert.equal(arenaSlotConcurrency(), 3)
  assert.equal(arenaSlotConcurrency({ ARENA_SLOT_CONCURRENCY: '2' } as never), 2)
  assert.equal(arenaSlotConcurrency({ ARENA_SLOT_CONCURRENCY: '0' } as never), 1)
  assert.equal(arenaSlotConcurrency({ ARENA_SLOT_CONCURRENCY: '99' } as never), 8)
  assert.equal(arenaSlotConcurrency({ ARENA_SLOT_CONCURRENCY: 'abc' } as never), 3)
})

test('#80 單 agent 超時：預設 150s、下限 1s、env 可調', () => {
  delete process.env.ARENA_AGENT_TIMEOUT_MS
  assert.equal(arenaAgentTimeoutMs(), 150_000)
  assert.equal(arenaAgentTimeoutMs({ ARENA_AGENT_TIMEOUT_MS: '2000' } as never), 2000)
  assert.equal(arenaAgentTimeoutMs({ ARENA_AGENT_TIMEOUT_MS: '1000' } as never), 1000)
  assert.equal(arenaAgentTimeoutMs({ ARENA_AGENT_TIMEOUT_MS: '10' } as never), 150_000)
  assert.equal(arenaAgentTimeoutMs({ ARENA_AGENT_TIMEOUT_MS: 'abc' } as never), 150_000)
})

test('#80 卡住的 agent 不拖死整段（HOLD＋error，限時內完成）', async () => {
  process.env.ARENA_AGENT_TIMEOUT_MS = '1500'
  process.env.ARENA_SLOT_CONCURRENCY = '3'
  try {
    const log: string[] = []
    const store = makeFakeStore([1, 2, 3], log)
    const strategist = {
      decide: async (ctx: { agent: { id: number } }) => {
        if (ctx.agent.id === 2) await new Promise(() => {}) // 永遠卡住（不佔 timer，進程可正常退出）
        return { decision: { actions: [] }, model: 'fake', fallbackUsed: false, error: undefined }
      },
    }
    const t0 = Date.now()
    const res = await runArenaRound(slotParams(store, strategist))
    const elapsed = Date.now() - t0
    assert.equal(res.processed, 3)
    assert.equal(res.phase, 'slot')
    assert.ok(elapsed < 12_000, `整段應遠小於 12min，實際 ${(elapsed / 1000).toFixed(1)}s`)
    assert.ok(res.errors.some((e) => e.includes('agent#2')), `agent#2 應記 error：${JSON.stringify(res.errors)}`)
    // persist 串行且保序
    assert.deepEqual(
      log.filter((l) => l.endsWith(':trade')),
      ['decision:1:trade', 'decision:2:trade', 'decision:3:trade'],
    )
  } finally {
    delete process.env.ARENA_AGENT_TIMEOUT_MS
    delete process.env.ARENA_SLOT_CONCURRENCY
  }
})

test('#80 decide 真並行（4 agent×300ms，並行 2 約 600ms 而非 1200ms）', async () => {
  process.env.ARENA_AGENT_TIMEOUT_MS = '30000'
  process.env.ARENA_SLOT_CONCURRENCY = '2'
  try {
    let inFlight = 0
    let maxFlight = 0
    const store = makeFakeStore([1, 2, 3, 4], [])
    const strategist = {
      decide: async () => {
        inFlight++
        maxFlight = Math.max(maxFlight, inFlight)
        await sleep(300)
        inFlight--
        return { decision: { actions: [] }, model: 'fake', fallbackUsed: false, error: undefined }
      },
    }
    const t0 = Date.now()
    const res = await runArenaRound(slotParams(store, strategist))
    const elapsed = Date.now() - t0
    assert.equal(res.processed, 4)
    assert.equal(res.errors.length, 0)
    assert.ok(maxFlight >= 2, `應觀測到並行，實際 maxFlight=${maxFlight}`)
    assert.ok(elapsed < 1000, `並行應約 600ms，實際 ${elapsed}ms`)
  } finally {
    delete process.env.ARENA_AGENT_TIMEOUT_MS
    delete process.env.ARENA_SLOT_CONCURRENCY
  }
})
