import { describe, expect, it } from 'vitest'
import { AssetType } from '@stock/core'
import { getFundamentalsSystemPrompt } from './fundamentals.js'
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
})
