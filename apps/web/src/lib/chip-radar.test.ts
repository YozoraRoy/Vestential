import { describe, it, expect } from 'vitest'
import {
  buildChipAnomalies,
  chipRatioPct,
  cleanChipCode,
  isChipAnomaly,
  parseChipThresholds,
  parseStockDayAll,
  parseTwt38u,
  parseTwt44u,
  parseTwseNum,
  trailingStreak,
  DEFAULT_CHIP_THRESHOLDS,
  type ChipAnomalyInput,
} from './chip-radar'

// Issue #71 主力籌碼雷達引擎單測（純函式，手算可重現）。
// 3 檔手算錨點＝TWSE 官方日報 2026-10-12（TWT38U 外資合計超＋TWT44U 投信超
// 合併淨超 × STOCK_DAY_ALL 收盤／成交金額；PoC 探針實測值）：
// - 2409 友達 sell×5 nets=[-212135842,-87070778,-76214749,-59453941,-26300905]
//   close=35.55 value=10966475811 → 8.53%
// - 2317 鴻海 sell×4 nets=[13008864,-21123589,-12368324,-25457977,-25270302]
//   close=244.50 value=12815704539 → 48.21%
// - 2609 陽明 buy×4 nets=[-2452057,5083030,502186,5224184,24294857]
//   close=63.60 value=6977547592 → 22.14%

describe('parseTwseNum', () => {
  it('去逗號／空白，空值視為 0', () => {
    expect(parseTwseNum('37,213,116')).toBe(37213116)
    expect(parseTwseNum('-25,270,302')).toBe(-25270302)
    expect(parseTwseNum('')).toBe(0)
    expect(parseTwseNum('--')).toBe(0)
    expect(parseTwseNum(null)).toBe(0)
  })
})

describe('cleanChipCode', () => {
  it('去尾空白轉大寫', () => {
    expect(cleanChipCode('2887  ')).toBe('2887')
    expect(cleanChipCode(' 0050 ')).toBe('0050')
  })
})

describe('parseTwt38u', () => {
  const payload = {
    stat: 'OK',
    date: '20261012',
    title: '115年10月12日 外資及陸資買賣超彙總表',
    fields: ['', '證券代號', '證券名稱', '買進股數', '賣出股數', '買賣超股數', '買進股數', '賣出股數', '買賣超股數', '買進股數', '賣出股數', '買賣超股數'],
    groups: [
      { start: 0, span: 3, title: '' },
      { start: 3, span: 3, title: '外資及陸資(不含外資自營商)' },
      { start: 6, span: 3, title: '外資自營商' },
      { start: 9, span: 3, title: '外資及陸資' },
    ],
    data: [
      ['*', '2887  ', '台新新光金      ', '57,099,483', '19,886,367', '37,213,116', '0', '0', '0', '57,099,483', '19,886,367', '37,213,116'],
      [' ', '2317  ', '鴻海            ', '1,000', '2,000', '-1,000', '0', '0', '0', '5,000', '6,000', '-25,270,302'],
    ],
  }
  it('取外資合計超 idx11（非不含自營欄 idx5）', () => {
    const m = parseTwt38u(payload)
    expect(m.get('2887')?.foreignNet).toBe(37213116)
    expect(m.get('2317')?.foreignNet).toBe(-25270302)
    expect(m.get('2317')?.name).toBe('鴻海')
  })
  it('stat 非 OK 回空 Map 不 throw', () => {
    expect(parseTwt38u({ stat: '查無資料', data: [] }).size).toBe(0)
    expect(parseTwt38u(null).size).toBe(0)
  })
})

describe('parseTwt44u', () => {
  it('取投信超 idx5', () => {
    const m = parseTwt44u({
      stat: 'OK',
      data: [[' ', '1301  ', '台塑            ', '19,104,000', '0', '19,104,000']],
    })
    expect(m.get('1301')).toBe(19104000)
  })
  it('stat 非 OK 回空', () => {
    expect(parseTwt44u({ stat: '查無資料' }).size).toBe(0)
  })
})

describe('parseStockDayAll', () => {
  it('取收盤＋成交金額，非法列略過', () => {
    const m = parseStockDayAll([
      { Code: '2409', ClosingPrice: '35.55', TradeValue: '10966475811' },
      { Code: 'XXXX', ClosingPrice: '0', TradeValue: '100' },
    ])
    expect(m.get('2409')).toEqual({ close: 35.55, tradeValue: 10966475811 })
    expect(m.has('XXXX')).toBe(false)
  })
})

describe('trailingStreak', () => {
  it('連買／連賣計尾端同向天數', () => {
    expect(trailingStreak([-2452057, 5083030, 502186, 5224184, 24294857])).toEqual({ direction: 'buy', days: 4 })
    expect(trailingStreak([-212135842, -87070778, -76214749, -59453941, -26300905])).toEqual({ direction: 'sell', days: 5 })
  })
  it('遇 0 或反向即斷；當日 0 即 none', () => {
    expect(trailingStreak([5, 0, 3, 4])).toEqual({ direction: 'buy', days: 2 })
    expect(trailingStreak([5, -1, -2, -3])).toEqual({ direction: 'sell', days: 3 })
    expect(trailingStreak([1, 2, 0])).toEqual({ direction: 'none', days: 0 })
    expect(trailingStreak([])).toEqual({ direction: 'none', days: 0 })
  })
})

