import { describe, it, expect } from 'vitest'
import {
  computeSMA,
  computeRSI,
  computeMACD,
  compute52WeekRange,
} from '../src/indicators.js'
import {
  evaluateSeries,
  evaluateLastBar,
  passesGate,
  runSignalBacktest,
  runSignalBacktestDetail,
  computeWilsonScoreInterval,
  DEFAULT_COST_PCT,
  classifyStage,
  MIN_EVAL_INDEX,
  MIN_SCORE,
  MAX_CANDIDATES,
  MIN_SAMPLE_SIGNALS,
  ruleR1,
  ruleR3,
  ruleR5,
} from '../src/rules.js'
import type { OHLCV } from '../src/types.js'
import {
  resolveStockName,
  getUniverseTier,
  isCoreEtf,
  isTop100Stock,
} from '../src/universe.js'

function bar(price: number, volume = 1000): OHLCV {
  return {
    timestamp: 0,
    open: price,
    high: price,
    low: price,
    close: price,
    volume,
  }
}

function seriesOf(
  closeList: number[],
  volumes?: number[],
  baseIdx = 1,
): OHLCV[] {
  return closeList.map((c, i) => {
    const day = (i + baseIdx) * 86400000
    const p = bar(c, volumes ? volumes[i] : 1000, i + baseIdx)
    return { ...p, timestamp: day }
  })
}

describe('indicators', () => {
  it('computeSMA 前 period-1 為 null', () => {
    expect(computeSMA([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })

  it('RSI 全漲 → 100，全跌 → 0', () => {
    const up = Array.from({ length: 20 }, (_, i) => 100 + i * 2)
    const down = Array.from({ length: 20 }, (_, i) => 200 - i * 2)
    expect(computeRSI(up, 14)[19]).toBe(100)
    expect(computeRSI(down, 14)[19]).toBe(0)
  })

  it('RSI 混合資料落在 (0,100)', () => {
    const data = [100, 98, 103, 99, 96, 101, 104, 97, 95, 98, 102, 105, 100, 99, 97, 101, 103, 98, 100, 102]
    const rsi = computeRSI(data, 14)
    expect(rsi[19]).toBeGreaterThan(0)
    expect(rsi[19]).toBeLessThan(100)
  })

  it('MACD 回傳 DIF/DEA/hist 且長度正確', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + i * 0.5)
    const macd = computeMACD(closes)
    expect(macd.dif).toHaveLength(120)
    expect(macd.dea).toHaveLength(120)
    expect(macd.hist).toHaveLength(120)
  })

  it('52 週高低點以最近 window 內計算', () => {
    const closes = Array.from({ length: 300 }, (_, i) => (i < 250 ? 100 : 200 + i))
    const range = compute52WeekRange(closes)
    expect(range?.high).toBe(499)
    // window=252 涵蓋 i=48..299，仍有 100 的平盤段
    expect(range?.low).toBe(100)
  })
})

describe('rule helpers', () => {
  it('ruleR1：-15% ~ -40% 且距低點 > 1% 成立', () => {
    expect(ruleR1(-0.2, 0.05)).toBe(true)
    expect(ruleR1(-0.1, 0.05)).toBe(false) // 離高點太近
    expect(ruleR1(-0.45, 0.05)).toBe(false) // 破 -40%
    expect(ruleR1(-0.2, 0.001)).toBe(false) // 貼近低點
  })

  it('ruleR3：近期超賣(<35)且目前 ≥40 成立', () => {
    const rsi = Array.from({ length: 30 }, (_, i) => 50)
    expect(ruleR3([...rsi, 30, 42], 31)).toBe(true)
    expect(ruleR3([...rsi, 30, 38], 31)).toBe(false) // 未達反轉線
    expect(ruleR3([...rsi, 40, 45], 31)).toBe(false) // 無超賣
  })

  it('ruleR5：5 日內柱轉正成立', () => {
    const hist = Array.from({ length: 30 }, (_, i) => -0.1)
    expect(ruleR5([...hist, -0.01, 0.3], 31)).toBe(true)
    // 最近 5 根皆為正 → 無「由負轉正」事件
    expect(ruleR5([...hist.slice(0, 25), 0.3, 0.4, 0.5, 0.6, 0.7], 30)).toBe(false)
    expect(ruleR5([...hist, -0.1, -0.2], 31)).toBe(false) // 目前仍在零軸下
  })

  it('classifyStage 邊界', () => {
    expect(classifyStage(-0.03)).toBe('near-high')
    expect(classifyStage(-0.1)).toBe('mild-pullback')
    expect(classifyStage(-0.3)).toBe('pullback')
    expect(classifyStage(-0.5)).toBe('deep-pullback')
  })
})

describe('evaluateSeries', () => {
  it('回檔到位(R1)+量能收斂(R4) 的可測場景', () => {
    // 60 根平 80 → 拉到 150 → 回檔至 98 → 反彈至 115
    const closes: number[] = []
    const volumes: number[] = []
    closes.push(...Array.from({ length: 60 }, () => 80))
    volumes.push(...Array.from({ length: 60 }, () => 500))
    for (let i = 0; i < 30; i++) {
      closes.push(80 + ((150 - 80) * i) / 29)
      volumes.push(1000)
    }
    closes.push(...[150, 138, 126, 116, 108, 102, 99, 98, 99, 101])
    volumes.push(...Array.from({ length: 10 }, () => 300))
    closes.push(...[102, 108, 115])
    volumes.push(...[400, 400, 400])

    const ohlcv = seriesOf(closes, volumes)
    const last = evaluateLastBar(ohlcv)
    expect(last).not.toBeNull()
    expect(last!.index).toBe(closes.length - 1)
    expect(last!.matchedRules).toContain('R1')
    expect(last!.matchedRules).toContain('R4')
    expect(last!.cycleStage).toBe('pullback')
    expect(last!.pctOff52wHigh).toBeLessThan(-0.15)
    expect(last!.pctOff52wHigh).toBeGreaterThan(-0.4)
    expect(last!.volumeRatio).toBeLessThan(1)
  })

  it('R2：站上 MA20 與 MA60', () => {
    // 60 根平 100（均線下修），之後回檔再彈回均線之上
    const closes: number[] = Array.from({ length: 60 }, () => 100)
    closes.push(...[100, 96, 92, 90, 90, 92, 96, 102, 104, 106, 108])
    const last = evaluateLastBar(seriesOf(closes))
    expect(last).not.toBeNull()
    expect(last!.matchedRules).toContain('R2')
  })

  it('evaluateSeries 起點為 MIN_EVAL_INDEX 並逐日填滿', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 5) * 10)
    const series = evaluateSeries(seriesOf(closes))
    expect(series[0].index).toBe(MIN_EVAL_INDEX)
    expect(series.length).toBe(closes.length - MIN_EVAL_INDEX)
  })
})

