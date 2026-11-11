import { revalidateTag } from 'next/cache'
import { sleep, getChainPaceMs } from '@stock/ai-engine'
import type { MarketFocusItem } from '@stock/database'
import {
  getMarketFocusMeta,
  logMarketFocusEvent,
  getLatestMarketFocusLog,
  cleanupMarketFocusLogs,
  cleanupSocialCardImages,
  cleanupSyncJobs,
} from '@stock/database'
import { refreshMarketFocusDetailed, previewMarketFocus, backfillMissingSummaries, backfillMissingReasons } from '@/lib/market-focus'
import type { MarketFocusStage } from '@/lib/market-focus'
import { sendMarketFocusAlert, sendMarketFocusSummary, isSummaryFallback } from '@/lib/email'
import { getTaiwanHour, isNewsletterSendWindow } from '@/lib/newsletter-window'
import { triggerSocialPublish } from '@/lib/social-trigger'
import type { SocialPostPlatform } from '@stock/database'
import {
  SYNC_JOB_ERROR_MAX_CHARS,
  SYNC_JOB_TIMEOUT_MS,
  createSyncJobSettler,
  loadSyncJobView,
  serializeSyncJobPayload,
  startSyncJob,
} from '@/lib/sync-job'
import type { SyncJobView } from '@/lib/sync-job'

// ─── 市場焦點背景 Job（Issue #146：狀態 DB 化）────────────────────
// 整個 refresh / publish 管線（抓新聞 → AI 過濾 → 爬全文 → 摘要 → 總覽 → email/社群）
// 改為背景執行並回傳 jobId，避免同步阻塞 HTTP 回應超過 Azure 240s 網關上限 (504)。
// 呼叫端（GitHub Actions 排程 / 後台 UI）輪詢 status 端點取得結果。
//
// 狀態存放於 DB（sync_jobs 表）：Azure App Service 重啟／搬移 worker 後仍查得到，
// 心跳斷掉則回終態 failed（Issue #144 的 404 盲輪詢即源自 in-memory job 遺失）。

/** sync_jobs.job_type。 */
export const SYNC_JOB_TYPE = 'market-focus'

export type MarketFocusJobKind = 'refresh' | 'publish' | 'dry'
export type MarketFocusJobStatus = 'running' | 'done' | 'failed'

export interface MarketFocusSocialResult {
  platform: SocialPostPlatform
  status: string
  error?: string | null
}

