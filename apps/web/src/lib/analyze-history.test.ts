import { describe, it, expect } from 'vitest'
import { findLatestRecentRecordForSymbol, ANALYZE_RECENT_WINDOW_MS } from './analyze-history'

describe('findLatestRecentRecordForSymbol (#198)', () => {
  const now = Date.UTC(2026, 10, 25, 4, 0, 0) // 2026-11-25T04:00:00Z

  it('7 天內有同標的紀錄（含 0056 / 0056.TW 正規化比對）→ 回傳最新一筆', () => {
    const records = [
      { id: 1, ticker: '0056.TW', created_at: '2026-11-20 03:00:00' },
      { id: 2, ticker: '0056', created_at: '2026-11-24 03:00:00' },
      { id: 3, ticker: '2330.TW', created_at: '2026-11-25 03:00:00' },
    ]
    const hit = findLatestRecentRecordForSymbol(records, '0056', now)
    expect(hit?.id).toBe(2)
  })

  it('超過 7 天 → 回傳 null（應自動觸發新分析）', () => {
    const oldIso = new Date(now - ANALYZE_RECENT_WINDOW_MS - 60_000).toISOString()
    const records = [{ id: 10, ticker: '0056.TW', created_at: oldIso }]
    expect(findLatestRecentRecordForSymbol(records, '0056', now)).toBeNull()
  })

  it('已軟刪除（deleted_at 有值）的紀錄不計入 7 天內快取 → 回傳 null', () => {
    const records = [
      { id: 11, ticker: '0056.TW', created_at: '2026-11-24 03:00:00', deleted_at: '2026-11-25T01:00:00Z' },
    ]
    expect(findLatestRecentRecordForSymbol(records, '0056', now)).toBeNull()
  })

  it('空清單或空代號 → 回傳 null', () => {
    expect(findLatestRecentRecordForSymbol([], '0056', now)).toBeNull()
    expect(findLatestRecentRecordForSymbol([{ id: 1, ticker: '0056', created_at: '2026-11-25 00:00:00' }], '', now)).toBeNull()
  })
})
