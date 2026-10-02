import test from 'node:test'
import assert from 'node:assert/strict'
import { runArenaRound } from '../src/arena/engine.js'
import {
  normalizeArenaDividendSymbol,
  arenaDividendAmount,
  arenaDividendWindow,
} from '../src/arena/dividends.js'
import type {
  ArenaStore,
  ArenaAgentRecord,
  ArenaHolding,
  ArenaDividendQuote,
  ArenaDividendCreditInput,
} from '../src/arena/store.js'

// Issue #54：競技場現金股利自動入帳（close 結算）。
// 關 LLM（close 段只跑結算＋快照，不需 strategist；discussion 亦關閉）。

process.env.ARENA_ENABLE_DISCUSSION = '0'

interface FakeCredit extends ArenaDividendCreditInput {}

function makeAgent(id: number, cash: number): ArenaAgentRecord {
  return {
    id,
    ownerUserId: '0',
    name: `agent${id}`,
    division: 'season',
    strategyId: 'dividend',
    tone: 'neutral',
    initialCapital: 500000,
    cash,
    status: 'active',
    lastRoundDate: null,
    seasonId: 1,
    seasonName: null,
    personality: null,
    strategyParams: { maxPositionPct: 30, stopLossPct: 15, minCashBufferPct: 5, maxTradesPerSlot: 3 },
  }
}

interface FakeStoreState {
  agents: Map<number, ArenaAgentRecord>
  holdings: Map<number, ArenaHolding[]>
  credits: FakeCredit[]
  snapshots: Array<{ agentId: number; roundDate: string; cash: number; equity: number }>
  /** 為 true 時 getDividendsInWindow 直接 throw（模擬缺快取）。 */
  blowUpDividends: boolean
  quotes: ArenaDividendQuote[]
}

/** 最小 ArenaStore 假實作（close 段所需＋股利 seam；其餘為空實作）。 */
function makeFakeStore(state: FakeStoreState): ArenaStore {
  return {
    async listActiveAgents() {
      return [...state.agents.values()]
    },
    async getHoldings(agentId: number) {
      return (state.holdings.get(agentId) ?? []).map((h) => ({ ...h }))
    },
    async replaceHoldings() {},
    async insertTrade() {},
    async getRoundTrades() {
      return []
    },
    async insertSnapshot(s) {
      state.snapshots.push({ agentId: s.agentId, roundDate: s.roundDate, cash: s.cash, equity: s.equity })
    },
    async advanceRound(agentId: number, roundDate: string, cash: number) {
      const a = state.agents.get(agentId)
      if (a) {
        a.cash = cash
        a.lastRoundDate = roundDate
      }
    },
    async saveIntradayPrices() {},
    async saveMarketBriefing() {},
    async getMarketBriefing() {
      return null
    },
    async insertDecisionLog() {},
    async saveDiscussion() {},
    async getDividendsInWindow(symbols: string[], from: string, to: string) {
      if (state.blowUpDividends) throw new Error('no cache file')
      return state.quotes.filter((q) => symbols.includes(q.symbol) && q.exDate >= from && q.exDate <= to)
    },
    async saveDividendCredit(c: ArenaDividendCreditInput) {
      const dup = state.credits.some(
        (r) => r.agentId === c.agentId && r.symbol === c.symbol && r.exDate === c.exDate,
      )
      if (dup) return false
      state.credits.push({ ...c })
      return true
    },
    async hasDividendCredit(agentId: number, symbol: string, exDate: string) {
      return state.credits.some((r) => r.agentId === agentId && r.symbol === symbol && r.exDate === exDate)
    },
  }
}

function baseParams(store: ArenaStore, roundDate: string) {
  return {
    store,
    strategist: { decide: async () => ({ decision: { actions: [] } }) } as any,
    prices: {},
    history: {},
    universe: [{ symbol: '2330', name: '台積電' }],
    roundDate,
    phase: 'close' as const,
  }
}

test('#54 symbol 正規化：去 .TW／.TWO，大寫', () => {
  assert.equal(normalizeArenaDividendSymbol('2330.TW'), '2330')
  assert.equal(normalizeArenaDividendSymbol('2330.TWO'), '2330')
  assert.equal(normalizeArenaDividendSymbol('2330'), '2330')
  assert.equal(normalizeArenaDividendSymbol('00400a'), '00400A')
  assert.equal(normalizeArenaDividendSymbol(' 2317.tw '), '2317')
})

test('#54 金額計算：round2(shares × cash_dividend)；非法回 0', () => {
  assert.equal(arenaDividendAmount(1000, 3.5), 3500)
  assert.equal(arenaDividendAmount(3, 0.333), 1)
  assert.equal(arenaDividendAmount(0, 3.5), 0)
  assert.equal(arenaDividendAmount(100, 0), 0)
  assert.equal(arenaDividendAmount(100, -1), 0)
})

