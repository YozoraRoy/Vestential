import { describe, it, expect } from 'vitest'
import {
  currentYearGapUpperBound,
  parseRocDateToIso,
  cleanTwseCode,
  parseTwt48uCsv,
} from './twse-dividends'

// Issue #84：回填納入當年 1/1 起缺口（補 2026 旺季斷層）。
describe('currentYearGapUpperBound（當年缺口上界 exclusive）', () => {
  it('取已快取最早 ex_date', () => {
    expect(currentYearGapUpperBound(['2026-09-28', '2026-10-02', '2026-09-25'])).toBe('2026-09-25')
  })

  it('無快取回遠未來（呼叫端以 today 截斷，缺口＝1/1～today）', () => {
    expect(currentYearGapUpperBound([])).toBe('9999-12-31')
  })

  it('非法日期略過（不污染最小值）', () => {
    expect(currentYearGapUpperBound([null, undefined, '', 'not-a-date', '2026-03-15'] as never[])).toBe(
      '2026-03-15',
    )
    expect(currentYearGapUpperBound([null, 'xx'] as never[])).toBe('9999-12-31')
  })
})

describe('TWT48U 解析（回歸：缺口回填依賴它）', () => {
  it('民國年轉 ISO', () => {
    expect(parseRocDateToIso('115年10月08日')).toBe('2026-10-08')
    expect(parseRocDateToIso('114年1月2日')).toBe('2025-01-02')
    expect(parseRocDateToIso('亂碼')).toBeNull()
  })

  it('代號清洗 Excel 前綴', () => {
    expect(cleanTwseCode('="00400A"')).toBe('00400A')
    expect(cleanTwseCode(' 2330 ')).toBe('2330')
  })

  it('待公告列略過計 skipped', () => {
    const csv = [
      '"除權除息日期","股票代號","名稱","除權息","現金股利"',
      '"115年10月08日","2330","台積電","息","5"',
      '"115年10月08日","00940","元大台灣價值高息","息","待公告實際收益分配金額"',
    ].join('\n')
    const { rows, skipped } = parseTwt48uCsv(csv)
    expect(rows).toEqual([{ symbol: '2330', ex_date: '2026-10-08', cash_dividend: 5 }])
    expect(skipped).toBe(1)
  })
})
