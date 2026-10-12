import { describe, it, expect } from 'vitest'
import {
  simulateDca,
  pickMonthlyFirstBars,
  savingsFutureValue,
  DCA_SAVINGS_RATE_DEFAULT,
  type DcaPriceBar,
} from './dca'
import { DEFAULT_FEE_DISCOUNT } from './portfolio-net'

// Issue #69 AC1：0050 5 年每月 5000 試算，期末市值與 adjclose 手算一致（誤差 0）。
// 以固定價合成 60 個月首交易日：每月 5000 / 100 = 50 股 ×60 ＝ 3000 股；期末價 100 → 市值 300000。
function fixedBars(months: number, price: number, startYear = 2021, startMonth = 1): DcaPriceBar[] {
  const bars: DcaPriceBar[] = []
  for (let i = 0; i < months; i++) {
    const y = startYear + Math.floor((startMonth - 1 + i) / 12)
    const m = ((startMonth - 1 + i) % 12) + 1
    const date = `${y}-${String(m).padStart(2, '0')}-03`
    bars.push({ date, close: price })
    // 同月第二個交易日（不應被選為買入價）
    bars.push({ date: `${y}-${String(m).padStart(2, '0')}-05`, close: price + 1 })
  }
  return bars.sort((a, b) => (a.date < b.date ? -1 : 1))
}

describe('pickMonthlyFirstBars（逐月首交易日）', () => {
  it('每月取日期最小者；同月後續交易日不取', () => {
    const bars = fixedBars(3, 100)
    const picks = pickMonthlyFirstBars(bars)
    expect(picks).toHaveLength(3)
    expect(picks.map((p) => p.date)).toEqual(['2021-01-03', '2021-02-03', '2021-03-03'])
    expect(picks.every((p) => p.close === 100)).toBe(true)
  })
})

describe('AC1：0050 5 年每月 5000（固定價手算，誤差 0）', () => {
  it('期末市值＝Σ(5000/價)×期末價；投入本金＝5000×60', () => {
    const r = simulateDca({
      symbol: '0050',
      monthlyAmount: 5000,
      nMonths: 60,
      bars: fixedBars(60, 100),
      dividends: [],
      dividendMode: 'reinvest',
      includeFees: false,
    })
    expect(r.nMonths).toBe(60)
    expect(r.invested).toBe(300000)
    expect(r.shares).toBeCloseTo(3000, 10)
    expect(r.marketValue).toBeCloseTo(300000, 10)
    expect(r.baselineMarketValue).toBeCloseTo(300000, 10)
    expect(r.grossReturnPct).toBeCloseTo(0, 10)
    expect(r.divBoostPp).toBeCloseTo(0, 10)
    expect(r.buys).toHaveLength(60)
  })

  it('變動價手算：3 個月 100/200/100，每月 1000 → 股數 10+5+10=25，市值 25×100=2500', () => {
    const bars: DcaPriceBar[] = [
      { date: '2021-01-04', close: 100 },
      { date: '2021-02-01', close: 200 },
      { date: '2021-03-01', close: 100 },
    ]
    const r = simulateDca({
      symbol: '0050',
      monthlyAmount: 1000,
      nMonths: 3,
      bars,
      dividends: [],
      dividendMode: 'cash',
      includeFees: false,
    })
    expect(r.shares).toBeCloseTo(25, 10)
    expect(r.invested).toBe(3000)
    expect(r.marketValue).toBeCloseTo(2500, 10)
    expect(r.grossReturnPct).toBeCloseTo((2500 - 3000) / 3000 * 100, 10)
  })
})

