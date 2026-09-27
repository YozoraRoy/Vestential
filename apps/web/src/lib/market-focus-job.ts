import { revalidateTag } from 'next/cache'
import { sleep, getChainPaceMs } from '@stock/ai-engine'
import type { MarketFocusItem } from '@stock/database'
import { getMarketFocusMeta, logMarketFocusEvent, getLatestMarketFocusLog, cleanupMarketFocusLogs, cleanupSocialCardImages } from '@stock/database'
import { refreshMarketFocusDetailed, previewMarketFocus, backfillMissingSummaries, backfillMissingReasons } from '@/lib/market-focus'
import type { MarketFocusStage } from '@/lib/market-focus'
import { sendMarketFocusAlert, sendMarketFocusSummary, isSummaryFallback } from '@/lib/email'
import { triggerSocialPublish } from '@/lib/social-trigger'
import type { SocialPostPlatform } from '@stock/database'

// ─── 市場焦點背景 Job ─────────────────────────────────────────────
// 整個 refresh / publish 管線（抓新聞 → AI 過濾 → 爬全文 → 摘要 → 總覽 → email/社群）
// 改為背景執行並回傳 jobId，避免同步阻塞 HTTP 回應超過 Azure 240s 網關上限 (504)。
// 呼叫端（GitHub Actions 排程 / 後台 UI）輪詢 status 端點取得結果。

export type MarketFocusJobKind = 'refresh' | 'publish' | 'dry'
export type MarketFocusJobStatus = 'running' | 'done' | 'failed'

export interface MarketFocusSocialResult {
  platform: SocialPostPlatform
  status: string
  error?: string | null
}

export interface MarketFocusJob {
  id: string
  kind: MarketFocusJobKind
  status: MarketFocusJobStatus
  alsoSocial: boolean
  skipSocial: boolean
  startedAt: string
  finishedAt: string | null
  error: string | null
  count: number | null
  editionKey: string | null
  timestamp: string | null
  /** 僅 kind='dry'：乾跑總覽與精選清單（未寫入 DB）。 */
  summary?: string | null
  items?: { title: string; source: string | null; reason: string | null }[] | null
  /** 僅 refresh/publish：社群小編發布結果。 */
  socialResults?: MarketFocusSocialResult[] | null
  /**
   * Issue #39：細化執行階段（不再籠統叫 pipeline）。
   * pipeline 內為 `pipeline:fetch|filter|crawl|summaries|summary`，
   * 之後依序為 `backfill`／`email`／`social`；看門狗中止時保留卡住段。
   */
  stage: string | null
}

const JOBS = new Map<string, MarketFocusJob>()
const MAX_KEPT_JOBS = 20
let activeJobId: string | null = null

/** Job 總逾時：25 分鐘（LLM 每次呼叫已有 180s abort，但 429 退避＋fallback 累積可能更久）。
 *  Issue #39：此值不動；各 pipeline 段另有自身上限（見 MARKET_FOCUS_STAGE_TIMEOUTS_MS，
 *  總和 20.5min < 25min），任一段 hanging 都會先在段上限內失敗並指出段名。 */
export const JOB_TIMEOUT_MS = 25 * 60 * 1000

