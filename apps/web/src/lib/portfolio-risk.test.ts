import { describe, it, expect } from 'vitest'
import {
  classifyEtfSector,
  computeConcentration,
  computeStress,
  resolveHoldingSector,
  BOND_ETF_SECTOR,
  TW_ETF_SECTOR,
  US_ETF_SECTOR,
  UNCATEGORIZED_SECTOR,
  type ConcentrationResult,
  type RiskHoldingInput,
  type StressScenarioResult,
} from './portfolio-risk'

// Issue #104：壓力測試第三格「最大產業重挫 30%」原本取 sectors[0]（最大的一桶），
// 若那一桶是「未分類」就整格歸零 → 顯示 NT$0 / 0.00%（誤導：最大產業跌 30% 也不虧）。
// 修正：目標取「最大的已知產業」；整組完全無已知產業時 targetSector=null 且
// targetUnavailable=true（UI 顯示 `—`＋「無法試算：缺產業資料」）。
// 本檔零 DB／零網路，全為純函式，金額皆可手算重現。

function scenarioOf(results: StressScenarioResult[], id: StressScenarioResult['id']): StressScenarioResult {
  const found = results.find((r) => r.id === id)
  if (!found) throw new Error(`scenario ${id} not found`)
  return found
}

describe('computeStress — 案例 A（全部持股未分類）', () => {
  const holdings: RiskHoldingInput[] = [
    { market: 'tw', symbol: '00878', symbolName: '國泰永續高股息', marketValue: 50000, sector: null, sectorSource: 'none' },
    { market: 'tw', symbol: '2412', symbolName: '中華電', marketValue: 30000, sector: null, sectorSource: 'none' },
  ]

  it('targetSector === null、targetUnavailable === true、lossAmount === 0', () => {
    const c = computeConcentration(holdings)
    const sector30 = scenarioOf(computeStress(c), 'sector-30')

    expect(sector30.targetSector).toBeNull()
    expect(sector30.targetUnavailable).toBe(true)
    expect(sector30.lossAmount).toBe(0)
    expect(sector30.lossPct).toBe(0)
    // 全組納入試算市值為 0（全部被排除），UI 才需以 targetUnavailable 判斷顯示 `—`
    expect(sector30.includedValue).toBe(0)
    expect(Number.isFinite(sector30.lossAmount)).toBe(true)
  })

  it('未分類持股列入「不納入試算（缺產業資料）」', () => {
    const c = computeConcentration(holdings)
    const sector30 = scenarioOf(computeStress(c), 'sector-30')

    expect(sector30.holdingLosses).toEqual([])
    expect(sector30.excluded.map((x) => x.symbol)).toEqual(['00878', '2412'])
    expect(sector30.excluded.every((x) => x.reason === 'missing-sector')).toBe(true)
    expect(sector30.excluded.every((x) => x.scenarioId === 'sector-30')).toBe(true)
    expect(c.sectors).toEqual([{ sector: UNCATEGORIZED_SECTOR, marketValue: 80000, weightPct: 100, count: 2 }])
  })
})

