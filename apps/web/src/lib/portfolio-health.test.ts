import { describe, it, expect } from 'vitest'
import {
  classifyAssetCategory,
  computeDrawdownFrom52wHigh,
  evaluateHoldingHealth,
  evaluatePortfolioHealth,
  type HoldingHealthInput,
} from './portfolio-health'

describe('classifyAssetCategory', () => {
  it('能正確辨識台/美股 ETF', () => {
    expect(classifyAssetCategory({ symbol: '0050', market: 'tw' })).toBe('etf')
    expect(classifyAssetCategory({ symbol: '00878', market: 'tw' })).toBe('etf')
    expect(classifyAssetCategory({ symbol: 'VOO', market: 'us', quoteType: 'ETF' })).toBe('etf')
  })

  it('能正確辨識金融業個股', () => {
    expect(classifyAssetCategory({ symbol: '2881', market: 'tw' })).toBe('financial')
    expect(classifyAssetCategory({ symbol: 'JPM', market: 'us', sector: 'Financial Services' })).toBe('financial')
    expect(classifyAssetCategory({ symbol: '2891', market: 'tw', sector: '金融保險業' })).toBe('financial')
  })

  it('其餘個股歸類為一般企業 equity', () => {
    expect(classifyAssetCategory({ symbol: '2330', market: 'tw', sector: '半導體' })).toBe('equity')
    expect(classifyAssetCategory({ symbol: 'AAPL', market: 'us', sector: '科技' })).toBe('equity')
  })
})

describe('computeDrawdownFrom52wHigh', () => {
  it('正確計算距 52 週高點回撤並防呆零值', () => {
    expect(computeDrawdownFrom52wHigh(80, 100)).toBe(-20)
    expect(computeDrawdownFrom52wHigh(110, 100)).toBe(0)
    expect(computeDrawdownFrom52wHigh(100, 0)).toBeNull()
    expect(computeDrawdownFrom52wHigh(null, 100)).toBeNull()
  })
})

describe('evaluateHoldingHealth — 一般企業個股', () => {
  it('基本面健全且具估值折價（PEG/Forward PE 優）判為 discount_healthy', () => {
    const res = evaluateHoldingHealth({
      market: 'tw',
      symbol: '2330',
      symbolName: '台積電',
      shares: 1000,
      cost: 1000,
      currentPrice: 900,
      marketValue: 900000,
      unrealizedPnlPct: -10,
      sector: '半導體',
      fundamentals: {
        forwardPe: 13.4,
        peRatio: 20.5,
        priceToBook: 4.0,
        pegRatio: 0.58,
        returnOnEquity: 0.418,
        operatingMargins: 0.579,
        earningsGrowth: 0.687,
        debtToEquity: 15.2,
        currentRatio: 2.58,
        freeCashflow: 1_040_000_000_000,
        payoutRatio: 0.25,
        fiftyTwoWeekHigh: 1100,
      },
    })
    expect(res.assetCategory).toBe('equity')
    expect(res.verdict).toBe('discount_healthy')
    expect(res.healthScore).toBeGreaterThanOrEqual(80)
    expect(res.highlights.fcfPositive).toBe(true)
    expect(res.drawdownFrom52wHighPct).toBeCloseTo(-18.2, 1)
  })

  it('基本面健全但估值偏高（高 PE、高 PB、未大幅回撤）判為 healthy', () => {
    const res = evaluateHoldingHealth({
      market: 'us',
      symbol: 'AAPL',
      symbolName: 'Apple',
      shares: 10,
      cost: 220,
      currentPrice: 240,
      marketValue: 2400,
      unrealizedPnlPct: 9.1,
      sector: '科技',
      fundamentals: {
        forwardPe: 33,
        peRatio: 38,
        priceToBook: 45,
        pegRatio: 2.85,
        returnOnEquity: 1.42,
        operatingMargins: 0.33,
        earningsGrowth: 0.14,
        debtToEquity: 84,
        currentRatio: 1.02,
        freeCashflow: 105_000_000_000,
        payoutRatio: 0.12,
        fiftyTwoWeekHigh: 250,
      },
    })
    expect(res.verdict).toBe('healthy')
    expect(res.dimensions.valuation.status).toBe('warn')
  })

  it('現金流為負＋獲利衰退＋高負債判為 warning', () => {
    const res = evaluateHoldingHealth({
      market: 'tw',
      symbol: '9999',
      symbolName: '測試衰退股',
      shares: 1000,
      cost: 50,
      currentPrice: 30,
      marketValue: 30000,
      unrealizedPnlPct: -40,
      fundamentals: {
        peRatio: 10,
        returnOnEquity: 0.02,
        operatingMargins: 0.01,
        earningsGrowth: -0.35,
        debtToEquity: 220,
        currentRatio: 0.7,
        freeCashflow: -500_000_000,
      },
    })
    expect(res.verdict).toBe('warning')
    expect(res.highlights.fcfPositive).toBe(false)
  })

  it('公開財報全部缺值時降級為 insufficient，不硬給紅綠燈', () => {
    const res = evaluateHoldingHealth({
      market: 'tw',
      symbol: '1234',
      shares: 1000,
      cost: 20,
      currentPrice: 18,
      marketValue: 18000,
      unrealizedPnlPct: -10,
      fundamentals: {},
    })
    expect(res.verdict).toBe('insufficient')
    expect(res.healthScore).toBeNull()
    expect(res.evaluatedMetricCount).toBe(0)
  })
})