function makeJobId(): string {
  return `mf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
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
 * 啟動市場焦點背景 Job。
 * - kind='refresh'：寫入 DB + email + 社群（供 GitHub 排程呼叫）。
 * - kind='publish'：寫入 DB + email，並依 alsoSocial 決定是否觸發社群（後台手動發布）。
 * - kind='dry'：僅乾跑預覽，不寫 DB（後台預覽）。
 * 若已有 Job 執行中，直接回傳該 Job，避免重疊執行。
 * @param skipSocial 為 true 時跳過社群發布（適合排程自動化，縮短 pipeline 時間）。
 */
export function startMarketFocusJob(options: { kind: MarketFocusJobKind; alsoSocial?: boolean; skipSocial?: boolean }): MarketFocusJob {
  if (activeJobId) {
    const running = JOBS.get(activeJobId)
    if (running?.status === 'running') {
      // 2026-09-26 教訓：卡死的 job 會擋住後續所有觸發。若已超過總逾時，強制標失敗並開新 job，不再無限等待。
      const ageMs = Date.now() - Date.parse(running.startedAt)
      if (Number.isFinite(ageMs) && ageMs > JOB_TIMEOUT_MS) {
        running.status = 'failed'
        running.error = `被新觸發接管：前一個 job 卡在 stage=${running.stage ?? '?'} 超過 ${Math.round(JOB_TIMEOUT_MS / 60000)} 分鐘。`
        running.finishedAt = new Date().toISOString()
        console.error(`[MarketFocusJob] takeover stale job ${running.id} (stage=${running.stage ?? '?'})`)
        activeJobId = null
      } else {
        return running
      }
    }
  }

  const kind = options.kind
  const job: MarketFocusJob = {
    id: makeJobId(),
    kind,
    status: 'running',
    alsoSocial: kind === 'refresh' ? true : !!options.alsoSocial,
    skipSocial: !!options.skipSocial,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    count: null,
    editionKey: null,
    timestamp: null,
    summary: null,
    items: null,
    socialResults: null,
    stage: 'queued',
  }
  JOBS.set(job.id, job)
  activeJobId = job.id

  // 總逾時看門狗：超過 JOB_TIMEOUT_MS 尚未完成即自動失敗（避免 LLM 退避累積卡死）。
  // 開槍時一併記錄當下細化 stage（含 pipeline:xxx 段名），下次直接定罪。
  const watchdog = setTimeout(() => {
    const current = JOBS.get(job.id)
    if (current?.status === 'running') {
      current.status = 'failed'
      current.error = `Job 執行逾時（超過 ${Math.round(JOB_TIMEOUT_MS / 60000)} 分鐘，卡在 stage=${current.stage ?? 'unknown'}），已中止。`
      current.finishedAt = new Date().toISOString()
      if (activeJobId === job.id) activeJobId = null
      console.error(`[MarketFocusJob] watchdog killed ${job.id} at stage=${current.stage ?? 'unknown'}`)
      if (activeJobId === job.id) activeJobId = null
      console.error(`[MarketFocusJob] watchdog killed ${job.id} at stage=${current.stage ?? 'unknown'}`)
      void logMarketFocusEvent({
        source: 'job',
        level: 'error',
        code: 'JOB_TIMEOUT',
        jobId: job.id,
        editionKey: current.editionKey ?? null,
        message: `market-focus job 超時（卡在 stage=${current.stage ?? 'unknown'}）`,
      }).catch(() => {})
    }
  }, JOB_TIMEOUT_MS)

  void runJob(job, watchdog)
  trimJobs()
  return job
}

export function getMarketFocusJob(id: string): MarketFocusJob | null {
  return JOBS.get(id) ?? null
}

async function runJob(job: MarketFocusJob, watchdog: NodeJS.Timeout): Promise<void> {
  // Issue #39：細化 stage 心跳（job.stage＋log），下次卡住直接指出段名。
  const setStage = (stage: string): void => {
    job.stage = stage
    console.log(`[MarketFocusJob] ${job.id} stage -> ${stage}`)
  }
  // pipeline 段回報：`pipeline:fetch|filter|crawl|summaries|summary`
  const onPipelineStage = (stage: MarketFocusStage): void => setStage(`pipeline:${stage}`)
  try {
    if (job.kind === 'dry') {
      const { items, summary } = await previewMarketFocus(onPipelineStage)
      job.items = items.map((it: MarketFocusItem) => ({ title: it.title, source: it.source, reason: it.reason }))
      job.summary = summary
      job.count = items.length
    } else {
      const { enriched: items, summary, hasNewEdition, newCount } = await refreshMarketFocusDetailed(onPipelineStage)
      revalidateTag('market-focus')
      job.count = items.length
      const meta = await getMarketFocusMeta()
      job.editionKey = meta?.generated_at ?? null
      job.timestamp = new Date().toISOString()
      job.summary = summary
      job.items = items.map((it: MarketFocusItem) => ({ title: it.title, source: it.source, reason: it.reason }))

      // 回填先前 LLM 失敗留下的空摘要／空遴選原因（與是否產新版次無關，每次收尾都治療）
      // Issue #32：兩段回填之間錯峰（與主鏈共用同一 OTPM 池）
      if (job.kind === 'refresh' || job.kind === 'publish') {
        setStage('backfill')
        const filledSummaries = await backfillMissingSummaries()
        if (filledSummaries > 0) await sleep(getChainPaceMs())
        const filled = filledSummaries + (await backfillMissingReasons())
        if (filled > 0) {
          console.log(`[MarketFocusJob] backfilled ${filled} missing summaries/reasons`)
          revalidateTag('market-focus')
        }
      }

      if (!hasNewEdition) {
        console.log(`[MarketFocusJob] 無新重大新聞通過門檻（新增: ${newCount} 則），保留上一版總覽，略過 Email 與社群發布。`)
      } else {
        // Email：回退偵測同原流程
        setStage('email')
        try {
          if (meta?.summary && isSummaryFallback(meta.summary)) {
            // 把 DB 日誌中最新一筆總覽失敗的細節帶進告警信，取代過去固定的無資訊訊息。
            const lastSummaryLog = await getLatestMarketFocusLog('daily_summary', 'error').catch(() => null)
            let alertMsg = '主模型與備援皆失敗，每日總覽以新聞標題拼接呈現。'
            if (lastSummaryLog?.message) alertMsg += `\n[message] ${lastSummaryLog.message}`
            if (lastSummaryLog?.detail) {
              let detail = lastSummaryLog.detail
              try {
                const parsed = JSON.parse(detail) as { message?: string; code?: string; stack?: string }
                detail = [parsed.message, parsed.code ? `code=${parsed.code}` : '', parsed.stack ? `stack=${parsed.stack}` : ''].filter(Boolean).join('\n') || detail
              } catch {}
              alertMsg += `\n[detail] ${detail.slice(0, 1200)}`
            }
            await logMarketFocusEvent({
              source: 'job',
              level: 'warn',
              code: 'EDITION_SUMMARY_FALLBACK',
              jobId: job.id,
              editionKey: job.editionKey ?? null,
              message: '已偵測每日總覽為標題拼接 fallback，寄出 LLM 回退告警',
            })
            await sendMarketFocusAlert('LLM 每日總覽回退', alertMsg)
          } else {
            await sendMarketFocusSummary(job.editionKey ?? undefined)
          }
        } catch (e: any) {
          console.error('[MarketFocusJob] email dispatch error:', e)
        }

        // 社群：refresh 必發；publish 依勾選；skipSocial=true 時跳過
        if (!job.skipSocial && (job.kind === 'refresh' || job.alsoSocial)) {
          setStage('social')
          try {
            const social = await triggerSocialPublish()
            job.socialResults = social?.results ?? []
          } catch (e: any) {
            console.error('[MarketFocusJob] social publish error:', e)
            job.socialResults = [{ platform: 'instagram', status: 'failed', error: e?.message ?? String(e) }]
          }
        }
      }
    }
    job.status = 'done'
    job.finishedAt = new Date().toISOString()
  } catch (e: any) {
    job.status = 'failed'
    job.error = (e?.message ?? String(e)).slice(0, 500)
    job.finishedAt = new Date().toISOString()
    if (job.kind === 'refresh' || job.kind === 'publish') {
      await logMarketFocusEvent({
        source: 'job',
        level: 'error',
        code: 'JOB_FAILED',
        jobId: job.id,
        editionKey: job.editionKey ?? null,
        message: `market-focus job 失敗（${job.kind}）：${job.error}`,
        detail: { reason: e?.message ?? String(e) },
      })
      try {
        await sendMarketFocusAlert('refresh 失敗', job.error ?? '')
      } catch {}
    }
  } finally {
    clearTimeout(watchdog)
    if (activeJobId === job.id) activeJobId = null
    if (job.status === 'done') {
      // 每次成功收尾順帶清理：日誌保留 7 天、圖卡快照僅留最近 30 版（避免 Azure SQL 配額累積）
      void (async () => {
        try {
          const logs = await cleanupMarketFocusLogs(7)
          const cards = await cleanupSocialCardImages(30)
          if (logs > 0 || cards > 0) {
            console.log(`[MarketFocusJob] cleanup done: logs=${logs} cards=${cards}`)
          }
        } catch (e: any) {
          console.warn('[MarketFocusJob] cleanup failed:', e?.message ?? e)
        }
      })()
    }
  }
}