import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseRocDateToIso,
  parseRocCompactToIso,
  cleanTwseCode,
  parseTwt48uCsv,
  parseTwt49uRows,
  parseT187ap45Rows,
  matchOfficialDividend,
  parseCoveredMonths,
  backfillMonthWindow,
  writeDividendsMonthPlan,
  ensureYieldHistoryBackfill,
  T187AP45_FETCH_TIMEOUT_MS,
  YIELD_BACKFILL_YEARS,
  type DividendsMonthPlan,
  type OfficialDividendRow,
} from './twse-dividends'

// #95 P2：本檔改為注入 mock 的 @stock/database（其餘測試為純解析，不受影響）。
const db = vi.hoisted(() => ({
  upsertTwseDividends: vi.fn(),
  deleteTwseDividendIfMatches: vi.fn(),
  getAgentSetting: vi.fn(),
  setAgentSetting: vi.fn(),
  getTwseDividendsByYear: vi.fn(),
}))

vi.mock('@stock/database', () => ({
  upsertTwseDividends: db.upsertTwseDividends,
  deleteTwseDividendIfMatches: db.deleteTwseDividendIfMatches,
  getAgentSetting: db.getAgentSetting,
  setAgentSetting: db.setAgentSetting,
  getTwseDividendsByYear: db.getTwseDividendsByYear,
}))

// Issue #90：歷史回填改走 TWT49U 月粒度（TWT48U 無歷史會空轉）。
// Issue #95：回填窗 5 年 → 6 年（5 年平均改「去年為止 5 個完整年度」）。
describe('backfillMonthWindow（回填月份窗，由新往舊）', () => {
  it('當月往前推滿 6 年之 1 月（(Y-5)-01）', () => {
    const months = backfillMonthWindow('2026-10-16')
    expect(months[0]).toBe('2026-10')
    expect(months[months.length - 1]).toBe('2021-01')
    expect(months.length).toBe(12 * 5 + 10)
  })

  it('YIELD_BACKFILL_YEARS === 6', () => {
    expect(YIELD_BACKFILL_YEARS).toBe(6)
  })

  it('UTC+8 邊界：月初／年末不誤差', () => {
    expect(backfillMonthWindow('2026-01-01')[0]).toBe('2026-01')
    expect(backfillMonthWindow('2026-01-01').at(-1)).toBe('2021-01')
    expect(backfillMonthWindow('2026-12-31').at(-1)).toBe('2021-01')
  })

  it('非法日期回空陣列', () => {
    expect(backfillMonthWindow('not-a-date')).toEqual([])
  })
})

// #95：息列取 `權值+息值`（第 6 欄）；權／權息列不再以價差推導。
describe('parseTwt49uRows（息／權／權息三態）', () => {
  it('息列取「權值+息值」，不再用價差推導（2330 2026-03-17）', () => {
    const { rows, unresolved, skipped } = parseTwt49uRows([
      ['115年03月17日', '2330', '台積電', '1,845.00', '1,838.99', '6.000035', '息', '2,020.00', '1,660.00', '1,840.00', '1,838.99'],
    ])
    expect(rows).toEqual([{ symbol: '2330', ex_date: '2026-03-17', cash_dividend: 6.000035 }])
    expect(unresolved).toEqual([])
    expect(skipped).toBe(0)
  })

  it('權息列不推導：1773 勝一 2025-06-13 不得產生 27.25 假股利', () => {
    const { rows, unresolved } = parseTwt49uRows([
      // 實測列：前收 151.00、減除股利參考價 123.75 → 舊版會寫入 27.25（含配股價值）
      ['114年06月13日', '1773', '勝一', '151.00', '123.75', '27.250000', '權息', '136.00', '111.50', '124.00', '123.75'],
    ])
    expect(rows).toEqual([])
    expect(unresolved).toEqual([{ symbol: '1773', ex_date: '2025-06-13', kind: '權息', derivedValue: 27.25 }])
  })

  it('純權列亦不推導（3416 融程電 2026-09-01；價差 8.63 為配股價值）', () => {
    const { rows, unresolved } = parseTwt49uRows([
      ['115年09月01日', '3416', '融程電', '182.00', '173.37', '8.627321', '權', '190.50', '156.50', '173.50', '173.37'],
    ])
    expect(rows).toEqual([])
    expect(unresolved).toEqual([{ symbol: '3416', ex_date: '2026-09-01', kind: '權', derivedValue: 8.63 }])
  })

  it('息列誤差修正：前收 − 減除參考價的 0.07 改為官方級 0.068', () => {
    const { rows } = parseTwt49uRows([
      ['115年07月01日', '00939', '統一台灣高息動能', '13.74', '13.67', '0.068000', '息', '15.03', '12.31', '13.67', '13.67'],
    ])
    expect(rows).toEqual([{ symbol: '00939', ex_date: '2026-07-01', cash_dividend: 0.068 }])
  })

  it('代號 Excel 前綴清洗；非法列計 skipped', () => {
    const { rows, skipped } = parseTwt49uRows([
      ['115年06月19日', '="2330"', '台積電', '1000', '990', '10', '息', '0', '0', '990', '990'],
      ['壞列'],
    ])
    expect(rows).toEqual([{ symbol: '2330', ex_date: '2026-06-19', cash_dividend: 10 }])
    expect(skipped).toBe(1)
  })
})

