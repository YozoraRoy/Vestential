import { describe, it, expect } from 'vitest'
import {
  yearlyPerShareTotals,
  computeCurrentYearYield,
  computeFiveYearAvgYield,
  yieldWindowYears,
  yieldDataYears,
  computeYieldBreakdown,
  computeRealizedYearYields,
  computeRealizedAvgYield,
  ttmWindowStart,
  YIELD_HISTORY_YEARS,
  YIELD_DATA_YEARS,
  YIELD_TTM_DAYS,
  type YieldHistoryEntry,
} from './portfolio-yield'

// Issue #44：當年殖利率＋5 年平均殖利率（手算可重現：加總÷現價）。
// Issue #95：當年改 YTD（ex_date ≤ today）；5 年平均改「去年為止 5 個完整年度」。
// Issue #101：逐年已實現殖利率（÷該年最後一次除息日昨收）＝Yahoo 同義口徑。
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

// ─────────────────────────────────────────────────────────────────────────────
// #100：TTM（近 365 天）＋ computeYieldBreakdown（00878 真實快取、00929 月配）
// 00878 快取 23 筆（2021-02-25～2026-08-18）；今日 2026-10-17、現價 35.53。
// #101：`prev_close`＝除息日昨收（Yahoo 對照值）；此處僅在「該年最後一次除息事件」
//   與 2026 三筆標上已知真值，其餘未標（＝未回填，不得代墊）。
// ─────────────────────────────────────────────────────────────────────────────
const TODAY = '2026-10-17'
const d878: YieldHistoryEntry[] = [
  { symbol: '00878', ex_date: '2021-02-25', cash_dividend: 0.15 },
  { symbol: '00878', ex_date: '2021-05-18', cash_dividend: 0.25 },
  { symbol: '00878', ex_date: '2021-08-17', cash_dividend: 0.3 },
  { symbol: '00878', ex_date: '2021-11-16', cash_dividend: 0.28, prev_close: 18.85 },
  { symbol: '00878', ex_date: '2022-02-22', cash_dividend: 0.3 },
  { symbol: '00878', ex_date: '2022-05-18', cash_dividend: 0.32 },
  { symbol: '00878', ex_date: '2022-08-16', cash_dividend: 0.28 },
  { symbol: '00878', ex_date: '2022-11-16', cash_dividend: 0.28, prev_close: 16.77 },
  { symbol: '00878', ex_date: '2023-02-16', cash_dividend: 0.27 },
  { symbol: '00878', ex_date: '2023-05-17', cash_dividend: 0.27 },
  { symbol: '00878', ex_date: '2023-08-16', cash_dividend: 0.35 },
  { symbol: '00878', ex_date: '2023-11-16', cash_dividend: 0.35, prev_close: 20.69 },
  { symbol: '00878', ex_date: '2024-02-27', cash_dividend: 0.4 },
  { symbol: '00878', ex_date: '2024-05-17', cash_dividend: 0.51 },
  { symbol: '00878', ex_date: '2024-08-16', cash_dividend: 0.55 },
  { symbol: '00878', ex_date: '2024-11-18', cash_dividend: 0.55, prev_close: 22.73 },
  { symbol: '00878', ex_date: '2025-02-20', cash_dividend: 0.5 },
  { symbol: '00878', ex_date: '2025-05-19', cash_dividend: 0.47 },
  { symbol: '00878', ex_date: '2025-08-18', cash_dividend: 0.4 },
  { symbol: '00878', ex_date: '2025-11-18', cash_dividend: 0.4, prev_close: 21.11 },
  { symbol: '00878', ex_date: '2026-02-26', cash_dividend: 0.42, prev_close: 24.0 },
  { symbol: '00878', ex_date: '2026-05-19', cash_dividend: 0.66, prev_close: 27.8 },
  { symbol: '00878', ex_date: '2026-08-18', cash_dividend: 1.01, prev_close: 33.75 },
]
// 00929 月配（TTM 12 筆：2025-10-21～2026-09-17；另附窗外 2 筆證明下界生效）。
const d929: YieldHistoryEntry[] = [
  { symbol: '00929', ex_date: '2025-09-17', cash_dividend: 0.08 },
  { symbol: '00929', ex_date: '2025-10-21', cash_dividend: 0.08 },
  { symbol: '00929', ex_date: '2025-11-19', cash_dividend: 0.09 },
  { symbol: '00929', ex_date: '2025-12-17', cash_dividend: 0.09 },
  { symbol: '00929', ex_date: '2026-01-20', cash_dividend: 0.1 },
  { symbol: '00929', ex_date: '2026-03-03', cash_dividend: 0.1 },
  { symbol: '00929', ex_date: '2026-03-18', cash_dividend: 0.11 },
  { symbol: '00929', ex_date: '2026-04-21', cash_dividend: 0.13 },
  { symbol: '00929', ex_date: '2026-05-20', cash_dividend: 0.13 },
  { symbol: '00929', ex_date: '2026-06-17', cash_dividend: 0.26 },
  { symbol: '00929', ex_date: '2026-07-21', cash_dividend: 0.38 },
  { symbol: '00929', ex_date: '2026-08-19', cash_dividend: 0.38 },
  { symbol: '00929', ex_date: '2026-09-17', cash_dividend: 0.38 },
]

