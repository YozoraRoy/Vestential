import { describe, it, expect } from 'vitest'
import { computeHealthTaxSafety, getEtfDividendComposition, HEALTH_TAX_THRESHOLD } from './etf-dividend-composition'
import { computeLookThroughRadar } from './etf-holdings-radar'

describe('ETF 配息組成與二代健保安全張數 (Issue #132)', () => {
  it('正確取得 00878 配息組成並計算安全張數', () => {
    const comp = getEtfDividendComposition('00878')
    expect(comp.dividend54cRatio).toBe(0.35)
    expect(comp.capitalGainRatio).toBe(0.40)
    expect(comp.equalizationRatio).toBe(0.25)

    // 假設單次配息 0.55 元
    // 54C 每股 = 0.55 * 0.35 = 0.1925 元
    // 安全股數 = floor(19999 / 0.1925) = 103,890 股 -> 103 張
    const safety = computeHealthTaxSafety('00878', 0.55, 50000) // 持有 50 張 (50,000 股)
    expect(safety.dividend54cPerShare).toBe(0.1925)
    expect(safety.safeMaxLots).toBe(103)
    expect(safety.holdingEvaluation?.isSubjectToTax).toBe(false)
    expect(safety.holdingEvaluation?.estimatedTax).toBe(0)
  })

  it('持有超過安全張數時正確發出二代健保預警並計算 2.11% 保費', () => {
    // 持有 150 張 (150,000 股) 00878，每股配息 0.55 元
    // 54C 總額 = 150000 * 0.1925 = 28,875 元 (>= 20,000)
    // 預估補充保費 = round(28875 * 0.0211) = 609 元
    const safety = computeHealthTaxSafety('00878', 0.55, 150000)
    expect(safety.holdingEvaluation?.isSubjectToTax).toBe(true)
    expect(safety.holdingEvaluation?.estimated54cAmount).toBe(28875)
    expect(safety.holdingEvaluation?.estimatedTax).toBe(609)
  })
})

describe('穿透式成分股重疊度雷達 (Issue #132)', () => {
  it('同時持有台積電與 0050 時正確合併穿透曝險', () => {
    const holdings = [
      { symbol: '2330', market: 'tw', market_value: 1000000 }, // 直接持有 100 萬
      { symbol: '0050', market: 'tw', market_value: 1000000 }, // 0050 內台積電佔 55.2% (55.2 萬)
    ]

    const radar = computeLookThroughRadar(holdings)
    expect(radar.totalPortfolioValue).toBe(2000000)
    expect(radar.hasEtf).toBe(true)

    // 台積電總曝險 = 100 萬 + 55.2 萬 = 155.2 萬
    // 佔總投資組合比例 = 155.2 / 200 = 77.6%
    const tsmc = radar.topExposures.find((s) => s.symbol === '2330')
    expect(tsmc).toBeDefined()
    expect(tsmc?.directValue).toBe(1000000)
    expect(tsmc?.totalExposedValue).toBe(1552000)
    expect(tsmc?.weightPct).toBe(77.6)

    // 觸發集中度預警（第一大 > 35% 且前五大 > 60%）
    expect(radar.warnings.length).toBeGreaterThan(0)
  })

  it('持有多檔高股息 ETF 時正確識別重疊成分股', () => {
    const holdings = [
      { symbol: '00878', market: 'tw', market_value: 500000 },
      { symbol: '0056', market: 'tw', market_value: 500000 },
    ]

    const radar = computeLookThroughRadar(holdings)
    expect(radar.overlaps.length).toBe(1)
    const pair = radar.overlaps[0]
    expect(pair.etfA).toContain('00878')
    expect(pair.etfB).toContain('0056')

    // 00878 與 0056 前十大中共同持有：聯發科、廣達、大聯大、光寶科 等
    expect(pair.overlapCount).toBeGreaterThan(0)
    const mediatek = pair.commonStocks.find((c) => c.symbol === '2454')
    expect(mediatek).toBeDefined()
  })
})
