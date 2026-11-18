import { describe, expect, it } from 'vitest'
import { estimateTradeFeeAndTax, settlePortfolioTrade, type ExistingHoldingRow } from './portfolio-trade'

describe('portfolio-trade 交易手續費試算與移動加權平均結算 (Issue #163)', () => {
  it('台股手續費含折數與最低20元，賣出區分 ETF 0.1% 與個股 0.3%', () => {
    // 買進小額 10,000 元，6折：10000 * 0.001425 * 0.6 = 8.55 -> 最低收 20
    const smallBuy = estimateTradeFeeAndTax({
      market: 'tw',
      symbol: '0056',
      side: 'buy',
      shares: 1000,
      price: 10,
      feeDiscount: 0.6,
    })
    expect(smallBuy.fee).toBe(20)
    expect(smallBuy.tax).toBe(0)
    expect(smallBuy.netCashAmount).toBe(10_020)

    // 賣出 ETF 100,000 元，不打折：fee=143, tax=100
    const sellEtf = estimateTradeFeeAndTax({
      market: 'tw',
      symbol: '0056',
      side: 'sell',
      shares: 2500,
      price: 40,
      feeDiscount: 1,
    })
    expect(sellEtf.fee).toBe(143)
    expect(sellEtf.tax).toBe(100)
    expect(sellEtf.netCashAmount).toBe(100_000 - 143 - 100)

    // 賣出個股 100,000 元：tax=300
    const sellStock = estimateTradeFeeAndTax({
      market: 'tw',
      symbol: '2330',
      side: 'sell',
      shares: 100,
      price: 1000,
      feeDiscount: 1,
    })
    expect(sellStock.tax).toBe(300)
  })

  it('新買入建倉與加碼買入移動加權平均成本（含手續費）', () => {
    const first = settlePortfolioTrade([], {
      market: 'tw',
      symbol: '0056',
      symbolName: '元大高股息',
      side: 'buy',
      shares: 1000,
      price: 35,
      fee: 30,
      tax: 0,
      tradeDate: '2026-11-18',
    })
    expect(first.action).toBe('create')
    expect(first.settledRecord?.shares).toBe(1000)
    expect(first.settledRecord?.costBasis).toBe(35_030)
    expect(first.settledRecord?.cost).toBe(35.03)

    const existing: ExistingHoldingRow[] = [
      {
        id: 10,
        market: 'tw',
        symbol: '0056',
        symbol_name: '元大高股息',
        shares: 1000,
        cost: 35.03,
        current_price: 36,
        dividend: 3.6,
        cost_basis: 35_030,
      },
    ]

    const addMore = settlePortfolioTrade(existing, {
      market: 'tw',
      symbol: '0056',
      side: 'buy',
      shares: 1000,
      price: 37,
      fee: 32,
      tax: 0,
      currentPrice: 37,
      tradeDate: '2026-11-18',
    })
    expect(addMore.action).toBe('update')
    expect(addMore.primaryRecordId).toBe(10)
    expect(addMore.settledRecord?.shares).toBe(2000)
    // 總成本 = 35,030 + 37,032 = 72,062 -> 均價 36.031
    expect(addMore.settledRecord?.costBasis).toBe(72_062)
    expect(addMore.settledRecord?.cost).toBe(36.031)
  })

  it('部分賣出計算已實現損益與剩餘股數，全數賣光移除持倉，超賣阻擋', () => {
    const existing: ExistingHoldingRow[] = [
      {
        id: 21,
        market: 'tw',
        symbol: '2330',
        symbol_name: '台積電',
        shares: 1000,
        cost: 900,
        current_price: 1050,
        dividend: 16,
        cost_basis: 900_000,
      },
    ]

    // 賣出 400 股 @ 1,000，fee=500, tax=1,200 -> 淨收入 398,300 - 成本 360,000 = +38,300
    const partialSell = settlePortfolioTrade(existing, {
      market: 'tw',
      symbol: '2330',
      side: 'sell',
      shares: 400,
      price: 1000,
      fee: 500,
      tax: 1200,
      tradeDate: '2026-11-18',
    })
    expect(partialSell.action).toBe('update')
    expect(partialSell.realizedPnl).toBe(38_300)
    expect(partialSell.settledRecord?.shares).toBe(600)
    expect(partialSell.settledRecord?.costBasis).toBe(540_000)

    // 全數賣光 1000 股 -> action='delete'
    const fullSell = settlePortfolioTrade(existing, {
      market: 'tw',
      symbol: '2330',
      side: 'sell',
      shares: 1000,
      price: 1000,
      fee: 1000,
      tax: 3000,
      tradeDate: '2026-11-18',
    })
    expect(fullSell.action).toBe('delete')
    expect(fullSell.removeRecordIds).toEqual([21])
    expect(fullSell.realizedPnl).toBe(96_000)

    // 超賣 1,500 股 -> 拋錯阻擋
    expect(() =>
      settlePortfolioTrade(existing, {
        market: 'tw',
        symbol: '2330',
        side: 'sell',
        shares: 1500,
        price: 1000,
        fee: 0,
        tax: 0,
        tradeDate: '2026-11-18',
      }),
    ).toThrow(/不可大於目前持有股數/)
  })
})
