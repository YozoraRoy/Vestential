import { describe, expect, it } from 'vitest'
import { INDUSTRY_BOND_ETF, INDUSTRY_DR, INDUSTRY_ETF, INDUSTRY_UNCLASSIFIED } from './industry'
import { computeConcentration, CONCENTRATION_THRESHOLDS } from './portfolio-concentration'

describe('computeConcentration', () => {
  it('空持股時回傳 empty=true、hhi=0、空陣列且不拋錯', () => {
    const report = computeConcentration([])
    expect(report).toEqual({
      empty: true,
      hhi: 0,
      topWeights: [],
      industryExposure: [],
      flags: [],
    })
  })

  it('總市值為 0 或負值或 NaN 時回傳空狀態報告，不出現 NaN / Infinity', () => {
    const report = computeConcentration([
      { market: 'tw', symbol: '2330', marketValue: 0 },
      { market: 'tw', symbol: '2317', marketValue: -500 },
      { market: 'us', symbol: 'AAPL', marketValue: Number.NaN },
    ])
    expect(report.empty).toBe(true)
    expect(report.hhi).toBe(0)
    expect(Number.isFinite(report.hhi)).toBe(true)
    expect(report.topWeights).toEqual([])
    expect(report.industryExposure).toEqual([])
    expect(report.flags).toEqual([])
  })

  it('單一持股 100% 時 hhi=1、topWeight=100% 且觸發紅燈旗標', () => {
    const report = computeConcentration(
      [{ market: 'tw', symbol: '2330', marketValue: 100000 }],
      { 'tw:2330': '半導體業' },
    )
    expect(report.empty).toBe(false)
    expect(report.hhi).toBe(1)
    expect(report.topWeights).toEqual([{ market: 'tw', symbol: '2330', weightPct: 100 }])
    expect(report.industryExposure).toEqual([{ industry: '半導體業', weightPct: 100 }])
    expect(report.flags).toContain('hhiDanger')
    expect(report.flags).toContain('stockDanger')
    expect(report.flags).toContain('stockWarn')
    expect(report.flags).toContain('industryDanger')
  })

  it('正常分散持股時 hhi 介於 0 與 1 之間、topWeights 最多 3 筆降序、industryExposure 合計 100%', () => {
    const report = computeConcentration(
      [
        { market: 'tw', symbol: '2330', marketValue: 150 },
        { market: 'tw', symbol: '2881', marketValue: 250 },
        { market: 'tw', symbol: '2412', marketValue: 200 },
        { market: 'tw', symbol: '1101', marketValue: 200 },
        { market: 'tw', symbol: '1216', marketValue: 200 },
      ],
      {
        'tw:2330': '半導體業',
        'tw:2881': '金融保險業',
        'tw:2412': '通信網路業',
        'tw:1101': '水泥工業',
        'tw:1216': '食品工業',
      },
    )

    expect(report.empty).toBe(false)
    expect(report.hhi).toBeGreaterThan(0)
    expect(report.hhi).toBeLessThan(1)
    expect(report.hhi).toBeLessThanOrEqual(CONCENTRATION_THRESHOLDS.hhiDanger)
    expect(report.topWeights).toHaveLength(3)
    expect(report.topWeights[0].symbol).toBe('2881')
    expect(report.topWeights[0].weightPct).toBe(25)

    const topSum = report.topWeights.reduce((acc, w) => acc + w.weightPct, 0)
    expect(topSum).toBeLessThanOrEqual(100.01)

    const industrySum = report.industryExposure.reduce((acc, i) => acc + i.weightPct, 0)
    expect(Math.abs(industrySum - 100)).toBeLessThanOrEqual(0.01)
    expect(report.flags).not.toContain('hhiDanger')
    expect(report.flags).not.toContain('industryDanger')
    expect(report.flags).toContain('stockWarn')
  })

  it('單一產業權重 >= 50% 時觸發 industryDanger；均 < 50% 時不觸發', () => {
    const over50 = computeConcentration(
      [
        { market: 'tw', symbol: '2330', marketValue: 300 },
        { market: 'tw', symbol: '2454', marketValue: 200 },
        { market: 'tw', symbol: '2881', marketValue: 250 },
        { market: 'tw', symbol: '2412', marketValue: 250 },
      ],
      {
        'tw:2330': '半導體業',
        'tw:2454': '半導體業',
        'tw:2881': '金融保險業',
        'tw:2412': '通信網路業',
      },
    )
    expect(over50.industryExposure[0]).toEqual({ industry: '半導體業', weightPct: 50 })
    expect(over50.flags).toContain('industryDanger')

    const under50 = computeConcentration(
      [
        { market: 'tw', symbol: '2330', marketValue: 240 },
        { market: 'tw', symbol: '2454', marketValue: 250 },
        { market: 'tw', symbol: '2881', marketValue: 260 },
        { market: 'tw', symbol: '2412', marketValue: 250 },
      ],
      {
        'tw:2330': '半導體業',
        'tw:2454': '半導體業',
        'tw:2881': '金融保險業',
        'tw:2412': '通信網路業',
      },
    )
    expect(under50.flags).not.toContain('industryDanger')
  })

  it('產業缺值歸 INDUSTRY_UNCLASSIFIED，ETF / 債券 ETF / 存託憑證各自成桶', () => {
    const report = computeConcentration(
      [
        { market: 'tw', symbol: '0050', marketValue: 400 },
        { market: 'tw', symbol: '00679B', marketValue: 300 },
        { market: 'tw', symbol: '9103', marketValue: 200 },
        { market: 'us', symbol: 'AAPL', marketValue: 100 },
      ],
      {
        'tw:0050': INDUSTRY_ETF,
        'tw:00679B': INDUSTRY_BOND_ETF,
        'tw:9103': INDUSTRY_DR,
        // AAPL 無對映 → 未分類
      },
    )

    expect(report.industryExposure).toEqual([
      { industry: INDUSTRY_ETF, weightPct: 40 },
      { industry: INDUSTRY_BOND_ETF, weightPct: 30 },
      { industry: INDUSTRY_DR, weightPct: 20 },
      { industry: INDUSTRY_UNCLASSIFIED, weightPct: 10 },
    ])
  })
})
