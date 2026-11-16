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
    // 可抵減稅額單獨列示，不混入實拿
    expect(res.taxCredit).toBe(Math.round(26_000 * 0.085))

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

  it('2027 年尚無官方公告時，依 2026 同期推估預覽並標註 isEstimated', () => {
    const res = buildDividendCalendar(
      [{ symbol: '0056', name: '元大高股息', shares: 10000, market: 'tw' }],
      [{ symbol: '0056', ex_date: '2026-02-05', cash_dividend: 1.07 }],
      { today: '2026-11-16', year: 2027 },
    )
    expect(res.isEstimatedYear).toBe(true)
    expect(res.estimatedFromYear).toBe(2026)
    expect(res.eventCount).toBe(1)
    expect(res.months[1]?.events[0]?.exDate).toBe('2027-02-05')
    expect(res.months[1]?.events[0]?.isEstimated).toBe(true)
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
})
