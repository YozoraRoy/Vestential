import { describe, it, expect } from 'vitest'
import {
  yearlyPerShareTotals,
  computeCurrentYearYield,
  computeFiveYearAvgYield,
  yieldWindowYears,
  type YieldHistoryEntry,
} from './portfolio-yield'

// Issue #44：當年殖利率＋5 年平均殖利率（手算可重現：加總÷現價）。
const rows: YieldHistoryEntry[] = [
  { symbol: '2330', ex_date: '2026-07-16', cash_dividend: 10 },
  { symbol: '2330', ex_date: '2026-09-10', cash_dividend: 5 },
  { symbol: '2330', ex_date: '2025-07-17', cash_dividend: 12 },
  { symbol: '2330', ex_date: '2024-07-18', cash_dividend: 8 },
  { symbol: '2330', ex_date: '2023-07-20', cash_dividend: 6 },
  // 2022 缺年（整年無列）
  { symbol: '2317', ex_date: '2026-08-01', cash_dividend: 4 },
]

describe('yearlyPerShareTotals（分年代號加總）', () => {
  it('同年代號加總；他代號／非法列不混入', () => {
    const years = ['2022', '2023', '2024', '2025', '2026']
    const out = yearlyPerShareTotals('2330', rows, years)
    expect(out.find((y) => y.year === '2026')).toEqual({ year: '2026', perShareTotal: 15, count: 2 })
    expect(out.find((y) => y.year === '2025')).toEqual({ year: '2025', perShareTotal: 12, count: 1 })
    expect(out.find((y) => y.year === '2022')).toEqual({ year: '2022', perShareTotal: 0, count: 0 })
    // 大小寫／空白代號等效
    expect(yearlyPerShareTotals(' 2330 ', rows, ['2026'])[0].perShareTotal).toBe(15)
  })
})

describe('computeCurrentYearYield（當年＝TWSE 今年加總÷現價）', () => {
  it('與手算一致：15 ÷ 500 ×100 ＝ 3%', () => {
    expect(computeCurrentYearYield(15, 500)).toBeCloseTo(3, 10)
  })

  it('現價非法回 null（UI 顯示 —，不報錯）', () => {
    expect(computeCurrentYearYield(15, 0)).toBeNull()
    expect(computeCurrentYearYield(15, -1)).toBeNull()
    expect(computeCurrentYearYield(15, NaN)).toBeNull()
  })
})

describe('computeFiveYearAvgYield（有資料年平均÷現價；缺年註記）', () => {
  it('有值且與手算一致：(15+12+8+6)/4 ＝ 10.25；10.25 ÷ 500 ×100 ＝ 2.05%', () => {
    const yearly = yearlyPerShareTotals('2330', rows, ['2022', '2023', '2024', '2025', '2026'])
    const r = computeFiveYearAvgYield(yearly, 500)
    expect(r.value).toBeCloseTo(2.05, 10)
    expect(r.coveredYears).toEqual(['2023', '2024', '2025', '2026'])
    expect(r.missingYears).toEqual(['2022'])
    expect(r.partial).toBe(true)
  })

  it('全缺年回 null＋partial（年份不全）', () => {
    const yearly = yearlyPerShareTotals('9999', rows, ['2022', '2023'])
    const r = computeFiveYearAvgYield(yearly, 500)
    expect(r.value).toBeNull()
    expect(r.partial).toBe(true)
  })

  it('5 年全齊時 partial 為 false', () => {
    const full = yearlyPerShareTotals('2330', [
      ...rows,
      { symbol: '2330', ex_date: '2022-07-21', cash_dividend: 4 },
    ], ['2022', '2023', '2024', '2025', '2026'])
    const r = computeFiveYearAvgYield(full, 500)
    // (15+12+8+6+4)/5 ＝ 9；9 ÷ 500 ×100 ＝ 1.8%
    expect(r.value).toBeCloseTo(1.8, 10)
    expect(r.partial).toBe(false)
  })
})

describe('yieldWindowYears（當年＋前 4 年）', () => {
  it('2026 → 2022..2026', () => {
    expect(yieldWindowYears('2026')).toEqual(['2022', '2023', '2024', '2025', '2026'])
  })
})
