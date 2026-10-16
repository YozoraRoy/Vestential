import { describe, it, expect, vi } from 'vitest'
import {
  handleDividendsRepair,
  normalizeRepairMonth,
  type DividendsRepairCoverage,
  type DividendsRepairDeps,
} from './dividends-repair'
import type { DividendsMonthPlan } from './twse-dividends'

// Issue #95：修復端點語意（dryRun 預設 true、limit 分段、冪等、401）。
const coverage: DividendsRepairCoverage = {
  years: [
    { year: '2021', rows: 120, missing: false },
    { year: '2022', rows: 0, missing: true },
  ],
  // 由新往舊（backfillMonthWindow 順序）
  windowMonths: ['2026-10', '2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04'],
  coveredMonths: ['2026-10'],
}

function plan(month: string, upserts = 3, deletes = 1): DividendsMonthPlan {
  return {
    month,
    upserts: Array.from({ length: upserts }, (_, i) => ({
      symbol: `233${i}`,
      ex_date: `${month}-01`,
      cash_dividend: 1 + i,
    })),
    officialOverrides: 1,
    unresolved: [],
    deleteCandidates: Array.from({ length: deletes }, (_, i) => ({
      symbol: `177${i}`,
      ex_date: `${month}-13`,
      derivedValue: 27.25,
    })),
    skipped: 0,
  }
}

function deps(overrides: Partial<DividendsRepairDeps> = {}) {
  const planMonth = vi.fn(async (m: string) => plan(m))
  const applyPlan = vi.fn(
    async (_plan: DividendsMonthPlan, _opts: { dryRun: boolean }) => ({ written: 3, deleted: 1, ok: true, reason: null }),
  )
  const markCovered = vi.fn(async (months: string[]) => months)
  return {
    deps: {
      coverage: async () => coverage,
      planMonth,
      applyPlan,
      markCovered,
      ...overrides,
    } as DividendsRepairDeps,
    planMonth,
    applyPlan,
    markCovered,
  }
}

describe('normalizeRepairMonth', () => {
  it('接受 YYYY-MM / YYYY-MM-DD / YYYY/MM；非法回 null', () => {
    expect(normalizeRepairMonth('2026-09')).toBe('2026-09')
    expect(normalizeRepairMonth('2026-9-1')).toBe('2026-09')
    expect(normalizeRepairMonth('2026/09')).toBe('2026-09')
    expect(normalizeRepairMonth('2026-13')).toBeNull()
    expect(normalizeRepairMonth('nope')).toBeNull()
    expect(normalizeRepairMonth(202601)).toBeNull()
  })
})

