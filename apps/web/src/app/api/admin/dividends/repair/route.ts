import { NextResponse } from 'next/server'
import { getTwseDividendsByYear } from '@stock/database'
import { authorizeSync } from '@/lib/sync-auth'
import { handleDividendsRepair } from '@/lib/dividends-repair'
import { taipeiTodayStr } from '@/lib/twse-calendar'
import {
  backfillMonthWindow,
  fetchT187ap45Table,
  getCoveredMonths,
  markMonthsCovered,
  planTwt49uMonth,
  writeDividendsMonthPlan,
  type OfficialDividendRow,
  type YieldBackfillYear,
} from '@/lib/twse-dividends'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * 殖利率歷史資料修復（Issue #95 P4 管理用，常駐保留）。
 *
 * 用途：以新的 TWT49U 解析（息列取 `權值+息值`）＋官方 `t187ap45_L`（權息精確值）
 * 重抓 2021-01～當月，覆寫既有錯誤列（2330 的 6.01）並刪除價差推導列
 * （1773 勝一 2025-06-13 的 27.25 假殖利率）；查不到精確值的權息列一律刪除不寫入。
 *
 * 鑑權：沿用排程端點慣例 `authorizeSync`（Bearer `SYNC_TOKEN`），供主 agent 於 P4
 * 以 curl 無頭呼叫生產執行（比照 `/api/admin/odd-lot/repair`）。
 *
 * Body（JSON，預設 dry-run 只讀不寫）：
 * - `{ "action": "assess" }`：回分年 coverage＋未回填月（預覽，不抓不寫）
 * - `{ "action": "repair", "limit": 6 }`：預覽窗內最新 6 個月的計畫（不寫）
 * - `{ "action": "repair", "dryRun": false, "limit": 12 }`：實際執行（#95 P2：`writeDividendsMonthPlan`
 *   一律顯式帶 `dryRun`，非 dry-run 才會真的 upsert／刪除）
 * - `{ "action": "repair", "dryRun": false, "from": "2026-01", "to": "2026-09" }`：指定區間
 *
 * 分段續跑語意（#97）：
 * - 未指定 from/to 時：預設從未覆蓋月（pending）依序由新往舊取 limit 個月，`next_month` 為下一個
 *   待處理的未覆蓋月，`remaining` 為剩餘未覆蓋月數；管理端可重複呼叫相同 payload 續跑直到 `remaining: 0`。
 * - 指定 from/to 時：針對指定區間由新往舊取 limit 個月，支援強制重跑與自訂分段（可帶上一段 `next_month` 為 `to`）。
 */
export async function POST(req: Request) {
  const authorized = authorizeSync(req)
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {}

  // 官方股利分派表抓一次（全月共用；失敗降級＝僅套息列，權息列不覆寫）。
  let official: OfficialDividendRow[] | null = null
  let officialError: string | null = null
  try {
    official = await fetchT187ap45Table()
  } catch (e: unknown) {
    officialError = e instanceof Error ? e.message : 't187ap45_L fetch failed'
    console.error('[dividends/repair] official table fetch failed (degraded):', officialError)
  }

  const today = taipeiTodayStr()
  const { status, body: resBody } = await handleDividendsRepair(
    { authorized, body },
    {
      coverage: async () => {
        const windowMonths = backfillMonthWindow(today)
        const years: YieldBackfillYear[] = []
        for (const year of [...new Set(windowMonths.map((m) => m.slice(0, 4)))].sort()) {
          const rows = await getTwseDividendsByYear(year).catch(() => [])
          years.push({ year, rows: rows.length, missing: rows.length === 0 })
        }
        return { years, windowMonths, coveredMonths: [...(await getCoveredMonths())] }
      },
      planMonth: (month) => planTwt49uMonth(month, official),
      // #95 P2：apply 一律顯式帶 dryRun（dryRun 只由 handleDividendsRepair 決定；
      // 非 dry-run 才會被呼叫，且 writeDividendsMonthPlan 會真的寫入）。
      applyPlan: (plan, writeOpts) => writeDividendsMonthPlan(plan, writeOpts),
      markCovered: (months) => markMonthsCovered(months),
      onLog: (message) => console.log(message),
    },
  )
  return NextResponse.json(
    { ...resBody, official_rows: official?.length ?? null, official_error: officialError },
    { status },
  )
}
