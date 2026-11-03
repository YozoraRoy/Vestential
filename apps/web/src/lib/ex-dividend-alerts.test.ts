import { describe, expect, it } from 'vitest'
import { isExDividendAlertWindow } from './ex-dividend-alerts'

describe('isExDividendAlertWindow (告警時間窗控制)', () => {
  it('凌晨 01:08 應返回 false（非告警時間窗，避免時間差誤報）', () => {
    // 2026-11-04 01:08:00 (UTC+8) -> 2026-11-03 17:08:00 UTC
    const date = new Date('2026-11-03T17:08:00Z')
    expect(isExDividendAlertWindow(date)).toBe(false)
  })

  it('清晨 08:29 應返回 false', () => {
    // 2026-11-04 08:29:00 (UTC+8) -> 2026-11-04 00:29:00 UTC
    const date = new Date('2026-11-04T00:29:00Z')
    expect(isExDividendAlertWindow(date)).toBe(false)
  })

  it('早上 08:30 盤前起應返回 true（開啟告警）', () => {
    // 2026-11-04 08:30:00 (UTC+8) -> 2026-11-04 00:30:00 UTC
    const date = new Date('2026-11-04T00:30:00Z')
    expect(isExDividendAlertWindow(date)).toBe(true)
  })

  it('下午 16:00 盤後應返回 true', () => {
    // 2026-11-04 16:00:00 (UTC+8) -> 2026-11-04 08:00:00 UTC
    const date = new Date('2026-11-04T08:00:00Z')
    expect(isExDividendAlertWindow(date)).toBe(true)
  })
})
