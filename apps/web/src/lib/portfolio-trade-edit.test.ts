import { describe, it, expect } from 'vitest'
import { recomputeTransactionAmounts } from './portfolio-trade'

describe('recomputeTransactionAmounts (#205)', () => {
  it('買入紀錄更新股數、單價、手續費後正確重算交割金額', () => {
    const out = recomputeTransactionAmounts(
      { side: 'buy', shares: 1000, price: 35, fee: 49, tax: 0, trade_date: '2026-11-20', realized_pnl: null, realized_pnl_pct: null, note: null },
      { shares: 2000, price: 36, fee: 100, note: '加碼' },
    )
    expect(out.totalAmount).toBe(2000 * 36 + 100)
    expect(out.note).toBe('加碼')
    expect(out.realizedPnl).toBeNull()
  })

  it('賣出紀錄更新單價與稅金後正確重算交割金額（扣除費稅）並保留/更新已實現損益', () => {
    const out = recomputeTransactionAmounts(
      { side: 'sell', shares: 1000, price: 40, fee: 57, tax: 120, trade_date: '2026-11-25', realized_pnl: 4823, realized_pnl_pct: 13.7, note: '停利' },
      { price: 42, tax: 126, realizedPnl: 6817 },
    )
    expect(out.totalAmount).toBe(1000 * 42 - 57 - 126)
    expect(out.realizedPnl).toBe(6817)
  })

  it('無效股數／負費用／錯誤日期格式拋出錯誤', () => {
    expect(() =>
      recomputeTransactionAmounts(
        { side: 'buy', shares: 1000, price: 35, fee: 0, tax: 0, trade_date: '2026-11-20' },
        { shares: 0 },
      ),
    ).toThrow()
    expect(() =>
      recomputeTransactionAmounts(
        { side: 'buy', shares: 1000, price: 35, fee: 0, tax: 0, trade_date: '2026-11-20' },
        { tradeDate: '2026/11/20' },
      ),
    ).toThrow()
  })
})
