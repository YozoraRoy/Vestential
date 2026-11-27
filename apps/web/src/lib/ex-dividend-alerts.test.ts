import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMock, settingStore, dbQueryAllMock, getPortfolioRecordsMock } = vi.hoisted(() => ({
  sendMock: vi.fn<(topic: string, message: string, opts?: { variant?: string; htmlDetail?: string }) => Promise<boolean>>(
    async () => true,
  ),
  settingStore: new Map<string, string>(),
  dbQueryAllMock: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  getPortfolioRecordsMock: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
}))
vi.mock('./email', () => ({ sendMarketFocusAlert: sendMock }))
vi.mock('@stock/database', () => ({
  dbQueryAll: dbQueryAllMock,
  getPortfolioRecords: getPortfolioRecordsMock,
  getAgentSetting: vi.fn(async (key: string) => settingStore.get(key) ?? null),
  setAgentSetting: vi.fn(async ({ key, value }: { key: string; value: string }) => {
    settingStore.set(key, value)
  }),
}))

import {
  alertExLastBuyCountdown,
  alertFillCompleted,
  buildExLastBuyCountdownHtml,
  buildFillCompletedHtml,
  getOwnerHeldSymbols,
  isExDividendAlertWindow,
  stockDisplayLabel,
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

describe('服務通知 HTML（代號＋名稱粗體）', () => {
  it('最後買進日提醒：代號與名稱以 <b> 呈現', () => {
    const html = buildExLastBuyCountdownHtml([
      { symbol: '00940', name: '元大台灣價值高息', ex_date: '2026-11-10', ex_last_buy_date: '2026-11-09' },
    ])
    expect(html).toContain('<b>00940 元大台灣價值高息</b>')
    expect(html).toContain('最後買進日 2026-11-09（今日）')
  })

  it('填息完成：代號與名稱以 <b> 呈現', () => {
    const html = buildFillCompletedHtml([{ symbol: '2330', name: '台積電', ex_date: '2026-11-03', daysToFill: 2 }])
    expect(html).toContain('<b>2330 台積電</b>')
    expect(html).toContain('2 個交易日內填息')
  })

  it('沒有名稱時只顯示代號；名稱含 HTML 會轉義', () => {
    expect(stockDisplayLabel('0056')).toBe('0056')
    const html = buildFillCompletedHtml([
      { symbol: '0056', name: '<script>alert(1)</script>', ex_date: '2026-11-03', daysToFill: 1 },
    ])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('超過 20 檔加註總數', () => {
    const items = Array.from({ length: 21 }, (_, i) => ({
      symbol: `000${i}`,
      ex_date: '2026-11-10',
      ex_last_buy_date: '2026-11-09',
    }))
    expect(buildExLastBuyCountdownHtml(items)).toContain('…等共 21 檔')
  })
})

describe('半夜不寄信（2026-11-05 00:20 事故回歸）', () => {
  const item = { symbol: '00400A', ex_date: '2026-11-06', ex_last_buy_date: '2026-11-05' }
  const held = new Set(['00400A'])

  beforeEach(() => {
    sendMock.mockClear()
    settingStore.clear()
  })

  it('最後買進日提醒：台北 00:20 不得寄出', async () => {
    await alertExLastBuyCountdown([item], new Date('2026-11-04T16:20:00Z'), { heldSymbols: held })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('最後買進日提醒：08:29 仍不寄，08:30 才寄', async () => {
    await alertExLastBuyCountdown([item], new Date('2026-11-05T00:29:00Z'), { heldSymbols: held })
    expect(sendMock).not.toHaveBeenCalled()

    await alertExLastBuyCountdown([item], new Date('2026-11-05T00:30:00Z'), { heldSymbols: held })
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('最後買進日提醒：同日重複讀取只寄一封', async () => {
    const nov6Item = { symbol: '00400A', ex_date: '2026-11-09', ex_last_buy_date: '2026-11-06' }
    await alertExLastBuyCountdown([nov6Item], new Date('2026-11-06T01:00:00Z'), { heldSymbols: held })
    await alertExLastBuyCountdown([nov6Item], new Date('2026-11-06T02:00:00Z'), { heldSymbols: held })
    await alertExLastBuyCountdown([nov6Item], new Date('2026-11-06T05:30:00Z'), { heldSymbols: held })
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

describe('最後買進日提醒：只寄自己帳號持股且僅限今日', () => {
  beforeEach(() => {
    sendMock.mockClear()
    settingStore.clear()
    dbQueryAllMock.mockReset()
    getPortfolioRecordsMock.mockReset()
  })

  it('未持有的股票不會寄出', async () => {
    const items = [
      { symbol: '2330', name: '台積電', ex_date: '2026-11-11', ex_last_buy_date: '2026-11-10' },
      { symbol: '0056', name: '元大高股息', ex_date: '2026-11-11', ex_last_buy_date: '2026-11-10' },
    ]
    await alertExLastBuyCountdown(items, new Date('2026-11-10T01:00:00Z'), {
      heldSymbols: new Set(['2317']),
    })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('日期還很遠（非今日最後買進日）不會寄出', async () => {
    const items = [
      { symbol: '2330', name: '台積電', ex_date: '2026-11-25', ex_last_buy_date: '2026-11-24' },
    ]
    await alertExLastBuyCountdown(items, new Date('2026-11-10T01:00:00Z'), {
      heldSymbols: new Set(['2330']),
    })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('混合清單僅寄送「自己帳號持有」且「今日最後買進日」的標的', async () => {
    const items = [
      { symbol: '2330', name: '台積電', ex_date: '2026-11-12', ex_last_buy_date: '2026-11-11' },
      { symbol: '0056', name: '元大高股息', ex_date: '2026-11-12', ex_last_buy_date: '2026-11-11' },
      { symbol: '2317', name: '鴻海', ex_date: '2026-11-20', ex_last_buy_date: '2026-11-19' },
    ]
    await alertExLastBuyCountdown(items, new Date('2026-11-11T01:00:00Z'), {
      heldSymbols: new Set(['2330', '2317']),
    })
    expect(sendMock).toHaveBeenCalledTimes(1)
    const firstCall = sendMock.mock.calls[0]!
    const body = firstCall[1]
    const opts = firstCall[2]
    expect(body).toContain('2330 台積電')
    expect(body).not.toContain('0056')
    expect(body).not.toContain('2317')
    expect(opts?.htmlDetail).toContain('<b>2330 台積電</b>')
    expect(opts?.htmlDetail).not.toContain('0056')
  })

  it('getOwnerHeldSymbols 依 NOTIFY_TO 查詢持股並過濾 shares<=0 與美股', async () => {
    const prevNotify = process.env.NOTIFY_TO
    process.env.NOTIFY_TO = 'owner@example.com'
    try {
      dbQueryAllMock
        .mockResolvedValueOnce([{ id: 7 }])
        .mockResolvedValueOnce([])
      getPortfolioRecordsMock.mockResolvedValueOnce([
        { symbol: '2330.TW', market: 'tw', shares: 1000 },
        { symbol: '0050', market: 'tw', shares: 0 },
        { symbol: 'AAPL', market: 'us', shares: 10 },
      ])
      const held = await getOwnerHeldSymbols()
      expect([...held]).toEqual(['2330'])
    } finally {
      if (prevNotify === undefined) delete process.env.NOTIFY_TO
      else process.env.NOTIFY_TO = prevNotify
    }
  })
})
