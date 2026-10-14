import { describe, it, expect } from 'vitest'
import { sortChipRows, type ChipSortableRow } from './chip-sort'

// Issue #75：四欄排序純函式單測（不打 API、不碰引擎）。
const rows: ChipSortableRow[] = [
  { symbol: '2330', direction: 'buy', netShares: 1_200_000, ratioPct: 8.12 },
  { symbol: '2317', direction: 'sell', netShares: -3_400_000, ratioPct: 12.5 },
  { symbol: '2454', direction: 'buy', netShares: 500_000, ratioPct: 5.01 },
  { symbol: '1301', direction: 'sell', netShares: -800_000, ratioPct: 5.01 },
]

describe('sortChipRows（#75 表格排序）', () => {
  it('預設佔比↓：ratioPct 降冪（＝引擎／API／信件順序）', () => {
    expect(sortChipRows(rows, 'ratioPct', 'desc').map((r) => r.symbol)).toEqual([
      '2317',
      '2330',
      '2454',
      '1301',
    ])
  })

  it('佔比↑反轉；同值維持傳入順序（穩定排序，首屏不亂跳）', () => {
    expect(sortChipRows(rows, 'ratioPct', 'asc').map((r) => r.symbol)).toEqual([
      '2454',
      '1301',
      '2330',
      '2317',
    ])
  })

  it('代號 asc/desc 依字串排序', () => {
    expect(sortChipRows(rows, 'symbol', 'asc').map((r) => r.symbol)).toEqual([
      '1301',
      '2317',
      '2330',
      '2454',
    ])
    expect(sortChipRows(rows, 'symbol', 'desc').map((r) => r.symbol)).toEqual([
      '2454',
      '2330',
      '2317',
      '1301',
    ])
  })

  it('方向 asc＝連買在前，desc＝連賣在前（群內保序）', () => {
    expect(sortChipRows(rows, 'direction', 'asc').map((r) => r.symbol)).toEqual([
      '2330',
      '2454',
      '2317',
      '1301',
    ])
    expect(sortChipRows(rows, 'direction', 'desc').map((r) => r.symbol)).toEqual([
      '2317',
      '1301',
      '2330',
      '2454',
    ])
  })

  it('當日淨超依帶符號股數排序', () => {
    expect(sortChipRows(rows, 'netShares', 'desc').map((r) => r.symbol)).toEqual([
      '2330',
      '2454',
      '1301',
      '2317',
    ])
    expect(sortChipRows(rows, 'netShares', 'asc').map((r) => r.symbol)).toEqual([
      '2317',
      '1301',
      '2454',
      '2330',
    ])
  })

  it('不 mutate 輸入', () => {
    const before = rows.map((r) => r.symbol)
    sortChipRows(rows, 'symbol', 'asc')
    expect(rows.map((r) => r.symbol)).toEqual(before)
  })
})
