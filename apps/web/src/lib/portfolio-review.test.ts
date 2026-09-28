import { describe, it, expect } from 'vitest'
import {
  computePortfolioReviewPnl,
  computePortfolioReviewStats,
  filterPortfolioReviewByMonth,
  PORTFOLIO_MIN_REVIEW_COUNT,
  PORTFOLIO_REVIEW_SYSTEM_PROMPT,
  type PortfolioReviewEntryLike,
} from './portfolio-review'

// Issue #43：歷史區整體覆盤統計（筆數／勝率／平均賺賠／最大回撤筆）
// 必須與歷史明細逐筆重算一致（月／全部兩檔）。
function entry(over: Partial<PortfolioReviewEntryLike> & { id: number; symbol: string }): PortfolioReviewEntryLike {
  return {
    market: 'tw',
    shares: 1000,
    cost: 100,
    current_price: 110,
    dividend: 0,
    created_at: '2026-09-10 12:00:00',
    ...over,
  }
}

describe('computePortfolioReviewStats（與明細加總一致）', () => {
  it('筆數／勝率／平均賺賠由 total_return 逐筆重算', () => {
    const entries = [
      entry({ id: 1, symbol: '2330', total_return: 10000 }),
      entry({ id: 2, symbol: '2317', total_return: -4000 }),
      entry({ id: 3, symbol: '2454', total_return: 6000 }),
    ]
    const s = computePortfolioReviewStats(entries)
    expect(s.count).toBe(3)
    expect(s.wins).toBe(2)
    expect(s.losses).toBe(1)
    expect(s.winRate).toBeCloseTo((2 / 3) * 100)
    expect(s.totalPnl).toBe(12000)
    expect(s.avgPnl).toBe(4000)
  })

  it('最大回撤筆為單筆虧損最大者；全勝時為 null', () => {
    const entries = [
      entry({ id: 1, symbol: '2330', total_return: 10000 }),
      entry({ id: 2, symbol: '2317', total_return: -4000 }),
      entry({ id: 3, symbol: '2454', total_return: -9000 }),
    ]
    const worst = computePortfolioReviewStats(entries).maxLossEntry
    expect(worst?.id).toBe(3)
    expect(worst?.symbol).toBe('2454')
    expect(worst?.pnl).toBe(-9000)

    const allWin = computePortfolioReviewStats([entry({ id: 9, symbol: '2330', total_return: 5 })])
    expect(allWin.maxLossEntry).toBeNull()
  })

  it('空陣列回零值（不除零）', () => {
    const s = computePortfolioReviewStats([])
    expect(s.count).toBe(0)
    expect(s.winRate).toBeNull()
    expect(s.avgPnl).toBeNull()
    expect(s.maxLossEntry).toBeNull()
  })

  it('缺 total_return 時以 unrealized_pnl＋dividend 還原', () => {
    const e = entry({ id: 1, symbol: '2330', total_return: null, unrealized_pnl: 8000, dividend: 2000 })
    expect(computePortfolioReviewPnl(e)).toBe(10000)
  })
})

describe('filterPortfolioReviewByMonth（月／全部兩檔）', () => {
  const entries = [
    entry({ id: 1, symbol: '2330', created_at: '2026-09-10 12:00:00' }),
    entry({ id: 2, symbol: '2317', created_at: '2026-08-10 12:00:00' }),
  ]
  it('月篩選只留當月；all／空值回全部', () => {
    expect(filterPortfolioReviewByMonth(entries, '2026-09').map((e) => e.id)).toEqual([1])
    expect(filterPortfolioReviewByMonth(entries, 'all')).toHaveLength(2)
    expect(filterPortfolioReviewByMonth(entries, '')).toHaveLength(2)
  })

  it('月統計與全部統計各自與明細一致', () => {
    const month = filterPortfolioReviewByMonth(entries, '2026-09')
    expect(computePortfolioReviewStats(month).count).toBe(1)
    expect(computePortfolioReviewStats(entries).count).toBe(2)
  })
})

describe('覆盤門檻與 prompt 約束（#43 ACCEPTANCE）', () => {
  it('未滿 5 筆擋下門檻為 5', () => {
    expect(PORTFOLIO_MIN_REVIEW_COUNT).toBe(5)
  })

  it('prompt 含差異註明（無方向／理由／停損）＋禁未來買賣點', () => {
    expect(PORTFOLIO_REVIEW_SYSTEM_PROMPT).toContain('方向')
    expect(PORTFOLIO_REVIEW_SYSTEM_PROMPT).toContain('理由')
    expect(PORTFOLIO_REVIEW_SYSTEM_PROMPT).toContain('停損')
    expect(PORTFOLIO_REVIEW_SYSTEM_PROMPT).toContain('未來買賣點')
    expect(PORTFOLIO_REVIEW_SYSTEM_PROMPT).toContain('Top-3')
    expect(PORTFOLIO_REVIEW_SYSTEM_PROMPT).toContain('#12')
  })
})
