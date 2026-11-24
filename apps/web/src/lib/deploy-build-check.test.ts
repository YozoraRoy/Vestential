import { describe, it, expect } from 'vitest'
import { isNewBuildServed } from './deploy-build-check'

describe('isNewBuildServed (#157 / #186)', () => {
  it('版本相符時回傳 true（支援物件與 JSON 字串）', () => {
    expect(isNewBuildServed({ ok: true, build: { version: 'abc1234', builtAt: '2026-11-24T00:00:00Z' } }, 'abc1234')).toBe(true)
    expect(isNewBuildServed(JSON.stringify({ ok: true, build: { version: 'abc1234' } }), 'abc1234')).toBe(true)
  })

  it('版本不符時回傳 false', () => {
    expect(isNewBuildServed({ ok: true, build: { version: 'old9999' } }, 'abc1234')).toBe(false)
  })

  it('缺 build / version 欄位或格式異常時回傳 false', () => {
    expect(isNewBuildServed({ ok: true }, 'abc1234')).toBe(false)
    expect(isNewBuildServed({ ok: true, build: {} }, 'abc1234')).toBe(false)
    expect(isNewBuildServed({ ok: true, build: { version: '' } }, 'abc1234')).toBe(false)
    expect(isNewBuildServed(null, 'abc1234')).toBe(false)
    expect(isNewBuildServed('', 'abc1234')).toBe(false)
    expect(isNewBuildServed('<html>502 Bad Gateway</html>', 'abc1234')).toBe(false)
  })

  it("version === 'unknown' 或 expected === 'unknown' 時回傳 false", () => {
    expect(isNewBuildServed({ ok: true, build: { version: 'unknown' } }, 'unknown')).toBe(false)
    expect(isNewBuildServed({ ok: true, build: { version: 'unknown' } }, 'abc1234')).toBe(false)
    expect(isNewBuildServed({ ok: true, build: { version: 'abc1234' } }, 'unknown')).toBe(false)
    expect(isNewBuildServed({ ok: true, build: { version: 'abc1234' } }, '')).toBe(false)
  })
})
