import { findRunningArenaTickJob, getArenaRoundProgress } from '@stock/database'
import { isTaiwanMarketTradingDay } from '@/utils/taiwan-calendar'

/**
 * 台灣時區的競技場階段排程（與 .github/workflows/arena-tick.yml 及 VM crontab 相同時間表）。
 *
 * 防爆設計（Issue/Plan 2026-11-16）：
 * 1. 容器啟動後延遲 STARTUP_DELAY_MS（90 秒）才開始第一次 sweep，避開開機與連線池暖機高峰。
 * 2. 觸發前先查 DB `getArenaRoundProgress(roundDate, spec.key)` 與 `findRunningArenaTickJob()`：
 *    重啟前已跑完（done）或正在執行中的階段直接略過，絕不在重啟瞬間重複打內部 API。
 * 3. `sweepInFlight` 互斥鎖＋每次 sweep 最多只觸發 1 個未完成階段，避免單核 B1 同時塞入多個重型 tick。
 */

interface PhaseSpec {
  key: string
  phase: 'premarket' | 'slot' | 'close'
  slot: number | null
  query: string // URL query：phase/slot
  atMin: number // 當日分鐘數（台灣時間）
}

const PHASE_SCHEDULE: PhaseSpec[] = [
  { key: 'premarket', phase: 'premarket', slot: null, query: 'phase=premarket', atMin: 9 * 60 },
  { key: 'slot0', phase: 'slot', slot: 0, query: 'phase=slot&slot=0', atMin: 9 * 60 + 35 },
  { key: 'slot1', phase: 'slot', slot: 1, query: 'phase=slot&slot=1', atMin: 10 * 60 + 35 },
  { key: 'slot2', phase: 'slot', slot: 2, query: 'phase=slot&slot=2', atMin: 11 * 60 + 35 },
  { key: 'slot3', phase: 'slot', slot: 3, query: 'phase=slot&slot=3', atMin: 13 * 60 + 5 },
  { key: 'close', phase: 'close', slot: null, query: 'phase=close', atMin: 15 * 60 + 30 },
]

const STARTUP_DELAY_MS = 90 * 1000 // 啟動後延遲 90 秒再首次掃描
const RETRY_COOLDOWN_MS = 10 * 60 * 1000 // 10 分鐘內不重複嘗試同一個階段
const SWEEP_INTERVAL_MS = 30 * 1000
const WINDOW_MINUTES = 240 // 目標時間後 4 小時內仍允許補跑

interface JobStatusPayload {
  status?: string
  error?: string
  result?: unknown
}

/** 查詢 job 狀態（失敗回 null；呼叫端視為「本次查不到，下次 sweep 再確認」）。 */
async function fetchJobStatus(
  url: string,
  headers: Record<string, string>,
): Promise<JobStatusPayload | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15 * 1000) })
    return (await res.json().catch(() => null)) as JobStatusPayload | null
  } catch {
    return null
  }
}

let started = false
let sweepInFlight = false
const lastAttemptAt: Record<string, number> = {}

function taiwanNowMinutes(): number {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
  const [h, m] = s.split(':').map((v) => Number(v))
  return h * 60 + (m || 0)
}

function taiwanNowDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
}

async function triggerPhase(roundDate: string, spec: PhaseSpec): Promise<void> {
  const syncToken = process.env.SYNC_TOKEN
  const port = process.env.PORT || '3000'
  const base = `http://127.0.0.1:${port}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(syncToken ? { Authorization: `Bearer ${syncToken}` } : {}),
  }

  let postRes: Response
  try {
    postRes = await fetch(`${base}/api/agent-arena/tick?date=${roundDate}&${spec.query}`, {
      method: 'POST',
      headers,
      body: '{}',
      signal: AbortSignal.timeout(20 * 1000),
    })
  } catch (e) {
    console.warn(`[ArenaScheduler] ${spec.key} POST 失敗:`, (e as Error).message ?? e)
    return
  }
  const posted = (await postRes.json().catch(() => null)) as {
    success?: boolean
    jobId?: number
    error?: string
  } | null
  if (!postRes.ok || !posted?.success || !posted?.jobId) {
    console.warn(`[ArenaScheduler] ${spec.key} POST HTTP ${postRes.status}: ${posted?.error ?? postRes.statusText}`)
    return
  }

  const statusUrl = `${base}/api/agent-arena/tick/status?jobId=${posted.jobId}`
  const deadline = Date.now() + 26 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10 * 1000))
    const st = await fetchJobStatus(statusUrl, headers)
    if (!st) {
      console.warn(`[ArenaScheduler] ${spec.key} status 查詢失敗（job ${posted.jobId}），下次 sweep 再確認`)
      return
    }
    if (st.status === 'done') {
      const res = (st.result ?? {}) as { processed?: number; trades?: number }
      console.log(
        `[ArenaScheduler] ${spec.key} done date=${roundDate} processed=${res.processed ?? 0} trades=${res.trades ?? 0}`,
      )
      return
    }
    if (st.status === 'failed') {
      console.warn(`[ArenaScheduler] ${spec.key} failed date=${roundDate}: ${st.error ?? '未知錯誤'}`)
      return
    }
  }
  console.warn(`[ArenaScheduler] ${spec.key} 輪詢逾時（job ${posted.jobId}），下次 sweep 再確認`)
}

async function sweep(): Promise<void> {
  if (sweepInFlight) return
  sweepInFlight = true
  try {
    const nowMin = taiwanNowMinutes()
    const roundDate = taiwanNowDate()
    const todayTw = new Date(`${roundDate}T00:00:00`)
    if (!isTaiwanMarketTradingDay(todayTw)) return

    for (const spec of PHASE_SCHEDULE) {
      if (nowMin < spec.atMin) continue
      if (nowMin > spec.atMin + WINDOW_MINUTES) continue
      const lastAt = lastAttemptAt[spec.key] ?? 0
      if (Date.now() - lastAt < RETRY_COOLDOWN_MS) continue

      // 先查 DB：該階段若已完成或正在執行中，記下時間戳直接略過，不打內部 HTTP API
      const [alreadyDone, runningJob] = await Promise.all([
        getArenaRoundProgress(roundDate, spec.key).catch(() => false),
        findRunningArenaTickJob(roundDate, spec.phase, spec.slot).catch(() => null),
      ])
      if (alreadyDone || runningJob) {
        lastAttemptAt[spec.key] = Date.now()
        continue
      }

      lastAttemptAt[spec.key] = Date.now()
      try {
        await triggerPhase(roundDate, spec)
      } catch (e) {
        console.error(`[ArenaScheduler] ${spec.key} tick failed:`, (e as Error).message ?? e)
      }
      // 單次 sweep 最多只觸發 1 個未完成階段，避免連續轟炸單核 B1
      break
    }
  } finally {
    sweepInFlight = false
  }
}

export function startArenaPhaseScheduler(): void {
  if (started) return
  started = true
  const startTimer = setTimeout(() => {
    void sweep()
    const timer = setInterval(() => {
      void sweep()
    }, SWEEP_INTERVAL_MS)
    timer.unref?.()
  }, STARTUP_DELAY_MS)
  startTimer.unref?.()
}
