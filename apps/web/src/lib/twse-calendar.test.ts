import { describe, it, expect } from 'vitest'
import { isTwseTradingDay, getLastCompletedTradingDay } from './twse-calendar'

// Issue #70：lib/twse-calendar 統一引用 utils/taiwan-calendar 正源，
// 補上曾缺漏的 2026-09-28（教師節）、2026-10-26（光復節補假）、
// 2026-12-25（行憲紀念日）；2026-10-12（週一）為交易日。
describe('isTwseTradingDay｜Issue #70 休市日曆雙源統一', () => {
  it('2026-09-28（週一，教師節）為休市 === false', () => {
    expect(isTwseTradingDay('2026-09-28')).toBe(false)
  })
  it('2026-10-26（週一，光復節補假）為休市 === false', () => {
    expect(isTwseTradingDay('2026-10-26')).toBe(false)
  })
  it('2026-12-25（週五，行憲紀念日）為休市 === false', () => {
    expect(isTwseTradingDay('2026-12-25')).toBe(false)
  })
  it('2026-10-12（週一）為交易日 === true', () => {
    expect(isTwseTradingDay('2026-10-12')).toBe(true)
  })
})

describe('getLastCompletedTradingDay｜Issue #117 / #119 盤前降級時鐘', () => {
  it('週一 11-02 盤前 08:30（未滿 16:00）應回退至前一個交易日（週五 10-30）', () => {
    const mondayMorning = new Date('2026-11-02T08:30:00+08:00')
    expect(getLastCompletedTradingDay(mondayMorning)).toBe('2026-10-30')
  })

  it('週一 11-02 盤後 16:30（超過 16:00）以今日為基準', () => {
    const mondayAfternoon = new Date('2026-11-02T16:30:00+08:00')
    expect(getLastCompletedTradingDay(mondayAfternoon)).toBe('2026-11-02')
  })

  it('週日 11-01 休市日回退至前一個交易日（週五 10-30）', () => {
    const sunday = new Date('2026-11-01T14:00:00+08:00')
    expect(getLastCompletedTradingDay(sunday)).toBe('2026-10-30')
  })

  it('連假休市日（例如 2026-10-26 光復節補假，前週五 10-23 亦休市）回退至前一個交易日（週四 10-22）', () => {
    const holiday = new Date('2026-10-26T10:00:00+08:00')
    expect(getLastCompletedTradingDay(holiday)).toBe('2026-10-22')
  })
})