describe('ttmWindowStart（#100：TTM 窗起日＝today−365，下界不含）', () => {
  it('2026-10-17 → 2025-10-17；非法 today 回 null', () => {
    expect(ttmWindowStart('2026-10-17')).toBe('2025-10-17')
    expect(ttmWindowStart('2026-03-01')).toBe('2025-03-01')
    expect(ttmWindowStart('bad')).toBeNull()
    expect(ttmWindowStart('2026-02-31')).toBeNull()
  })

  it('回看天數＝YIELD_TTM_DAYS＝365', () => {
    expect(YIELD_TTM_DAYS).toBe(365)
  })
})

describe('computeYieldBreakdown（#100：00878 手算可重現）', () => {
  const b = computeYieldBreakdown('00878', d878, TODAY, 35.53)

  it('TTM＝(0.40+0.42+0.66+1.01)/35.53＝7.01%、次數 4', () => {
    expect(b.ttm.perShareTotal).toBeCloseTo(2.49, 10)
    expect(b.ttm.count).toBe(4)
    expect(b.ttm.fromDate).toBe('2025-10-17')
    expect(b.ttm.value).toBeCloseTo(7.007, 2)
    expect(Number(b.ttm.value!.toFixed(2))).toBe(7.01)
  })

  it('TTM 卡片次數＝事件清單筆數（新→舊）', () => {
    expect(b.events).toHaveLength(b.ttm.count)
    expect(b.events.map((e) => e.exDate)).toEqual(['2026-08-18', '2026-05-19', '2026-02-26', '2025-11-18'])
    expect(b.events.map((e) => e.cash)).toEqual([1.01, 0.66, 0.42, 0.4])
    // 當次殖利率＝cash ÷ 現價 ×100（1.01 ÷ 35.53）
    expect(b.events[0].yieldOnPrice).toBeCloseTo((1.01 / 35.53) * 100, 8)
  })

  it('YTD＝2.09/35.53＝5.88%、今年已除息 3 筆', () => {
    expect(b.cur.perShareTotal).toBeCloseTo(2.09, 10)
    expect(b.cur.count).toBe(3)
    expect(Number(b.cur.value!.toFixed(2))).toBe(5.88)
  })

  it('5 年平均（現價口徑）＝(0.98+1.18+1.24+2.01+1.77)/5 ÷35.53＝4.04%、窗 2021–2025 無缺年', () => {
    expect(b.avg5.value).toBeCloseTo((1.436 / 35.53) * 100, 10)
    expect(Number(b.avg5.value!.toFixed(2))).toBe(4.04)
    expect(b.avg5.coveredYears).toEqual(['2021', '2022', '2023', '2024', '2025'])
    expect(b.avg5.missingYears).toEqual([])
    expect(b.avg5.partial).toBe(false)
    expect(b.avg5.years.map((y) => y.year)).toEqual(['2021', '2022', '2023', '2024', '2025'])
  })

  it('逐年明細 2021–2026：每年筆數／每股合計', () => {
    expect(b.yearly.map((y) => [y.year, y.count, Number(y.perShareTotal.toFixed(2))])).toEqual([
      ['2021', 4, 0.98],
      ['2022', 4, 1.18],
      ['2023', 4, 1.24],
      ['2024', 4, 2.01],
      ['2025', 4, 1.77],
      ['2026', 3, 2.09],
    ])
  })

  it('預告事件（ex_date > today）不計入 YTD（未來不墊高）', () => {
    const withForecast = computeYieldBreakdown('00878', [...d878, { symbol: '00878', ex_date: '2026-11-20', cash_dividend: 5 }], TODAY, 35.53)
    expect(withForecast.cur.perShareTotal).toBeCloseTo(2.09, 10)
    expect(withForecast.cur.count).toBe(3)
  })

  it('TTM 下界不含：fromDate 當日除息屬前一年窗', () => {
    const rows: YieldHistoryEntry[] = [
      { symbol: '2330', ex_date: '2025-10-17', cash_dividend: 9 }, // ＝fromDate，不計
      { symbol: '2330', ex_date: '2025-10-18', cash_dividend: 3 }, // 計
    ]
    const r = computeYieldBreakdown('2330', rows, TODAY, 100)
    expect(r.ttm.perShareTotal).toBeCloseTo(3, 10)
    expect(r.ttm.count).toBe(1)
  })
})

