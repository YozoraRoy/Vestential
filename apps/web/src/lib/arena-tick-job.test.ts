import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'

// ─── temp DB 隔離（必須在 import @stock/database 之前生效） ────────
vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp'
  const dir = `${base}\\arena-tick-job-test-${process.pid}`
  process.env.DATABASE_PATH = `${dir}\\arena-tick.db`
  delete process.env.DATABASE_URL // 強制 SQLite 後端
})

// ─── mock @stock/ai-engine：只留 arena.ts 用到的符號，runArenaRound 可控 ──
const aiMocks = vi.hoisted(() => ({
  runArenaRound: vi.fn(),
  buildDefaultDailyUniverse: vi.fn(),
  fetchArenaMarket: vi.fn(),
  fetchArenaLivePrices: vi.fn(),
}))

vi.mock('@stock/ai-engine', () => ({
  runArenaRound: aiMocks.runArenaRound,
  LightweightStrategist: class LightweightStrategist {},
  buildDefaultDailyUniverse: aiMocks.buildDefaultDailyUniverse,
  fetchArenaMarket: aiMocks.fetchArenaMarket,
  fetchArenaLivePrices: aiMocks.fetchArenaLivePrices,
  normalizeArenaStrategyParams: (p: unknown) => p,
}))

import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  startArenaTickJob,
  arenaTickWatchdogMinutes,
  arenaTickHeartbeatMs,
  ARENA_TICK_WATCHDOG_MIN,
  ARENA_TICK_ERRORS_MAX,
  ARENA_TICK_ERROR_ITEM_MAX_CHARS,
  sanitizeArenaTickResult,
  isArenaTickJobStale,
  interpretArenaTickJobStatus,
  type ArenaTickStatusView,
} from './arena'
import { getArenaTickJobById, closeDb, dbExecute } from '@stock/database'
import type { ArenaTickJobRow } from '@stock/database'

// ─── helpers ──────────────────────────────────────────────────────
function deferred<T>() {
  let resolve!: (v: T | PromiseLike<T>) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 8000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor timeout')
}

function row(over: Partial<ArenaTickJobRow>): ArenaTickJobRow {
  return {
    id: 1,
    round_date: '2026-09-16',
    phase: 'premarket',
    slot: null,
    status: 'running',
    result: null,
    error: null,
    created_at: '2026-09-16T08:00:00+08:00',
    updated_at: '2026-09-16T08:00:00+08:00',
    ...over,
  }
}

const NOW = new Date('2026-09-16T09:00:00+08:00')