describe('AC2：手續費/證交稅開關', () => {
  const bars = fixedBars(12, 100)
  const base = { symbol: '0050', monthlyAmount: 5000, nMonths: 12, bars, dividends: [], dividendMode: 'reinvest' as const }
  it('開關 on/off 影響淨值；off 時費用全 0 且淨＝總值', () => {
    const on = simulateDca({ ...base, includeFees: true })
    const off = simulateDca({ ...base, includeFees: false })
    expect(on.buyFeesTotal).toBeGreaterThan(0)
    expect(on.sellFee).toBeGreaterThan(0)
    expect(on.tax).toBeGreaterThan(0)
    expect(off.buyFeesTotal).toBe(0)
    expect(off.sellFee).toBe(0)
    expect(off.tax).toBe(0)
    expect(off.netTotal).toBeCloseTo(off.totalValue, 10)
    expect(on.netTotal).toBeLessThan(off.netTotal)
  })
  it('費率沿 portfolio.fee_discount（預設 6 折）；不足 NT$20 以 20 計', () => {
    const r = simulateDca({ ...base, includeFees: true })
    expect(r.feeDiscount).toBe(DEFAULT_FEE_DISCOUNT)
    // 每月 5000×0.1425%×0.6＝4.275 → 未滿 20 以 20 計 ×12 ＝ 240
    expect(r.buyFeesTotal).toBe(240)
  })
  it('ETF（00 開頭）稅率 0.1%，個股 0.3%', () => {
    const etf = simulateDca({ ...base, includeFees: true })
    const stock = simulateDca({ ...base, symbol: '2330', includeFees: true })
    expect(etf.isEtf).toBe(true)
    expect(etf.taxRate).toBeCloseTo(0.001, 10)
    expect(stock.isEtf).toBe(false)
    expect(stock.taxRate).toBeCloseTo(0.003, 10)
    expect(etf.tax).toBe(Math.round(etf.marketValue * 0.001))
    expect(stock.tax).toBe(Math.round(stock.marketValue * 0.003))
  })
})

describe('AC3：股利再投入 vs 領現', () => {
  // 12 個月固定價 100，每月 1000 → 每月 10 股；第 6 個月除息每股 5 元。
  const bars = fixedBars(12, 100)
  const dividends = [{ exDate: '2021-06-10', cashPerShare: 5 }]
  const base = { symbol: '0050', monthlyAmount: 1000, nMonths: 12, bars, dividends }
  it('兩模式數字不同且各自可驗', () => {
    const re = simulateDca({ ...base, dividendMode: 'reinvest', includeFees: false })
    const cash = simulateDca({ ...base, dividendMode: 'cash', includeFees: false })
    // 除息日時持有：1~6 月買入＝60 股 → 現金 300；再投入價 100 → +3 股
    expect(cash.cashDividends).toBeCloseTo(300, 10)
    expect(cash.shares).toBeCloseTo(120, 10)
    expect(re.cashDividends).toBe(0)
    expect(re.shares).toBeCloseTo(123, 10)
    expect(re.totalValue).toBeCloseTo(12300, 10)
    expect(cash.totalValue).toBeCloseTo(12000 + 300, 10)
    // 裸價差一致（同基準），加成分 defensively 不同口徑但此例同值 300/12000
    expect(re.grossReturnPct).toBeCloseTo(cash.grossReturnPct, 10)
    expect(re.divBoostPp).toBeCloseTo((12300 - 12000) / 12000 * 100, 10)
    expect(cash.divBoostPp).toBeCloseTo(300 / 12000 * 100, 10)
  })
})

describe('AC4：定存對照利率為常數（預設 1.5%）', () => {
  it('預設常數 0.015；改值後曲線隨之變化；零利率＝本金', () => {
    expect(DCA_SAVINGS_RATE_DEFAULT).toBe(0.015)
    expect(savingsFutureValue(1000, 12, 0)).toBe(12000)
    const low = savingsFutureValue(1000, 12, 0.015)
    const high = savingsFutureValue(1000, 12, 0.03)
    expect(high).toBeGreaterThan(low)
    expect(low).toBeGreaterThan(12000)
  })
  it('simulateDca 回傳 savingsValue 與倍數', () => {
    const r = simulateDca({
      symbol: '0050', monthlyAmount: 5000, nMonths: 12,
      bars: fixedBars(12, 100), dividends: [], dividendMode: 'reinvest',
      includeFees: false, savingsAnnualRate: 0.015,
    })
    expect(r.savingsAnnualRate).toBe(0.015)
    expect(r.savingsValue).toBeCloseTo(savingsFutureValue(5000, 12, 0.015), 10)
    expect(r.savingsMultiple).toBeCloseTo(r.totalValue / r.savingsValue, 10)
  })
})
