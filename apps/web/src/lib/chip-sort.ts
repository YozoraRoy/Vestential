/**
 * Issue #75：/chip-radar 表格排序（純函式，可單測；引擎 `buildChipAnomalies`
 * 的 ratioPct desc 順序不受影響——預設排序即該順序，`Array.sort` 穩定故
 * 首屏順序＝API items 順序＝信件順序，重新整理不亂跳）。
 */

export type ChipSortKey = 'symbol' | 'direction' | 'netShares' | 'ratioPct'
export type ChipSortDir = 'asc' | 'desc'

export interface ChipSortableRow {
  symbol: string
  direction: 'buy' | 'sell'
  netShares: number
  ratioPct: number
}

function cmpSymbol(a: ChipSortableRow, b: ChipSortableRow): number {
  return a.symbol.localeCompare(b.symbol, 'en')
}

function cmpDirection(a: ChipSortableRow, b: ChipSortableRow): number {
  // asc＝連買在前（buy=0, sell=1）。
  return (a.direction === 'buy' ? 0 : 1) - (b.direction === 'buy' ? 0 : 1)
}

/** 依指定欄排序（穩定排序，同值維持傳入順序；不 mutate 輸入）。 */
export function sortChipRows<T extends ChipSortableRow>(
  rows: readonly T[],
  key: ChipSortKey,
  dir: ChipSortDir,
): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    let c = 0
    switch (key) {
      case 'symbol':
        c = cmpSymbol(a, b)
        break
      case 'direction':
        c = cmpDirection(a, b)
        break
      case 'netShares':
        c = a.netShares - b.netShares
        break
      case 'ratioPct':
        c = a.ratioPct - b.ratioPct
        break
    }
    return c * sign
  })
}