/** 對外 job 視圖（欄位與既有 status API／後台 UI 相容）。 */
export interface MarketFocusJob {
  id: string
  kind: MarketFocusJobKind
  status: MarketFocusJobStatus
  alsoSocial: boolean
  skipSocial: boolean
  startedAt: string | null
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

export interface StartedMarketFocusJob {
  jobId: string
  status: MarketFocusJobStatus
  startedAt: string | null
  deduplicated: boolean
}

/** Job 總逾時：25 分鐘（LLM 每次呼叫已有 180s abort，但 429 退避＋fallback 累積可能更久）。
 *  Issue #39：此值不動；各 pipeline 段另有自身上限（見 MARKET_FOCUS_STAGE_TIMEOUTS_MS，
 *  總和 20.5min < 25min），任一段 hanging 都會先在段上限內失敗並指出段名。 */
export const JOB_TIMEOUT_MS = SYNC_JOB_TIMEOUT_MS

interface MarketFocusJobPayload {
  summary?: string | null
  items?: { title: string; source: string | null; reason: string | null }[] | null
  socialResults?: MarketFocusSocialResult[] | null
  timestamp?: string | null
  alsoSocial?: boolean
  skipSocial?: boolean
}

const DEFAULT_ALSO_SOCIAL = true

function toMarketFocusJob(view: SyncJobView): MarketFocusJob {
  const payload = (view.payload ?? {}) as MarketFocusJobPayload
  return {
    id: view.id,
    kind: view.kind as MarketFocusJobKind,
    status: view.status,
    alsoSocial: payload.alsoSocial ?? (view.kind === 'refresh' ? DEFAULT_ALSO_SOCIAL : false),
    skipSocial: payload.skipSocial ?? false,
    startedAt: view.startedAt,
    finishedAt: view.finishedAt,
    error: view.error,
    count: view.count,
    editionKey: view.editionKey,
    timestamp: payload.timestamp ?? null,
    summary: payload.summary ?? null,
    items: payload.items ?? null,
    socialResults: payload.socialResults ?? null,
    stage: view.stage,
  }
}

/**
 * 啟動市場焦點背景 Job。
 * - kind='refresh'：寫入 DB + email + 社群（供 GitHub 排程呼叫）。
 * - kind='publish'：寫入 DB + email，並依 alsoSocial 決定是否觸發社群（後台手動發布）。
 * - kind='dry'：僅乾跑預覽，不寫 DB（後台預覽）。
 * 若已有 Job 執行中（含其他 process／container），直接回傳該 Job，避免重疊執行。
 * @param skipSocial 為 true 時跳過社群發布（適合排程自動化，縮短 pipeline 時間）。
 */
export async function startMarketFocusJob(options: {
  kind: MarketFocusJobKind
  alsoSocial?: boolean
  skipSocial?: boolean
}): Promise<StartedMarketFocusJob> {
  const kind = options.kind
  const alsoSocial = kind === 'refresh' ? DEFAULT_ALSO_SOCIAL : !!options.alsoSocial
  const skipSocial = !!options.skipSocial

  const started = await startSyncJob({
    jobType: SYNC_JOB_TYPE,
    kind,
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

  void runJob(started.jobId, { kind, alsoSocial, skipSocial })
  return {
    jobId: String(started.jobId),
    status: 'running',
    startedAt: new Date().toISOString(),
    deduplicated: false,
  }
}

/** 查詢 job（含跨容器重啟後仍存活的紀錄）；不存在或型別不符回 null。 */
export async function getMarketFocusJob(id: string | number): Promise<MarketFocusJob | null> {
  const view = await loadSyncJobView(id, SYNC_JOB_TYPE)
  return view ? toMarketFocusJob(view) : null
}

async function runJob(
  jobId: number,
  options: { kind: MarketFocusJobKind; alsoSocial: boolean; skipSocial: boolean },
): Promise<void> {
  const { kind, alsoSocial, skipSocial } = options
  const settler = createSyncJobSettler(jobId)
  let editionKey: string | null = null
  let socialResults: MarketFocusSocialResult[] | null = null

  // Issue #39：細化 stage 心跳（DB 的 stage＋log），下次卡住直接指出段名。
  const setStage = (stage: string): void => {
    settler.setStage(stage)
    console.log(`[MarketFocusJob] ${jobId} stage -> ${stage}`)
  }
  // pipeline 段回報：`pipeline:fetch|filter|crawl|summaries|summary`
  const onPipelineStage = (stage: MarketFocusStage): void => setStage(`pipeline:${stage}`)

  try {
    if (kind === 'dry') {
      const { items, summary } = await previewMarketFocus(onPipelineStage)
      await settler.finish({
        status: 'done',
        count: items.length,
        payload: serializeSyncJobPayload({
          summary,
          items: items.map((it: MarketFocusItem) => ({ title: it.title, source: it.source, reason: it.reason })),
          alsoSocial,
          skipSocial,
        }),
      })
      return
    }

    const { enriched: items, summary, hasNewEdition, newCount } = await refreshMarketFocusDetailed(onPipelineStage)
    revalidateTag('market-focus', 'max')

    const meta = await getMarketFocusMeta()
    editionKey = meta?.generated_at ?? null
    const timestamp = new Date().toISOString()
    const mappedItems = items.map((it: MarketFocusItem) => ({
      title: it.title,
      source: it.source,
      reason: it.reason,
    }))

    // 回填先前 LLM 失敗留下的空摘要／空遴選原因（與是否產新版次無關，每次收尾都治療）
    // Issue #32：兩段回填之間錯峰（與主鏈共用同一 OTPM 池）
    if (kind === 'refresh' || kind === 'publish') {
      setStage('backfill')
      const filledSummaries = await backfillMissingSummaries()
      if (filledSummaries > 0) await sleep(getChainPaceMs())
      const filled = filledSummaries + (await backfillMissingReasons())
      if (filled > 0) {
        console.log(`[MarketFocusJob] backfilled ${filled} missing summaries/reasons`)
        revalidateTag('market-focus', 'max')
      }
    }

    // 早上寄送時段（08:00–13:59）即使本輪沒有新版次，也要嘗試寄當日電子報：
    // 凌晨 01:00 那輪只刷新頁面（時段外不寄），它產生的版次要在 09:00 送達。
    // sendMarketFocusSummary 內仍有「每日一封 + 同版次」護欄，不會重複洗版。
    const morningSend = kind === 'refresh' && isNewsletterSendWindow(getTaiwanHour())
    if (!hasNewEdition) {
      console.log(
        `[MarketFocusJob] 無新重大新聞通過門檻（新增: ${newCount} 則），保留上一版總覽${morningSend ? '；早上時段仍嘗試寄電子報' : '，略過 Email 與社群發布'}。`,
      )
    }

    if (hasNewEdition || morningSend) {
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
            jobId: String(jobId),
            editionKey,
            message: '已偵測每日總覽為標題拼接 fallback，寄出 LLM 回退告警',
          })
          await sendMarketFocusAlert('LLM 每日總覽回退', alertMsg)
        } else {
          await sendMarketFocusSummary(editionKey ?? undefined, false, kind === 'publish')
        }
      } catch (e: any) {
        console.error('[MarketFocusJob] email dispatch error:', e)
      }
    }

