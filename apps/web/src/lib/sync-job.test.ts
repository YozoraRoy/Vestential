import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// 先隔離 temp DB，再 import @stock/database（該模組在頂層讀 DATABASE_URL）
vi.hoisted(() => {
  const base = (process.env.TEMP || process.env.TMPDIR || '/tmp').replace(/\\/g, '/')
  const dir = `${base}/sync-job-test-${process.pid}`
  process.env.DATABASE_PATH = `${dir}/sync-job.db`
  delete process.env.DATABASE_URL // 強制 SQLite 後端
})

import { rmSync } from 'node:fs'
import {
  migrate,
  saveSyncJob,
  updateSyncJob,
  getSyncJobById,
  findRunningSyncJob,
  cleanupSyncJobs,
  dbExecute,
} from '@stock/database'
import {
  SYNC_JOB_PAYLOAD_MAX_CHARS,
  SYNC_JOB_RECYCLED_ERROR,
  isSyncJobStale,
  interpretSyncJob,
  loadSyncJobView,
  serializeSyncJobPayload,
  startSyncJob,
  syncJobIdParam,
} from '@/lib/sync-job'

const dbDir = (process.env.DATABASE_PATH ?? '').replace(/\/[^/]+$/, '')

function oldUtc(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString().slice(0, 19).replace('T', ' ')
}

async function forceUpdatedAt(jobId: number, minutesAgo: number): Promise<void> {
  await dbExecute(`UPDATE sync_jobs SET updated_at = @ts WHERE id = @id`, {
    ts: oldUtc(minutesAgo),
    id: jobId,
  })
}

beforeAll(async () => {
  await migrate()
})

afterAll(() => {
  try {
    rmSync(dbDir, { recursive: true, force: true })
  } catch {}
})

describe('sync_jobs 存取器', () => {
  it('建立 job 後可查回，時間戳為 ISO UTC', async () => {
    const id = await saveSyncJob({ jobType: 'test-basic', kind: 'refresh' })
    expect(id).toBeGreaterThan(0)

    const row = await getSyncJobById(id)
    expect(row).not.toBeNull()
    expect(row!.job_type).toBe('test-basic')
    expect(row!.kind).toBe('refresh')
    expect(row!.status).toBe('running')
    expect(row!.created_at).toMatch(/Z$/)
    expect(row!.updated_at).toMatch(/Z$/)
  })

  it('updateSyncJob 空 patch 即心跳（刷新 updated_at）', async () => {
    const id = await saveSyncJob({ jobType: 'test-heartbeat', kind: 'refresh' })
    await forceUpdatedAt(id, 10)

    const before = await getSyncJobById(id)
    expect(before!.updated_at).not.toBeNull()

    await updateSyncJob(id, {})
    const after = await getSyncJobById(id)
    expect(Date.parse(after!.updated_at!)).toBeGreaterThan(Date.parse(before!.updated_at!))
    expect(after!.status).toBe('running') // 心跳不改 status
  })

  it('updateSyncJob 寫入終態欄位', async () => {
    const id = await saveSyncJob({ jobType: 'test-finish', kind: 'dry' })
    await updateSyncJob(id, {
      status: 'done',
      count: 3,
      editionKey: '2026-11-11',
      payload: JSON.stringify({ summary: 'ok' }),
    })

    const row = await getSyncJobById(id)
    expect(row!.status).toBe('done')
    expect(row!.count).toBe(3)
    expect(row!.edition_key).toBe('2026-11-11')
    expect(row!.payload).toBe('{"summary":"ok"}')
  })
})

describe('staleness 與狀態視圖', () => {
  it('剛建立的 running job 不算 stale', async () => {
    const id = await saveSyncJob({ jobType: 'test-fresh', kind: 'refresh' })
    const row = (await getSyncJobById(id))!
    expect(isSyncJobStale(row)).toBe(false)
    expect(interpretSyncJob(row).status).toBe('running')
  })

  it('心跳中斷超過門檻 → stale，視圖降級成 failed 並附回收原因', async () => {
    const id = await saveSyncJob({ jobType: 'test-stale', kind: 'refresh' })
    await forceUpdatedAt(id, 10)

    const row = (await getSyncJobById(id))!
    expect(isSyncJobStale(row)).toBe(true)

    const view = interpretSyncJob(row)
    expect(view.status).toBe('failed')
    expect(view.stale).toBe(true)
    expect(view.error).toBe(SYNC_JOB_RECYCLED_ERROR)
    expect(view.finishedAt).not.toBeNull()
  })

  it('已結束的 job 不會被判定 stale', async () => {
    const id = await saveSyncJob({ jobType: 'test-done', kind: 'refresh' })
    await updateSyncJob(id, { status: 'done' })
    await forceUpdatedAt(id, 60)

    const row = (await getSyncJobById(id))!
    expect(isSyncJobStale(row)).toBe(false)
    expect(interpretSyncJob(row).status).toBe('done')
  })

  it('jobType 不符視為不存在（避免跨型別誤撈）', async () => {
    const id = await saveSyncJob({ jobType: 'test-type-a', kind: 'refresh' })
    expect(await loadSyncJobView(id, 'test-type-b')).toBeNull()
    expect(await loadSyncJobView(id, 'test-type-a')).not.toBeNull()
  })

  it('jobId 參數容忍數字與前綴格式', () => {
    expect(syncJobIdParam('12')).toBe(12)
    expect(syncJobIdParam('ce_12')).toBe(12)
    expect(syncJobIdParam('mf_99')).toBe(99)
    expect(syncJobIdParam('')).toBeNull()
    expect(syncJobIdParam('abc')).toBeNull()
    expect(syncJobIdParam(null)).toBeNull()
  })
})