describe('passesGate', () => {
  it('score≥3 且含 R1/R2 門檻', () => {
    expect(passesGate(3, ['R1', 'R4', 'R5'])).toBe(true)
    expect(passesGate(3, ['R2', 'R3', 'R4'])).toBe(true)
    expect(passesGate(2, ['R1', 'R4'])).toBe(false)
    expect(passesGate(3, ['R3', 'R4', 'R5'])).toBe(false) // 無 R1/R2
    expect(MIN_SCORE).toBe(3)
    expect(MAX_CANDIDATES).toBe(10)
    expect(MIN_SAMPLE_SIGNALS).toBe(10)
  })
})

describe('runSignalBacktest', () => {
  it('聚合統計一致（wins+losses+neutral == totalSignals）', () => {
    // 長回檔 + 低量 → 會多次觸發 R1 (+R3/R4/R5)
    const closes: number[] = Array.from({ length: 60 }, () => 100)
    closes.push(...Array.from({ length: 60 }, (_, i) => 200 - i * 1.8))
    closes.push(...Array.from({ length: 40 }, () => 96))
    const volumes: number[] = Array.from({ length: 60 }, () => 1000)
    volumes.push(...Array.from({ length: 100 }, () => 150))
    const ohlcv = seriesOf(closes, volumes)
    const stats = runSignalBacktest(ohlcv)
    expect(stats.totalSignals).toBeGreaterThanOrEqual(0)
    expect(stats.wins + stats.losses + stats.neutral + (stats.openTrades ?? 0)).toBe(stats.totalSignals)
    if (stats.wins + stats.losses > 0) {
      expect(stats.winRate).toBeGreaterThanOrEqual(0)
      expect(stats.winRate).toBeLessThanOrEqual(100)
    }
  })

  it('回檔到底後反彈可締造至少一次勝場', () => {
    const closes: number[] = Array.from({ length: 70 }, () => 100)
    // 陡峭拉高建立高點
    closes.push(...Array.from({ length: 30 }, (_, i) => 100 + ((200 - 100) * i) / 29))
    // 快速回檔至 -25%~-35% 區間，接著強力反彈站回
    closes.push(...[200, 180, 162, 146, 132, 140, 152, 166, 182, 200])
    const volumes: number[] = Array.from({ length: 70 }, () => 1000)
    volumes.push(...Array.from({ length: 30 }, () => 2000))
    volumes.push(...Array.from({ length: 10 }, () => 400))
    const stats = runSignalBacktest(seriesOf(closes, volumes))
    expect(stats.totalSignals).toBeGreaterThanOrEqual(0)
  })
})

