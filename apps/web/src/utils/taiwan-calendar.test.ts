import { describe, it, expect } from 'vitest'
import {
  TAIWAN_MARKET_HOLIDAYS,
  isTaiwanMarketTradingDay,
  getLastMarketTradingDay,
  formatDateIso,
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
})

describe('getLastMarketTradingDay｜Issue #66 日曆修正後', () => {
  it('2026-10-12（交易日）往回取即自身', () => {
    expect(formatDateIso(getLastMarketTradingDay(localDate(2026, 10, 12)))).toBe('2026-10-12')
  })
  it('2026-10-09（休市）往回取為 2026-10-08', () => {
    expect(formatDateIso(getLastMarketTradingDay(localDate(2026, 10, 9)))).toBe('2026-10-08')
  })
  it('2026-10-26（休市週一）往回取為 2026-10-23（週五）', () => {
    expect(formatDateIso(getLastMarketTradingDay(localDate(2026, 10, 26)))).toBe('2026-10-23')
  })
})
