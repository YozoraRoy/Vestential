import { describe, expect, it } from 'vitest'
import { AssetType } from '@stock/core'
import { buildEtfExternalContext, getFundamentalsSystemPrompt } from './fundamentals.js'
import { getMarketSystemPrompt } from './market.js'

describe('ETF prompt routing', () => {
  it('fundamentals analyst uses ETF prompt when assetType is ETF and forbids single-stock financials', () => {
    const prompt = getFundamentalsSystemPrompt(AssetType.ETF)
    expect(prompt).toContain('ETF Analyst')
    expect(prompt).toContain('Do NOT apply or mention single-company financial metrics')
    expect(prompt).toContain('gross margin')
    expect(prompt).toContain('ROE')
    expect(prompt).toContain('EPS')
  })

  it('fundamentals analyst keeps standard equity prompt for Stock', () => {
    const prompt = getFundamentalsSystemPrompt(AssetType.Stock)
    expect(prompt).toContain('Analyze financial statements and valuation')
    expect(prompt).toContain('EV/EBITDA')
  })

  it('market analyst uses ETF positioning prompt when assetType is ETF', () => {
    const prompt = getMarketSystemPrompt(AssetType.ETF)
    expect(prompt).toContain('ETF Technical & Positioning Analyst')
    expect(prompt).toContain('MA60')
    expect(prompt).toContain('Do NOT discuss single-company chip distribution')
  })

  it('buildEtfExternalContext formats verified TER, AUM, NAV premium/discount and top holdings', () => {
    const ctx = buildEtfExternalContext(
      {
        expenseRatio: 0.0032,
        totalAssets: 500_000_000_000,
        navPrice: 90,
        bondMaturityYears: 8.5,
        topHoldings: [{ symbol: '2330.TW', name: 'TSMC', weight: 0.52 }],
      },
      91.8,
    )
    expect(ctx).toContain('Expense Ratio (TER): 0.32%')
    expect(ctx).toContain('Total Assets (AUM): 500,000,000,000')
    expect(ctx).toContain('Latest NAV: 90.00 (Estimated Premium/Discount vs Quote: +2.00%)')
    expect(ctx).toContain('Bond Average Maturity: 8.50 years')
    expect(ctx).toContain('TSMC (2330.TW): 52.00%')
  })

  it('buildEtfExternalContext returns empty string when external fields are absent', () => {
    expect(buildEtfExternalContext(null)).toBe('')
    expect(buildEtfExternalContext({})).toBe('')
  })
})