describe('chipRatioPct', () => {
  it('3 檔與 TWSE 手算一致（誤差 0，取 2 位）', () => {
    expect(chipRatioPct(-26300905, 35.55, 10966475811)).toBeCloseTo(8.53, 2)
    expect(chipRatioPct(-25270302, 244.5, 12815704539)).toBeCloseTo(48.21, 2)
    expect(chipRatioPct(24294857, 63.6, 6977547592)).toBeCloseTo(22.14, 2)
  })
  it('取絕對值（賣超亦為正佔比）', () => {
    expect(chipRatioPct(-100, 10, 10000)).toBeCloseTo(10, 10)
  })
  it('非法輸入回 null', () => {
    expect(chipRatioPct(100, 0, 10000)).toBeNull()
    expect(chipRatioPct(100, 10, 0)).toBeNull()
    expect(chipRatioPct(Number.NaN, 10, 10000)).toBeNull()
  })
})

describe('parseChipThresholds', () => {
  it('缺值退預設（3 天／5%／on）', () => {
    expect(parseChipThresholds({})).toEqual(DEFAULT_CHIP_THRESHOLDS)
  })
  it('合法覆寫生效，非法退預設', () => {
    expect(parseChipThresholds({ consecDays: '4', ratioPct: '8', marginDivergeOn: 'off' })).toEqual({
      consecDays: 4,
      ratioPct: 8,
      marginDivergeOn: false,
    })
    expect(parseChipThresholds({ consecDays: 'x', ratioPct: '-1' })).toEqual(DEFAULT_CHIP_THRESHOLDS)
  })
})

describe('isChipAnomaly', () => {
  const th = { consecDays: 3, ratioPct: 5, marginDivergeOn: true }
  it('達標即異常', () => {
    expect(isChipAnomaly({ direction: 'buy', days: 4 }, 22.14, th)).toBe(true)
    expect(isChipAnomaly({ direction: 'sell', days: 5 }, 8.53, th)).toBe(true)
  })
  it('天數／佔比／方向任一不達標即否', () => {
    expect(isChipAnomaly({ direction: 'buy', days: 2 }, 22.14, th)).toBe(false)
    expect(isChipAnomaly({ direction: 'buy', days: 4 }, 4.99, th)).toBe(false)
    expect(isChipAnomaly({ direction: 'none', days: 0 }, 99, th)).toBe(false)
    expect(isChipAnomaly({ direction: 'sell', days: 5 }, null, th)).toBe(false)
  })
})

describe('buildChipAnomalies', () => {
  // 手算錨點：外資合計超＋投信超＝當日淨超（2409/2317 當日無投信列＝0；2609 同）
  const input = new Map<string, ChipAnomalyInput>([
    ['2409', { name: '友達', nets: [-212135842, -87070778, -76214749, -59453941, -26300905], quote: { close: 35.55, tradeValue: 10966475811 } }],
    ['2317', { name: '鴻海', nets: [13008864, -21123589, -12368324, -25457977, -25270302], quote: { close: 244.5, tradeValue: 12815704539 } }],
    ['2609', { name: '陽明', nets: [-2452057, 5083030, 502186, 5224184, 24294857], quote: { close: 63.6, tradeValue: 6977547592 } }],
    // 未達標：僅連買 2 天
    ['1312', { name: '國喬', nets: [0, 0, 0, 100, 200], quote: { close: 16.05, tradeValue: 1743663650 } }],
    // 缺報價：不列榜
    ['9999', { name: '缺報價', nets: [1, 2, 3, 4, 5], quote: null }],
  ])
  it('3 檔皆上榜、依佔比降冪、數值與手算一致', () => {
    const rows = buildChipAnomalies(input, DEFAULT_CHIP_THRESHOLDS)
    expect(rows.map((r) => r.symbol)).toEqual(['2317', '2609', '2409'])
    expect(rows[0]).toMatchObject({ direction: 'sell', days: 4 })
    expect(rows[0]!.ratioPct).toBeCloseTo(48.21, 2)
    expect(rows[1]).toMatchObject({ direction: 'buy', days: 4 })
    expect(rows[1]!.ratioPct).toBeCloseTo(22.14, 2)
    expect(rows[2]).toMatchObject({ direction: 'sell', days: 5 })
    expect(rows[2]!.ratioPct).toBeCloseTo(8.53, 2)
  })
  it('未達標與缺報價不列榜；融資一律未含', () => {
    const rows = buildChipAnomalies(input, DEFAULT_CHIP_THRESHOLDS)
    expect(rows.find((r) => r.symbol === '1312')).toBeUndefined()
    expect(rows.find((r) => r.symbol === '9999')).toBeUndefined()
    for (const r of rows) {
      expect(r.diverge).toBe(false)
      expect(r.marginNote).toBe('未含融資')
    }
  })
  it('趨勢序列為近 5 日升冪原樣', () => {
    const rows = buildChipAnomalies(input, DEFAULT_CHIP_THRESHOLDS)
    expect(rows.find((r) => r.symbol === '2409')?.trend).toEqual([-212135842, -87070778, -76214749, -59453941, -26300905])
  })
})
