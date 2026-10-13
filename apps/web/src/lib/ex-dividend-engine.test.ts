import { describe, it, expect } from 'vitest'
import {
  analyzeExDividendEvents,
  assetKindLabel,
  classifyAssetKind,
  computeExLastBuyDate,
  computeFillScore,
  daysUntilEx,
  MIN_EVENTS_FOR_SCORE,
  type ExDividendPriceBar,
} from './ex-dividend-engine'

// Issue #67 填息引擎單測（純函式，手算可重現）。
// adjclose 前提沿用 #69 P1（Yahoo adjclose 全域還原；0050/00878/00919 誤差 0），
// 本檔以合成還原序列驗證「引擎統計 ≡ 手算」。

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
}

function rep(n: number, v: number): number[] {
  return Array.from({ length: n }, () => v)
}

interface CaseEvent {
  pre: number
  closes: number[]
}

/**
 * 將事件規格展開為連續 bars：
 * [E1.exDate＋closes]＋gap(下一事件 pre 價)＋[E2.exDate＋closes]…
 * 使每事件的「除息前收盤」恰為其 pre（手算前提）。
 */
function buildCase(events: CaseEvent[], start = '2020-06-01', gap = 5): { bars: ExDividendPriceBar[]; exDates: string[] } {
  const bars: ExDividendPriceBar[] = []
  const exDates: string[] = []
  let cursor = start
  events.forEach((e, i) => {
    if (i > 0) {
      for (let g = 0; g < gap; g++) {
        bars.push({ date: cursor, close: e.pre })
        cursor = addDays(cursor, 1)
      }
    } else {
      bars.push({ date: cursor, close: e.pre })
      cursor = addDays(cursor, 1)
    }
    const exDate = cursor
    exDates.push(exDate)
    for (const c of e.closes) {
      bars.push({ date: cursor, close: c })
      cursor = addDays(cursor, 1)
    }
  })
  return { bars, exDates }
}

const weekdayStub = (dateStr: string): boolean => {
  // 簡易週末 stub（單測用，不依賴真實行事曆）。
  const dow = new Date(`${dateStr}T12:00:00+08:00`).getDay()
  return dow !== 0 && dow !== 6
}

describe('classifyAssetKind｜ETF／個股分流', () => {
  it('ETF → 配息鏈路；EQUITY → 除權息鏈路；空值 → unknown', () => {
    expect(classifyAssetKind('ETF')).toBe('etf')
    expect(classifyAssetKind('etf')).toBe('etf')
    expect(classifyAssetKind('EQUITY')).toBe('stock')
    expect(classifyAssetKind('')).toBe('unknown')
    expect(classifyAssetKind(null)).toBe('unknown')
    expect(classifyAssetKind('MUTUALFUND')).toBe('unknown')
    expect(assetKindLabel('etf')).toBe('ETF配息')
    expect(assetKindLabel('stock')).toBe('個股除權息')
  })
})

describe('computeExLastBuyDate｜除息最後買進日', () => {
  it('週五除息 → 前一日（週四）', () => {
    // 2020-06-19 為週五
    expect(computeExLastBuyDate('2020-06-19', weekdayStub)).toBe('2020-06-18')
  })
  it('週一除息 → 前一週五（跳週末）', () => {
    // 2020-06-22 為週一
    expect(computeExLastBuyDate('2020-06-22', weekdayStub)).toBe('2020-06-19')
  })
  it('非法輸入回空字串', () => {
    expect(computeExLastBuyDate('not-a-date', weekdayStub)).toBe('')
  })
})

describe('daysUntilEx｜除息日倒數', () => {
  it('同日 0、未來正數、過去負數', () => {
    expect(daysUntilEx('2026-10-13', '2026-10-13')).toBe(0)
    expect(daysUntilEx('2026-10-13', '2026-10-16')).toBe(3)
    expect(daysUntilEx('2026-10-13', '2026-10-10')).toBe(-3)
  })
})

