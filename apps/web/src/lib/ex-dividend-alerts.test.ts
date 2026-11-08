import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn(async () => true) }))
vi.mock('./email', () => ({ sendMarketFocusAlert: sendMock }))

import {
  alertExLastBuyCountdown,
  alertFillCompleted,
  isExDividendAlertWindow,
  taiwanDateKey,
} from './ex-dividend-alerts'

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

  it('跨日邊界以台北時間判定（UTC 16:20 = 台北隔日 00:20）', () => {
    expect(taiwanDateKey(new Date('2026-11-04T16:20:00Z'))).toBe('2026-11-05')
    expect(isExDividendAlertWindow(new Date('2026-11-04T16:20:00Z'))).toBe(false)
  })
})

describe('半夜不寄信（2026-11-05 00:20 事故回歸）', () => {
  const item = { symbol: '00400A', ex_date: '2026-11-06', ex_last_buy_date: '2026-11-05' }

  beforeEach(() => {
    sendMock.mockClear()
  })

  it('最後買進日提醒：台北 00:20 不得寄出', async () => {
    await alertExLastBuyCountdown([item], new Date('2026-11-04T16:20:00Z'))
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('最後買進日提醒：08:29 仍不寄，08:30 才寄', async () => {
    await alertExLastBuyCountdown([item], new Date('2026-11-05T00:29:00Z'))
    expect(sendMock).not.toHaveBeenCalled()

    await alertExLastBuyCountdown([item], new Date('2026-11-05T00:30:00Z'))
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('最後買進日提醒：同日重複讀取只寄一封', async () => {
    await alertExLastBuyCountdown([item], new Date('2026-11-06T01:00:00Z'))
    await alertExLastBuyCountdown([item], new Date('2026-11-06T02:00:00Z'))
    await alertExLastBuyCountdown([item], new Date('2026-11-06T05:30:00Z'))
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('填息完成：00:20 不得寄出', async () => {
    await alertFillCompleted([{ symbol: '2330', ex_date: '2026-11-03', daysToFill: 2 }], new Date('2026-11-04T16:20:00Z'))
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('填息完成：08:30 後寄出且同日只一封', async () => {
    const items = [{ symbol: '2317', ex_date: '2026-11-04', daysToFill: 3 }]
    await alertFillCompleted(items, new Date('2026-11-07T01:00:00Z'))
    await alertFillCompleted(items, new Date('2026-11-07T02:00:00Z'))
    expect(sendMock).toHaveBeenCalledTimes(1)
  })
})