describe('evaluateHoldingHealth — 金融股與 ETF 專屬分流', () => {
  it('金融股高負債不套用一般企業負債/流動比，改以 ROE/PB/EPS 評估', () => {
    const res = evaluateHoldingHealth({
      market: 'tw',
      symbol: '2881',
      symbolName: '富邦金',
      shares: 2000,
      cost: 90,
      currentPrice: 80,
      marketValue: 160000,
      unrealizedPnlPct: -11.1,
      sector: '金融保險業',
      twseAvgYield5y: 4.5,
      fundamentals: {
        peRatio: 11.2,
        priceToBook: 1.15,
        eps: 7.1,
        returnOnEquity: 0.16,
        operatingMargins: 0.28,
        debtToEquity: 650, // 金融業天然高負債，不應扣分
        currentRatio: 0.5, // 金融業不適用流動比，不應扣分
        payoutRatio: 0.52,
        fiftyTwoWeekHigh: 96,
      },
    })
    expect(res.assetCategory).toBe('financial')
    expect(res.verdict).toBe('discount_healthy')
    expect(res.dimensions.financialSafety.metrics.some((m) => m.key === 'dte')).toBe(false)
    expect(res.dimensions.financialSafety.metrics.some((m) => m.key === 'currentRatio')).toBe(false)
  })

  it('ETF 不套用個股 PE/ROE，改評成分分散度、配息結構與 52 週回撤', () => {
    const res = evaluateHoldingHealth({
      market: 'tw',
      symbol: '00878',
      symbolName: '國泰永續高股息',
      shares: 5000,
      cost: 22,
      currentPrice: 19,
      marketValue: 95000,
      unrealizedPnlPct: -13.6,
      twseAvgYield5y: 6.2,
      twseDividendYears5y: 5,
      fundamentals: {
        quoteType: 'ETF',
        fiftyTwoWeekHigh: 23,
      },
    })
    expect(res.assetCategory).toBe('etf')
    expect(res.verdict).toBe('discount_healthy')
    expect(res.highlights.pe).toBeNull()
    expect(res.highlights.roePct).toBeNull()
    expect(res.highlights.dividendYieldPct).toBe(6.2)
  })

  it('美股 ETF trailingAnnualDividendYield=0 時不誤顯 0.00%，無配息回 null、有 dividendRate 則自動推算', () => {
    const noDiv = evaluateHoldingHealth({
      market: 'us',
      symbol: 'IBIT',
      shares: 10,
      cost: 40,
      currentPrice: 33,
      marketValue: 330,
      unrealizedPnlPct: -17.5,
      fundamentals: {
        quoteType: 'ETF',
        trailingAnnualDividendYield: 0,
        fiftyTwoWeekHigh: 55,
      },
    })
    expect(noDiv.highlights.dividendYieldPct).toBeNull()

    const withRate = evaluateHoldingHealth({
      market: 'us',
      symbol: 'QQQI',
      shares: 10,
      cost: 50,
      currentPrice: 45,
      marketValue: 450,
      unrealizedPnlPct: -10,
      fundamentals: {
        quoteType: 'ETF',
        trailingAnnualDividendYield: 0,
        dividendRate: 7.5,
        fiftyTwoWeekHigh: 57,
      },
    })
    expect(withRate.highlights.dividendYieldPct).toBeCloseTo(16.67, 1)
    expect(withRate.highlights.dividendRate).toBe(7.5)
  })
})

describe('evaluatePortfolioHealth — 組合市值加權摘要與零守衛', () => {
  it('空持倉不回傳 NaN', () => {
    const report = evaluatePortfolioHealth([])
    expect(report.summaryByMarket.tw.healthyValuePct).toBe(0)
    expect(report.summaryByMarket.us.healthyValuePct).toBe(0)
    expect(report.overallCounts.total).toBe(0)
  })

  it('正確依台/美股分幣別計算市值加權健康佔比', () => {
    const inputs: HoldingHealthInput[] = [
      {
        market: 'tw',
        symbol: '2330',
        shares: 1000,
        cost: 1000,
        currentPrice: 800,
        marketValue: 800000,
        unrealizedPnlPct: -20,
        fundamentals: {
          forwardPe: 14,
          returnOnEquity: 0.35,
          operatingMargins: 0.45,
          freeCashflow: 1000,
          debtToEquity: 20,
          currentRatio: 2.2,
        },
      },
      {
        market: 'tw',
        symbol: '9999',
        shares: 1000,
        cost: 300,
        currentPrice: 200,
        marketValue: 200000,
        unrealizedPnlPct: -33,
        fundamentals: {
          returnOnEquity: 0.01,
          operatingMargins: 0.01,
          earningsGrowth: -0.4,
          freeCashflow: -100,
          debtToEquity: 250,
          currentRatio: 0.6,
        },
      },
    ]
    const report = evaluatePortfolioHealth(inputs)
    expect(report.summaryByMarket.tw.totalMarketValue).toBe(1000000)
    expect(report.summaryByMarket.tw.healthyValuePct).toBe(80)
    expect(report.summaryByMarket.tw.warningValuePct).toBe(20)
    expect(report.overallCounts.discount_healthy).toBe(1)
    expect(report.overallCounts.warning).toBe(1)
  })
})
