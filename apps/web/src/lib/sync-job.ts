import {
  findRunningSyncJob,
  getSyncJobById,
  saveSyncJob,
  updateSyncJob,
} from '@stock/database'
import type { SyncJobRow, SyncJobStatus } from '@stock/database'

// ─── 排程背景 Job 共用層（Issue #146）───────────────────────────────
// 背景 job（cycle-entry / market-focus）狀態一律寫入 DB 的 sync_jobs 表，
// 不再只存在 Node process 記憶體。理由（Issue #144）：Azure App Service 會因
// 平台維護、worker 搬移、手動重啟而換掉 container，in-memory job 一併消失，
// 呼叫端輪詢 status 只拿到 404，只能盲等到 timeout。
//
// 心跳契約：
// - 執行中的 job 每 SYNC_JOB_HEARTBEAT_MS 刷新 updated_at。
// - updated_at 超過 SYNC_JOB_STALE_MS 沒動 → 判定「執行實例已回收」，
//   status 端點直接回終態 failed（附原因），呼叫端可立即重新觸發。

/** 心跳間隔。 */
export const SYNC_JOB_HEARTBEAT_MS = 60_000
/** 心跳中斷多久視為實例已回收（容忍 DB 抖動／慢查詢，留 4 個心跳的餘裕）。 */
export const SYNC_JOB_STALE_MS = 5 * 60_000
/** job 總時限（與 GitHub Actions 25 分鐘輪詢窗對齊）。 */
export const SYNC_JOB_TIMEOUT_MS = 25 * 60_000
/** error 字串上限（防爆 DB 欄位）。 */
export const SYNC_JOB_ERROR_MAX_CHARS = 500
/** payload JSON 上限（乾跑的 signals/items 約 60KB，200KB 留足餘裕）。 */
export const SYNC_JOB_PAYLOAD_MAX_CHARS = 200_000

export const SYNC_JOB_RECYCLED_ERROR =
  '執行實例已回收（container 重啟／平台搬移），job 未完成；請重新觸發。'

export interface SyncJobView {
  /** 對外 jobId（字串，與既有 API/前端相容）。 */
  id: string
  numericId: number
  jobType: string
  kind: string
  status: SyncJobStatus
  stage: string | null
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  count: number | null
  editionKey: string | null
  payload: unknown
  /** 是否因心跳斷掉被判定為回收（status 已被降級成 failed）。 */
  stale: boolean
}

function lastTouchMs(job: Pick<SyncJobRow, 'updated_at' | 'created_at'>): number | null {
  for (const raw of [job.updated_at, job.created_at]) {
    if (!raw) continue
    const t = Date.parse(raw)
    if (!Number.isNaN(t)) return t
  }
  return null
}

/** running 且心跳超過門檻 → stale（實例可能已被回收）。 */
export function isSyncJobStale(
  job: Pick<SyncJobRow, 'status' | 'updated_at' | 'created_at'>,
  now: Date = new Date(),
): boolean {
  if (job.status !== 'running') return false
  const touch = lastTouchMs(job)
  if (touch === null) return true
  return now.getTime() - touch > SYNC_JOB_STALE_MS
}

/** DB row → 對外視圖；stale 的 running 一律降級成 failed 並附原因。 */
export function interpretSyncJob(job: SyncJobRow, now: Date = new Date()): SyncJobView {
  const stale = isSyncJobStale(job, now)
  const status: SyncJobStatus = stale ? 'failed' : job.status
  const error =
    status === 'failed'
      ? stale
        ? SYNC_JOB_RECYCLED_ERROR
        : (job.error ?? '執行失敗（未記錄原因）')
      : null
  return {
    id: String(job.id),
    numericId: job.id,
    jobType: job.job_type,
    kind: job.kind,
    status,
    stage: job.stage,
    startedAt: job.created_at,
    finishedAt: status === 'running' ? null : job.updated_at,
    error,
    count: job.count,
    editionKey: job.edition_key,
    payload: parseSyncJobPayload(job.payload),
    stale,
  }
}

export function parseSyncJobPayload<T = unknown>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** 序列化 payload；超過上限就退化為摘要（避免爆欄位，也讓呼叫端看得出被截斷）。 */
export function serializeSyncJobPayload(value: unknown): string | null {
  if (value === null || value === undefined) return null
  let json: string
  try {
    json = JSON.stringify(value)
  } catch {
    return null
  }
  if (json.length <= SYNC_JOB_PAYLOAD_MAX_CHARS) return json
  return JSON.stringify({
    truncated: true,
    bytes: json.length,
    preview: json.slice(0, 2000),
  })
}

/** 接受 '12' / 'ce_12' / 'mf_12' 等格式，取其中的數字 id。 */
export function syncJobIdParam(raw: string | null | undefined): number | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  const n = Number(digits)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export interface StartedSyncJob {
  jobId: number
  deduplicated: boolean
}