describe('computeStress — 案例 B（最大桶未分類 60% ＋已知產業合計 40%）', () => {
  // 手算：總市值 100000；未分類 60000（60%，最大桶）
  //       半導體 30000（30%）、金融 10000（10%）→ 最大的已知產業 = 半導體
  //       sector-30 虧損 = 30000 × 30% = 9000；納入試算 40000 → 9000/40000 = 22.5%
  const holdings: RiskHoldingInput[] = [
    { market: 'tw', symbol: '00878', marketValue: 60000, sector: null, sectorSource: 'none' },
    { market: 'tw', symbol: '2330', marketValue: 30000, sector: '半導體', sectorSource: 'fallback' },
    { market: 'tw', symbol: '2881', marketValue: 10000, sector: '金融', sectorSource: 'fallback' },
  ]
  const c = computeConcentration(holdings)
  const results = computeStress(c)

  it('目標 = 較大的已知產業（半導體），非最大桶（未分類）', () => {
    const sector30 = scenarioOf(results, 'sector-30')
    expect(sector30.targetSector).toBe('半導體')
    expect(sector30.targetUnavailable).toBe(false)
  })

  it('lossAmount = 該產業市值 30000 × 30% = 9000', () => {
    const sector30 = scenarioOf(results, 'sector-30')
    expect(sector30.lossAmount).toBe(9000)
    // 納入試算 = 已知產業合計 40000（未分類不納入）
    expect(sector30.includedValue).toBe(40000)
    expect(sector30.lossPct).toBeCloseTo(22.5, 10)
  })

  it('只有目標產業套用 30%，同為已知但非目標的產業套用 0', () => {
    const sector30 = scenarioOf(results, 'sector-30')
    expect(sector30.holdingLosses.map((h) => [h.symbol, h.appliedDropPct, h.lossAmount])).toEqual([
      ['2330', 30, 9000],
      ['2881', 0, 0],
    ])
  })

  it('未分類持股仍在「不納入試算」清單', () => {
    const sector30 = scenarioOf(results, 'sector-30')
    expect(sector30.excluded.map((x) => [x.symbol, x.reason])).toEqual([['00878', 'missing-sector']])
  })

  it('market-10／market-20 納入全體市值、與產業無關（10%／20%）', () => {
    const m10 = scenarioOf(results, 'market-10')
    const m20 = scenarioOf(results, 'market-20')
    // 手算：100000 × 10% = 10000；100000 × 20% = 20000
    expect([m10.lossAmount, m10.lossPct, m10.includedValue]).toEqual([10000, 10, 100000])
    expect([m20.lossAmount, m20.lossPct, m20.includedValue]).toEqual([20000, 20, 100000])
    expect(m10.targetSector).toBeNull()
    expect(m10.targetUnavailable).toBe(false)
    expect(m20.targetSector).toBeNull()
    expect(m20.targetUnavailable).toBe(false)
    expect(m10.excluded).toEqual([])
    expect(m20.excluded).toEqual([])
    // 大盤情境每檔都套用全額跌幅（不受產業／未分類影響）
    expect(m10.holdingLosses.map((h) => h.appliedDropPct)).toEqual([10, 10, 10])
  })
})

describe('computeStress — 案例 C（全部已知產業）', () => {
  // 手算：總市值 100000；半導體 60000（60%）> 金融 40000（40%）
  //       sector-30 虧損 = 60000 × 30% = 18000；納入試算 100000 → 18%
  const holdings: RiskHoldingInput[] = [
    { market: 'tw', symbol: '2330', marketValue: 50000, sector: '半導體', sectorSource: 'yahoo' },
    { market: 'tw', symbol: '2454', marketValue: 10000, sector: '半導體', sectorSource: 'yahoo' },
    { market: 'tw', symbol: '2881', marketValue: 40000, sector: '金融', sectorSource: 'yahoo' },
  ]

  it('目標 = 最大產業（半導體）、金額 = 60000 × 30% = 18000（與修正前行為相同）', () => {
    const sector30 = scenarioOf(computeStress(computeConcentration(holdings)), 'sector-30')
    expect(sector30.targetSector).toBe('半導體')
    expect(sector30.targetUnavailable).toBe(false)
    expect(sector30.lossAmount).toBe(18000)
    expect(sector30.lossPct).toBeCloseTo(18, 10)
    expect(sector30.includedValue).toBe(100000)
    expect(sector30.excluded).toEqual([])
  })
})

describe('computeStress — 案例 D（空倉／市值 0）', () => {
  const cases: Array<[string, ConcentrationResult]> = [
    ['空陣列', computeConcentration([])],
    ['市值 0', computeConcentration([{ market: 'tw', symbol: '2330', marketValue: 0, sector: '半導體' }])],
    ['市值 NaN', computeConcentration([{ market: 'us', symbol: 'AAPL', marketValue: NaN, sector: '科技' }])],
  ]

  for (const [label, c] of cases) {
    it(`${label}：無 NaN／Infinity，三情境皆零`, () => {
      expect(c.includedCount).toBe(0)
      expect(c.totalMarketValue).toBe(0)
      const results = computeStress(c)
      expect(results.map((r) => r.id)).toEqual(['market-10', 'market-20', 'sector-30'])
      for (const r of results) {
        expect(Number.isFinite(r.lossAmount)).toBe(true)
        expect(Number.isFinite(r.lossPct)).toBe(true)
        expect(Number.isFinite(r.includedValue)).toBe(true)
        expect(r.lossAmount).toBe(0)
        expect(r.lossPct).toBe(0)
        expect(r.includedValue).toBe(0)
        expect(r.holdingLosses).toEqual([])
      }
      // 無任何已知產業 → 大盤情境仍可算（旗標 false），產業情境無法判定（旗標 true）
      expect(scenarioOf(results, 'sector-30').targetUnavailable).toBe(true)
      expect(scenarioOf(results, 'sector-30').targetSector).toBeNull()
      expect(scenarioOf(results, 'market-10').targetUnavailable).toBe(false)
      expect(scenarioOf(results, 'market-20').targetUnavailable).toBe(false)
    })
  }

  it('市值 0／NaN 的持股列入「缺市值資料」排除，不進任何情境', () => {
    const c = computeConcentration([
      { market: 'tw', symbol: '2330', marketValue: 0, sector: '半導體' },
    ])
    expect(c.excluded.map((x) => [x.symbol, x.reason])).toEqual([['2330', 'missing-value']])
  })
})

