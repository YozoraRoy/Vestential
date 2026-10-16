/**
 * 殖利率歷史資料修復端點核心（Issue #95 P4 管理用）。
 *
 * 純邏輯＋依賴注入（沿 `odd-lot-repair.ts` 模式）：不依賴 Next runtime，供
 * `app/api/admin/dividends/repair/route.ts`（薄包裝：SYNC_TOKEN 鑑權＋真實 DB／
 * TWSE 依賴）與 vitest 單測共用。
 *
 * 語意：
 * - `dryRun` 預設 true（只回預估值，不抓不寫不刪）；`dryRun:false` 時 `applyPlan` 一律收到
 *   `{ dryRun: false }`（#95 P2：舊版漏傳 dry-run 關閉讓實跑變 no-op）。
 * - 一次處理 `limit` 個月（預設 6），**每段都從 `[from,to]` 的最新月往舊取**；回傳
 *   `nextMonth`／`remaining` 供觀測（`nextMonth` 不是進度游標——同段重跑結果一致；
 *   要跑整窗請用 `to` 逐段往回，見 route 註解）。
 * - 冪等：upsert 同鍵覆寫、刪除僅在值等於推導值時生效（連跑兩次結果一致）。
 * - `covered_months` 只計「實際標記成功」的月（`markCovered` 的回傳值）。
 */

import type { DividendsMonthPlan, DividendsWriteResult, YieldBackfillYear } from './twse-dividends'

export type DividendsRepairAction = 'assess' | 'repair'

export interface DividendsRepairBody {
  action?: unknown
  dryRun?: unknown
  /** 起始月（含）'YYYY-MM' 或 'YYYY-MM-DD'；預設回填窗最新月。 */
  from?: unknown
  /** 結束月（含）'YYYY-MM' 或 'YYYY-MM-DD'；預設回填窗最舊月。 */
  to?: unknown
  /** 單次處理月數（預設 6，夾在 1..12）。 */
  limit?: unknown
}

export interface DividendsRepairCoverage {
  /** 回填窗內的分年筆數／缺年（唯讀）。 */
  years: YieldBackfillYear[]
  /** 回填窗全部月（由新往舊）。 */
  windowMonths: string[]
  /** 已標記成功回填的月（agent_settings）。 */
  coveredMonths: string[]
}

export interface DividendsRepairDeps {
  coverage: () => Promise<DividendsRepairCoverage>
  /** 抓 TWT49U 單月＋官方表比對，產生計畫（不寫 DB）。 */
  planMonth: (month: string) => Promise<DividendsMonthPlan>
  /**
   * 套用計畫（upsert 精確列＋刪除推導列）。`writeOpts.dryRun` 由本模組傳入，
   * 呼叫端**不得**自行假設（#95 P2：漏傳 dry-run=false 曾讓 repair 實跑變 no-op）。
   */
  applyPlan: (
    plan: DividendsMonthPlan,
    writeOpts: { dryRun: boolean },
  ) => Promise<DividendsWriteResult>
  /**
   * 套用成功後標記該月已覆蓋；回傳**實際標記成功**的月清單（失敗回空陣列／undefined）。
   * 本模組只以此回傳值計入 `covered_months`，不再用「處理過的月數」謊報。
   */
  markCovered?: (months: string[]) => Promise<string[] | void>
  onLog?: (message: string) => void
}

export interface DividendsRepairResult {
  status: number
  body: Record<string, unknown>
}

const DEFAULT_LIMIT = 6
const MAX_LIMIT = 12

/** 接受 'YYYY-MM'／'YYYY-MM-DD'／'YYYY/MM'，正規化為 'YYYY-MM'；不合法回 null。 */
export function normalizeRepairMonth(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const t = input.trim().replace(/[/.]/g, '-')
  const m = t.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/)
  if (!m) return null
  const mo = Number(m[2])
  if (mo < 1 || mo > 12) return null
  return `${m[1]}-${String(mo).padStart(2, '0')}`
}

function clampLimit(input: unknown): number {
  const n = Number(input)
  if (!Number.isFinite(n)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(n)))
}

