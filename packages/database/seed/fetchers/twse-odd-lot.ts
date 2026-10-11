// Seed 路徑沿用 src 實作（Issue #65：dated 端點，標籤恆等於真實交易日）。
// 此檔僅保留轉出口，避免兩份 fetcher 行為分叉。
export { fetchTwseOddLots, formatDate } from '../../src/fetchers/twse-odd-lot.js'