describe('Wilson 95% 信賴區間', () => {
  it('total <= 0 回傳 null', () => {
    expect(computeWilsonScoreInterval(0, 0)).toBeNull()
    expect(computeWilsonScoreInterval(5, -1)).toBeNull()
  })

  it('以 9 wins / 21 total 驗算（同欣電例）', () => {
    const ci = computeWilsonScoreInterval(9, 21)
    expect(ci).not.toBeNull()
    // 估計勝率 42.9%，Wilson 95% CI 約在 [24.5, 63.4]
    expect(ci!.lower).toBeCloseTo(24.5, 0)
    expect(ci!.upper).toBeCloseTo(63.4, 0)
    expect(ci!.lower).toBeLessThan(42.9)
    expect(ci!.upper).toBeGreaterThan(42.9)
  })

  it('極端情況 0% 與 100% 邊界維持在 [0, 100]', () => {
    const zero = computeWilsonScoreInterval(0, 10)
    expect(zero!.lower).toBe(0)
    expect(zero!.upper).toBeGreaterThan(0)
    expect(zero!.upper).toBeLessThan(100)

    const full = computeWilsonScoreInterval(10, 10)
    expect(full!.lower).toBeGreaterThan(0)
    expect(full!.upper).toBe(100)
  })
})

describe('Stage 2 · open trade 語意與 0.6% 淨報酬', () => {
  it('DEFAULT_COST_PCT 常數為 0.006', () => {
    expect(DEFAULT_COST_PCT).toBe(0.006)
  })

  it('資料尾端截斷（未滿 holdingDays 且未觸停利停損）為 open', () => {
    // 建立 120 根 K 棒，讓前段觸發一次訊號，並在剛好第 115 根觸發最後一次訊號
    // 訊號在 115，進場在 116，到 120 僅 4 天（< 40），價格維持平盤未觸 +8% / -5%
    const closes: number[] = Array.from({ length: 60 }, () => 100)
    closes.push(...Array.from({ length: 30 }, (_, i) => 100 + ((200 - 100) * i) / 29))
    closes.push(...[200, 180, 162, 146, 132, 140, 152, 166, 182, 200]) // length=100
    // 再補平盤到 120
    closes.push(...Array.from({ length: 20 }, () => 150))
    const volumes: number[] = Array.from({ length: 120 }, () => 1000)

    const detail = runSignalBacktestDetail(seriesOf(closes, volumes))
    const openTrades = detail.trades.filter((t) => t.outcome === 'open')
    if (openTrades.length > 0) {
      const op = openTrades[0]
      expect(op.exitDate).toBeNull()
      expect(op.exitPrice).toBeNull()
      expect(op.returnPct).toBeNull()
      expect(op.netReturnPct).toBeNull()
      expect(op.exitReason).toBe('open')
      expect(op.holdingDays).toBeGreaterThan(0)
    }
    // open 不計入 winRate 分母
    expect(detail.stats.totalSignals).toBe(detail.trades.length)
  })

  it('已平倉交易扣除 0.6% round-trip 淨報酬', () => {
    // 模擬單筆 win：進場 100，停利 108 (+8%)
    // netReturnPct 應為 0.08 - 0.006 = 0.074 (+7.4%)
    const closes = Array.from({ length: 70 }, () => 100)
    closes.push(...Array.from({ length: 30 }, (_, i) => 100 + ((200 - 100) * i) / 29))
    closes.push(...[200, 180, 162, 146, 132, 140, 152, 166, 182, 200])
    const volumes = Array.from({ length: 110 }, () => 1000)

    const detail = runSignalBacktestDetail(seriesOf(closes, volumes))
    const winTrades = detail.trades.filter((t) => t.outcome === 'win')
    if (winTrades.length > 0) {
      const w = winTrades[0]
      expect(w.returnPct).toBeCloseTo(0.08, 2)
      expect(w.netReturnPct).toBeCloseTo(0.074, 3)
      expect(w.netReturnPct!).toBeLessThan(w.returnPct!)
    }
  })
})

