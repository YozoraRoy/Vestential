import { describe, it, expect } from 'vitest'
import {
  buildDividendCalendar,
  computeDividendTaxCredit,
  computeNhiSupplementFee,
  shouldWarnNhiForHolding,
  DIVIDEND_TAX_CREDIT_CAP,
} from './dividend-calendar'

describe('Issue #120 dividend-calendar engine', () => {
  it('二代健保邊界：單筆 19,999 元不扣、20,000 元扣 2.11%', () => {
    expect(computeNhiSupplementFee(19_999)).toBe(0)
    expect(computeNhiSupplementFee(20_000)).toBe(422) // 20000 * 0.0211 = 422
    expect(computeNhiSupplementFee(0)).toBe(0)
    expect(computeNhiSupplementFee(-100)).toBe(0)
  })

  it('可抵減稅額上限 80,000 元正確（8.5%）', () => {
    expect(computeDividendTaxCredit(100_000)).toBe(8_500)
    // 超過上限：1,000,000 * 8.5% = 85,000 -> 封頂 80,000
    expect(computeDividendTaxCredit(1_000_000)).toBe(DIVIDEND_TAX_CREDIT_CAP)
    expect(computeDividendTaxCredit(0)).toBe(0)
  })

  it('給定持股（2330 1000 股、0050 500 股）與 2026 股利，月曆落在對應月份且狀態/稅後一致', () => {
    const res = buildDividendCalendar(
      [
        { symbol: '2330', name: '台積電', shares: 1000, market: 'tw', marketValue: 1_000_000 },
        { symbol: '0050', name: '元大台灣50', shares: 500, market: 'tw', marketValue: 100_000 },
      ],
      [
        { symbol: '2330', ex_date: '2026-03-18', cash_dividend: 4.5 }, // 4500 (<20k)
        { symbol: '2330', ex_date: '2026-06-15', cash_dividend: 20.0 }, // 20000 (>=20k -> 扣 422)
        { symbol: '0050', ex_date: '2026-07-16', cash_dividend: 3.0 }, // 1500 (<20k)
      ],
      { today: '2026-05-01', year: 2026 },
    )

    expect(res.hasHoldings).toBe(true)
    expect(res.eventCount).toBe(3)
    expect(res.totalGross).toBe(26_000)
    expect(res.totalNhiFee).toBe(422)
    expect(res.totalNet).toBe(26_000 - 422)
    // 可抵減稅額單獨列示，依 54C 應稅比例計算（2330=100%, 0050=82%）
    expect(res.taxCredit).toBe(Math.round((24_500 + 1_500 * 0.82) * 0.085))

    const mar = res.months[2]!
    expect(mar.month).toBe(3)
    expect(mar.totalGross).toBe(4_500)
    expect(mar.events[0]?.exStatus).toBe('ex_passed')
    expect(mar.events[0]?.payDate).toBeNull()
    expect(mar.events[0]?.payStatus).toBe('pending_announcement')

    const jun = res.months[5]!
    expect(jun.month).toBe(6)
    expect(jun.totalGross).toBe(20_000)
    expect(jun.totalNhiFee).toBe(422)
    expect(jun.totalNet).toBe(19_578)
    expect(jun.events[0]?.exStatus).toBe('upcoming')
    expect(jun.events[0]?.nhiTriggered).toBe(true)

    const jul = res.months[6]!
    expect(jul.totalGross).toBe(1_500)
    expect(jul.events[0]?.nhiTriggered).toBe(false)
  })

  it('無持股／無股利時不產生 0 元假事件', () => {
    const emptyHoldings = buildDividendCalendar([], [{ symbol: '2330', ex_date: '2026-06-15', cash_dividend: 4.5 }], {
      today: '2026-05-01',
      year: 2026,
    })
    expect(emptyHoldings.hasHoldings).toBe(false)
    expect(emptyHoldings.eventCount).toBe(0)
    expect(emptyHoldings.months.every((m) => m.events.length === 0 && m.totalGross === 0)).toBe(true)

    const noDivs = buildDividendCalendar(
      [{ symbol: '2330', shares: 1000, market: 'tw' }],
      [{ symbol: '2330', ex_date: '2026-06-15', cash_dividend: 0 }],
      { today: '2026-05-01', year: 2026 },
    )
    expect(noDivs.hasHoldings).toBe(true)
    expect(noDivs.eventCount).toBe(0)
    expect(noDivs.totalGross).toBe(0)
  })

  it('2026-12 與 2027 年尚無官方公告時，依近 3 年同月歷史紀錄均算預估', () => {
    const res2026 = buildDividendCalendar(
      [{ symbol: '00919', name: '群益台灣精選高息', shares: 10000, market: 'tw' }],
      [
        { symbol: '00919', ex_date: '2024-12-20', cash_dividend: 0.72 },
        { symbol: '00919', ex_date: '2025-12-18', cash_dividend: 0.78 },
      ],
      { today: '2026-11-16', year: 2026 },
    )
    expect(res2026.isEstimatedYear).toBe(true)
    expect(res2026.months[11]?.events[0]?.exDate).toBe('2026-12-18')
    expect(res2026.months[11]?.events[0]?.cashDividendPerShare).toBe(0.75)
    expect(res2026.months[11]?.events[0]?.estimateLabel).toBe('近2年同月均算')

    const res2027 = buildDividendCalendar(
      [{ symbol: '0056', name: '元大高股息', shares: 10000, market: 'tw' }],
      [{ symbol: '0056', ex_date: '2026-02-05', cash_dividend: 1.07 }],
      { today: '2026-11-16', year: 2027 },
    )
    expect(res2027.isEstimatedYear).toBe(true)
    expect(res2027.months[1]?.events[0]?.exDate).toBe('2027-02-05')
    expect(res2027.months[1]?.events[0]?.isEstimated).toBe(true)
  })

  it('不配息 ETF（無現金股利紀錄）即使超過 25,000 股也不誤報健保預警', () => {
    const noDivResult = shouldWarnNhiForHolding('009816', 50_000, 'tw', [])
    expect(noDivResult.warn).toBe(false)

    const zeroDivResult = shouldWarnNhiForHolding('009816', 50_000, 'tw', [
      { symbol: '009816', ex_date: '2026-06-01', cash_dividend: 0 },
    ])
    expect(zeroDivResult.warn).toBe(false)

    // 有配息且單次預估 >= 20,000 元才會預警
    const highDivResult = shouldWarnNhiForHolding('0056', 25_000, 'tw', [
      { symbol: '0056', ex_date: '2026-10-15', cash_dividend: 1.07 },
    ])
    expect(highDivResult.warn).toBe(true)
    expect(highDivResult.estimatedGross).toBe(26_750)
  })

  it('依實際領錢月（groupBy=pay）歸類跨月現金流，並僅就 ETF 54C 應稅額計扣健保與抵稅', () => {
    const res = buildDividendCalendar(
      [
        { symbol: '0056', name: '元大高股息', shares: 100_000, market: 'tw' }, // 54C=30%
        { symbol: '00992A', name: '群益科技高息成長', shares: 30_000, market: 'tw' }, // 54C=0%
      ],
      [
        // 0056 1 月除息、2 月發放：總額 86,600 * 0.30 = 25,980 (>= 20,000 -> 扣 2.11% = 548)
        { symbol: '0056', ex_date: '2026-01-22', pay_date: '2026-02-11', cash_dividend: 0.866 },
        // 00992A 10 月除息、11 月發放：總額 25,500，但 54C=0% -> 免扣健保、無抵稅
        { symbol: '00992A', ex_date: '2026-10-20', pay_date: '2026-11-12', cash_dividend: 0.85 },
      ],
      { today: '2026-11-17', year: 2026, groupBy: 'pay', allowEstimate: false },
    )

    // 0056 落在 2 月（months[1]），且狀態為已領息 paid
    expect(res.months[0]?.events).toHaveLength(0)
    expect(res.months[1]?.events).toHaveLength(1)
    expect(res.months[1]?.events[0]?.payDate).toBe('2026-02-11')
    expect(res.months[1]?.events[0]?.payStatus).toBe('paid')
    expect(res.months[1]?.events[0]?.nhiFee).toBe(Math.round(Math.round(86_600 * 0.3) * 0.0211))

    // 00992A 落在 11 月（months[10]），54C=0% 免扣健保
    expect(res.months[10]?.events).toHaveLength(1)
    expect(res.months[10]?.events[0]?.nhiFee).toBe(0)
    expect(res.months[10]?.events[0]?.nhiTriggered).toBe(false)

    // 年度抵稅只算 0056 的 54C 金額
    expect(res.taxCredit).toBe(Math.round(Math.round(86_600 * 0.3) * 0.085))
  })

  it('minShares=1000 剔除不足千股零股（合併同代號後判斷），並只加總有產生股利標的之實際投入成本', () => {
    const res = buildDividendCalendar(
      [
        // 0056 兩筆各 600 股 → 合併為 1,200 股保留，投入成本 20,000 + 22,000 = 42,000
        { symbol: '0056', name: '元大高股息', shares: 600, market: 'tw', costBasis: 20_000 },
        { symbol: '0056', name: '元大高股息', shares: 600, market: 'tw', costBasis: 22_000 },
        // 2884 僅 1 股（紀念品零股）→ 剔除
        { symbol: '2884', name: '玉山金', shares: 1, market: 'tw', costBasis: 28 },
        // 00919 僅 500 股 → 剔除
        { symbol: '00919', name: '群益台灣精選高息', shares: 500, market: 'tw', costBasis: 11_000 },
        // 2330 有 1,000 股但當年無配息事件 → 保留在持股中，但不計入「實際投入產生股利的總金額」
        { symbol: '2330', name: '台積電', shares: 1000, market: 'tw', costBasis: 900_000 },
      ],
      [
        { symbol: '0056', ex_date: '2026-01-22', pay_date: '2026-02-11', cash_dividend: 1.0 },
        { symbol: '2884', ex_date: '2026-07-01', pay_date: '2026-07-28', cash_dividend: 1.4 },
        { symbol: '00919', ex_date: '2026-03-17', pay_date: '2026-04-14', cash_dividend: 0.78 },
      ],
      { today: '2026-11-17', year: 2026, groupBy: 'pay', allowEstimate: false, minShares: 1000 },
    )

    expect(res.excludedHoldings.map((h) => h.symbol)).toEqual(['2884', '00919'])
    expect(res.eventCount).toBe(1)
    expect(res.totalGross).toBe(1200)
    expect(res.dividendGeneratingSymbolCount).toBe(1)
    expect(res.totalInvestedCost).toBe(42_000)
    expect(res.effectiveCostYieldPct).toBe(Math.round((1200 / 42_000) * 10000) / 100)
  })
})