// #95：官方股利分派表（t187ap45_L）解析——現金股利合計＝三個「元/股」欄相加。
describe('parseT187ap45Rows（官方股利分派表）', () => {
  // #95 P4：官方表 2.47 MB（gzip 471 KB）、跨區（Azure Canada Central）實測 >20s
  // 逾時被中止 → 調為 120s；此斷言防日後被調回短逾時。
  it('抓取逾時 ≥ 90s（跨區 2.47 MB 慢速串流；上限受 sync workflow --max-time 240 約束）', () => {
    expect(T187AP45_FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(90000)
    expect(T187AP45_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(150000)
  })

  const raw = [
    {
      出表日期: '1151015',
      公司代號: '2330',
      公司名稱: '台積電',
      '決議（擬議）進度': '董事會決議',
      股利年度: '114',
      '股利所屬年(季)度': '第1季',
      股利所屬期間: '1141001~1141231',
      期別: '1',
      '董事會（擬議）股利分派日': '1150210',
      股東會日期: '',
      '股東配發-盈餘分配之現金股利(元/股)': '6.00003573',
      '股東配發-法定盈餘公積發放之現金(元/股)': '0.0',
      '股東配發-資本公積發放之現金(元/股)': '0.0',
      '股東配發-股東配發之現金(股利)總金額(元)': '155595147126',
    },
    {
      公司代號: '1101',
      '董事會（擬議）股利分派日': '1150311',
      股利年度: '114',
      '股東配發-盈餘分配之現金股利(元/股)': '0.0',
      '股東配發-法定盈餘公積發放之現金(元/股)': '0.0',
      '股東配發-資本公積發放之現金(元/股)': '0.80000000',
      '股東配發-股東配發之現金(股利)總金額(元)': '5994545394',
    },
    { 公司代號: '', '董事會（擬議）股利分派日': '1150311' },
  ]

  it('解析現金股利合計（含資本公積）與董事會日（民國→ISO）', () => {
    const rows = parseT187ap45Rows(raw)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ symbol: '2330', boardDate: '2026-02-10', cash: 6.00003573, dividendYear: '114' })
    expect(rows[1]).toEqual({ symbol: '1101', boardDate: '2026-03-11', cash: 0.8, dividendYear: '114' })
  })

  it('支援 { data: [...] } 包裝；非陣列回空', () => {
    expect(parseT187ap45Rows({ data: raw }).length).toBe(2)
    expect(parseT187ap45Rows(null)).toEqual([])
    expect(parseT187ap45Rows('nope')).toEqual([])
  })

  it('民國 compact 日期轉換', () => {
    expect(parseRocCompactToIso('1150210')).toBe('2026-02-10')
    expect(parseRocCompactToIso('1141223')).toBe('2025-12-23')
    expect(parseRocCompactToIso('0')).toBeNull()
    expect(parseRocCompactToIso('')).toBeNull()
  })
})