beforeAll(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp'
  const dir = join(base, `arena-tick-job-test-${process.pid}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
})

afterAll(() => {
  closeDb()
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp'
  rmSync(join(base, `arena-tick-job-test-${process.pid}`), { recursive: true, force: true })
})

// ─── watchdog 常數（依 phase 分設：premarket=20 / slot=12 / close=20）───
describe('ARENA_TICK_WATCHDOG_MIN（依 phase 分設）', () => {
  it('premarket=20、slot=12、close=20、full=20（QA 量測定案）', () => {
    expect(ARENA_TICK_WATCHDOG_MIN.premarket).toBe(20)
    expect(ARENA_TICK_WATCHDOG_MIN.slot).toBe(12)
    expect(ARENA_TICK_WATCHDOG_MIN.close).toBe(20)
    expect(ARENA_TICK_WATCHDOG_MIN.full).toBe(20)
  })

  it('arenaTickWatchdogMinutes 未知/空值一律回 20', () => {
    expect(arenaTickWatchdogMinutes('premarket')).toBe(20)
    expect(arenaTickWatchdogMinutes('slot')).toBe(12)
    expect(arenaTickWatchdogMinutes('close')).toBe(20)
    expect(arenaTickWatchdogMinutes(undefined)).toBe(20)
    expect(arenaTickWatchdogMinutes(null)).toBe(20)
    expect(arenaTickWatchdogMinutes('weird')).toBe(20)
  })
})

// ─── result/error 上限 ─────────────────────────────────────────────
describe('sanitizeArenaTickResult 上限', () => {
  it('errors 陣列截斷至 50 筆、每筆 500 字', () => {
    const result = {
      alreadyRun: false,
      universeSize: 1,
      processed: 1,
      trades: 0,
      errors: Array.from({ length: 80 }, (_, i) => `e${i}`.repeat(600)),
      modelCalls: 1,
      roundDate: '2026-09-16',
    }
    const parsed = JSON.parse(sanitizeArenaTickResult(result as never))
    expect(parsed.errors.length).toBe(ARENA_TICK_ERRORS_MAX)
    expect(parsed.errors[0].length).toBe(ARENA_TICK_ERROR_ITEM_MAX_CHARS)
    expect(parsed.processed).toBe(1)
  })

  it('總長度超過上限時標 truncated（不爆 DB 欄位）', () => {
    const result = {
      processed: 1,
      trades: 0,
      errors: [],
      modelCalls: 1,
      roundDate: '2026-09-16',
      pad: 'x'.repeat(200_000),
    }
    const parsed = JSON.parse(sanitizeArenaTickResult(result as never))
    expect(parsed.truncated).toBe(true)
    expect(parsed.pad.length).toBeLessThan(200_000)
  })
})

// ─── stale 判定（status 端點 watchdog）─────────────────────────────
describe('isArenaTickJobStale（staleness 守衛）', () => {
  it('running 且 updated_at 超過該 phase watchdog → stale（實例回收）', () => {
    expect(isArenaTickJobStale(row({ phase: 'premarket', updated_at: '2026-09-16T08:35:00+08:00' }), NOW)).toBe(true)
    expect(isArenaTickJobStale(row({ phase: 'slot', updated_at: '2026-09-16T08:40:00+08:00' }), NOW)).toBe(true)
    expect(isArenaTickJobStale(row({ phase: 'close', updated_at: '2026-09-16T08:35:00+08:00' }), NOW)).toBe(true)
  })

  it('running 且未逾 watchdog → 非 stale', () => {
    expect(isArenaTickJobStale(row({ phase: 'premarket', updated_at: '2026-09-16T08:50:00+08:00' }), NOW)).toBe(false)
    expect(isArenaTickJobStale(row({ phase: 'slot', updated_at: '2026-09-16T08:55:00+08:00' }), NOW)).toBe(false)
  })

  it('slot 12min 邊界：超過 12 分鐘才算 stale', () => {
    expect(isArenaTickJobStale(row({ phase: 'slot', updated_at: '2026-09-16T08:48:00+08:00' }), NOW)).toBe(false)
    expect(isArenaTickJobStale(row({ phase: 'slot', updated_at: '2026-09-16T08:47:00+08:00' }), NOW)).toBe(true)
  })

  it('done/failed 一律不視為 stale', () => {
    expect(isArenaTickJobStale(row({ status: 'done', updated_at: '2026-09-15T00:00:00+08:00' }), NOW)).toBe(false)
    expect(isArenaTickJobStale(row({ status: 'failed', updated_at: '2026-09-15T00:00:00+08:00' }), NOW)).toBe(false)
  })
})

// ─── status 三態解析（M6）──────────────────────────────────────────
describe('interpretArenaTickJobStatus（三態）', () => {
  it('done → result 解析為物件', () => {
    const view = interpretArenaTickJobStatus(
      row({ status: 'done', result: JSON.stringify({ processed: 3, trades: 2, errors: [] }) }),
      NOW,
    )
    expect(view.status).toBe('done')
    expect((view.result as { processed: number }).processed).toBe(3)
    expect((view.result as { trades: number }).trades).toBe(2)
  })

  it('done 但 result 為非法 JSON → result null 不炸', () => {
    const view = interpretArenaTickJobStatus(row({ status: 'done', result: '{broken' }), NOW)
    expect(view.status).toBe('done')
    expect(view.result).toBeNull()
  })

  it('failed → 帶 error', () => {
    const view = interpretArenaTickJobStatus(row({ status: 'failed', error: 'run boom' }), NOW)
    expect(view.status).toBe('failed')
    expect(view.error).toBe('run boom')
  })

  it('running 未逾時 → running（含 startedAt/updatedAt）', () => {
    const view = interpretArenaTickJobStatus(row({ updated_at: '2026-09-16T08:59:00+08:00' }), NOW)
    expect(view.status).toBe('running')
    expect(view.startedAt).toBe('2026-09-16T08:00:00+08:00')
    expect(view.updatedAt).toBe('2026-09-16T08:59:00+08:00')
  })

  it('running 但逾 watchdog → 視為 failed「逾時/實例回收」（可重觸發）', () => {
    const view = interpretArenaTickJobStatus(
      row({ phase: 'slot', updated_at: '2026-09-16T08:40:00+08:00' }),
      NOW,
    ) as ArenaTickStatusView
    expect(view.status).toBe('failed')
    expect(String(view.error)).toContain('逾時')
  })
})

// ─── 背景 job：真實 SQLite + mock ai-engine ───────────────────────
describe('startArenaTickJob（背景跑完寫 DB）', () => {
  beforeEach(() => {
    aiMocks.runArenaRound.mockReset()
    aiMocks.buildDefaultDailyUniverse.mockReset()
    aiMocks.fetchArenaMarket.mockReset()
    aiMocks.fetchArenaLivePrices.mockReset()
    aiMocks.fetchArenaLivePrices.mockResolvedValue({ bySymbol: {} })
  })

  it('premarket 完成 → 背景 runArenaTick 跑完寫 done + result JSON', async () => {
    const uni = deferred<Array<{ symbol: string; name: string }>>()
    aiMocks.buildDefaultDailyUniverse.mockReturnValue(uni.promise)
    aiMocks.fetchArenaMarket.mockResolvedValue({ prices: [], history: [] })
    aiMocks.runArenaRound.mockResolvedValue({
      processed: 3,
      trades: 2,
      errors: [],
      modelCalls: 4,
      roundDate: '2026-09-16',
      slots: 0,
      premarket: true,
      discussion: false,
      phase: 'premarket',
    })

    const started = await startArenaTickJob('2026-09-16', { phase: 'premarket' })
    expect(started.jobId).toBeGreaterThan(0)
    expect(started.phaseKey).toBe('premarket')
    expect(started.deduplicated).toBe(false)

    // 背景尚未完成 → running
    let job = await getArenaTickJobById(started.jobId)
    expect(job?.status).toBe('running')
    expect(job?.round_date).toBe('2026-09-16')
    expect(job?.phase).toBe('premarket')

    // 放行背景 → 輪詢至終態
    uni.resolve([{ symbol: '2330', name: '台積電' }])
    await waitFor(async () => {
      job = await getArenaTickJobById(started.jobId)
      return job?.status !== 'running'
    })

    expect(job?.status).toBe('done')
    const res = job?.result ? JSON.parse(job.result) : null
    expect(res.processed).toBe(3)
    expect(res.trades).toBe(2)
    expect(res.errors).toEqual([])
    expect(job?.error).toBeNull()
  })

  it('例外 → 背景寫 failed + error', async () => {
    const uni = deferred<Array<{ symbol: string; name: string }>>()
    aiMocks.buildDefaultDailyUniverse.mockReturnValue(uni.promise)
    aiMocks.fetchArenaMarket.mockRejectedValue(new Error('market boom'))

    const started = await startArenaTickJob('2026-09-16', { phase: 'close' })
    expect(await getArenaTickJobById(started.jobId)).toMatchObject({ status: 'running' })

    uni.resolve([{ symbol: '2330', name: '台積電' }])
    await waitFor(async () => {
      const j = await getArenaTickJobById(started.jobId)
      return j?.status !== 'running'
    })

    const job = await getArenaTickJobById(started.jobId)
    expect(job?.status).toBe('failed')
    expect(job?.error).toContain('market boom')
  })

  it('去重：同 (round_date, phase, slot) 已有 running → 回傳既有 jobId，不重疊執行', async () => {
    const uni = deferred<Array<{ symbol: string; name: string }>>()
    aiMocks.buildDefaultDailyUniverse.mockReturnValue(uni.promise)
    aiMocks.fetchArenaMarket.mockResolvedValue({ prices: [], history: [] })
    aiMocks.runArenaRound.mockResolvedValue({
      processed: 1,
      trades: 0,
      errors: [],
      modelCalls: 1,
      roundDate: '2026-09-16',
      slots: 0,
      premarket: false,
      discussion: false,
      phase: 'slot',
      executedSlot: 1,
    })

    const first = await startArenaTickJob('2026-09-16', { phase: 'slot', slot: 1 })
    const second = await startArenaTickJob('2026-09-16', { phase: 'slot', slot: 1 })
    expect(second.jobId).toBe(first.jobId)
    expect(second.deduplicated).toBe(true)
    expect(aiMocks.runArenaRound).not.toHaveBeenCalled() // 尚未放行，且不應有第二次執行

    // 不同 slot 不互相攔截
    const third = await startArenaTickJob('2026-09-16', { phase: 'slot', slot: 2 })
    expect(third.jobId).not.toBe(first.jobId)
    expect(third.deduplicated).toBe(false)

    uni.resolve([{ symbol: '2330', name: '台積電' }])
    await waitFor(async () => {
      const j = await getArenaTickJobById(first.jobId)
      return j?.status !== 'running'
    })

    // 放行後同 key 才可新建 job（既有已 done）
    const after = await startArenaTickJob('2026-09-16', { phase: 'slot', slot: 1 })
    expect(after.jobId).not.toBe(first.jobId)
    expect(after.deduplicated).toBe(false)
  })
  it('去重：premarket/close（slot=NULL）也能攔到 running job（IS NULL 語意）', async () => {
    const uni = deferred<Array<{ symbol: string; name: string }>>()
    aiMocks.buildDefaultDailyUniverse.mockReturnValue(uni.promise)
    aiMocks.fetchArenaMarket.mockResolvedValue({ prices: [], history: [] })
    aiMocks.runArenaRound.mockResolvedValue({
      processed: 2,
      trades: 1,
      errors: [],
      modelCalls: 2,
      roundDate: '2026-09-16',
      slots: 0,
      premarket: true,
      discussion: false,
      phase: 'premarket',
    })

    const first = await startArenaTickJob('2026-09-16', { phase: 'premarket' })
    const second = await startArenaTickJob('2026-09-16', { phase: 'premarket' })
    expect(second.jobId).toBe(first.jobId)
    expect(second.deduplicated).toBe(true)

    // close 與 premarket 不同 phase，不互相攔截
    const closeJob = await startArenaTickJob('2026-09-16', { phase: 'close' })
    expect(closeJob.jobId).not.toBe(first.jobId)
    expect(closeJob.deduplicated).toBe(false)

    uni.resolve([{ symbol: '2330', name: '台積電' }])
    await waitFor(async () => {
      const j = await getArenaTickJobById(first.jobId)
      return j?.status !== 'running'
    })
  })

// ─── Issue #56 心跳（段級 report＋interval 兜底 touch）─────────────
describe('arenaTickHeartbeatMs（心跳間隔）', () => {
  const prev = process.env.ARENA_TICK_HEARTBEAT_MS
  afterAll(() => {
    if (prev === undefined) delete process.env.ARENA_TICK_HEARTBEAT_MS
    else process.env.ARENA_TICK_HEARTBEAT_MS = prev
  })

  it('預設 60s；env 可覆寫；低於 1000ms 鉗制回預設（防 DB 洗版）', () => {
    delete process.env.ARENA_TICK_HEARTBEAT_MS
    expect(arenaTickHeartbeatMs()).toBe(60_000)
    expect(arenaTickHeartbeatMs({ ARENA_TICK_HEARTBEAT_MS: '5000' } as unknown as NodeJS.ProcessEnv)).toBe(5000)
    expect(arenaTickHeartbeatMs({ ARENA_TICK_HEARTBEAT_MS: '50' } as unknown as NodeJS.ProcessEnv)).toBe(60_000)
    expect(arenaTickHeartbeatMs({ ARENA_TICK_HEARTBEAT_MS: 'abc' } as unknown as NodeJS.ProcessEnv)).toBe(60_000)
  })
})

describe('startArenaTickJob 心跳（Issue #56）', () => {
  beforeEach(() => {
    aiMocks.runArenaRound.mockReset()
    aiMocks.buildDefaultDailyUniverse.mockReset()
    aiMocks.fetchArenaMarket.mockReset()
    aiMocks.fetchArenaLivePrices.mockReset()
    aiMocks.fetchArenaLivePrices.mockResolvedValue({ bySymbol: {} })
  })

  it('engine onProgress 穿透 runArenaTick → touch updated_at（stale→非stale）', async () => {    const uni = deferred<Array<{ symbol: string; name: string }>>()
    const round = deferred<unknown>()
    aiMocks.buildDefaultDailyUniverse.mockReturnValue(uni.promise)
    aiMocks.fetchArenaMarket.mockResolvedValue({ prices: [], history: [] })
    let captured: ((stage: string) => void) | undefined
    aiMocks.runArenaRound.mockImplementation(async (params: { onProgress?: (s: string) => void }) => {
      captured = params.onProgress
      return round.promise
    })

    const started = await startArenaTickJob('2026-09-17', { phase: 'slot', slot: 1 })
    uni.resolve([{ symbol: '2330', name: '台積電' }])
    await waitFor(() => aiMocks.runArenaRound.mock.calls.length > 0)
    expect(typeof captured).toBe('function')

    // 人為老化 updated_at → 先判 stale（slot watchdog 12min）
    await dbExecute(`UPDATE arena_tick_jobs SET updated_at = '2020-01-01 00:00:00' WHERE id = @id`, {
      id: started.jobId,
    })
    let job = await getArenaTickJobById(started.jobId)
    expect(isArenaTickJobStale(job!, new Date())).toBe(true)

    // 模擬 engine 段級 report → touch 更新 updated_at → 不再 stale
    captured!('slot:1:agent:1')
    await waitFor(async () => {
      job = await getArenaTickJobById(started.jobId)
      return !isArenaTickJobStale(job!, new Date())
    })
    expect(job?.status).toBe('running')

      round.resolve({
      processed: 1,
      trades: 0,
      errors: [],
      modelCalls: 1,
      roundDate: '2026-09-17',
      slots: 1,
      premarket: false,
      discussion: false,
      phase: 'slot',
      executedSlot: 1,
    })
    await waitFor(async () => {
      const j = await getArenaTickJobById(started.jobId)
      return j?.status !== 'running'
    })
    expect((await getArenaTickJobById(started.jobId))?.status).toBe('done')
  })

  it('interval 兜底：無 report 時仍定期 touch（單次超長 LLM call 空窗）', async () => {
    process.env.ARENA_TICK_HEARTBEAT_MS = '1000'
    try {
      const uni = deferred<Array<{ symbol: string; name: string }>>()
      const round = deferred<unknown>()
      aiMocks.buildDefaultDailyUniverse.mockReturnValue(uni.promise)
      aiMocks.fetchArenaMarket.mockResolvedValue({ prices: [], history: [] })
      aiMocks.runArenaRound.mockImplementation(() => round.promise)

      const started = await startArenaTickJob('2026-09-18', { phase: 'close' })
      uni.resolve([{ symbol: '2330', name: '台積電' }])
      await waitFor(() => aiMocks.runArenaRound.mock.calls.length > 0)

      await dbExecute(`UPDATE arena_tick_jobs SET updated_at = '2020-01-01 00:00:00' WHERE id = @id`, {
        id: started.jobId,
      })
      // 不發任何 report，interval（1s）應自行 touch 回來
      await waitFor(
        async () => {
          const j = await getArenaTickJobById(started.jobId)
          return j != null && !isArenaTickJobStale(j, new Date())
        },
        8000,
        100,
      )

      round.resolve({
      processed: 1,
      trades: 0,
      errors: [],
      modelCalls: 1,
      roundDate: '2026-09-18',
      slots: 0,
      premarket: false,
      discussion: true,
      phase: 'close',
    })
      await waitFor(async () => {
        const j = await getArenaTickJobById(started.jobId)
        return j?.status !== 'running'
      })
    } finally {
      delete process.env.ARENA_TICK_HEARTBEAT_MS
    }
  })
}) // ── describe('startArenaTickJob 心跳（Issue #56）') end
})