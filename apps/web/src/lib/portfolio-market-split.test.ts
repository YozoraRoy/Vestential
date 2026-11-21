import { describe, it, expect } from 'vitest'
import {
  computeMarketPortfolioStats,
  computeTwCoreAssetStats,
  summarizeTransactionsByMarket,
  type MarketRecordLike,
} from './portfolio-market-split'

describe('computeMarketPortfolioStats', () => {
  it('空持倉安全歸零且不 NaN', () => {
    const res = computeMarketPortfolioStats([], 0.6)
    expect(res.totalCount).toBe(0)
    expect(res.tw.unrealizedPnlPct).toBe(0)
    expect(res.us.netPnlPct).toBe(0)
  })

  it('嚴格分開計算台股與美股的成本、市值、未實現與含稅費淨損益', () => {
    const records: MarketRecordLike[] = [
      {
        market: 'tw',
        symbol: '2330',
        shares: 1000,
        cost: 1000,
        current_price: 1100,
        cost_basis: 1_000_000,
        market_value: 1_100_000,
        unrealized_pnl: 100_000,
      },
      {
        market: 'us',
        symbol: 'AAPL',
        shares: 10,
        cost: 200,
        current_price: 250,
        cost_basis: 2000,
        market_value: 2500,
        unrealized_pnl: 500,
      },
      {
        market: 'us',
        symbol: 'NVDA',
        shares: 10,
        cost: 150,
        current_price: 120,
        cost_basis: 1500,
        market_value: 1200,
        unrealized_pnl: -300,
      },
    ]

    const res = computeMarketPortfolioStats(records, 0.6)
    expect(res.totalCount).toBe(3)

    // 台股獨立計算
    expect(res.tw.count).toBe(1)
    expect(res.tw.totalCost).toBe(1_000_000)
    expect(res.tw.totalMarketValue).toBe(1_100_000)
    expect(res.tw.unrealizedPnl).toBe(100_000)
    expect(res.tw.unrealizedPnlPct).toBeCloseTo(10, 2)
    expect(res.tw.netPnl).toBeLessThan(100_000) // 已扣台股手續費與證交稅

    // 美股獨立計算（不被台股 NT$ 數字汙染）
    expect(res.us.count).toBe(2)
    expect(res.us.totalCost).toBe(3500)
    expect(res.us.totalMarketValue).toBe(3700)
    expect(res.us.unrealizedPnl).toBe(200)
    expect(res.us.unrealizedPnlPct).toBeCloseTo((200 / 3500) * 100, 2)
    expect(res.us.netPnl).toBe(200)
  })
})

describe('computeTwCoreAssetStats', () => {
  it('美股市值不應稀釋台股核心資產配置比例', () => {
    const res = computeTwCoreAssetStats([
      { market: 'tw', symbol: '0050', market_value: 100_000 },
      { market: 'us', symbol: 'AAPL', market_value: 500_000 },
    ])
    expect(res.twCount).toBe(1)
    expect(res.coreCount).toBe(1)
    expect(res.totalMarketValue).toBe(100_000)
    expect(res.ratioPct).toBe(100)
  })
})

describe('summarizeTransactionsByMarket', () => {
  it('分開加總台股與美股交易金額與已實現損益', () => {
    const s = summarizeTransactionsByMarket([
      { market: 'tw', side: 'buy', total_amount: 500_000, realized_pnl: null },
      { market: 'tw', side: 'sell', total_amount: 550_000, realized_pnl: 45_000 },
      { market: 'us', side: 'buy', total_amount: 3000, realized_pnl: null },
      { market: 'us', side: 'sell', total_amount: 3600, realized_pnl: 600 },
    ])
    expect(s.tw.totalBuyAmount).toBe(500_000)
    expect(s.tw.totalRealizedPnl).toBe(45_000)
    expect(s.us.totalBuyAmount).toBe(3000)
    expect(s.us.totalRealizedPnl).toBe(600)
  })
})