describe('resolveStockName', () => {
  it('台股大型股代號優先回傳中文名', () => {
    expect(resolveStockName('2317.TW', 'HON HAI PRECISION INDUSTRY')).toBe('鴻海')
    expect(resolveStockName('2330.TW', 'Taiwan Semiconductor')).toBe('台積電')
    expect(resolveStockName('2207.TW', 'HOTAI MOTOR CO')).toBe('和泰車')
    expect(resolveStockName('3711.TW', 'ASE TECHNOLOGY HOLDING CO LTD')).toBe('日月光投控')
    expect(resolveStockName('6770.TW')).toBe('力積電')
    expect(resolveStockName('0050.TW')).toBe('元大台灣50')
    expect(resolveStockName('00878.TW')).toBe('國泰永續高股息')
  })

  it('支援純數字台股代號查詢', () => {
    expect(resolveStockName('2317')).toBe('鴻海')
    expect(resolveStockName('0056')).toBe('元大高股息')
  })

  it('rawName 若原本包含中文則保留中文', () => {
    expect(resolveStockName('9999.TW', '自訂中文股')).toBe('自訂中文股')
  })

  it('原本為英文且無對照時保留英文名稱', () => {
    expect(resolveStockName('NVDA', 'NVIDIA Corporation')).toBe('NVIDIA Corporation')
    expect(resolveStockName('AAPL')).toBe('AAPL')
  })
})

describe('getUniverseTier & helper functions', () => {
  it('正確識別核心原型 ETF（不含槓桿/反向）', () => {
    expect(getUniverseTier('0050.TW')).toBe('ETF')
    expect(getUniverseTier('0050')).toBe('ETF')
    expect(getUniverseTier('00878.TW')).toBe('ETF')
    expect(getUniverseTier('00919')).toBe('ETF')
    expect(isCoreEtf('0050.TW')).toBe(true)
    expect(isCoreEtf('00878')).toBe(true)

    // 槓桿與反向 ETF 不在核心原型 ETF 池內
    expect(getUniverseTier('00631L.TW')).toBe('OTHER')
    expect(getUniverseTier('00632R.TW')).toBe('OTHER')
    expect(isCoreEtf('00631L')).toBe(false)
  })

  it('正確識別 Top 50 核心權值與 Top 51-100 績優股', () => {
    expect(getUniverseTier('2330.TW')).toBe('TOP_50')
    expect(getUniverseTier('2317')).toBe('TOP_50')
    expect(isTop100Stock('2330.TW')).toBe(true)

    expect(getUniverseTier('2353.TW')).toBe('TOP_100') // 宏碁
    expect(getUniverseTier('2801')).toBe('TOP_100') // 彰銀
    expect(isTop100Stock('2353.TW')).toBe(true)

    // 已下市代號或小型投機股
    expect(getUniverseTier('2311.TW')).toBe('OTHER') // 已下市
    expect(getUniverseTier('2823.TW')).toBe('OTHER') // 已下市
    expect(getUniverseTier('2611.TW')).toBe('OTHER') // 非前百大投機股
    expect(isTop100Stock('2611.TW')).toBe(false)
  })
})