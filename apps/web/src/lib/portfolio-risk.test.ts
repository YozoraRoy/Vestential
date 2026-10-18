import { describe, it, expect } from 'vitest'
import {
  computeConcentration,
  computeStress,
  UNCATEGORIZED_SECTOR,
  type ConcentrationResult,
  type RiskHoldingInput,
  type StressScenarioResult,
} from './portfolio-risk'

// Issue #104：壓力測試第三格「最大產業重挫 30%」原本取 sectors[0]（最大的一桶），
// 若那一桶是「未分類」就整格歸零 → 顯示 NT$0 / 0.00%（誤導：最大產業跌 30% 也不虧）。
// 修正：目標取「最大的已知產業」；整組完全無已知產業時 targetSector=null 且
// targetUnavailable=true（UI 顯示 `—`＋「無法試算：缺產業資料」）。
// 本檔零 DB／零網路，全為純函式，金額皆可手算重現。

function scenarioOf(results: StressScenarioResult[], id: StressScenarioResult['id']): StressScenarioResult {
  const found = results.find((r) => r.id === id)
  if (!found) throw new Error(`scenario ${id} not found`)
  return found
}

describe('computeStress — 案例 A（全部持股未分類）', () => {
  const holdings: RiskHoldingInput[] = [
    { market: 'tw', symbol: '00878', symbolName: '國泰永續高股息', marketValue: 50000, sector: null, sectorSource: 'none' },
    { market: 'tw', symbol: '2412', symbolName: '中華電', marketValue: 30000, sector: null, sectorSource: 'none' },
  ]

  it('targetSector === null、targetUnavailable === true、lossAmount === 0', () => {
    const c = computeConcentration(holdings)
    const sector30 = scenarioOf(computeStress(c), 'sector-30')

    expect(sector30.targetSector).toBeNull()
    expect(sector30.targetUnavailable).toBe(true)
    expect(sector30.lossAmount).toBe(0)
    expect(sector30.lossPct).toBe(0)
    // 全組納入試算市值為 0（全部被排除），UI 才需以 targetUnavailable 判斷顯示 `—`
    expect(sector30.includedValue).toBe(0)
    expect(Number.isFinite(sector30.lossAmount)).toBe(true)
  })

  it('未分類持股列入「不納入試算（缺產業資料）」', () => {
    const c = computeConcentration(holdings)
    const sector30 = scenarioOf(computeStress(c), 'sector-30')

    expect(sector30.holdingLosses).toEqual([])
    expect(sector30.excluded.map((x) => x.symbol)).toEqual(['00878', '2412'])
    expect(sector30.excluded.every((x) => x.reason === 'missing-sector')).toBe(true)
    expect(sector30.excluded.every((x) => x.scenarioId === 'sector-30')).toBe(true)
    expect(c.sectors).toEqual([{ sector: UNCATEGORIZED_SECTOR, marketValue: 80000, weightPct: 100, count: 2 }])
  })
})

describe('computeStress — 案例 B（最大桶未分類 60% ＋已知產業合計 40%）', () => {
  // 手算：總市值 100000；未分類 60000（60%，最大桶）
  //       半導體 30000（30%）、金融 10000（10%）→ 最大的已知產業 = 半導體
  //       sector-30 虧損 = 30000 × 30% = 9000；納入試算 40000 → 9000/40000 = 22.5%
  const holdings: RiskHoldingInput[] = [
    { market: 'tw', symbol: '00878', marketValue: 60000, sector: null, sectorSource: 'none' },
    { market: 'tw', symbol: '2330', marketValue: 30000, sector: '半導體', sectorSource: 'fallback' },
    { market: 'tw', symbol: '2881', marketValue: 10000, sector: '金融', sectorSource: 'fallback' },
  ]
  const c = computeConcentration(holdings)
  const results = computeStress(c)

  it('目標 = 較大的已知產業（半導體），非最大桶（未分類）', () => {
    const sector30 = scenarioOf(results, 'sector-30')
    expect(sector30.targetSector).toBe('半導體')
    expect(sector30.targetUnavailable).toBe(false)
  })

  it('lossAmount = 該產業市值 30000 × 30% = 9000', () => {
    const sector30 = scenarioOf(results, 'sector-30')
    expect(sector30.lossAmount).toBe(9000)
    // 納入試算 = 已知產業合計 40000（未分類不納入）
    expect(sector30.includedValue).toBe(40000)
    expect(sector30.lossPct).toBeCloseTo(22.5, 10)
  })

  it('只有目標產業套用 30%，同為已知但非目標的產業套用 0', () => {
    const sector30 = scenarioOf(results, 'sector-30')
    expect(sector30.holdingLosses.map((h) => [h.symbol, h.appliedDropPct, h.lossAmount])).toEqual([
      ['2330', 30, 9000],
      ['2881', 0, 0],
    ])
  })

  it('未分類持股仍在「不納入試算」清單', () => {
    const sector30 = scenarioOf(results, 'sector-30')
    expect(sector30.excluded.map((x) => [x.symbol, x.reason])).toEqual([['00878', 'missing-sector']])
  })

  it('market-10／market-20 納入全體市值、與產業無關（10%／20%）', () => {
    const m10 = scenarioOf(results, 'market-10')
    const m20 = scenarioOf(results, 'market-20')
    // 手算：100000 × 10% = 10000；100000 × 20% = 20000
    expect([m10.lossAmount, m10.lossPct, m10.includedValue]).toEqual([10000, 10, 100000])
    expect([m20.lossAmount, m20.lossPct, m20.includedValue]).toEqual([20000, 20, 100000])
    expect(m10.targetSector).toBeNull()
    expect(m10.targetUnavailable).toBe(false)
    expect(m20.targetSector).toBeNull()
    expect(m20.targetUnavailable).toBe(false)
    expect(m10.excluded).toEqual([])
    expect(m20.excluded).toEqual([])
    // 大盤情境每檔都套用全額跌幅（不受產業／未分類影響）
    expect(m10.holdingLosses.map((h) => h.appliedDropPct)).toEqual([10, 10, 10])
  })
})