describe('填息定義＝收盤 ≥ 除息前收盤', () => {
  it('D1 即填息：除息日收盤等於除息前收盤 → daysToFill=1', () => {
    const { bars, exDates } = buildCase([{ pre: 100, closes: [100, ...rep(39, 99)] }])
    const s = analyzeExDividendEvents(bars, [{ exDate: exDates[0]! }])
    expect(s.events).toHaveLength(1)
    expect(s.events[0]!.filled).toBe(true)
    expect(s.events[0]!.daysToFill).toBe(1)
    expect(s.events[0]!.hitD1).toBe(true)
  })
  it('D40 未填息：40 天皆低於基準 → filled=false、daysToFill=null', () => {
    const { bars, exDates } = buildCase([{ pre: 100, closes: rep(40, 90) }])
    const s = analyzeExDividendEvents(bars, [{ exDate: exDates[0]! }])
    expect(s.events[0]!.filled).toBe(false)
    expect(s.events[0]!.daysToFill).toBeNull()
    expect(s.events[0]!.hitD40).toBe(false)
    expect(s.events[0]!.maxDrawdownPct).toBeCloseTo(-10, 10)
  })
  it('到期邊界：第 40 天恰等於基準 → 達標（≥ 含等號）', () => {
    const { bars, exDates } = buildCase([{ pre: 50, closes: [...rep(39, 49), 50] }])
    const s = analyzeExDividendEvents(bars, [{ exDate: exDates[0]! }])
    expect(s.events[0]!.filled).toBe(true)
    expect(s.events[0]!.daysToFill).toBe(40)
    expect(s.events[0]!.hitD40).toBe(true)
    expect(s.events[0]!.hitD20).toBe(false)
  })
})

describe('AC 手算一致：0050 式 5 事件（d1/d5/d10/d25/未填）', () => {
  // 手算：D1=1/5=0.2；D5=2/5=0.4；D10=3/5=0.6；D20=3/5=0.6；
  // D40=4/5=0.8；到期=4/5=0.8；平均=(1+5+10+25)/4=10.25；
  // 評分=40×0.6＋40×0.8＋20×(1-(10.25-1)/39)=71.3；最大未填息=-10%。
  const { bars, exDates } = buildCase([
    { pre: 100, closes: [100, ...rep(39, 101)] },
    { pre: 100, closes: [95, 96, 97, 98, 100, ...rep(35, 101)] },
    { pre: 100, closes: [...rep(9, 90), 100, ...rep(30, 102)] },
    { pre: 100, closes: [...rep(24, 90), 100, ...rep(15, 101)] },
    { pre: 100, closes: rep(40, 90) },
  ])
  const s = analyzeExDividendEvents(bars, exDates.map((exDate) => ({ exDate })))
  it('事件數 5、皆滿窗、年份覆蓋 1 年（合成窗）', () => {
    expect(s.eventCount).toBe(5)
    expect(s.insufficient).toBe(false)
    expect(s.maturedCount).toBe(5)
  })
  it('D1/D5/D10/D20/D40 比率與手算一致', () => {
    expect(s.fillRateD1).toBeCloseTo(0.2, 10)
    expect(s.fillRateD5).toBeCloseTo(0.4, 10)
    expect(s.fillRateD10).toBeCloseTo(0.6, 10)
    expect(s.fillRateD20).toBeCloseTo(0.6, 10)
    expect(s.fillRateD40).toBeCloseTo(0.8, 10)
    expect(s.expiryFillRate).toBeCloseTo(0.8, 10)
  })
  it('平均填息天數 10.25、評分 71.3、最大未填息 -10%', () => {
    expect(s.avgFillDays).toBeCloseTo(10.25, 10)
    expect(s.fillScore).toBeCloseTo(71.3, 1)
    expect(s.maxUnfilledDrawdownPct).toBeCloseTo(-10, 10)
  })
})

describe('AC 手算一致：00878 式 3 事件（全 D1 填息）', () => {
  // 手算：比率全 1；平均 1 天；評分=40＋40＋20=100；無未填息。
  const { bars, exDates } = buildCase([
    { pre: 20, closes: [20, ...rep(39, 21)] },
    { pre: 20, closes: [20, ...rep(39, 22)] },
    { pre: 20, closes: [20, ...rep(39, 23)] },
  ])
  const s = analyzeExDividendEvents(bars, exDates.map((exDate) => ({ exDate })))
  it('比率全 1、平均 1 天、滿分 100', () => {
    expect(s.eventCount).toBe(3)
    expect(s.fillRateD1).toBeCloseTo(1, 10)
    expect(s.fillRateD40).toBeCloseTo(1, 10)
    expect(s.expiryFillRate).toBeCloseTo(1, 10)
    expect(s.avgFillDays).toBeCloseTo(1, 10)
    expect(s.fillScore).toBe(100)
    expect(s.maxUnfilledDrawdownPct).toBeNull()
  })
})