describe('handleDividendsRepair', () => {
  it('未帶 Bearer SYNC_TOKEN（authorized=false）回 401 且不抓不寫', async () => {
    const { deps: d, planMonth } = deps()
    const r = await handleDividendsRepair({ authorized: false, body: { action: 'repair', dryRun: false } }, d)
    expect(r.status).toBe(401)
    expect(r.body.success).toBe(false)
    expect(planMonth).not.toHaveBeenCalled()
  })

  it('action 非法回 400', async () => {
    const { deps: d } = deps()
    expect((await handleDividendsRepair({ authorized: true, body: {} }, d)).status).toBe(400)
    expect((await handleDividendsRepair({ authorized: true, body: { action: 'delete' } }, d)).status).toBe(400)
  })

  it('assess：唯讀回分年 coverage＋未回填月數', async () => {
    const { deps: d, planMonth } = deps()
    const r = await handleDividendsRepair({ authorized: true, body: { action: 'assess' } }, d)
    expect(r.status).toBe(200)
    expect(r.body.years).toEqual(coverage.years)
    expect(r.body.covered_months).toBe(1)
    expect(r.body.pending_months).toBe(6)
    expect(r.body.window).toEqual({ from: '2026-04', to: '2026-10', months: 7 })
    expect(planMonth).not.toHaveBeenCalled()
  })

  it('repair：dryRun 預設 true → 只回 would_write／would_delete，不寫不刪不標記', async () => {
    const { deps: d, applyPlan, markCovered } = deps()
    const r = await handleDividendsRepair({ authorized: true, body: { action: 'repair' } }, d)
    expect(r.status).toBe(200)
    expect(r.body.dryRun).toBe(true)
    expect(r.body.written).toBe(0)
    expect(r.body.deleted).toBe(0)
    expect(r.body.would_write).toBe(18) // 6 個月 × 3
    expect(r.body.would_delete).toBe(6)
    expect(r.body.processed).toBe(6)
    expect(r.body.next_month).toBe('2026-04')
    expect(r.body.remaining).toBe(1)
    expect(applyPlan).not.toHaveBeenCalled()
    expect(markCovered).not.toHaveBeenCalled()
  })

  it('repair＋dryRun:false → 逐月套用（顯式 dryRun:false）並標記已覆蓋；連跑兩次結果一致（冪等）', async () => {
    const { deps: d, applyPlan, markCovered } = deps()
    const first = await handleDividendsRepair({ authorized: true, body: { action: 'repair', dryRun: false, limit: 3 } }, d)
    expect(first.body.written).toBe(9)
    expect(first.body.deleted).toBe(3)
    expect(first.body.official_overrides).toBe(3)
    expect(first.body.next_month).toBe('2026-07')
    expect(applyPlan).toHaveBeenCalledTimes(3)
    // #95 P2：apply 必須收到 dryRun 關閉（舊版沒傳 → 實跑 no-op）
    expect(applyPlan.mock.calls.map((c) => c[1])).toEqual([{ dryRun: false }, { dryRun: false }, { dryRun: false }])
    expect(markCovered).toHaveBeenCalledWith(['2026-10', '2026-09', '2026-08'])
    // covered_months = 既有 {2026-10} ∪ 實際標記成功的 3 個月 = 3（2026-10 已存在；
    // 舊版 `covered.size + applied.length` 會謊報成 4）
    expect(first.body.covered_months).toBe(3)
    expect(first.body.marked_months).toBe(3)

    const second = await handleDividendsRepair({ authorized: true, body: { action: 'repair', dryRun: false, limit: 3 } }, d)
    expect(second.body.written).toBe(first.body.written)
    expect(second.body.would_write).toBe(first.body.would_write)
  })

  it('repair＋dryRun:false：apply 回報未寫入（ok:false）→ 該月記 failed、written 0、covered_months 不增', async () => {
    const applyPlan = vi.fn(async () => ({ written: 0, deleted: 0, ok: false, reason: 'dry-run' }))
    const { deps: d, markCovered } = deps({ applyPlan })
    const r = await handleDividendsRepair({ authorized: true, body: { action: 'repair', dryRun: false, limit: 2 } }, d)
    expect(r.body.written).toBe(0)
    expect(r.body.failed_months).toBe(2)
    expect(r.body.success).toBe(false)
    expect(markCovered).not.toHaveBeenCalled()
    expect(r.body.covered_months).toBe(1) // 只有既有 2026-10，不得 + applied.length
    expect(r.body.marked_months).toBe(0)
    const months = r.body.months as Array<Record<string, unknown>>
    expect(String(months[0]?.error)).toContain('apply not written')
  })

  it('repair＋dryRun:false：markCovered 拋錯時 covered_months 不得謊報', async () => {
    const markCovered = vi.fn(async () => {
      throw new Error('settings down')
    })
    const { deps: d } = deps({ markCovered })
    const r = await handleDividendsRepair({ authorized: true, body: { action: 'repair', dryRun: false, limit: 2 } }, d)
    expect(r.body.written).toBe(6)
    expect(r.body.covered_months).toBe(1)
    expect(r.body.marked_months).toBe(0)
  })

  it('repair：from/to 過濾與 limit 夾範圍（1..12）', async () => {
    const { deps: d } = deps()
    const r = await handleDividendsRepair(
      { authorized: true, body: { action: 'repair', from: '2026-08', to: '2026-07', limit: 99 } },
      d,
    )
    expect(r.body.processed).toBe(0)
    expect(r.body.remaining).toBe(0)
    const r2 = await handleDividendsRepair({ authorized: true, body: { action: 'repair', from: '2026-09', limit: 99 } }, d)
    expect(r2.body.limit).toBe(12)
    expect(r2.body.months).toHaveLength(2) // from=2026-09 → 2026-10, 2026-09
    expect(r2.body.next_month).toBeNull()
    const r3 = await handleDividendsRepair({ authorized: true, body: { action: 'repair', limit: 0 } }, d)
    expect(r3.body.limit).toBe(1)
  })

  it('repair：單月抓取失敗不擋整段（failed_months 揭露，其餘照做）', async () => {
    const planMonth = vi.fn(async (m: string) => {
      if (m === '2026-09') throw new Error('TWSE TWT49U error: 429')
      return plan(m)
    })
    const { deps: d, applyPlan } = deps({ planMonth })
    const r = await handleDividendsRepair({ authorized: true, body: { action: 'repair', dryRun: false, limit: 3 } }, d)
    expect(r.status).toBe(200)
    expect(r.body.failed_months).toBe(1)
    expect(r.body.success).toBe(false)
    expect(applyPlan).toHaveBeenCalledTimes(2)
    const months = r.body.months as Array<Record<string, unknown>>
    expect(months.find((m) => m.month === '2026-09')?.error).toContain('429')
  })
})
