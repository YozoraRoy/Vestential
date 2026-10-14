/**
 * Issue #76：代號＋名稱的 Google 搜尋 URL（另開新頁查新聞／基本面）。
 *
 * 純函式、無 server 依賴——'use client' 的 `chip-radar/page.tsx` 必須只 import
 * 本檔（`chip-radar.ts` 含 `await import('@stock/database')`＋better-sqlite3，
 * client 引入會污染 bundle，故本函式獨立成檔，單一真相）。
 */
export function googleStockSearchUrl(symbol: string, name: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${symbol.trim()}${name.trim()}`)}`
}
