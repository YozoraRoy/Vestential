import { revalidateTag } from 'next/cache'
import { computeCycleEntryEdition } from '@/lib/cycle-entry'
import type { CycleEntrySignalRow } from '@stock/database'

// ─── 週期進場背景 Job ────────────────────────────────────────────
// 整條盤後掃描管線（批次報價 → 120 檔歷史 → 規則初篩 → 擬合回測 → LLM 評述/總覽 → DB）
// 需在背景執行並回傳 jobId，避免同步阻塞超過 Azure 240s 網關上限。
// 另加 Job 層總逾時保護：LLM 每次呼叫已有 180s abort，但 429 退避＋fallback 鏈
// 在大量 LLM 呼叫下會累積；超過 JOB_TIMEOUT_MS 即自動標記 failed 並釋放執行緒。

export type CycleEntryJobKind = 'refresh' | 'dry'
export type CycleEntryJobStatus = 'running' | 'done' | 'failed'

export interface CycleEntryJob {
  id: string
  kind: CycleEntryJobKind
  status: CycleEntryJobStatus
  startedAt: string
  finishedAt: string | null
  error: string | null
  count: number | null
  editionDate: string | null
  /** 僅 kind='dry'：乾跑結果（未寫入 DB）。 */
  signals?: Omit<CycleEntrySignalRow, 'editionDate'>[] | null
  summary?: string | null
}

const JOBS = new Map<string, CycleEntryJob>()
const MAX_KEPT_JOBS = 20
let activeJobId: string | null = null

/** Job 總逾時：25 分鐘（排程 workflow timeout 35 分鐘，保留緩衝）。 */
export const JOB_TIMEOUT_MS = 25 * 60 * 1000

function makeJobId(): string {
  return `ce_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function trimJobs(): void {
  if (JOBS.size <= MAX_KEPT_JOBS) return
  const finished = [...JOBS.entries()]
    .filter(([, j]) => j.status !== 'running')
    .sort((a, b) => a[1].startedAt.localeCompare(b[1].startedAt))
  let overflow = JOBS.size - MAX_KEPT_JOBS
  for (const [id] of finished) {
    if (overflow <= 0) break
    JOBS.delete(id)
    overflow -= 1
  }
}

/**
 * 啟動週期進場背景 Job。
 * - kind='refresh'：寫入 DB（供 GitHub 排程 / 後台呼叫）。
 * - kind='dry'：僅乾跑，不寫 DB（後台預覽）。
 * 若已有 Job 執行中，直接回傳該 Job，避免重疊執行。
 */
export function startCycleEntryJob(options: { kind: CycleEntryJobKind }): CycleEntryJob {
  if (activeJobId) {
    const running = JOBS.get(activeJobId)
    if (running?.status === 'running') return running
  }

  const job: CycleEntryJob = {
    id: makeJobId(),
    kind: options.kind,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    count: null,
    editionDate: null,
    signals: null,
    summary: null,
  }
  JOBS.set(job.id, job)
  activeJobId = job.id

  // 總逾時看門狗：超過 JOB_TIMEOUT_MS 尚未完成即自動失敗
  const watchdog = setTimeout(() => {
    const current = JOBS.get(job.id)
    if (current?.status === 'running') {
      current.status = 'failed'
      current.error = `Job 執行逾時（超過 ${Math.round(JOB_TIMEOUT_MS / 60000)} 分鐘），已中止。`
      current.finishedAt = new Date().toISOString()
      if (activeJobId === job.id) activeJobId = null
    }
  }, JOB_TIMEOUT_MS)

  void runJob(job, watchdog)
  trimJobs()
  return job
}

export function getCycleEntryJob(id: string): CycleEntryJob | null {
  return JOBS.get(id) ?? null
}

async function runJob(job: CycleEntryJob, watchdog: NodeJS.Timeout): Promise<void> {
  try {
    const result = await computeCycleEntryEdition(job.kind === 'dry')
    job.editionDate = result.editionDate
    job.count = result.signalCount
    job.summary = result.summary
    if (job.kind === 'dry') job.signals = result.signals
    if (job.kind === 'refresh') revalidateTag('cycle-entry', 'max')
    job.status = 'done'
  } catch (e: any) {
    job.status = 'failed'
    job.error = (e?.message ?? String(e)).slice(0, 500)
  } finally {
    clearTimeout(watchdog)
    job.finishedAt = new Date().toISOString()
    if (activeJobId === job.id) activeJobId = null
  }
}