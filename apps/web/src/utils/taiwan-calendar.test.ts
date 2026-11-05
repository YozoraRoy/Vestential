import { describe, it, expect } from 'vitest'
import {
  TAIWAN_MARKET_HOLIDAYS,
  isTaiwanMarketTradingDay,
  getLastMarketTradingDay,
  formatDateIso,
  formatLastBuyDateWithYear,
} from './taiwan-calendar'

// 以本地時區建構日期（避免 `new Date('YYYY-MM-DD')` 的 UTC 解析在不同時區 getDay 偏移）。
function localDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day)
}

// Issue #66：逐筆比對 TWSE 官方 holidaySchedule（民國 115 年）。
// 官方列出：1150928（一，孔子誕辰/教師節）、1151026（一，光復節補假）、
// 1151225（五，行憲紀念日）、1151009（五，國慶補假）；無 1151012、無 1150302。
describe('TAIWAN_MARKET_HOLIDAYS｜Issue #66 與官方 holidaySchedule 一致', () => {
  it('移除誤列：不含 2026-10-12 與 2026-03-02', () => {
    expect(TAIWAN_MARKET_HOLIDAYS.has('2026-10-12')).toBe(false)
    expect(TAIWAN_MARKET_HOLIDAYS.has('2026-03-02')).toBe(false)
  })

  it('補上缺漏：含 2026-09-28、2026-10-26、2026-12-25', () => {
    expect(TAIWAN_MARKET_HOLIDAYS.has('2026-09-28')).toBe(true)
    expect(TAIWAN_MARKET_HOLIDAYS.has('2026-10-26')).toBe(true)
    expect(TAIWAN_MARKET_HOLIDAYS.has('2026-12-25')).toBe(true)
  })

  it('保留正確既有：2026-10-09（國慶補假）、2026-02-27（和平紀念日補假）仍為休市', () => {
    expect(TAIWAN_MARKET_HOLIDAYS.has('2026-10-09')).toBe(true)
    expect(TAIWAN_MARKET_HOLIDAYS.has('2026-02-27')).toBe(true)
  })

  it('含 2026-10-23（薔琵颱風侵襲臨時休市）', () => {
    expect(TAIWAN_MARKET_HOLIDAYS.has('2026-10-23')).toBe(true)
  })
})

describe('isTaiwanMarketTradingDay｜Issue #66 復驗', () => {
  it("2026-10-12（週一）為交易日 === true", () => {
    expect(isTaiwanMarketTradingDay(localDate(2026, 10, 12))).toBe(true)
  })
  it("2026-10-26（週一，光復節補假）為休市 === false", () => {
    expect(isTaiwanMarketTradingDay(localDate(2026, 10, 26))).toBe(false)
  })
  it('移除日期皆為交易日：2026-03-02（週一）=== true', () => {
    expect(isTaiwanMarketTradingDay(localDate(2026, 3, 2))).toBe(true)
  })
  it('新增日期皆為休市：2026-09-28（週一）=== false、2026-12-25（週五）=== false', () => {
    expect(isTaiwanMarketTradingDay(localDate(2026, 9, 28))).toBe(false)
    expect(isTaiwanMarketTradingDay(localDate(2026, 12, 25))).toBe(false)
  })
  it('週末仍休市：2026-10-10（週六）=== false', () => {
    expect(isTaiwanMarketTradingDay(localDate(2026, 10, 10))).toBe(false)
  })
  it('2026-10-23（週五，薔琵颱風休市）為休市 === false', () => {
    expect(isTaiwanMarketTradingDay(localDate(2026, 10, 23))).toBe(false)
  })
})

describe('getLastMarketTradingDay｜Issue #66 日曆修正後', () => {
  it('2026-10-12（交易日）往回取即自身', () => {
    expect(formatDateIso(getLastMarketTradingDay(localDate(2026, 10, 12)))).toBe('2026-10-12')
  })
  it('2026-10-09（休市）往回取為 2026-10-08', () => {
    expect(formatDateIso(getLastMarketTradingDay(localDate(2026, 10, 9)))).toBe('2026-10-08')
  })
  it('2026-10-26（休市週一）往回取為 2026-10-22（週四，因 10-23 颱風休市、10-24/25 週末）', () => {
    expect(formatDateIso(getLastMarketTradingDay(localDate(2026, 10, 26)))).toBe('2026-10-22')
  })
  it('2026-10-24（週六）往回取為 2026-10-22（週四，因 10-23 颱風休市）', () => {
    expect(formatDateIso(getLastMarketTradingDay(localDate(2026, 10, 24)))).toBe('2026-10-22')
  })
  it('2026-10-23（颱風休市週五）往回取為 2026-10-22', () => {
    expect(formatDateIso(getLastMarketTradingDay(localDate(2026, 10, 23)))).toBe('2026-10-22')
  })
})

describe('formatLastBuyDateWithYear｜最後買進日與電投會後領取日錯位識別', () => {
  it('正常最後買進日（早於股東會開會日）不被標記為錯位', () => {
    // 聯詠 3034：最後買進日 03/26，股東會 05/29
    const res = formatLastBuyDateWithYear('03/26', '05/29')
    expect(res).not.toBeNull()
    expect(res?.isPickupDateMisplaced).toBe(false)
    expect(res?.formattedDate).toContain('03/26')
  })

  it('會後電投領取截止日（晚於股東會開會日）精確識別為錯位', () => {
    // 台新新光金 2887：誤植最後買進日 08/14，股東會 06/12
    const res2887 = formatLastBuyDateWithYear('08/14', '06/12')
    expect(res2887).not.toBeNull()
    expect(res2887?.isPickupDateMisplaced).toBe(true)

    // 宏碁 2353：誤植最後買進日 08/20，股東會 05/29
    const res2353 = formatLastBuyDateWithYear('08/20', '05/29')
    expect(res2353).not.toBeNull()
    expect(res2353?.isPickupDateMisplaced).toBe(true)

    // 中保科 9917：誤植最後買進日 07/10，股東會 05/29
    const res9917 = formatLastBuyDateWithYear('07/10', '05/29')
    expect(res9917).not.toBeNull()
    expect(res9917?.isPickupDateMisplaced).toBe(true)
  })
})
