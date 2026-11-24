import { describe, it, expect } from 'vitest'
import { beforeOddLotSyncDeadline, classifyOddLotFreshness, ODD_LOT_EXPECTED_SYNC_DEADLINE_TW, resolveBuildInfo } from './health'

/** 以「台灣時間牆鐘」建構 UTC ms（TW = UTC+8，台灣無日光節約，偏移恆為 8h）。 */
function twMs(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour - 8, minute)
}

describe('ODD_LOT_EXPECTED_SYNC_DEADLINE_TW', () => {
  it('定義為 TW 20:10（當日分鐘數 1210）', () => {
    expect(ODD_LOT_EXPECTED_SYNC_DEADLINE_TW).toBe(20 * 60 + 10)
  })
})

describe('beforeOddLotSyncDeadline｜窗口一：交易日收盤前（00:00~15:30 TW）維持 warn', () => {
  it('15:30 前 → 屬預期（pending=true）', () => {
    expect(beforeOddLotSyncDeadline(twMs(2026, 9, 15, 10, 0), '20260915')).toBe(true)
  })
  it('15:30 整點 → 仍在窗口內（pending=true）', () => {
    expect(beforeOddLotSyncDeadline(twMs(2026, 9, 15, 15, 30), '20260915')).toBe(true)
  })
})

describe('beforeOddLotSyncDeadline｜窗口二：交易日 15:30~20:10 TW 降 warn', () => {
  it('16:00 → 屬預期（pending=true）', () => {
    expect(beforeOddLotSyncDeadline(twMs(2026, 9, 15, 16, 0), '20260915')).toBe(true)
  })
  it('19:59 → 屬預期（pending=true）', () => {
    expect(beforeOddLotSyncDeadline(twMs(2026, 9, 15, 19, 59), '20260915')).toBe(true)
  })
  it('20:09 → 屬預期（pending=true）', () => {
    expect(beforeOddLotSyncDeadline(twMs(2026, 9, 15, 20, 9), '20260915')).toBe(true)
  })
})

describe('beforeOddLotSyncDeadline｜窗口三：交易日 20:10 TW 之後仍缺維持 error', () => {
  it('20:10 整點 → 窗口關閉（pending=false → error）', () => {
    expect(beforeOddLotSyncDeadline(twMs(2026, 9, 15, 20, 10), '20260915')).toBe(false)
  })
  it('20:30 → 非預期（pending=false → error）', () => {
    expect(beforeOddLotSyncDeadline(twMs(2026, 9, 15, 20, 30), '20260915')).toBe(false)
  })
  it('23:59 → 非預期（pending=false → error）', () => {
    expect(beforeOddLotSyncDeadline(twMs(2026, 9, 15, 23, 59), '20260915')).toBe(false)
  })
})

describe('beforeOddLotSyncDeadline｜跨日／非交易日不誤放', () => {
  it('週一早上、預期為上週五 → false（error）', () => {
    expect(beforeOddLotSyncDeadline(twMs(2026, 9, 14, 9, 0), '20260911')).toBe(false)
  })
  it('週日、預期為上週五 → false（error）', () => {
    expect(beforeOddLotSyncDeadline(twMs(2026, 9, 13, 12, 0), '20260911')).toBe(false)
  })
  it('週五 20:10 前、預期為當日 → true（warn）', () => {
    expect(beforeOddLotSyncDeadline(twMs(2026, 9, 11, 16, 0), '20260911')).toBe(true)
  })
  it('週五 21:00 仍缺 → false（error）', () => {
    expect(beforeOddLotSyncDeadline(twMs(2026, 9, 11, 21, 0), '20260911')).toBe(false)
  })
  it('凌晨跨日邊界：TW 00:30（UTC 前一日 16:30）仍屬當日窗口 → true', () => {
    expect(beforeOddLotSyncDeadline(twMs(2026, 9, 15, 0, 30), '20260915')).toBe(true)
  })
})

describe('classifyOddLotFreshness｜Issue #65 最新日期不得超前預期交易日', () => {
  it('一致 → ok', () => {
    expect(classifyOddLotFreshness('20261008', '20261008')).toBe('ok')
  })
  it('落後 → stale', () => {
    expect(classifyOddLotFreshness('20261007', '20261008')).toBe('stale')
  })
  it('超前（休市日錯標籤如 20261009）→ future', () => {
    expect(classifyOddLotFreshness('20261009', '20261008')).toBe('future')
  })
  it('無資料 → empty', () => {
    expect(classifyOddLotFreshness(null, '20261008')).toBe('empty')
    expect(classifyOddLotFreshness(undefined, '20261008')).toBe('empty')
  })
})

describe('resolveBuildInfo (#157)', () => {
  it('未注入 env 且無 .build-version 檔時，version 回傳 unknown 且不拋錯', () => {
    const prevBuild = process.env.BUILD_VERSION
    const prevSha = process.env.GITHUB_SHA
    const prevTime = process.env.BUILD_TIME
    delete process.env.BUILD_VERSION
    delete process.env.GITHUB_SHA
    delete process.env.BUILD_TIME
    try {
      const info = resolveBuildInfo('C:/non-existent-dir-for-test')
      expect(info.version).toBe('unknown')
      expect(typeof info.builtAt).toBe('string')
      expect(info.builtAt.length).toBeGreaterThan(0)
    } finally {
      if (prevBuild !== undefined) process.env.BUILD_VERSION = prevBuild
      if (prevSha !== undefined) process.env.GITHUB_SHA = prevSha
      if (prevTime !== undefined) process.env.BUILD_TIME = prevTime
    }
  })

  it('注入 BUILD_VERSION 與 BUILD_TIME 時回傳對應值', () => {
    const prevBuild = process.env.BUILD_VERSION
    const prevTime = process.env.BUILD_TIME
    process.env.BUILD_VERSION = 'sha-test-123'
    process.env.BUILD_TIME = '2026-11-24T06:00:00Z'
    try {
      const info = resolveBuildInfo('C:/non-existent-dir-for-test')
      expect(info).toEqual({ version: 'sha-test-123', builtAt: '2026-11-24T06:00:00Z' })
    } finally {
      if (prevBuild !== undefined) process.env.BUILD_VERSION = prevBuild
      else delete process.env.BUILD_VERSION
      if (prevTime !== undefined) process.env.BUILD_TIME = prevTime
      else delete process.env.BUILD_TIME
    }
  })
})