describe('computeYieldBreakdown（#100：00929 月配 12 筆）', () => {
  it('TTM 次數 12、合計 2.23；窗外事件不計', () => {
    const b = computeYieldBreakdown('00929', d929, TODAY, 21.5)
    expect(b.ttm.count).toBe(12)
    expect(b.ttm.perShareTotal).toBeCloseTo(2.23, 10)
    expect(b.events).toHaveLength(12)
    expect(Number(b.ttm.value!.toFixed(2))).toBe(Number(((2.23 / 21.5) * 100).toFixed(2)))
  })

  it('逐年代號不混入（同代號大小寫／空白等效）', () => {
    const b = computeYieldBreakdown(' 00878 ', d878, TODAY, 35.53)
    expect(b.ttm.count).toBe(4)
    expect(b.ttm.perShareTotal).toBeCloseTo(2.49, 10)
  })
})

describe('computeYieldBreakdown（#100：今年零筆除息 → null、不顯示 0.00%）', () => {
  const annual: YieldHistoryEntry[] = [
    { symbol: '1101', ex_date: '2024-07-10', cash_dividend: 2 },
    { symbol: '1101', ex_date: '2025-07-09', cash_dividend: 2.2 },
  ]

  it('今年零筆：cur.value＝null、count＝0（UI 顯示「—」＋「今年尚未除息」）', () => {
    const b = computeYieldBreakdown('1101', annual, TODAY, 40)
    expect(b.cur.count).toBe(0)
    expect(b.cur.perShareTotal).toBe(0)
    expect(b.cur.value).toBeNull()
    expect(b.cur.value).not.toBe(0)
  })

  it('computeCurrentYearYield(0, price) 回 null（#100 修 0.00% 缺陷）', () => {
    expect(computeCurrentYearYield(0, 500)).toBeNull()
    expect(computeCurrentYearYield(-1, 500)).toBeNull()
  })

  it('年配股 TTM 次數＝1（配息頻率由次數揭露）', () => {
    const b = computeYieldBreakdown('1101', annual, TODAY, 40)
    // 2025-07-09 距今日 2026-10-17 已 465 天 → 近 365 天無除息
    expect(b.ttm.count).toBe(0)
    // 除息日前一年內（2026-07-08）看得到去年那一次 → 次數 1
    const b2 = computeYieldBreakdown('1101', annual, '2026-07-08', 40)
    expect(b2.ttm.count).toBe(1)
    expect(b2.ttm.perShareTotal).toBeCloseTo(2.2, 10)
  })
})