// Issue #105：Yahoo profile 的 quoteSummary 端點已下架（404／401），產業改由 search 端點取得；
// ETF 在 Yahoo 沒有 sector（quoteType='ETF'）⇒ 原本全數落「未分類」，台股 ETF 持有人的
// 「最大產業重挫 30%」情境失效。以下驗證 ETF 歸類與風險層優先序（純函式，零網路／零 DB）。
describe('classifyEtfSector — ETF 歸類（Issue #105）', () => {
  it('台股 ETF：依市場歸類為「台股 ETF」', () => {
    const twEtfs: Array<[string, string]> = [
      ['00878', '國泰永續高股息'],
      ['00929', '復華台灣科技優息'],
      ['0050', '元大台灣50'],
    ]
    for (const [symbol, name] of twEtfs) {
      expect(classifyEtfSector({ quoteType: 'ETF', name, market: 'tw' })).toBe(TW_ETF_SECTOR)
      expect(TW_ETF_SECTOR).toBe('台股 ETF')
      expect(symbol).toBeTruthy()
    }
  })

  it('名稱含 債／Bond／Treasury → 「債券 ETF」（00687B 美債 ETF）', () => {
    expect(classifyEtfSector({
      quoteType: 'ETF',
      name: 'Cathay US Treasury 20+ YR ETF TWD',
      market: 'tw',
    })).toBe(BOND_ETF_SECTOR)
    expect(classifyEtfSector({ quoteType: 'ETF', name: '元大美債20年', market: 'tw' })).toBe(BOND_ETF_SECTOR)
    expect(classifyEtfSector({ quoteType: 'ETF', name: 'Vanguard Total Bond Market ETF', market: 'us' })).toBe(BOND_ETF_SECTOR)
    expect(BOND_ETF_SECTOR).toBe('債券 ETF')
  })

  it('美股 ETF → 「美股 ETF」', () => {
    expect(classifyEtfSector({ quoteType: 'ETF', name: 'Vanguard S&P 500 ETF', market: 'us' })).toBe(US_ETF_SECTOR)
    expect(US_ETF_SECTOR).toBe('美股 ETF')
  })

  it('非 ETF（EQUITY）不歸類：AAPL／2330', () => {
    expect(classifyEtfSector({ quoteType: 'EQUITY', name: 'Apple Inc.', market: 'us' })).toBeNull()
    expect(classifyEtfSector({ quoteType: 'EQUITY', name: '台積電', market: 'tw' })).toBeNull()
    expect(classifyEtfSector({ quoteType: '', name: 'whatever', market: 'tw' })).toBeNull()
    expect(classifyEtfSector({ quoteType: null, name: null, market: 'tw' })).toBeNull()
    expect(classifyEtfSector({ name: '00878', market: 'tw' })).toBeNull()
  })

  it('quoteType 大小寫不敏感（Yahoo 回 ETF）', () => {
    expect(classifyEtfSector({ quoteType: 'etf', name: '國泰永續高股息', market: 'tw' })).toBe(TW_ETF_SECTOR)
  })
})

