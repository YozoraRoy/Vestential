import { describe, it, expect, vi } from 'vitest'
import { handleOddLotRepair, normalizeRepairDate, type OddLotRepairDeps } from './odd-lot-repair'

function makeDeps(overrides: Partial<OddLotRepairDeps> = {}): OddLotRepairDeps {
  return {
    listCounts: vi.fn().mockResolvedValue([
      { date: '20261009', cnt: 1200 },
      { date: '20261008', cnt: 1150 },
    ]),
    deleteByDate: vi.fn().mockResolvedValue(1200),
    backfillByDate: vi.fn().mockResolvedValue(1150),
    onLog: () => {},
    ...overrides,
  }
}

describe('normalizeRepairDate', () => {
  it('接受 YYYYMMDD／YYYY-MM-DD／YYYY/MM/DD', () => {
    expect(normalizeRepairDate('20261009')).toBe('20261009')
    expect(normalizeRepairDate('2026-10-09')).toBe('20261009')
    expect(normalizeRepairDate('2026/10/09')).toBe('20261009')
  })
  it('不合法回 null', () => {
    expect(normalizeRepairDate('')).toBeNull()
    expect(normalizeRepairDate('2026109')).toBeNull()
    expect(normalizeRepairDate('not-a-date')).toBeNull()
    expect(normalizeRepairDate(undefined)).toBeNull()
    expect(normalizeRepairDate(20261009)).toBeNull()
  })
})

describe('handleOddLotRepair｜鑑權', () => {
  it('未授權回 401，且不碰任何依賴（零寫入）', async () => {
    const deps = makeDeps()
    const res = await handleOddLotRepair({ authorized: false, body: { action: 'assess' } }, deps)
    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ success: false })
    expect(deps.listCounts).not.toHaveBeenCalled()
    expect(deps.deleteByDate).not.toHaveBeenCalled()
    expect(deps.backfillByDate).not.toHaveBeenCalled()
  })
})

describe('handleOddLotRepair｜參數驗證', () => {
  it('未知 action 回 400', async () => {
    const deps = makeDeps()
    const res = await handleOddLotRepair({ authorized: true, body: { action: 'wipe' } }, deps)
    expect(res.status).toBe(400)
  })
  it('delete／backfill 缺 date 回 400', async () => {
    const deps = makeDeps()
    expect((await handleOddLotRepair({ authorized: true, body: { action: 'delete' } }, deps)).status).toBe(400)
    expect(
      (await handleOddLotRepair({ authorized: true, body: { action: 'backfill', date: 'xyz' } }, deps)).status,
    ).toBe(400)
    expect(deps.deleteByDate).not.toHaveBeenCalled()
    expect(deps.backfillByDate).not.toHaveBeenCalled()
  })
})

describe('handleOddLotRepair｜assess（唯讀）', () => {
  it('回傳各 date 筆數，不呼叫寫入依賴', async () => {
    const deps = makeDeps()
    const res = await handleOddLotRepair({ authorized: true, body: { action: 'assess' } }, deps)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, action: 'assess' })
    expect((res.body as any).counts).toEqual([
      { date: '20261009', cnt: 1200 },
      { date: '20261008', cnt: 1150 },
    ])
    expect(deps.deleteByDate).not.toHaveBeenCalled()
    expect(deps.backfillByDate).not.toHaveBeenCalled()
  })
})

describe('handleOddLotRepair｜delete 需二次確認', () => {
  it('無 confirm 不執行：只回 wouldDelete，零寫入', async () => {
    const deps = makeDeps()
    const res = await handleOddLotRepair(
      { authorized: true, body: { action: 'delete', date: '20261009', dryRun: false } },
      deps,
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, dryRun: true, date: '20261009', wouldDelete: 1200, deleted: 0 })
    expect(deps.deleteByDate).not.toHaveBeenCalled()
  })
  it('預設 dry-run（無 dryRun:false）即使有 confirm 也不執行', async () => {
    const deps = makeDeps()
    const res = await handleOddLotRepair(
      { authorized: true, body: { action: 'delete', date: '20261009', confirm: true } },
      deps,
    )
    expect(res.body).toMatchObject({ dryRun: true, deleted: 0 })
    expect(deps.deleteByDate).not.toHaveBeenCalled()
  })
  it('confirm:true＋dryRun:false 才執行刪除並 log 筆數', async () => {
    const onLog = vi.fn()
    const deps = makeDeps({ onLog })
    const res = await handleOddLotRepair(
      { authorized: true, body: { action: 'delete', date: '20261009', confirm: true, dryRun: false } },
      deps,
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, dryRun: false, date: '20261009', deleted: 1200 })
    expect(deps.deleteByDate).toHaveBeenCalledWith('20261009')
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('1200'))
  })
})

describe('handleOddLotRepair｜backfill 預設 dry-run', () => {
  it('預設不抓取寫入：只回 existing，零寫入', async () => {
    const deps = makeDeps()
    const res = await handleOddLotRepair(
      { authorized: true, body: { action: 'backfill', date: '20261008' } },
      deps,
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, dryRun: true, date: '20261008', existing: 1150, inserted: 0 })
    expect(deps.backfillByDate).not.toHaveBeenCalled()
    expect(deps.deleteByDate).not.toHaveBeenCalled()
  })
  it('dryRun:false 執行回填並 log 筆數', async () => {
    const onLog = vi.fn()
    const deps = makeDeps({ onLog })
    const res = await handleOddLotRepair(
      { authorized: true, body: { action: 'backfill', date: '20261008', dryRun: false } },
      deps,
    )
    expect(res.body).toMatchObject({ success: true, dryRun: false, date: '20261008', inserted: 1150 })
    expect(deps.backfillByDate).toHaveBeenCalledWith('20261008')
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('1150'))
  })
})