test('#54 掃描窗：近 10 交易日（14 日曆天）含兩端', () => {
  assert.deepEqual(arenaDividendWindow('2026-09-30'), { from: '2026-09-16', to: '2026-09-30' })
})

test('#54 close：除息股持股現金增加＋credit 列正確', async () => {
  const state: FakeStoreState = {
    agents: new Map([[1, makeAgent(1, 100000)]]),
    holdings: new Map([[1, [{ symbol: '2330', shares: 1000, avgCost: 900 }]]]),
    credits: [],
    snapshots: [],
    blowUpDividends: false,
    quotes: [{ symbol: '2330', exDate: '2026-09-28', cashDividend: 3.5 }],
  }
  const res = await runArenaRound(baseParams(makeFakeStore(state), '2026-09-30'))
  assert.equal(res.errors.length, 0)
  // 100000 + round2(1000 × 3.5)
  assert.equal(state.agents.get(1)!.cash, 103500)
  assert.equal(state.credits.length, 1)
  assert.deepEqual(
    { agentId: 1, symbol: '2330', exDate: '2026-09-28', shares: 1000, amount: 3500 },
    { ...state.credits[0] },
  )
  // 快照 cash 連動（equity＝cash，因無收盤價）
  assert.equal(state.snapshots.length, 1)
  assert.equal(state.snapshots[0]!.cash, 103500)
})

test('#54 冪等：重跑 close 不重複發', async () => {
  const state: FakeStoreState = {
    agents: new Map([[1, makeAgent(1, 100000)]]),
    holdings: new Map([[1, [{ symbol: '2330', shares: 1000, avgCost: 900 }]]]),
    credits: [],
    snapshots: [],
    blowUpDividends: false,
    quotes: [{ symbol: '2330', exDate: '2026-09-28', cashDividend: 3.5 }],
  }
  const store = makeFakeStore(state)
  await runArenaRound(baseParams(store, '2026-09-30'))
  assert.equal(state.agents.get(1)!.cash, 103500)
  await runArenaRound(baseParams(store, '2026-09-30'))
  assert.equal(state.agents.get(1)!.cash, 103500)
  assert.equal(state.credits.length, 1)
})

test('#54 缺快取跳過：查詢炸掉不擋快照', async () => {
  const state: FakeStoreState = {
    agents: new Map([[1, makeAgent(1, 100000)]]),
    holdings: new Map([[1, [{ symbol: '2330', shares: 1000, avgCost: 900 }]]]),
    credits: [],
    snapshots: [],
    blowUpDividends: true,
    quotes: [],
  }
  const res = await runArenaRound(baseParams(makeFakeStore(state), '2026-09-30'))
  assert.equal(res.errors.length, 0)
  assert.equal(state.agents.get(1)!.cash, 100000)
  assert.equal(state.credits.length, 0)
  assert.equal(state.snapshots.length, 1)
})

test('#54 賣出後不再發：結算時無持股即跳過', async () => {
  const state: FakeStoreState = {
    agents: new Map([[1, makeAgent(1, 100000)]]),
    holdings: new Map([[1, []]]),
    credits: [],
    snapshots: [],
    blowUpDividends: false,
    quotes: [{ symbol: '2330', exDate: '2026-09-28', cashDividend: 3.5 }],
  }
  await runArenaRound(baseParams(makeFakeStore(state), '2026-09-30'))
  assert.equal(state.agents.get(1)!.cash, 100000)
  assert.equal(state.credits.length, 0)
})

test('#54 窗外不追溯：舊除息日不發', async () => {
  const state: FakeStoreState = {
    agents: new Map([[1, makeAgent(1, 100000)]]),
    holdings: new Map([[1, [{ symbol: '2330', shares: 1000, avgCost: 900 }]]]),
    credits: [],
    snapshots: [],
    blowUpDividends: false,
    quotes: [{ symbol: '2330', exDate: '2026-08-01', cashDividend: 3.5 }],
  }
  await runArenaRound(baseParams(makeFakeStore(state), '2026-09-30'))
  assert.equal(state.agents.get(1)!.cash, 100000)
  assert.equal(state.credits.length, 0)
})

test('#54 持股 .TW 尾綴仍對得上快取無尾綴代號', async () => {
  const state: FakeStoreState = {
    agents: new Map([[1, makeAgent(1, 50000)]]),
    holdings: new Map([[1, [{ symbol: '2330.TW', shares: 100, avgCost: 900 }]]]),
    credits: [],
    snapshots: [],
    blowUpDividends: false,
    quotes: [{ symbol: '2330', exDate: '2026-09-29', cashDividend: 2 }],
  }
  await runArenaRound(baseParams(makeFakeStore(state), '2026-09-30'))
  assert.equal(state.agents.get(1)!.cash, 50200)
  assert.equal(state.credits.length, 1)
  assert.equal(state.credits[0]!.symbol, '2330')
})
