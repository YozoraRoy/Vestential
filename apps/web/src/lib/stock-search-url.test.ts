import { describe, it, expect } from 'vitest'
import { googleStockSearchUrl } from './stock-search-url'

// Issue #76：代號 Google 搜尋連結（純函式單測，不打網）。
describe('googleStockSearchUrl', () => {
  it('代號＋名稱 URL encoded（1402遠東新）', () => {
    expect(googleStockSearchUrl('1402', '遠東新')).toBe(
      'https://www.google.com/search?q=1402%E9%81%A0%E6%9D%B1%E6%96%B0',
    )
  })
  it('前後空白修剪', () => {
    expect(googleStockSearchUrl(' 2330 ', '台積電')).toBe(
      'https://www.google.com/search?q=2330%E5%8F%B0%E7%A9%8D%E9%9B%BB',
    )
  })
})
