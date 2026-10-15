import { describe, it, expect } from 'vitest'
import {
  parseRocDateToIso,
  cleanTwseCode,
  parseTwt48uCsv,
  parseTwt49uRows,
  backfillMonthWindow,
} from './twse-dividends'

// Issue #90：歷史回填改走 TWT49U 月粒度（TWT48U 無歷史會空轉）。
describe('backfillMonthWindow（回填月份窗，由新往舊）', () => {
  it('當月往前推滿 5 年之 1 月', () => {
    const months = backfillMonthWindow('2026-10-16')
    expect(months[0]).toBe('2026-10')
    expect(months[months.length - 1]).toBe('2022-01')
    expect(months.length).toBe(12 * 4 + 10)
  })

  it('非法日期回空陣列', () => {
    expect(backfillMonthWindow('not-a-date')).toEqual([])
  })
})

describe('parseTwt49uRows（現金＝前收−減除參考價）', () => {
  it('息列還原正確、權列略過（無現金）', () => {
    const { rows, skipped } = parseTwt49uRows([
      ['115年07月01日', '00939', '統一台灣高息動能', '13.74', '13.67', '0.068000', '息', '15.03', '12.31', '13.67', '13.67'],
      ['114年07月18日', '6541', '泰福-KY', '53.50', '52.95', '0.540275', '權', '58.80', '47.70', '53.50', '53.50'],
      ['壞列'],
    ])
    expect(rows).toEqual([{ symbol: '00939', ex_date: '2026-07-01', cash_dividend: 0.07 }])
    expect(skipped).toBe(2)
  })

  it('代號 Excel 前綴清洗', () => {
    const { rows } = parseTwt49uRows([['115年06月19日', '="2330"', '台積電', '1000', '990', '10', '息', '0', '0', '990', '990']])
    expect(rows).toEqual([{ symbol: '2330', ex_date: '2026-06-19', cash_dividend: 10 }])
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
