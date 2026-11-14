import { describe, expect, it } from 'vitest'
import {
  calcTwLimitPrice,
  classifyLimitStatus,
  computeVolumeRatio,
  dedupAnnouncements,
} from './daily-movers'

describe('daily-movers', () => {
  it('classifies limit-up and limit-down with TW tick size and ex-dividend note', () => {
    // 100 元昨收 -> 理論漲停 110.0、跌停 90.0
    expect(calcTwLimitPrice(100, 'up')).toBe(110)
    expect(calcTwLimitPrice(100, 'down')).toBe(90)

    const up = classifyLimitStatus(110, 10, 110, 102)
    expect(up.status).toBe('limit_up')
    expect(up.exDividendNote).toBe(false)

    const down = classifyLimitStatus(90, -10, 99, 90)
    expect(down.status).toBe('limit_down')
    expect(down.exDividendNote).toBe(false)

    // 含除權息參考價微幅差異（>= 9.85% 且收最高）標註 exDividendNote
    const exDiv = classifyLimitStatus(109.9, 9.9, 109.9, 101)
    expect(exDiv.status).toBe('limit_up')
    expect(exDiv.exDividendNote).toBe(true)
  })

  it('computes volume ratio against 5-day average and returns null on missing history', () => {
    expect(computeVolumeRatio(30_000, [10_000, 10_000, 10_000, 10_000])).toBe(3)
    expect(computeVolumeRatio(15_000, [])).toBeNull()
    expect(computeVolumeRatio(0, [10_000, 10_000])).toBeNull()
  })

  it('deduplicates punish/notice announcements and marks only new items as isNew=true', () => {
    const prevKeys = new Set(['punish:2330:2026-11-14:1'])
    const list = dedupAnnouncements(
      [
        {
          type: 'punish',
          code: '2330',
          name: '台積電',
          date: '2026-11-14',
          announcementNo: '1',
          reason: '連續漲停',
        },
        {
          type: 'punish',
          code: '2330',
          name: '台積電',
          date: '2026-11-14',
          announcementNo: '1',
          reason: '重複列',
        },
        {
          type: 'punish',
          code: '2454',
          name: '聯發科',
          date: '2026-11-15',
          announcementNo: '2',
          reason: '週轉率過高',
        },
      ],
      prevKeys,
    )

    expect(list).toHaveLength(2)
    expect(list[0].isNew).toBe(false)
    expect(list[1].code).toBe('2454')
    expect(list[1].isNew).toBe(true)
  })
})