describe('computeStress — 案例 C（全部已知產業）', () => {
  // 手算：總市值 100000；半導體 60000（60%）> 金融 40000（40%）
  //       sector-30 虧損 = 60000 × 30% = 18000；納入試算 100000 → 18%
  const holdings: RiskHoldingInput[] = [
    { market: 'tw', symbol: '2330', marketValue: 50000, sector: '半導體', sectorSource: 'yahoo' },
    { market: 'tw', symbol: '2454', marketValue: 10000, sector: '半導體', sectorSource: 'yahoo' },
    { market: 'tw', symbol: '2881', marketValue: 40000, sector: '金融', sectorSource: 'yahoo' },
  ]

  it('目標 = 最大產業（半導體）、金額 = 60000 × 30% = 18000（與修正前行為相同）', () => {
    const sector30 = scenarioOf(computeStress(computeConcentration(holdings)), 'sector-30')
    expect(sector30.targetSector).toBe('半導體')
    expect(sector30.targetUnavailable).toBe(false)
    expect(sector30.lossAmount).toBe(18000)
    expect(sector30.lossPct).toBeCloseTo(18, 10)
    expect(sector30.includedValue).toBe(100000)
    expect(sector30.excluded).toEqual([])
  })
})

describe('computeStress — 案例 D（空倉／市值 0）', () => {
  const cases: Array<[string, ConcentrationResult]> = [
    ['空陣列', computeConcentration([])],
    ['市值 0', computeConcentration([{ market: 'tw', symbol: '2330', marketValue: 0, sector: '半導體' }])],
    ['市值 NaN', computeConcentration([{ market: 'us', symbol: 'AAPL', marketValue: NaN, sector: '科技' }])],
  ]

  for (const [label, c] of cases) {
    it(`${label}：無 NaN／Infinity，三情境皆零`, () => {
      expect(c.includedCount).toBe(0)
      expect(c.totalMarketValue).toBe(0)
      const results = computeStress(c)
      expect(results.map((r) => r.id)).toEqual(['market-10', 'market-20', 'sector-30'])
      for (const r of results) {
        expect(Number.isFinite(r.lossAmount)).toBe(true)
        expect(Number.isFinite(r.lossPct)).toBe(true)
        expect(Number.isFinite(r.includedValue)).toBe(true)
        expect(r.lossAmount).toBe(0)
        expect(r.lossPct).toBe(0)
        expect(r.includedValue).toBe(0)
        expect(r.holdingLosses).toEqual([])
      }
      // 無任何已知產業 → 大盤情境仍可算（旗標 false），產業情境無法判定（旗標 true）
      expect(scenarioOf(results, 'sector-30').targetUnavailable).toBe(true)
      expect(scenarioOf(results, 'sector-30').targetSector).toBeNull()
      expect(scenarioOf(results, 'market-10').targetUnavailable).toBe(false)
      expect(scenarioOf(results, 'market-20').targetUnavailable).toBe(false)
    })
  }

  it('市值 0／NaN 的持股列入「缺市值資料」排除，不進任何情境', () => {
    const c = computeConcentration([
      { market: 'tw', symbol: '2330', marketValue: 0, sector: '半導體' },
    ])
    expect(c.excluded.map((x) => [x.symbol, x.reason])).toEqual([['2330', 'missing-value']])
  })
})