describe('computeYieldBreakdown（#100：美股／現價非法 → —，次數照算且不為 0）', () => {
  it('現價 0：value 全 null，但筆數／事件仍列出', () => {
    const b = computeYieldBreakdown('00878', d878, TODAY, 0)
    expect(b.ttm.value).toBeNull()
    expect(b.cur.value).toBeNull()
    expect(b.avg5.value).toBeNull()
    expect(b.ttm.count).toBe(4)
    expect(b.events).toHaveLength(4)
    expect(b.events[0].yieldOnPrice).toBeNull()
  })

  it('無資料代號（美股無真源）：次數 0、events 空、value null（不顯示 0）', () => {
    const b = computeYieldBreakdown('AAPL', d878, TODAY, 200)
    expect(b.ttm.count).toBe(0)
    expect(b.ttm.value).toBeNull()
    expect(b.events).toEqual([])
    expect(b.cur.value).toBeNull()
    expect(b.avg5.value).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #101：逐年已實現殖利率（÷該年最後一次除息日昨收）＝Yahoo 同義
// ─────────────────────────────────────────────────────────────────────────────
describe('computeRealizedYearYields（#101：00878 逐年已實現）', () => {
  const years = ['2021', '2022', '2023', '2024', '2025', '2026']
  const r = computeRealizedYearYields('00878', d878, years)

  it('分母＝該年最後一次除息日昨收（2021–2025：18.85/16.77/20.69/22.73/21.11）', () => {
    expect(r.years.map((y) => [y.year, y.prevClose])).toEqual([
      ['2021', 18.85],
      ['2022', 16.77],
      ['2023', 20.69],
      ['2024', 22.73],
      ['2025', 21.11],
      ['2026', 33.75],
    ])
  })

  it('逐年值＝期望值 5.20/7.04/5.99/8.84/8.38/6.19%（±0.02）', () => {
    const got = r.years.map((y) => Number(y.value!.toFixed(2)))
    expect(got).toEqual([5.2, 7.04, 5.99, 8.84, 8.38, 6.19])
    // 手算：0.98/18.85；1.18/16.77；1.24/20.69；2.01/22.73；1.77/21.11；2.09/33.75
    expect(Number(((0.98 / 18.85) * 100).toFixed(2))).toBe(5.2)
    expect(Number(((2.09 / 33.75) * 100).toFixed(2))).toBe(6.19)
  })

  it('5 年平均（逐年已實現）＝7.09%（±0.02）；窗 (Y-5)..(Y-1)＝2021–2025', () => {
    const five = r.years.filter((y) => y.year !== '2026')
    const avg = computeRealizedAvgYield(five)
    expect(Number(avg.value!.toFixed(2))).toBe(7.09)
    expect(avg.coveredYears).toEqual(['2021', '2022', '2023', '2024', '2025'])
    expect(avg.missingYears).toEqual([])
    expect(avg.partial).toBe(false)
    // 現價口徑不得被影響（回歸）：4.04%（1.436÷35.53）
    const b = computeYieldBreakdown('00878', d878, TODAY, 35.53)
    expect(Number(b.avg5.value!.toFixed(2))).toBe(4.04)
  })

  it('分子＝該年每股現金合計（同 yearlyPerShareTotals 口徑）', () => {
    expect(r.years.map((y) => [y.count, Number(y.perShareTotal.toFixed(2))])).toEqual([
      [4, 0.98],
      [4, 1.18],
      [4, 1.24],
      [4, 2.01],
      [4, 1.77],
      [3, 2.09],
    ])
  })
})

describe('computeRealizedYearYields（#101：缺 prev_close → null，不代墊）', () => {
  it('整年都沒有 prev_close → value null（且除以 0 或現價都不算）', () => {
    const rows: YieldHistoryEntry[] = [
      { symbol: '0051', ex_date: '2025-11-21', cash_dividend: 3 },
      { symbol: '0051', ex_date: '2024-11-22', cash_dividend: 2.46 },
    ]
    const r = computeRealizedYearYields('0051', rows, ['2024', '2025', '2026'])
    expect(r.years.map((y) => y.prevClose)).toEqual([null, null, null])
    expect(r.years.map((y) => y.value)).toEqual([null, null, null])
    // 缺年（count 0）同樣 null，不得補 0
    expect(r.years[2].count).toBe(0)
    // 平均只計有值年份 → 全缺 → null＋partial（不得回 0）
    expect(r.avg.value).toBeNull()
    expect(r.avg.partial).toBe(true)
    expect(r.avg.missingYears).toEqual(['2024', '2025', '2026'])
  })

  it('該年最後一次除息事件缺前收 → 取該年往前最近一筆有值者', () => {
    const rows: YieldHistoryEntry[] = [
      { symbol: '1101', ex_date: '2026-07-09', cash_dividend: 2.2, prev_close: 40.5 },
      { symbol: '1101', ex_date: '2026-08-20', cash_dividend: 0.5 }, // 最後一次，無前收
    ]
    const r = computeRealizedYearYields('1101', rows, ['2026'])
    expect(r.years[0].prevClose).toBe(40.5)
    expect(Number(r.years[0].value!.toFixed(4))).toBe(Number((((2.7 / 40.5) * 100).toFixed(4))))
  })

  it('不用現價代墊：資金全無前收時 value 仍 null（現價僅影響現價口徑）', () => {
    const rows: YieldHistoryEntry[] = [{ symbol: '1101', ex_date: '2025-07-09', cash_dividend: 2.2 }]
    const r = computeRealizedYearYields('1101', rows, ['2025'], TODAY)
    expect(r.years[0].value).toBeNull()
    expect(r.years[0].perShareTotal).toBe(2.2)
  })

  it('帶 today 時僅計已除息（未來預告不計入）；分母取自窗內最後一次', () => {
    const rows: YieldHistoryEntry[] = [
      { symbol: '00878', ex_date: '2026-02-26', cash_dividend: 0.42, prev_close: 24 },
      { symbol: '00878', ex_date: '2026-08-18', cash_dividend: 1.01, prev_close: 33.75 },
      { symbol: '00878', ex_date: '2026-11-20', cash_dividend: 5, prev_close: 40 },
    ]
    const r = computeRealizedYearYields('00878', rows, ['2026'], TODAY)
    expect(r.years[0].count).toBe(2)
    expect(r.years[0].prevClose).toBe(33.75)
    expect(Number(r.years[0].value!.toFixed(2))).toBe(4.24) // 1.43 / 33.75
  })
})

describe('computeRealizedYearYields（#101：月配 ETF 以該年最後一次除息日昨收為分母）', () => {
  const rows: YieldHistoryEntry[] = [
    { symbol: '00929', ex_date: '2026-01-20', cash_dividend: 0.1, prev_close: 18.0 },
    { symbol: '00929', ex_date: '2026-02-24', cash_dividend: 0.1, prev_close: 18.2 },
    { symbol: '00929', ex_date: '2026-03-18', cash_dividend: 0.11, prev_close: 18.5 },
    { symbol: '00929', ex_date: '2026-09-17', cash_dividend: 0.38, prev_close: 17.5 },
  ]

  it('逐年＝全年合計 ÷ 最後一次除息日昨收（不得改成逐次殖利率平均）', () => {
    const r = computeRealizedYearYields('00929', rows, ['2026'])
    expect(r.years[0].perShareTotal).toBeCloseTo(0.69, 10)
    expect(r.years[0].prevClose).toBe(17.5)
    expect(Number(r.years[0].value!.toFixed(2))).toBe(Number(((0.69 / 17.5) * 100).toFixed(2))) // 3.94%
    // 逐次殖利率平均會是不同數字（0.1/18 + 0.1/18.2 + 0.11/18.5 + 0.38/17.5)/4 → 0.0113…
    const perEventAvg =
      [0.1 / 18, 0.1 / 18.2, 0.11 / 18.5, 0.38 / 17.5].reduce((a, b) => a + b, 0) / 4
    expect(r.years[0].value! / 100).not.toBeCloseTo(perEventAvg, 6)
  })
})

describe('computeYieldBreakdown（#101：avg5Realized 併入拆解）', () => {
  const b = computeYieldBreakdown('00878', d878, TODAY, 35.53)

  it('avg5Realized.value＝7.09%（窗 2021–2025）；逐年明細 6 年對齊 yearly', () => {
    expect(Number(b.avg5Realized.value!.toFixed(2))).toBe(7.09)
    expect(b.avg5Realized.coveredYears).toEqual(['2021', '2022', '2023', '2024', '2025'])
    expect(b.avg5Realized.missingYears).toEqual([])
    expect(b.avg5Realized.partial).toBe(false)
    expect(b.avg5Realized.years.map((y) => y.year)).toEqual(b.yearly.map((y) => y.year))
    expect(Number(b.avg5Realized.years.at(-1)!.value!.toFixed(2))).toBe(6.19) // 2026：2.09 ÷ 33.75
  })

  it('#100 回歸紅線：TTM 7.01 / YTD 5.88 / 5 年平均（現價）4.04 不得改變', () => {
    expect(Number(b.ttm.value!.toFixed(2))).toBe(7.01)
    expect(b.ttm.perShareTotal).toBeCloseTo(2.49, 10)
    expect(b.ttm.count).toBe(4)
    expect(Number(b.cur.value!.toFixed(2))).toBe(5.88)
    expect(Number(b.avg5.value!.toFixed(2))).toBe(4.04)
    expect(b.events.map((e) => e.exDate)).toEqual(['2026-08-18', '2026-05-19', '2026-02-26', '2025-11-18'])
  })

  it('查無前收的代號（美股／未回填）：avg5Realized null（UI「—」），不影響其他卡', () => {
    const noPrev: YieldHistoryEntry[] = d878.map((r) => ({ ...r, prev_close: null }))
    const b2 = computeYieldBreakdown('00878', noPrev, TODAY, 35.53)
    expect(b2.avg5Realized.value).toBeNull()
    expect(b2.avg5Realized.partial).toBe(true)
    expect(b2.avg5Realized.years.every((y) => y.value === null)).toBe(true)
    // 現價口徑不受影響
    expect(Number(b2.avg5.value!.toFixed(2))).toBe(4.04)
    expect(Number(b2.ttm.value!.toFixed(2))).toBe(7.01)
  })
})