describe('matchOfficialDividend（官方值對應；2330／1773／3416 回歸）', () => {
  const official: OfficialDividendRow[] = [
    { symbol: '2330', boardDate: '2026-08-11', cash: 7, dividendYear: '115' },
    { symbol: '2330', boardDate: '2026-05-12', cash: 7.00000137, dividendYear: '115' },
    { symbol: '2330', boardDate: '2026-02-10', cash: 6.00003573, dividendYear: '114' },
    { symbol: '1773', boardDate: '2026-03-04', cash: 4, dividendYear: '114' },
    { symbol: '3416', boardDate: '2026-02-24', cash: 5.1, dividendYear: '114' },
    { symbol: '0056', boardDate: null, cash: 0.866, dividendYear: '114' },
  ]

  it('息列以值最接近者校正精度（03-17／06-11 → 114Q4；09-16 → 115Q1）', () => {
    expect(matchOfficialDividend(official, '2330', '2026-03-17', 6.000035, '息')).toBe(6.00003573)
    expect(matchOfficialDividend(official, '2330', '2026-06-11', 6.000035, '息')).toBe(6.00003573)
    expect(matchOfficialDividend(official, '2330', '2026-09-16', 7.000001, '息')).toBe(7.00000137)
  })

  it('息列的換算差（3416 5.095945 vs 官方 5.1）仍對齊官方值', () => {
    expect(matchOfficialDividend(official, '3416', '2026-06-30', 5.095945, '息')).toBe(5.1)
  })

  it('權息列：董事會日 ≤ ex_date 且最接近者；查不到（跨年）回 null', () => {
    // 1773 2025-06-13：官方表僅 2026-03-04（在 ex_date 之後）→ 不得覆寫
    expect(matchOfficialDividend(official, '1773', '2025-06-13', null, '權息')).toBeNull()
    expect(matchOfficialDividend(official, '3416', '2026-06-20', null, '權息')).toBe(5.1)
  })

  it('純權列一律不套官方值（除權無現金；官方值屬另一個除息事件）', () => {
    expect(matchOfficialDividend(official, '3416', '2026-09-01', null, '權')).toBeNull()
  })

  it('官方表無此代號／無董事會日／值差過大 → null（0056 ETF 不在表內）', () => {
    expect(matchOfficialDividend(official, '0056', '2026-01-22', 0.866, '息')).toBeNull()
    expect(matchOfficialDividend(official, '9999', '2026-01-22', 1, '息')).toBeNull()
    expect(matchOfficialDividend(official, '2330', '2026-01-10', 6.000035, '息')).toBeNull()
    expect(matchOfficialDividend(null, '2330', '2026-03-17', 6.000035, '息')).toBeNull()
  })
})

