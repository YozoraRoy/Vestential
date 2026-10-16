import { describe, it, expect } from 'vitest'
import {
  yearlyPerShareTotals,
  computeCurrentYearYield,
  computeFiveYearAvgYield,
  yieldWindowYears,
  yieldDataYears,
  YIELD_HISTORY_YEARS,
  YIELD_DATA_YEARS,
  type YieldHistoryEntry,
} from './portfolio-yield'

// Issue #44：當年殖利率＋5 年平均殖利率（手算可重現：加總÷現價）。
// Issue #95：當年改 YTD（ex_date ≤ today）；5 年平均改「去年為止 5 個完整年度」。
const rows: YieldHistoryEntry[] = [
  { symbol: '2330', ex_date: '2026-07-16', cash_dividend: 10 },
  { symbol: '2330', ex_date: '2026-10-20', cash_dividend: 3 }, // 已公告未除息（預告）
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
    expect(out.find((y) => y.year === '2026')).toEqual({ year: '2026', perShareTotal: 13, count: 2 })
    expect(out.find((y) => y.year === '2025')).toEqual({ year: '2025', perShareTotal: 12, count: 1 })
    expect(out.find((y) => y.year === '2022')).toEqual({ year: '2022', perShareTotal: 0, count: 0 })
    // 大小寫／空白代號等效
    expect(yearlyPerShareTotals(' 2330 ', rows, ['2026'])[0].perShareTotal).toBe(13)
  })

  it('#95 YTD：帶 today 時只計 ex_date ≤ today（預告事件不墊高當年）', () => {
    const ytd = yearlyPerShareTotals('2330', rows, ['2026'], '2026-10-16')
    expect(ytd[0]).toEqual({ year: '2026', perShareTotal: 10, count: 1 })
    // 同日除息視為已除息（≤ 而非 <）
    expect(yearlyPerShareTotals('2330', rows, ['2026'], '2026-07-16')[0].perShareTotal).toBe(10)
    // 未帶 today（歷史年份口徑）＝全計
    expect(yearlyPerShareTotals('2330', rows, ['2026'])[0].perShareTotal).toBe(13)
    // 非法 today 視同未帶
    expect(yearlyPerShareTotals('2330', rows, ['2026'], 'bad')[0].perShareTotal).toBe(13)
  })
})

describe('computeCurrentYearYield（當年＝今年已除息加總÷現價）', () => {
  it('與手算一致：15 ÷ 500 ×100 ＝ 3%', () => {
    expect(computeCurrentYearYield(15, 500)).toBeCloseTo(3, 10)
  })

  it('現價非法回 null（UI 顯示 —，不報錯）', () => {
    expect(computeCurrentYearYield(15, 0)).toBeNull()
    expect(computeCurrentYearYield(15, -1)).toBeNull()
    expect(computeCurrentYearYield(15, NaN)).toBeNull()
  })
})

describe('computeFiveYearAvgYield（完整年度平均÷現價；缺年註記）', () => {
  it('有值且與手算一致：(12+8+6)/3 ＝ 8.666…；÷ 500 ×100', () => {
    // 窗＝(Y-5)..(Y-1)＝2021..2025（不含當年 2026）
    const yearly = yearlyPerShareTotals('2330', rows, ['2021', '2022', '2023', '2024', '2025'])
    const r = computeFiveYearAvgYield(yearly, 500)
    expect(r.value).toBeCloseTo((26 / 3 / 500) * 100, 10)
    expect(r.coveredYears).toEqual(['2023', '2024', '2025'])
    expect(r.missingYears).toEqual(['2021', '2022'])
    expect(r.partial).toBe(true)
  })

  it('全缺年回 null＋partial（年份不全）', () => {
    const yearly = yearlyPerShareTotals('9999', rows, ['2021', '2022'])
    const r = computeFiveYearAvgYield(yearly, 500)
    expect(r.value).toBeNull()
    expect(r.partial).toBe(true)
  })

  it('5 個完整年度全齊時 partial 為 false', () => {
    const full = yearlyPerShareTotals(
      '2330',
      [
        ...rows,
        { symbol: '2330', ex_date: '2021-07-21', cash_dividend: 4 },
        { symbol: '2330', ex_date: '2022-07-21', cash_dividend: 5 },
      ],
      ['2021', '2022', '2023', '2024', '2025'],
    )
    const r = computeFiveYearAvgYield(full, 500)
    // (4+5+6+8+12)/5 ＝ 7；7 ÷ 500 ×100 ＝ 1.4%
    expect(r.value).toBeCloseTo(1.4, 10)
    expect(r.partial).toBe(false)
  })
})

describe('yieldWindowYears（#95：去年為止 5 個完整年度 (Y-5)..(Y-1)）', () => {
  it('2026 → 2021..2025（不含當年）', () => {
    expect(yieldWindowYears('2026')).toEqual(['2021', '2022', '2023', '2024', '2025'])
  })

  it('窗長＝YIELD_HISTORY_YEARS＝5；非法輸入回空', () => {
    expect(yieldWindowYears('2026')).toHaveLength(YIELD_HISTORY_YEARS)
    expect(yieldWindowYears('abc')).toEqual([])
  })
})

describe('yieldDataYears（#95：資料讀取窗 (Y-5)..Y 共 6 年）', () => {
  it('2026 → 2021..2026；長度＝6（對齊 6 年回填窗）', () => {
    expect(yieldDataYears('2026')).toEqual(['2021', '2022', '2023', '2024', '2025', '2026'])
    expect(yieldDataYears('2026')).toHaveLength(YIELD_DATA_YEARS)
    expect(yieldDataYears('bad')).toEqual([])
  })
})
