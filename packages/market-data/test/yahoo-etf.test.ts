import { describe, expect, it } from 'vitest'
import { parseYahooEtfModules } from '../src/providers/yahoo-finance'

describe('parseYahooEtfModules (Issue #212)', () => {
  it('可解析 TER、AUM、NAV、前 10 大成分股與債券到期年限', () => {
    const parsed = parseYahooEtfModules({
      fundProfile: {
        feesExpensesInvestment: {
          annualReportExpenseRatio: { raw: 0.0032 },
        },
      },
      summaryDetail: {
        totalAssets: { raw: 500_000_000_000 },
        navPrice: { raw: 92.09 },
      },
      topHoldings: {
        holdings: [
          { symbol: '2330.TW', holdingName: 'TSMC', holdingPercent: { raw: 0.52 } },
          { symbol: '2317.TW', holdingName: 'Hon Hai', holdingPercent: { raw: 0.05 } },
          { symbol: 'BAD', holdingName: 'Invalid', holdingPercent: { raw: 0 } },
        ],
        bondHoldings: {
          maturity: { raw: 9.255 },
        },
      },
    })

    expect(parsed.expenseRatio).toBe(0.0032)
    expect(parsed.totalAssets).toBe(500_000_000_000)
    expect(parsed.navPrice).toBe(92.09)
    expect(parsed.bondMaturityYears).toBe(9.255)
    expect(parsed.topHoldings).toEqual([
      { symbol: '2330.TW', name: 'TSMC', weight: 0.52 },
      { symbol: '2317.TW', name: 'Hon Hai', weight: 0.05 },
    ])
  })

  it('面對空物件或無效值回傳空欄位而不拋錯', () => {
    expect(parseYahooEtfModules(null)).toEqual({})
    expect(parseYahooEtfModules({})).toEqual({
      expenseRatio: undefined,
      totalAssets: undefined,
      navPrice: undefined,
      bondMaturityYears: undefined,
      topHoldings: undefined,
    })
  })
})
