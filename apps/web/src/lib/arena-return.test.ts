import { describe, it, expect } from 'vitest'
import {
  arenaReturnPct,
  arenaCashEstimatePct,
  latestArenaSnapshot,
  unifiedArenaReturn,
  breakdownArenaReturn,
} from './arena-return'

// Issue #38：排行榜與歷程共用同一累計報酬率函式（最新快照、同一 rounding）。
describe('arenaReturnPct（單一累計報酬率算法）', () => {
  it('最新快照 (equity - initial) / initial，小數 2 位四捨五入', () => {
    expect(arenaReturnPct(550000, 500000)).toBe(10)
    expect(arenaReturnPct(510123, 500000)).toBe(2.02)
    expect(arenaReturnPct(489999, 500000)).toBe(-2)
    // 與 engine 寫入公式 Math.round(x*10000)/100 一致
    expect(arenaReturnPct(500005, 500000)).toBe(0)
  })

  it('initial <= 0 或非數值回 0（不除零）', () => {
    expect(arenaReturnPct(100, 0)).toBe(0)
    expect(arenaReturnPct(100, -5)).toBe(0)
    expect(arenaReturnPct(NaN, 500000)).toBe(0)
  })

  it('無快照現金估算同 rounding', () => {
    expect(arenaCashEstimatePct(200000, 500000)).toBe(-60)
    expect(arenaCashEstimatePct(200000, 200000)).toBe(0)
  })
})

describe('latestArenaSnapshot（ASC 取最後一筆 = 最新）', () => {
  it('回傳最後一筆；空陣列回 null', () => {
    const snaps = [
      { round_date: '2026-09-23', equity: 1, cash: 1, return_pct: 0 },
      { round_date: '2026-09-24', equity: 2, cash: 2, return_pct: 0 },
    ]
    expect(latestArenaSnapshot(snaps)?.round_date).toBe('2026-09-24')
    expect(latestArenaSnapshot([])).toBeNull()
  })
})

describe('unifiedArenaReturn（排行榜＋歷程共用）', () => {
  it('有快照：用最新快照重算並帶截至日期', () => {
    const r = unifiedArenaReturn(
      [
        { round_date: '2026-09-23', equity: 500000, cash: 500000, return_pct: 0 },
        { round_date: '2026-09-24', equity: 550000, cash: 100000, return_pct: 10 },
      ],
      500000,
      100000,
    )
    expect(r).toEqual({ pct: 10, asOf: '2026-09-24', estimated: false })
  })

  it('無快照：現金公式估算且標示 estimated', () => {
    const r = unifiedArenaReturn([], 500000, 200000)
    expect(r).toEqual({ pct: -60, asOf: null, estimated: true })
  })
})

describe('breakdownArenaReturn（Issue #122：總報酬率拆解 價差 vs 股息）', () => {
  it('正常拆解：總報酬 +0.26%，本金 500,000，股息 4,000 (0.8%) → 價差 -0.54%', () => {
    const res = breakdownArenaReturn(0.26, 500000, 4000)
    expect(res).toEqual({
      totalReturnPct: 0.26,
      dividendReturnPct: 0.8,
      capitalGainPct: -0.54,
      totalDividends: 4000,
    })
  })

  it('無股息時：股息貢獻為 0，價差等於總報酬', () => {
    const res = breakdownArenaReturn(5.5, 500000, 0)
    expect(res).toEqual({
      totalReturnPct: 5.5,
      dividendReturnPct: 0,
      capitalGainPct: 5.5,
      totalDividends: 0,
    })
  })

  it('本金非正常數值時防除零與防呆', () => {
    const res = breakdownArenaReturn(2.5, 0, 1000)
    expect(res).toEqual({
      totalReturnPct: 0,
      dividendReturnPct: 0,
      capitalGainPct: 0,
      totalDividends: 1000,
    })
  })
})