describe('parseCoveredMonths（#95 覆蓋集）', () => {
  it('只留合法 YYYY-MM；壞資料回空', () => {
    expect(parseCoveredMonths('["2026-09","2026-8","x","2021-01"]')).toEqual(['2026-09', '2021-01'])
    expect(parseCoveredMonths('not-json')).toEqual([])
    expect(parseCoveredMonths(null)).toEqual([])
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

// ─── #95 P2 回歸：dry-run 預設陷阱（漏傳 opts → 靜默 no-op 卻標記覆蓋）──────
function monthPlan(month = '2026-09'): DividendsMonthPlan {
  return {
    month,
    upserts: [
      { symbol: '2330', ex_date: '2026-09-16', cash_dividend: 7.00000137 },
      { symbol: '0056', ex_date: '2026-09-18', cash_dividend: 0.866 },
    ],
    officialOverrides: 1,
    unresolved: [],
    deleteCandidates: [{ symbol: '1773', ex_date: '2025-06-13', derivedValue: 27.25 }],
    skipped: 0,
  }
}

describe('writeDividendsMonthPlan（#95 P2：opts 必填、移除 dry-run 預設值）', () => {
  beforeEach(() => {
    db.upsertTwseDividends.mockReset().mockResolvedValue(2)
    db.deleteTwseDividendIfMatches.mockReset().mockResolvedValue(1)
    db.getAgentSetting.mockReset().mockResolvedValue(null)
    db.setAgentSetting.mockReset().mockResolvedValue(undefined)
    db.getTwseDividendsByYear.mockReset().mockResolvedValue([])
  })

  it('型別層：opts 必填（少傳即編譯失敗，防下一個呼叫端再踩）', () => {
    // @ts-expect-error #95 P2：opts 必填；若有人加回預設值，此行會變成「未使用的 ts-expect-error」→ typecheck 失敗
    const missing = () => writeDividendsMonthPlan(monthPlan())
    expect(typeof missing).toBe('function')
  })

  it('未經型別檢查漏傳 opts（JS 呼叫端）→ 立即拋錯且完全不碰 DB', async () => {
    const loose = writeDividendsMonthPlan as unknown as (plan: DividendsMonthPlan) => Promise<unknown>
    await expect(loose(monthPlan())).rejects.toThrow()
    expect(db.upsertTwseDividends).not.toHaveBeenCalled()
    expect(db.deleteTwseDividendIfMatches).not.toHaveBeenCalled()
  })

  it('dryRun:true → 只回 ok:false，不寫不刪（不得碰 DB）', async () => {
    const res = await writeDividendsMonthPlan(monthPlan(), { dryRun: true })
    expect(res).toEqual({ written: 0, deleted: 0, ok: false, reason: 'dry-run' })
    expect(db.upsertTwseDividends).not.toHaveBeenCalled()
    expect(db.deleteTwseDividendIfMatches).not.toHaveBeenCalled()
  })

  it('dryRun:false → 真的呼叫 upsert 與 deleteIfMatches（回 ok:true）', async () => {
    const plan = monthPlan()
    const res = await writeDividendsMonthPlan(plan, { dryRun: false })
    expect(res).toEqual({ written: 2, deleted: 1, ok: true, reason: null })
    expect(db.upsertTwseDividends).toHaveBeenCalledTimes(1)
    expect(db.upsertTwseDividends).toHaveBeenCalledWith(plan.upserts)
    expect(db.deleteTwseDividendIfMatches).toHaveBeenCalledTimes(1)
    expect(db.deleteTwseDividendIfMatches).toHaveBeenCalledWith('1773', '2025-06-13', 27.25)
  })

  it('upsert 拋錯 → ok:false、不執行刪除（不得被當成寫入成功）', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.upsertTwseDividends.mockRejectedValueOnce(new Error('db down'))
    const res = await writeDividendsMonthPlan(monthPlan(), { dryRun: false })
    expect(res.ok).toBe(false)
    expect(res.written).toBe(0)
    expect(res.reason).toContain('db down')
    expect(db.deleteTwseDividendIfMatches).not.toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('ensureYieldHistoryBackfill（#95 P2：只有確實寫入才 markMonthsCovered）', () => {
  function deps() {
    return {
      yearRows: vi.fn(async () => 10),
      coveredMonths: vi.fn(async () => new Set<string>(['2026-10'])),
      planMonth: vi.fn(async (month: string) => monthPlan(month)),
      markCovered: vi.fn(async (months: string[]) => months),
    }
  }

  beforeEach(() => {
    db.upsertTwseDividends.mockReset().mockResolvedValue(2)
    db.deleteTwseDividendIfMatches.mockReset().mockResolvedValue(1)
    db.getAgentSetting.mockReset().mockResolvedValue(null)
    db.setAgentSetting.mockReset().mockResolvedValue(undefined)
    db.getTwseDividendsByYear.mockReset().mockResolvedValue([])
  })

  it('apply 無實際寫入（ok:false）→ 不 markCovered、status=failed', async () => {
    const d = deps()
    const writeMonth = vi.fn(async () => ({ written: 0, deleted: 0, ok: false, reason: 'dry-run' }))
    const res = await ensureYieldHistoryBackfill('2026-10-16', {
      maxMonths: 2,
      official: [],
      deps: { ...d, writeMonth },
    })
    expect(res.status).toBe('failed')
    expect(res.written).toBe(0)
    expect(res.reason).toContain('not-written')
    expect(d.markCovered).not.toHaveBeenCalled()
  })

  it('預設 writer 為非 dry-run：真的寫入 DB 後才 markCovered（逐月）', async () => {
    const d = deps()
    const res = await ensureYieldHistoryBackfill('2026-10-16', { maxMonths: 2, official: [], deps: d })
    expect(res.written).toBe(4) // 2 個月 × 2 upserts
    expect(res.deleted).toBe(2)
    expect(db.upsertTwseDividends).toHaveBeenCalledTimes(2)
    expect(d.markCovered.mock.calls.map((c) => c[0])).toEqual([['2026-09'], ['2026-08']])
  })

  it('upsert 失敗的該月不 markCovered（其餘月照做，下輪重試）', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = deps()
    db.upsertTwseDividends.mockRejectedValueOnce(new Error('db down'))
    const res = await ensureYieldHistoryBackfill('2026-10-16', { maxMonths: 2, official: [], deps: d })
    expect(res.written).toBe(2) // 只有 2026-08 成功
    expect(d.markCovered.mock.calls.map((c) => c[0])).toEqual([['2026-08']])
    expect(res.reason).toContain('not-written')
    err.mockRestore()
  })

  it('全部月份皆已覆蓋 → done 且不抓不寫', async () => {
    const d = deps()
    d.coveredMonths = vi.fn(async () => new Set(backfillMonthWindow('2026-10-16')))
    const res = await ensureYieldHistoryBackfill('2026-10-16', { maxMonths: 2, official: [], deps: d })
    expect(res.status).toBe('done')
    expect(db.upsertTwseDividends).not.toHaveBeenCalled()
    expect(d.markCovered).not.toHaveBeenCalled()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

