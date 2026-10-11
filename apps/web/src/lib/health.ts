import { dbQueryFirst, getMarketFocusMeta, getLatestCycleEntryMeta, cleanupMarketFocusLogs } from '@stock/database'
import { getLastMarketTradingDay, isTaiwanMarketTradingDay, formatDateIso } from '@/utils/taiwan-calendar'
import { FALLBACK_SUMMARY_PREFIX } from '@/lib/email'

export interface HealthIssue {
  code: string
  severity: 'error' | 'warn'
  message: string
}

export interface HealthReport {
  ok: boolean
  generatedAt: string
  total: number
  issues: HealthIssue[]
  checks: Record<string, any>
}

export const MARKET_FOCUS_STALE_MS = 5 * 60 * 60 * 1000
export const CYCLE_ENTRY_STALE_MS = 48 * 60 * 60 * 1000

function toCompact(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/**
 * odd-lot 盤後零股預期同步完成時間（台灣時間 20:10，以當日分鐘數表示）。
 * 交叉引用 .github/workflows/sync-oddlot.yml:6：cron 宣告 `10 7 * * 1-5`
 * （UTC 07:10 = TW 15:10）；但 GitHub Actions `schedule` 事件常有 4~5 小時
 * 佇列延遲（cf. apps/web/src/lib/arena-scheduler.ts:5），故 de-facto
 * 同步約在 TW 20:10 完成。未來若調整 sync-oddlot.yml 排程，須同步此常數。
 */
export const ODD_LOT_EXPECTED_SYNC_DEADLINE_TW = 20 * 60 + 10

/**
 * 台灣時間現在是否仍處「今日（＝預期交易日）」的 odd-lot 同步預期窗口。
 * TW 20:10（de-facto 同步完成）之前，當日盤後零股尚未同步屬預期現象，
 * 用於將 oddlot 缺失降為 warn；20:10 之後仍缺則維持 error（真警報不吞）。
 * 以 UTC getter 計算（now + 8h 後讀 UTC 欄位），避免本機時區造成雙重偏移。
 * 非當日一律回傳 false（跨日/非交易日不誤放）。
 */
export function beforeOddLotSyncDeadline(nowMs: number, expectedCompact: string): boolean {
  const tw = new Date(nowMs + 8 * 60 * 60 * 1000)
  const y = tw.getUTCFullYear()
  const m = String(tw.getUTCMonth() + 1).padStart(2, '0')
  const d = String(tw.getUTCDate()).padStart(2, '0')
  const compact = `${y}${m}${d}`
  if (compact < expectedCompact) return false
  if (compact > expectedCompact) return false
  return tw.getUTCHours() * 60 + tw.getUTCMinutes() < ODD_LOT_EXPECTED_SYNC_DEADLINE_TW
}

/**
 * Issue #65：odd-lot 最新日期與預期交易日的純比對（可單測）。
 * - 'empty'：尚無資料；'stale'：落後；'future'：超前（錯標籤如休市日，不應發生）；'ok'：一致。
 */
export function classifyOddLotFreshness(
  latest: string | null | undefined,
  expected: string,
): 'empty' | 'stale' | 'future' | 'ok' {
  if (!latest) return 'empty'
  if (latest < expected) return 'stale'
  if (latest > expected) return 'future'
  return 'ok'
}

export async function runHealthChecks(): Promise<HealthReport> {
  const issues: HealthIssue[] = []
  const now = Date.now()
  const checks: Record<string, any> = {}

  // ── market_focus 資料 ──────────────────────────────────────────
  try {
    const count = await dbQueryFirst<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM market_focus')
    const latest = await dbQueryFirst<{ d: string | null }>('SELECT MAX(published_at) AS d FROM market_focus')
    const nullContent = await dbQueryFirst<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM market_focus WHERE content IS NULL OR content = ''",
    )
    checks.marketFocus = {
      count: count?.cnt ?? 0,
      latestPublishedAt: latest?.d ?? null,
      nullContentCount: nullContent?.cnt ?? 0,
    }

    if (!(count?.cnt)) {
      issues.push({ code: 'mf_empty', severity: 'error', message: 'market_focus 完全沒有資料' })
    } else if ((nullContent?.cnt ?? 0) > Math.ceil((count?.cnt ?? 0) / 2)) {
      issues.push({
        code: 'mf_null_content',
        severity: 'error',
        message: `market_focus 有 ${nullContent?.cnt ?? 0}/${count?.cnt ?? 0} 則內容為空(抓取失敗)`,
      })
    }
  } catch (e: any) {
    issues.push({ code: 'mf_query_error', severity: 'error', message: `market_focus 查詢失敗: ${e.message}` })
  }

  // ── market_focus_meta 鮮度 ─────────────────────────────────────
  try {
    const meta = await getMarketFocusMeta()
    checks.marketFocusMeta = {
      exists: !!meta?.summary,
      generatedAt: meta?.generated_at ?? null,
      isFallback: !!meta?.summary && meta.summary.startsWith(FALLBACK_SUMMARY_PREFIX),
    }
    const ts = meta?.generated_at ? new Date(meta.generated_at).getTime() : NaN
    if (!meta?.summary) {
      issues.push({ code: 'mf_meta_missing', severity: 'error', message: 'market_focus_meta 沒有內容(從未成功產生?每日總覽會寄信失敗)' })
    } else if (Number.isNaN(ts) || now - ts > MARKET_FOCUS_STALE_MS) {
      issues.push({
        code: 'mf_stale',
        severity: 'warn',
        message: `market_focus 資料更新於 ${meta.generated_at}（已超過 5 小時未刷新；夜間或非交易時段屬正常現象，可手動刷新或等待定期排程）`,
      })
    } else if (meta.summary.startsWith(FALLBACK_SUMMARY_PREFIX)) {
      issues.push({ code: 'mf_fallback', severity: 'warn', message: '每日總覽正在使用標題拼接 fallback(LLM 主/備援皆失敗)' })
    }
  } catch (e: any) {
    issues.push({ code: 'mf_meta_error', severity: 'error', message: `market_focus_meta 查詢失敗: ${e.message}` })
  }

  // ── cycle_entry 資料鮮度 ────────────────────────────────────────
  try {
    const meta = await getLatestCycleEntryMeta()
    checks.cycleEntry = {
      exists: !!meta?.editionDate,
      editionDate: meta?.editionDate ?? null,
      generatedAt: meta?.generatedAt ?? null,
      signalCount: meta?.signalCount ?? 0,
    }
    const ts = meta?.generatedAt ? new Date(meta.generatedAt).getTime() : NaN
    if (!meta?.editionDate) {
      issues.push({ code: 'cycle_entry_missing', severity: 'error', message: 'cycle_entry 從未產出版次(掃描未執行過?)' })
    } else if (Number.isNaN(ts) || now - ts > CYCLE_ENTRY_STALE_MS) {
      issues.push({
        code: 'cycle_entry_stale',
        severity: 'warn',
        message: `cycle_entry 最新版次 ${meta.editionDate} 更新於 ${meta.generatedAt}（已超過 48 小時未刷新；週末或非交易時段屬正常現象）`,
      })
    }
  } catch (e: any) {
    issues.push({ code: 'cycle_entry_error', severity: 'error', message: `cycle_entry 查詢失敗: ${e.message}` })
  }

  // ── odd_lot 最新交易日 ─────────────────────────────────────────
  try {
    const lastTradingDay = getLastMarketTradingDay()
    const expected = toCompact(lastTradingDay)
    const row = await dbQueryFirst<{ d: string | null }>('SELECT MAX(date) AS d FROM odd_lot_trades')
    checks.oddLot = { latestDate: row?.d ?? null, expectedDate: expected, expectedIso: formatDateIso(lastTradingDay) }
    if (!row?.d) {
      const pending = beforeOddLotSyncDeadline(now, expected)
      issues.push({
        code: 'oddlot_empty',
        severity: pending ? 'warn' : 'error',
        message: pending
          ? `odd_lot_trades 尚無資料（TW 15:30~20:10 屬預期，盤後零股同步中）`
          : 'odd_lot_trades 完全沒有資料',
      })
    } else if (classifyOddLotFreshness(row.d, expected) === 'stale') {
      const pending = beforeOddLotSyncDeadline(now, expected)
      issues.push({
        code: 'oddlot_stale',
        severity: pending ? 'warn' : 'error',
        message: pending
          ? `odd_lot 最新交易日 ${row.d}，今日 ${expected} 收盤資料尚未公布（TW 15:30~20:10 屬預期，盤後零股同步中）`
          : `odd_lot 最新交易日 ${row.d} 早於最近交易日 ${expected}`,
      })
    } else if (classifyOddLotFreshness(row.d, expected) === 'future') {
      // Issue #65：latestDate 超前預期交易日即錯標籤（如休市日 20261009），屬 error 且不受同步窗口降級。
      issues.push({
        code: 'oddlot_future',
        severity: 'error',
        message: `odd_lot 最新交易日 ${row.d} 晚於最近交易日 ${expected}（疑似日期錯標籤或休市日誤寫入）`,
      })
    }
  } catch (e: any) {
    issues.push({ code: 'oddlot_error', severity: 'error', message: `odd_lot 查詢失敗: ${e.message}` })
  }

  // ── 資料庫連線 ─────────────────────────────────────────────────
  try {
    await dbQueryFirst('SELECT 1 AS ok')
    checks.db = { ok: true }
  } catch (e: any) {
    checks.db = { ok: false, error: e.message }
    issues.push({ code: 'db_error', severity: 'error', message: `資料庫連線失敗: ${e.message}` })
  }

  // ── market_focus_logs 維護（保留最新 7 天）──────────────────────
  // 由現有 health 排程（每 4 小時＋每日完整覆盤）代跑，超過 7 天的日誌定期刪除。
  try {
    const total = (await dbQueryFirst<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM market_focus_logs'))?.cnt ?? 0
    const pruned = await cleanupMarketFocusLogs(7)
    const remaining = Math.max(0, total - pruned)
    checks.marketFocusLogs = { total, pruned, remaining, retentionDays: 7 }
    if (remaining > 5000) {
      issues.push({ code: 'mf_logs_growing', severity: 'warn', message: `market_focus_logs 仍有 ${remaining} 筆（保留上限設定 7 天，可能清理未生效）` })
    }
  } catch (e: any) {
    issues.push({ code: 'mf_logs_error', severity: 'error', message: `market_focus_logs 維護失敗: ${e.message}` })
  }

  // ── 核心套件 import ────────────────────────────────────────────
  try {
    await import('@stock/ai-engine')
    checks.imports = { aiEngine: true }
  } catch (e: any) {
    checks.imports = { aiEngine: false, error: e.message }
    issues.push({ code: 'import_error', severity: 'error', message: `ai-engine 載入失敗: ${e.message}` })
  }

  // ── 關鍵環境變數 ───────────────────────────────────────────────
  const envChecks: Record<string, boolean> = {}
  envChecks.OPENAI_API_KEY = !!process.env.OPENAI_API_KEY
  envChecks.GOOGLE_GENERATIVE_AI_API_KEY = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY
  envChecks.FALLBACK2_QUICK_LLM_API_KEY = !!(process.env.FALLBACK2_QUICK_LLM_API_KEY || process.env.FALLBACK_QUICK_LLM_API_KEY)
  envChecks.AUTH_SECRET = !!process.env.AUTH_SECRET
  envChecks.SYNC_TOKEN = !!process.env.SYNC_TOKEN
  envChecks.DATABASE_URL_OR_PATH =
    process.env.NODE_ENV === 'production'
      ? !!(process.env.DATABASE_URL || process.env.DATABASE_PATH)
      : true
  checks.env = envChecks
  for (const [name, ok] of Object.entries(envChecks)) {
    if (!ok) issues.push({ code: `env_${name.toLowerCase()}`, severity: 'error', message: `環境變數 ${name} 未設定` })
  }

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    generatedAt: new Date().toISOString(),
    total: issues.length,
    issues,
    checks,
  }
}

/** 判斷當日(Asia/Taipei)是否為台股交易日,供 odd-lot 修復使用。 */
export function shouldRepairOddLot(current: HealthReport): boolean {
  const stale = current.issues.some((i) => i.code === 'oddlot_stale' || i.code === 'oddlot_empty')
  if (!stale) return false
  const now = new Date()
  const nowTw = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now)
  const todayTw = new Date(`${nowTw}T00:00:00`)
  return isTaiwanMarketTradingDay(todayTw)
}