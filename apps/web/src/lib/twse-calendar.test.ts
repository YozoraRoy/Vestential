import { describe, it, expect } from 'vitest'
import { isTwseTradingDay } from './twse-calendar'

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
