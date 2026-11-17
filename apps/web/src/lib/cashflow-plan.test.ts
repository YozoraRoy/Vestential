import { describe, expect, it } from 'vitest'
import {
  buildAssetProfile,
  CASHFLOW_STYLE_TEMPLATES,
  CASHFLOW_TARGET_PRESETS,
  DEFAULT_CASHFLOW_TARGET,
  evaluateCashflowPlan,
  solveTargetLots,
} from './cashflow-plan'

describe('cashflow-plan engine (Issue #153)', () => {
  const p0056 = buildAssetProfile({
    symbol: '0056',
    name: '元大高股息',
    price: 38,
    today: '2026-11-17',
    rawDividends: [
      { ex_date: '2026-01-22', pay_date: '2026-02-11', cash_dividend: 0.866 },
      { ex_date: '2026-04-23', pay_date: '2026-05-14', cash_dividend: 1.0 },
      { ex_date: '2026-07-21', pay_date: '2026-08-10', cash_dividend: 1.35 },
      { ex_date: '2026-10-22', pay_date: '2026-11-11', cash_dividend: 1.72 },
    ],
  })

  const p00878 = buildAssetProfile({
    symbol: '00878',
    name: '國泰永續高股息',
    price: 22,
    today: '2026-11-17',
    rawDividends: [
      { ex_date: '2026-02-26', pay_date: '2026-03-25', cash_dividend: 0.42 },
      { ex_date: '2026-05-19', pay_date: '2026-06-15', cash_dividend: 0.66 },
      { ex_date: '2026-08-18', pay_date: '2026-09-14', cash_dividend: 1.01 },
      { ex_date: '2025-11-18', pay_date: '2025-12-12', cash_dividend: 0.4 },
    ],
  })

  const p00919 = buildAssetProfile({
    symbol: '00919',
    name: '群益台灣精選高息',
    price: 24,
    today: '2026-11-17',
    rawDividends: [
      { ex_date: '2025-12-16', pay_date: '2026-01-13', cash_dividend: 0.54 },
      { ex_date: '2026-03-17', pay_date: '2026-04-14', cash_dividend: 0.78 },
      { ex_date: '2026-06-16', pay_date: '2026-07-13', cash_dividend: 1.0 },
      { ex_date: '2026-09-16', pay_date: '2026-10-15', cash_dividend: 1.1 },
    ],
  })

  it('預設目標為 4 萬且包含 2/4/6/8/10 萬檔位與 3 種風格範本', () => {
    expect(DEFAULT_CASHFLOW_TARGET).toBe(40_000)
    expect(CASHFLOW_TARGET_PRESETS).toEqual([20_000, 40_000, 60_000, 80_000, 100_000])
    expect(CASHFLOW_STYLE_TEMPLATES).toHaveLength(3)
  })

  it('反推建議張數後，年化稅後實拿 >= 月領目標 * 12 且依實際發放月歸類', () => {
    const solved = solveTargetLots(
      [
        { asset: p0056, weight: 0.34 },
        { asset: p00878, weight: 0.33 },
        { asset: p00919, weight: 0.33 },
      ],
      40_000,
    )
    const evalRes = evaluateCashflowPlan(solved, 40_000)
    expect(evalRes.annualNet).toBeGreaterThanOrEqual(480_000)
    expect(evalRes.totalCapital).toBeGreaterThan(0)
    // 三檔季配錯開應涵蓋全年度 12 個發放月份
    const activeMonths = evalRes.months.filter((m) => m.net > 0).length
    expect(activeMonths).toBe(12)
  })

  it('00992A (54C=0%) 即使單次領超過 2 萬元也不扣二代健保，且無紀錄時標記 insufficientHistory', () => {
    const pEmpty = buildAssetProfile({
      symbol: '009816',
      name: '凱基台灣TOP50',
      price: 15,
      today: '2026-11-17',
      rawDividends: [],
    })
    expect(pEmpty.insufficientHistory).toBe(true)

    const p992a = buildAssetProfile({
      symbol: '00992A',
      name: '群益科技高息成長',
      price: 16,
      today: '2026-11-17',
      rawDividends: [{ ex_date: '2026-10-20', pay_date: '2026-11-12', cash_dividend: 0.85 }],
    })
    const evalRes = evaluateCashflowPlan([{ asset: p992a, lots: 30 }], 40_000)
    expect(evalRes.annualGross).toBe(25_500)
    expect(evalRes.annualNhiFee).toBe(0)
    expect(evalRes.assets[0]?.safeMaxLots).toBeNull()
  })
})
