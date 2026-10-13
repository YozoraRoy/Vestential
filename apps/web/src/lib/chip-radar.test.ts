import { describe, it, expect } from 'vitest'
import {
  buildChipAnomalies,
  buildChipWindowDays,
  chipRatioPct,
  cleanChipCode,
  clearChipRadarCache,
  ensureChipRadar,
  isChipAnomaly,
  isTodayOnlyPartial,
  parseChipThresholds,
  parseStockDayAll,
  parseTwt38u,
  parseTwt44u,
  parseTwseNum,
  taipeiHourOf,
  trailingStreak,
  CHIP_PUBLISH_HOUR_TAIPEI,
  DEFAULT_CHIP_THRESHOLDS,
  type ChipAnomalyInput,
  type ChipForeignRow,
  type ChipQuote,
} from './chip-radar'
import { isTwseTradingDay } from './twse-calendar'

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

// ─── #71 後續：夜間誤報修復（法人日報約 19 點後公布） ───
// 日期錨點：2026-10-13（週二，交易日；10-09 國慶補假休市、10-10/11 週末）。
// 故公布前窗＝[10-05,10-06,10-07,10-08,10-12]，公布後窗＝[10-06,10-07,10-08,10-12,10-13]。
describe('公布時點窗（buildChipWindowDays）', () => {
  const TODAY = '2026-10-13'

  it('公布時點常數為 19，taipeiHourOf 回傳 0–23 整數（不依賴真實時鐘斷言固定值）', () => {
    expect(CHIP_PUBLISH_HOUR_TAIPEI).toBe(19)
    const h = taipeiHourOf()
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(23)
  })

  it('① 未滿 19 點窗不含今日（起點往前挪一天）', () => {
    expect(buildChipWindowDays(TODAY, 10, isTwseTradingDay)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-12',
    ])
    // 邊界：18 點仍排除今日
    const edge = buildChipWindowDays(TODAY, 18, isTwseTradingDay)
    expect(edge).not.toContain(TODAY)
    expect(edge[edge.length - 1]).toBe('2026-10-12')
  })

  it('≥19 點窗含今日', () => {
    expect(buildChipWindowDays(TODAY, 19, isTwseTradingDay)).toEqual([
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-12',
      '2026-10-13',
    ])
    expect(buildChipWindowDays(TODAY, 23, isTwseTradingDay)).toContain(TODAY)
  })
})

describe('isTodayOnlyPartial（告警分級）', () => {
  const TODAY = '2026-10-13'
  it('僅缺今日單日 → true（route 抑制寄信）', () => {
    expect(isTodayOnlyPartial('partial-days:2026-10-13', TODAY)).toBe(true)
  })
  it('缺過去日照常寄 → false', () => {
    expect(isTodayOnlyPartial('partial-days:2026-10-12', TODAY)).toBe(false)
    expect(isTodayOnlyPartial('partial-days:2026-10-12,2026-10-13', TODAY)).toBe(false)
    expect(isTodayOnlyPartial('partial-days:2026-10-13,2026-10-12', TODAY)).toBe(false)
  })
  it('非 partial 原因 → false', () => {
    expect(isTodayOnlyPartial(null, TODAY)).toBe(false)
    expect(isTodayOnlyPartial('insufficient-days', TODAY)).toBe(false)
    expect(isTodayOnlyPartial('no-quotes', TODAY)).toBe(false)
    expect(isTodayOnlyPartial('non-trading-day', TODAY)).toBe(false)
  })
})

describe('ensureChipRadar 公布時點整合（抓取以注入代替打網）', () => {
  const TODAY = '2026-10-13'
  const foreignOf =
    (byDay: Record<string, number>) =>
    async (d: string): Promise<Map<string, ChipForeignRow>> => {
      const v = byDay[d]
      if (v == null) return new Map()
      return new Map([['2330', { name: '台積電', foreignNet: v }]])
    }
  const emptyTrust = async (): Promise<Map<string, number>> => new Map()
  // 佔比＝|1000×1000|／100000×100＝1000%，任何合法閾值下皆達標
  const quotesOf = async (): Promise<Map<string, ChipQuote>> =>
    new Map([['2330', { close: 1000, tradeValue: 100_000 }]])

  it('② ≥19 點缺今日照常 partial（真異常，不吞；分級判為僅缺今日）', async () => {
    clearChipRadarCache()
    const snap = await ensureChipRadar(TODAY, {
      taipeiHour: 20,
      fetchForeignDay: foreignOf({
        '2026-10-06': 1000,
        '2026-10-07': 1000,
        '2026-10-08': 1000,
        '2026-10-12': 1000,
        // '2026-10-13' 公布後仍無今日檔
      }),
      fetchTrustDay: emptyTrust,
      fetchQuotes: quotesOf,
    })
    expect(snap.windowDays).toContain(TODAY)
    expect(snap.degraded).toBe(true)
    expect(snap.degradedReason).toBe('partial-days:2026-10-13')
    expect(isTodayOnlyPartial(snap.degradedReason, TODAY)).toBe(true)
  })

  it('③ streak 不受未公布日污染（公布前窗止於昨日、asOf 為昨日、無 partial）', async () => {
    clearChipRadarCache()
    const snap = await ensureChipRadar(TODAY, {
      taipeiHour: 10,
      fetchForeignDay: foreignOf({
        '2026-10-05': 1000,
        '2026-10-06': 1000,
        '2026-10-07': 1000,
        '2026-10-08': 1000,
        '2026-10-12': 1000,
      }),
      fetchTrustDay: emptyTrust,
      fetchQuotes: quotesOf,
    })
    expect(snap.windowDays).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-12',
    ])
    expect(snap.asOf).toBe('2026-10-12')
    expect(snap.degraded).toBe(false)
    expect(snap.degradedReason).toBeNull()
    expect(snap.items.find((i) => i.symbol === '2330')).toMatchObject({
      direction: 'buy',
      days: 5,
    })
    // 對照：若把未公布今日補 0 納入，streak 會被斷成 none（舊 bug 行為）
    expect(trailingStreak([1000, 1000, 1000, 1000, 1000, 0])).toEqual({
      direction: 'none',
      days: 0,
    })
  })

  it('④ 休市分支不變（hour 無關、不打 TWSE）', async () => {
    const sunday = '2026-10-11'
    const boom = async (): Promise<never> => {
      throw new Error('must not fetch on closed day')
    }
    for (const h of [10, 20]) {
      clearChipRadarCache()
      const snap = await ensureChipRadar(sunday, {
        taipeiHour: h,
        fetchForeignDay: boom,
        fetchTrustDay: boom,
        fetchQuotes: boom,
      })
      expect(snap.status).toBe('closed')
      expect(snap.isTradingDay).toBe(false)
      expect(snap.degradedReason).toBe('non-trading-day')
      expect(snap.asOf).toBe('2026-10-08')
      expect(snap.windowDays).toEqual([])
    }
  })
})
