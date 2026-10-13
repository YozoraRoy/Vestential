import { describe, it, expect, vi, beforeEach } from 'vitest'

// #71 後續文案分流單測：mock email 管線（不寄真信，只斷言文案）。
vi.mock('./email', () => ({
  sendMarketFocusAlert: vi.fn(async () => true),
  sendChipRadarDigest: vi.fn(async () => true),
}))

import { sendMarketFocusAlert } from './email'
import { alertChipFetchFailed } from './chip-alerts'

const mockedAlert = vi.mocked(sendMarketFocusAlert)

describe('alertChipFetchFailed 文案分流（#71 後續）', () => {
  beforeEach(() => {
    mockedAlert.mockClear()
  })

  it('今日未公布情境文案為「晚間再看」，不提排程檢查', async () => {
    await alertChipFetchFailed('partial-days:2026-10-13（資料時間 2026-10-12）', {
      todayNotPublished: true,
    })
    expect(mockedAlert).toHaveBeenCalledTimes(1)
    const [subject, body] = mockedAlert.mock.calls[0] ?? ['', '']
    expect(subject).toBe('籌碼雷達抓取降級')
    expect(body).toContain('今日法人日報尚未公布')
    expect(body).toContain('晚間再看')
    expect(body).not.toContain('請檢查同步排程')
  })

  it('真缺數保留「請檢查同步排程」', async () => {
    await alertChipFetchFailed('partial-days:2026-10-12（資料時間 2026-10-12）')
    expect(mockedAlert).toHaveBeenCalledTimes(1)
    const body = mockedAlert.mock.calls[0]?.[1] ?? ''
    expect(body).toContain('請檢查同步排程')
    expect(body).not.toContain('晚間再看')
  })
})