/**
 * 建立 job（含跨 process 去重）：
 * - 同 jobType 已有 running 且心跳正常 → 回傳既有 jobId，不重疊執行。
 * - 既有 running 但心跳中斷（實例已回收）→ 標成 failed 後開新 job。
 */
export async function startSyncJob(options: {
  jobType: string
  kind: string
  takeoverError?: (job: SyncJobRow) => string
}): Promise<StartedSyncJob> {
  const running = await findRunningSyncJob(options.jobType)
  if (running) {
    if (!isSyncJobStale(running)) {
      return { jobId: running.id, deduplicated: true }
    }
    const message = options.takeoverError
      ? options.takeoverError(running)
      : `被新觸發接管：前一個 job 心跳中斷（stage=${running.stage ?? 'unknown'}），判定執行實例已回收。`
    await updateSyncJob(running.id, { status: 'failed', error: message.slice(0, SYNC_JOB_ERROR_MAX_CHARS) })
  }

  const jobId = await saveSyncJob({ jobType: options.jobType, kind: options.kind })
  if (jobId <= 0) throw new Error(`建立 ${options.jobType} job 失敗（DB 不可用）`)
  return { jobId, deduplicated: false }
}

export interface SyncJobSettler {
  readonly settled: boolean
  readonly stage: string | null
  /** 更新階段（同時寫 DB，供 status 端點顯示卡在哪一段）。 */
  setStage(stage: string | null): void
  /** 寫入終態（只生效一次；error 會截斷）。 */
  finish(patch: {
    status: 'done' | 'failed'
    count?: number | null
    editionKey?: string | null
    error?: string | null
    payload?: string | null
  }): Promise<void>
  /** 釋放心跳與總逾時計時器（務必在 finally 呼叫）。 */
  cleanup(): void
}

/**
 * 建立 job 執行器：自動開心跳、總逾時看門狗，並保證終態只寫一次。
 * 心跳與看門狗都 `unref()`，不阻止 process 結束。
 */
export function createSyncJobSettler(
  jobId: number,
  options: { timeoutMinutes?: number } = {},
): SyncJobSettler {
  const timeoutMinutes = options.timeoutMinutes ?? Math.round(SYNC_JOB_TIMEOUT_MS / 60000)
  let settled = false
  let stage: string | null = null
  let hb: ReturnType<typeof setInterval> | undefined
  let hardTimer: ReturnType<typeof setTimeout> | undefined

  const stopTimers = () => {
    if (hb) clearInterval(hb)
    if (hardTimer) clearTimeout(hardTimer)
    hb = undefined
    hardTimer = undefined
  }

  const finish: SyncJobSettler['finish'] = async (patch) => {
    if (settled) return
    settled = true
    stopTimers()
    const error =
      patch.error === undefined
        ? undefined
        : String(patch.error ?? '').slice(0, SYNC_JOB_ERROR_MAX_CHARS) || '執行失敗（未記錄原因）'
    await updateSyncJob(jobId, {
      status: patch.status,
      count: patch.count,
      editionKey: patch.editionKey,
      payload: patch.payload,
      error,
    })
  }

  // 心跳：只刷新 updated_at，不動 status（settle 後即停，stale 判定才有效）。
  hb = setInterval(() => {
    if (settled) return
    void updateSyncJob(jobId, {}).catch(() => {})
  }, SYNC_JOB_HEARTBEAT_MS)
  hb?.unref?.()

  // 總逾時兜底：LLM 429 退避＋fallback 鏈可能累積很久，保證 job 必見終態。
  hardTimer = setTimeout(() => {
    if (settled) return
    void finish({
      status: 'failed',
      error: `Job 執行逾時（超過 ${timeoutMinutes} 分鐘${stage ? `，卡在 stage=${stage}` : ''}），已中止。`,
    })
  }, timeoutMinutes * 60_000)
  hardTimer?.unref?.()
  return {
    get settled() {
      return settled
    },
    get stage() {
      return stage
    },
    setStage(next) {
      stage = next
      if (settled) return
      void updateSyncJob(jobId, { stage: next }).catch(() => {})
    },
    finish,
    cleanup: stopTimers,
  }
}

/** 讀取 job 並轉成對外視圖（jobType 不符視為不存在，避免跨型別誤撈）。 */
export async function loadSyncJobView(
  jobId: string | number | null | undefined,
  jobType: string,
): Promise<SyncJobView | null> {
  const numericId = typeof jobId === 'number' ? jobId : syncJobIdParam(jobId)
  if (!numericId) return null
  const row = await getSyncJobById(numericId)
  if (!row || row.job_type !== jobType) return null
  return interpretSyncJob(row)
}
