import { revalidateTag } from 'next/cache'
import { computeCycleEntryEdition } from '@/lib/cycle-entry'
import { cleanupSyncJobs } from '@stock/database'
import type { CycleEntrySignalRow } from '@stock/database'
import {
  SYNC_JOB_ERROR_MAX_CHARS,
  SYNC_JOB_TIMEOUT_MS,
  createSyncJobSettler,
  loadSyncJobView,
  serializeSyncJobPayload,
  startSyncJob,
} from '@/lib/sync-job'
import type { SyncJobView } from '@/lib/sync-job'

// ─── 週期進場背景 Job（Issue #146：狀態 DB 化）────────────────────
// 整條盤後掃描管線（批次報價 → 120 檔歷史 → 規則初篩 → 擬合回測 → LLM 評述/總覽 → DB）
// 需在背景執行並回傳 jobId，避免同步阻塞超過 Azure 240s 網關上限。
//
// 狀態存放於 DB（sync_jobs 表），不再只存在 process 記憶體：Azure App Service
// 重啟／搬移 worker 後仍查得到 job，心跳斷掉則由 status 端點回終態 failed
// （Issue #144 的 404 盲輪詢即源自 in-memory job 遺失）。

/** sync_jobs.job_type。 */
export const SYNC_JOB_TYPE = 'cycle-entry'

export type CycleEntryJobKind = 'refresh' | 'dry'
export type CycleEntryJobStatus = 'running' | 'done' | 'failed'

/** Job 總逾時：25 分鐘（排程 workflow timeout 35 分鐘，保留緩衝）。 */
export const JOB_TIMEOUT_MS = SYNC_JOB_TIMEOUT_MS

/** 對外 job 視圖（欄位與既有 status API／後台 UI 相容）。 */
export interface CycleEntryJob {
  id: string
  kind: CycleEntryJobKind
  status: CycleEntryJobStatus
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  count: number | null
  editionDate: string | null
  stage: string | null
  /** 僅 kind='dry'：乾跑結果（未寫入 DB）。 */
  signals?: Omit<CycleEntrySignalRow, 'editionDate'>[] | null
  summary?: string | null
}

export interface StartedCycleEntryJob {
  jobId: string
  status: CycleEntryJobStatus
  startedAt: string | null
  deduplicated: boolean
}

interface CycleEntryJobPayload {
  summary?: string | null
  signals?: Omit<CycleEntrySignalRow, 'editionDate'>[] | null
}

function toCycleEntryJob(view: SyncJobView): CycleEntryJob {
  const payload = (view.payload ?? {}) as CycleEntryJobPayload
  return {
    id: view.id,
    kind: view.kind as CycleEntryJobKind,
    status: view.status,
    startedAt: view.startedAt,
    finishedAt: view.finishedAt,
    error: view.error,
    count: view.count,
    editionDate: view.editionKey,
    stage: view.stage,
    signals: payload.signals ?? null,
    summary: payload.summary ?? null,
  }
}

/**
 * 啟動週期進場背景 Job。
 * - kind='refresh'：寫入 DB（供 GitHub 排程 / 後台呼叫）。
 * - kind='dry'：僅乾跑，不寫 DB（後台預覽）。
 * 若已有 Job 執行中（含其他 process／container），直接回傳該 Job，避免重疊執行。
 */
export async function startCycleEntryJob(options: { kind: CycleEntryJobKind }): Promise<StartedCycleEntryJob> {
  const started = await startSyncJob({
    jobType: SYNC_JOB_TYPE,
    kind: options.kind,
    takeoverError: (job) =>
      `被新觸發接管：前一個 job 心跳中斷（stage=${job.stage ?? 'unknown'}），判定執行實例已回收。`,
  })

  if (started.deduplicated) {
    const view = await loadSyncJobView(started.jobId, SYNC_JOB_TYPE)
    return {
      jobId: String(started.jobId),
      status: view?.status ?? 'running',
      startedAt: view?.startedAt ?? null,
      deduplicated: true,
    }
  }

  void runJob(started.jobId, options.kind)
  return {
    jobId: String(started.jobId),
    status: 'running',
    startedAt: new Date().toISOString(),
    deduplicated: false,
  }
}

/** 查詢 job（含跨容器重啟後仍存活的紀錄）；不存在或型別不符回 null。 */
export async function getCycleEntryJob(id: string | number): Promise<CycleEntryJob | null> {
  const view = await loadSyncJobView(id, SYNC_JOB_TYPE)
  return view ? toCycleEntryJob(view) : null
}

async function runJob(jobId: number, kind: CycleEntryJobKind): Promise<void> {
  const settler = createSyncJobSettler(jobId)
  try {
    settler.setStage(kind === 'dry' ? 'dry' : 'refresh')
    const result = await computeCycleEntryEdition(kind === 'dry')
    if (kind === 'refresh') revalidateTag('cycle-entry', 'max')

    const payload = serializeSyncJobPayload(
      kind === 'dry'
        ? { summary: result.summary, signals: result.signals }
        : { summary: result.summary },
    )
    await settler.finish({
      status: 'done',
      count: result.signalCount,
      editionKey: result.editionDate,
      payload,
    })

    // 成功收尾順帶清理舊紀錄（30 天）
    void cleanupSyncJobs(SYNC_JOB_TYPE, 30).catch(() => {})
  } catch (e: any) {
    const message = String(e?.message ?? e).slice(0, SYNC_JOB_ERROR_MAX_CHARS)
    console.error(`[CycleEntryJob] job ${jobId} failed:`, message)
    await settler.finish({ status: 'failed', error: message || '執行失敗' })
  } finally {
    settler.cleanup()
  }
}
