/**
 * 盤後零股髒資料修復端點的核心邏輯（Issue #65 P4 管理用）。
 *
 * 純函式＋依賴注入：不依賴 Next runtime，供
 * `app/api/admin/odd-lot/repair/route.ts`（薄包裝：SYNC_TOKEN 鑑權＋真實 DB 依賴）
 * 與 vitest 單測共用。
 *
 * 語意：
 * - `dryRun` 預設 true（只讀不寫）。只有 body 顯式帶 `dryRun: false` 才允許寫入。
 * - `delete` 另需 `confirm: true` 才執行，否則只回傳 `wouldDelete` 預覽。
 * - `backfill` 執行時沿用 refresh 既有寫入路徑（migrate＋dated fetcher），由 route 層注入。
 */

export type OddLotRepairAction = 'assess' | 'delete' | 'backfill'

export interface OddLotRepairBody {
  action?: unknown
  date?: unknown
  confirm?: unknown
  dryRun?: unknown
}

export interface OddLotDateCount {
  date: string
  cnt: number
}

export interface OddLotRepairDeps {
  listCounts: () => Promise<OddLotDateCount[]>
  deleteByDate: (date: string) => Promise<number>
  backfillByDate: (date: string) => Promise<number>
  onLog?: (message: string) => void
}

export interface OddLotRepairResult {
  status: number
  body: Record<string, unknown>
}

/** 接受 YYYYMMDD／YYYY-MM-DD／YYYY/MM/DD，正規化為 YYYYMMDD；不合法回 null。 */
export function normalizeRepairDate(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const cleaned = input.trim().replace(/[-\/]/g, '')
  if (!/^\d{8}$/.test(cleaned)) return null
  return cleaned
}

export async function handleOddLotRepair(
  opts: { authorized: boolean; body: OddLotRepairBody },
  deps: OddLotRepairDeps,
): Promise<OddLotRepairResult> {
  const log = deps.onLog ?? (() => {})
  const timestamp = new Date().toISOString()

  if (!opts.authorized) {
    return { status: 401, body: { success: false, error: 'Unauthorized' } }
  }

  const action = opts.body?.action
  if (action !== 'assess' && action !== 'delete' && action !== 'backfill') {
    return {
      status: 400,
      body: { success: false, error: "action 須為 'assess' | 'delete' | 'backfill'" },
    }
  }

  // 預設 dry-run：只有顯式 dryRun:false 才寫入。
  const dryRun = opts.body?.dryRun !== false

  if (action === 'assess') {
    const counts = await deps.listCounts()
    log(`[odd-lot/repair] assess: ${counts.length} dates listed (dryRun=${dryRun})`)
    return { status: 200, body: { success: true, action, dryRun, counts, timestamp } }
  }

  const date = normalizeRepairDate(opts.body?.date)
  if (!date) {
    return {
      status: 400,
      body: { success: false, error: 'date 須為 YYYYMMDD（或 YYYY-MM-DD／YYYY/MM/DD）' },
    }
  }

  if (action === 'delete') {
    if (dryRun || opts.body?.confirm !== true) {
      const counts = await deps.listCounts()
      const wouldDelete = counts.find((c) => c.date === date)?.cnt ?? 0
      log(`[odd-lot/repair] delete preview ${date}: wouldDelete=${wouldDelete} (no write)`)
      return {
        status: 200,
        body: {
          success: true,
          action,
          dryRun: true,
          date,
          wouldDelete,
          deleted: 0,
          note: '預覽：未刪除；同時帶 confirm:true 與 dryRun:false 才執行',
          timestamp,
        },
      }
    }
    const deleted = await deps.deleteByDate(date)
    log(`[odd-lot/repair] delete ${date}: ${deleted} rows deleted`)
    return {
      status: 200,
      body: { success: true, action, dryRun: false, date, deleted, timestamp },
    }
  }

  // backfill
  if (dryRun) {
    const counts = await deps.listCounts()
    const existing = counts.find((c) => c.date === date)?.cnt ?? 0
    log(`[odd-lot/repair] backfill preview ${date}: existing=${existing} (no fetch, no write)`)
    return {
      status: 200,
      body: {
        success: true,
        action,
        dryRun: true,
        date,
        existing,
        inserted: 0,
        note: '預覽：未抓取寫入；帶 dryRun:false 執行回填',
        timestamp,
      },
    }
  }
  const inserted = await deps.backfillByDate(date)
  log(`[odd-lot/repair] backfill ${date}: ${inserted} rows inserted`)
  return {
    status: 200,
    body: { success: true, action, dryRun: false, date, inserted, timestamp },
  }
}