    // 社群：只有真的產生新版次才發，避免重複貼同一版。
    if (hasNewEdition && !skipSocial && (kind === 'refresh' || alsoSocial)) {
      setStage('social')
      try {
        const social = await triggerSocialPublish()
        socialResults = social?.results ?? []
      } catch (e: any) {
        console.error('[MarketFocusJob] social publish error:', e)
        socialResults = [{ platform: 'threads', status: 'failed', error: e?.message ?? String(e) }]
      }
    }

    await settler.finish({
      status: 'done',
      count: items.length,
      editionKey,
      payload: serializeSyncJobPayload({
        summary,
        items: mappedItems,
        socialResults,
        timestamp,
        alsoSocial,
        skipSocial,
      }),
    })

    // 每次成功收尾順帶清理：日誌保留 7 天、圖卡快照僅留最近 30 版（避免 Azure SQL 配額累積）
    void (async () => {
      try {
        const logs = await cleanupMarketFocusLogs(7)
        const cards = await cleanupSocialCardImages(30)
        if (logs > 0 || cards > 0) {
          console.log(`[MarketFocusJob] cleanup done: logs=${logs} cards=${cards}`)
        }
        await cleanupSyncJobs(SYNC_JOB_TYPE, 30)
      } catch (e: any) {
        console.warn(`[MarketFocusJob] cleanup failed: ${e?.message ?? e}`)
      }
    })()
  } catch (e: any) {
    const message = String(e?.message ?? e).slice(0, SYNC_JOB_ERROR_MAX_CHARS)
    console.error(`[MarketFocusJob] job ${jobId} failed:`, message)
    if (kind === 'refresh' || kind === 'publish') {
      await logMarketFocusEvent({
        source: 'job',
        level: 'error',
        code: 'JOB_FAILED',
        jobId: String(jobId),
        editionKey,
        message: `market-focus job 失敗（${kind}）：${message || '執行失敗'}`,
        detail: { reason: message },
      }).catch(() => {})
      try {
        await sendMarketFocusAlert('refresh 失敗', message || '執行失敗')
      } catch {}
    }
    await settler.finish({ status: 'failed', error: message || '執行失敗' })
  } finally {
    settler.cleanup()
  }
}