describe('startSyncJob（跨 process 去重與 stale 接管）', () => {
  it('同 jobType 已有 running job → 回傳同一 jobId', async () => {
    const first = await startSyncJob({ jobType: 'test-dedupe', kind: 'refresh' })
    const second = await startSyncJob({ jobType: 'test-dedupe', kind: 'refresh' })

    expect(second.jobId).toBe(first.jobId)
    expect(second.deduplicated).toBe(true)
  })

  it('既有 running 但心跳中斷 → 標成 failed 並開新 job', async () => {
    const first = await startSyncJob({ jobType: 'test-takeover', kind: 'refresh' })
    await forceUpdatedAt(first.jobId, 10)

    const second = await startSyncJob({ jobType: 'test-takeover', kind: 'refresh' })
    expect(second.jobId).not.toBe(first.jobId)
    expect(second.deduplicated).toBe(false)

    const oldRow = (await getSyncJobById(first.jobId))!
    expect(oldRow.status).toBe('failed')
    expect(oldRow.error).toContain('接管')
  })

  it('不同 jobType 互不影響', async () => {
    const a = await startSyncJob({ jobType: 'test-iso-a', kind: 'refresh' })
    const b = await startSyncJob({ jobType: 'test-iso-b', kind: 'refresh' })
    expect(b.jobId).not.toBe(a.jobId)
    expect(b.deduplicated).toBe(false)
  })
})

describe('findRunningSyncJob 與 cleanupSyncJobs', () => {
  it('只撈該 jobType 的 running job', async () => {
    const id = await saveSyncJob({ jobType: 'test-find-a', kind: 'refresh' })
    await saveSyncJob({ jobType: 'test-find-b', kind: 'refresh' })

    const found = await findRunningSyncJob('test-find-a')
    expect(found?.id).toBe(id)
  })

  it('清理超過保留期且已結束的 job，running 不受影響', async () => {
    const ended = await saveSyncJob({ jobType: 'test-cleanup', kind: 'refresh' })
    await updateSyncJob(ended, { status: 'done' })
    await forceUpdatedAt(ended, 60 * 24 * 40)

    const running = await saveSyncJob({ jobType: 'test-cleanup', kind: 'refresh' })
    const runningBefore = await getSyncJobById(running)

    const deleted = await cleanupSyncJobs('test-cleanup', 30)
    expect(deleted).toBe(1)

    expect(await getSyncJobById(ended)).toBeNull()
    const runningAfter = await getSyncJobById(running)
    expect(runningAfter).not.toBeNull()
    expect(runningAfter!.status).toBe(runningBefore!.status)
  })
})

describe('payload 序列化', () => {
  it('一般 payload 原樣保存並可解析', async () => {
    const id = await saveSyncJob({ jobType: 'test-payload', kind: 'dry' })
    const payload = { summary: 's', signals: [{ symbol: '2330.TW' }] }
    const raw = serializeSyncJobPayload(payload)
    await updateSyncJob(id, { status: 'done', payload: raw })

    const view = interpretSyncJob((await getSyncJobById(id))!)
    expect(view.payload).toEqual(payload)
  })

  it('超過上限 → 截斷並標記 truncated', () => {
    const big = { blob: 'x'.repeat(SYNC_JOB_PAYLOAD_MAX_CHARS + 1000) }
    const raw = serializeSyncJobPayload(big)!
    expect(raw.length).toBeLessThan(SYNC_JOB_PAYLOAD_MAX_CHARS)

    const parsed = JSON.parse(raw) as { truncated: boolean; bytes: number }
    expect(parsed.truncated).toBe(true)
    expect(parsed.bytes).toBeGreaterThan(SYNC_JOB_PAYLOAD_MAX_CHARS)
  })
})

describe('interpretSyncJob（型別完整性）', () => {
  it('回傳欄位與舊 status API 相容', async () => {
    const id = await saveSyncJob({ jobType: 'test-shape', kind: 'refresh' })
    await updateSyncJob(id, { status: 'done', count: 2, editionKey: '2026-11-11' })

    const view = interpretSyncJob((await getSyncJobById(id))!)
    expect(view).toMatchObject({
      id: String(id),
      numericId: id,
      jobType: 'test-shape',
      kind: 'refresh',
      status: 'done',
      count: 2,
      editionKey: '2026-11-11',
      error: null,
      stale: false,
    })
  })
})