describe('AC 手算一致：00919 式 4 事件（d1/d20/d40/未填）', () => {
  // 手算：D1=D5=D10=1/4=0.25；D20=2/4=0.5；D40=到期=3/4=0.75；
  // 平均=(1+20+40)/3=20.33；評分=20＋30＋20×(1-(20.33-1)/39)=60.1；
  // 最大未填息=(88/100-1)=-12%。
  const { bars, exDates } = buildCase([
    { pre: 100, closes: [100, ...rep(39, 101)] },
    { pre: 100, closes: [...rep(19, 90), 100, ...rep(20, 101)] },
    { pre: 100, closes: [...rep(39, 90), 100] },
    { pre: 100, closes: rep(40, 88) },
  ])
  const s = analyzeExDividendEvents(bars, exDates.map((exDate) => ({ exDate })))
  it('各窗口比率與手算一致', () => {
    expect(s.fillRateD1).toBeCloseTo(0.25, 10)
    expect(s.fillRateD5).toBeCloseTo(0.25, 10)
    expect(s.fillRateD10).toBeCloseTo(0.25, 10)
    expect(s.fillRateD20).toBeCloseTo(0.5, 10)
    expect(s.fillRateD40).toBeCloseTo(0.75, 10)
    expect(s.expiryFillRate).toBeCloseTo(0.75, 10)
    expect(s.avgFillDays).toBeCloseTo(20.33, 2)
    expect(s.fillScore).toBeCloseTo(60.1, 1)
    expect(s.maxUnfilledDrawdownPct).toBeCloseTo(-12, 10)
  })
})

describe('樣本不足（事件數 < 3）', () => {
  it(`事件數不足 ${MIN_EVENTS_FOR_SCORE} 即 insufficient，比率與評分皆 null 但明細保留`, () => {
    const { bars, exDates } = buildCase([
      { pre: 100, closes: [100, ...rep(39, 101)] },
      { pre: 100, closes: rep(40, 90) },
    ])
    const s = analyzeExDividendEvents(bars, exDates.map((exDate) => ({ exDate })))
    expect(s.eventCount).toBe(2)
    expect(s.insufficient).toBe(true)
    expect(s.fillRateD20).toBeNull()
    expect(s.expiryFillRate).toBeNull()
    expect(s.avgFillDays).toBeNull()
    expect(s.fillScore).toBeNull()
    expect(s.events).toHaveLength(2)
  })
  it('空序列亦為樣本不足', () => {
    const s = analyzeExDividendEvents([], [])
    expect(s.insufficient).toBe(true)
    expect(s.fillScore).toBeNull()
  })
})

describe('未滿窗事件的分母處理', () => {
  it('最新事件僅 10 根 bars 且未達標：D5 計入分母（可觀察），D20/D40/到期排除', () => {
    const { bars, exDates } = buildCase(
      [
        { pre: 100, closes: [100, ...rep(39, 101)] },
        { pre: 100, closes: [100, ...rep(39, 101)] },
        { pre: 100, closes: rep(10, 90) },
      ],
      '2020-06-01',
      5,
    )
    const s = analyzeExDividendEvents(bars, exDates.map((exDate) => ({ exDate })))
    expect(s.eventCount).toBe(3)
    expect(s.maturedCount).toBe(2)
    // D5：3 事件皆可觀察（2 達標 1 未達標）→ 2/3
    expect(s.fillRateD5).toBeCloseTo(2 / 3, 10)
    // D20：未滿窗未達標者排除 → 2/2
    expect(s.fillRateD20).toBeCloseTo(1, 10)
    expect(s.fillRateD40).toBeCloseTo(1, 10)
    expect(s.expiryFillRate).toBeCloseTo(1, 10)
  })
})

describe('computeFillScore｜評分公式', () => {
  it('缺值以 0 計；全滿為 100', () => {
    expect(computeFillScore(null, null, null)).toBe(0)
    expect(computeFillScore(1, 1, 1)).toBe(100)
  })
})