export async function handleDividendsRepair(
  opts: { authorized: boolean; body: DividendsRepairBody },
  deps: DividendsRepairDeps,
): Promise<DividendsRepairResult> {
  const log = deps.onLog ?? (() => {})
  const timestamp = new Date().toISOString()

  if (!opts.authorized) {
    return { status: 401, body: { success: false, error: 'Unauthorized' } }
  }

  const action = opts.body?.action
  if (action !== 'assess' && action !== 'repair') {
    return {
      status: 400,
      body: { success: false, error: "action 須為 'assess' | 'repair'" },
    }
  }

  // 預設 dry-run：只有顯式 dryRun:false 才寫入／刪除。
  const dryRun = opts.body?.dryRun !== false

  const coverage = await deps.coverage()
  const covered = new Set(coverage.coveredMonths)
  const windowMonths = coverage.windowMonths
  const pending = windowMonths.filter((m) => !covered.has(m))

  if (action === 'assess') {
    log(`[dividends/repair] assess: ${coverage.years.length} years, ${windowMonths.length} months, ${pending.length} pending (dryRun=${dryRun})`)
    return {
      status: 200,
      body: {
        success: true,
        action,
        dryRun,
        years: coverage.years,
        window: {
          from: windowMonths[windowMonths.length - 1] ?? null,
          to: windowMonths[0] ?? null,
          months: windowMonths.length,
        },
        covered_months: covered.size,
        pending_months: pending.length,
        pending_sample: pending.slice(0, 12),
        timestamp,
      },
    }
  }

  // repair：窗內由新往舊，取前 limit 個月（可重跑、可分段）。
  const from = normalizeRepairMonth(opts.body?.from)
  const to = normalizeRepairMonth(opts.body?.to)
  if (opts.body?.from != null && from == null) {
    return { status: 400, body: { success: false, error: "from 須為 'YYYY-MM'（或 YYYY-MM-DD）" } }
  }
  if (opts.body?.to != null && to == null) {
    return { status: 400, body: { success: false, error: "to 須為 'YYYY-MM'（或 YYYY-MM-DD）" } }
  }
  const inWindow = windowMonths.filter((m) => (!from || m >= from) && (!to || m <= to))
  const limit = clampLimit(opts.body?.limit)
  const batch = inWindow.slice(0, limit)

  const results: Array<Record<string, unknown>> = []
  const applied: string[] = []
  let totalWrite = 0
  let totalDelete = 0
  let totalOfficial = 0
  let failed = 0

  for (const month of batch) {
    try {
      const plan = await deps.planMonth(month)
      const wouldWrite = plan.upserts.length
      const wouldDelete = plan.deleteCandidates.length
      let written = 0
      let deleted = 0
      if (dryRun) {
        totalWrite += wouldWrite
        totalDelete += wouldDelete
      } else {
        const applied2 = await deps.applyPlan(plan, { dryRun })
        // #95 P2：apply 回報未確實寫入（ok=false）時視為該月失敗，不得計入 written／不得標記覆蓋。
        if (!applied2.ok) throw new Error(`apply not written: ${applied2.reason ?? 'unknown'}`)
        written = applied2.written
        deleted = applied2.deleted
        applied.push(month)
        totalWrite += written
        totalDelete += deleted
      }
      totalOfficial += plan.officialOverrides
      results.push({
        month,
        exact: plan.upserts.length,
        official_overrides: plan.officialOverrides,
        unresolved: plan.unresolved.length,
        would_write: wouldWrite,
        would_delete: wouldDelete,
        written,
        deleted,
        skipped: plan.skipped,
      })
      log(`[dividends/repair] ${month}: plan write=${wouldWrite} delete=${wouldDelete} official=${plan.officialOverrides} (dryRun=${dryRun})`)
    } catch (e: unknown) {
      failed++
      const message = e instanceof Error ? e.message : 'month repair failed'
      results.push({ month, error: message })
      log(`[dividends/repair] ${month}: FAILED ${message}`)
    }
  }

  // #95 P2：covered_months 只計「實際標記成功」的月（不得用 applied.length 謊報）。
  let markedMonths: string[] = []
  if (!dryRun && deps.markCovered && applied.length > 0) {
    try {
      const marked = await deps.markCovered(applied)
      if (Array.isArray(marked)) markedMonths = marked.filter((m): m is string => typeof m === 'string')
    } catch (e) {
      log(`[dividends/repair] markCovered failed (non-blocking): ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const lastProcessed = batch[batch.length - 1]
  const nextMonth = inWindow.length > batch.length ? inWindow[batch.length] : null

  return {
    status: 200,
    body: {
      success: failed === 0,
      action,
      dryRun,
      from: from ?? null,
      to: to ?? null,
      limit,
      months: results,
      processed: batch.length,
      failed_months: failed,
      written: dryRun ? 0 : totalWrite,
      deleted: dryRun ? 0 : totalDelete,
      would_write: totalWrite,
      would_delete: totalDelete,
      official_overrides: totalOfficial,
      /** 已覆蓋月數＝既有 covered ∪ 本次實際標記成功者（不得謊報）。 */
      covered_months: new Set([...covered, ...markedMonths]).size,
      marked_months: markedMonths.length,
      next_month: nextMonth,
      remaining: Math.max(0, inWindow.length - batch.length),
      note: dryRun
        ? '預覽：未抓取比對以外的寫入／刪除；帶 dryRun:false 才執行'
        : 'upsert 精確值＋刪除價差推導列；冪等（可重跑，結果一致）',
      last_month: lastProcessed ?? null,
      timestamp,
    },
  }
}