describe('resolveHoldingSector — 風險層優先序（Issue #105）', () => {
  it('Yahoo sector 有值 → sectorSource = yahoo（且為中文原值）', () => {
    expect(resolveHoldingSector({
      symbol: '2330',
      market: 'tw',
      yahooSector: '科技',
      quoteType: 'EQUITY',
      companyName: '台積電',
    })).toEqual({ sector: '科技', sectorSource: 'yahoo' })
  })

  it('ETF 且無 sector → ETF 歸類，sectorSource = fallback（不新增列舉值）', () => {
    expect(resolveHoldingSector({
      symbol: '00878',
      market: 'tw',
      yahooSector: null,
      quoteType: 'ETF',
      companyName: '國泰永續高股息',
    })).toEqual({ sector: '台股 ETF', sectorSource: 'fallback' })

    expect(resolveHoldingSector({
      symbol: '00687B',
      market: 'tw',
      yahooSector: undefined,
      quoteType: 'ETF',
      companyName: 'Cathay US Treasury 20+ YR ETF TWD',
    })).toEqual({ sector: '債券 ETF', sectorSource: 'fallback' })
  })

  it('非 ETF 且 Yahoo 無值 → FALLBACK_SECTOR_MAP，sectorSource = fallback', () => {
    expect(resolveHoldingSector({ symbol: '2330.TW', market: 'tw', yahooSector: null, quoteType: 'EQUITY' }))
      .toEqual({ sector: '半導體', sectorSource: 'fallback' })
    expect(resolveHoldingSector({ symbol: 'AAPL', market: 'us', yahooSector: '', quoteType: 'EQUITY' }))
      .toEqual({ sector: '科技', sectorSource: 'fallback' })
  })

  it('三層皆無 → sector null、sectorSource = none（形狀與修正前一致）', () => {
    expect(resolveHoldingSector({ symbol: '9999', market: 'tw' }))
      .toEqual({ sector: null, sectorSource: 'none' })
    expect(resolveHoldingSector({ symbol: 'ZZZZ', market: 'us', yahooSector: null, quoteType: null }))
      .toEqual({ sector: null, sectorSource: 'none' })
  })

  it('ETF 歸類優先於 FALLBACK_SECTOR_MAP（名稱判定勝過代號表）', () => {
    // 0050 在 FALLBACK_SECTOR_MAP 也是「台股 ETF」；00878 不在表內 → 只有 ETF 歸類救得回來
    expect(resolveHoldingSector({
      symbol: '00878', market: 'tw', yahooSector: null, quoteType: 'ETF', companyName: '國泰永續高股息',
    }).sector).toBe('台股 ETF')
  })
})

describe('ETF 歸類 × 集中度整合（Issue #105：不再整組落未分類）', () => {
  // 手算：00878 50000（ETF）／00687B 30000（ETF 且名稱含 Treasury）／2330 20000（Yahoo 科技）
  const holdings: RiskHoldingInput[] = [
    { market: 'tw', symbol: '00878', marketValue: 50000, ...resolveHoldingSector({ symbol: '00878', market: 'tw', quoteType: 'ETF', companyName: '國泰永續高股息' }) },
    { market: 'tw', symbol: '00687B', marketValue: 30000, ...resolveHoldingSector({ symbol: '00687B', market: 'tw', quoteType: 'ETF', companyName: 'Cathay US Treasury 20+ YR ETF TWD' }) },
    { market: 'tw', symbol: '2330', marketValue: 20000, ...resolveHoldingSector({ symbol: '2330', market: 'tw', yahooSector: '科技', quoteType: 'EQUITY' }) },
  ]

  it('產業分布為三桶（無未分類）、產業來源含 yahoo 與 fallback', () => {
    const c = computeConcentration(holdings)
    expect(c.sectors.map((s) => [s.sector, s.marketValue])).toEqual([
      ['台股 ETF', 50000],
      ['債券 ETF', 30000],
      ['科技', 20000],
    ])
    expect(c.sectors.some((s) => s.sector === UNCATEGORIZED_SECTOR)).toBe(false)
    expect(new Set(c.weights.map((w) => w.sectorSource))).toEqual(new Set(['yahoo', 'fallback']))
  })

  it('壓力測試第三格（最大已知產業）金額 > 0', () => {
    const sector30 = scenarioOf(computeStress(computeConcentration(holdings)), 'sector-30')
    expect(sector30.targetUnavailable).toBe(false)
    expect(sector30.targetSector).toBe('台股 ETF')
    // 50000 × 30% = 15000
    expect(sector30.lossAmount).toBe(15000)
  })
})
