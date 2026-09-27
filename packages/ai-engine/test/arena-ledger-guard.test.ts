import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyArenaDecision,
  ARENA_GUARD_CUMULATIVE_PREFIX,
  ARENA_GUARD_NEGATIVE_PROCEEDS_REASON,
  isArenaGuardRejection,
} from '../src/arena/ledger.js'

// Issue #40：競技場現金下限守衛（總量預扣＋成交對帳，cash 恆 ≥ 0）。

const CLOSES_5 = { '2330': 1000, '2317': 500, '2454': 500, '2303': 500, '2412': 500 }

test('#40 同輪多筆買單總額超現金被擋下並記 rejected 原因', () => {
  const warnings: string[] = []
  const origWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }
  try {
    const res = applyArenaDecision({
      cash: 10000,
      holdings: [],
      closes: CLOSES_5,
      decision: {
        actions: [
          { symbol: '2330', action: 'BUY', shares: 2 },
          { symbol: '2317', action: 'BUY', shares: 4 },
          { symbol: '2454', action: 'BUY', shares: 4 },
          { symbol: '2303', action: 'BUY', shares: 4 },
          { symbol: '2412', action: 'BUY', shares: 4 },
        ],
      },
      guardContext: { agentId: 7, roundDate: '2026-09-28', slot: 1 },
    })
    // 每筆成本 2004.85（含手續費／滑價）；前 4 筆成交，第 5 筆累計 10024.25 > 10000 被總量守衛擋掉
    assert.equal(res.entries.filter((e) => e.action === 'BUY').length, 4)
    assert.equal(res.rejected.length, 1)
    assert.ok(res.rejected[0]!.reason!.startsWith(ARENA_GUARD_CUMULATIVE_PREFIX))
    assert.ok(isArenaGuardRejection(res.rejected[0]!.reason))
    assert.ok(res.cash >= 0, `cash 不可為負，實際=${res.cash}`)
    // 守衛觸發 log 帶 agent＋round＋金額
    const guardLog = warnings.find((w) => w.includes('[ArenaLedger#40]'))
    assert.ok(guardLog, '應有守衛觸發 log')
    assert.ok(guardLog!.includes('agent#7'))
    assert.ok(guardLog!.includes('round=2026-09-28'))
    assert.ok(guardLog!.includes('10024.25'), 'log／原因應帶金額')
  } finally {
    console.warn = origWarn
  }
})

test('#40 灌爆：30 筆買單＋費用邊際下 cash 恆 ≥ 0', () => {
  const symbols = Object.keys(CLOSES_5)
  const actions = Array.from({ length: 30 }, (_, i) => ({
    symbol: symbols[i % symbols.length]!,
    action: 'BUY' as const,
    shares: 4,
  }))
  const res = applyArenaDecision({ cash: 5000, holdings: [], closes: CLOSES_5, decision: { actions } })
  assert.ok(res.cash >= 0, `cash 不可為負，實際=${res.cash}`)
  assert.equal(res.entries.filter((e) => e.action === 'BUY').length + res.rejected.length, 30)
  assert.ok(res.rejected.length > 0, '超額部分應被擋掉')
  for (const r of res.rejected) assert.ok(r.reason && r.reason.length > 0, '每筆擋單都要有原因')
})

test('#40 手續費倒掛的賣出被擋掉（所得為負不吃現金）', () => {
  const res = applyArenaDecision({
    cash: 100,
    holdings: [{ symbol: '9999', shares: 1, avgCost: 1 }],
    closes: { '9999': 0.5 },
    decision: { actions: [{ symbol: '9999', action: 'SELL', shares: 1 }] },
  })
  assert.equal(res.rejected.length, 1)
  assert.equal(res.rejected[0]!.reason, ARENA_GUARD_NEGATIVE_PROCEEDS_REASON)
  assert.equal(res.cash, 100)
  assert.ok(res.cash >= 0)
})

test('#40 手續費倒掛的自動停損被跳過（持倉不動、現金不動）', () => {
  const res = applyArenaDecision({
    cash: 100,
    holdings: [{ symbol: 'P', shares: 2, avgCost: 100 }],
    closes: { P: 0.4 },
    decision: { actions: [] },
    strategyParams: { stopLossPct: 15, minCashBufferPct: 0, maxTradesPerSlot: 10, maxPositionPct: 30 },
  })
  assert.equal(res.rejected.length, 1)
  assert.equal(res.rejected[0]!.reason, ARENA_GUARD_NEGATIVE_PROCEEDS_REASON)
  assert.equal(res.holdings.length, 1)
  assert.equal(res.holdings[0]!.shares, 2)
  assert.equal(res.cash, 100)
})

test('#40 同輪先賣後買：賣出所得計入可用額度，不誤擋', () => {
  const res = applyArenaDecision({
    cash: 500,
    holdings: [{ symbol: '2330', shares: 10, avgCost: 100 }],
    closes: { '2330': 100, '2317': 50 },
    decision: {
      actions: [
        { symbol: '2330', action: 'SELL', shares: 10 },
        { symbol: '2317', action: 'BUY', shares: 8 },
      ],
    },
  })
  assert.equal(res.rejected.length, 0)
  assert.ok(res.entries.some((e) => e.action === 'SELL'))
  assert.ok(res.entries.some((e) => e.action === 'BUY'))
  assert.ok(res.cash >= 0)
})

test('#40 正常單筆買單不受守衛誤擋（無迴歸）', () => {
  const res = applyArenaDecision({
    cash: 500000,
    holdings: [],
    closes: { '2330': 1000 },
    decision: { actions: [{ symbol: '2330', action: 'BUY', shares: 100 }] },
  })
  assert.equal(res.entries.filter((e) => e.action === 'BUY').length, 1)
  assert.equal(res.rejected.length, 0)
  assert.ok(res.cash >= 0)
})

test('#40 isArenaGuardRejection 識別', () => {
  assert.equal(isArenaGuardRejection(`${ARENA_GUARD_CUMULATIVE_PREFIX} 1 超過本輪可用 0）`), true)
  assert.equal(isArenaGuardRejection(ARENA_GUARD_NEGATIVE_PROCEEDS_REASON), true)
  assert.equal(isArenaGuardRejection('現金不足'), false)
  assert.equal(isArenaGuardRejection(undefined), false)
})
