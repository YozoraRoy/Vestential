import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { fetchTwseOddLots, deleteOddLotByDate, listOddLotDateCounts, migrate } from '@stock/database'
import { authorizeSync } from '@/lib/sync-auth'
import { handleOddLotRepair } from '@/lib/odd-lot-repair'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * 盤後零股髒資料修復（Issue #65 P4 管理用，常駐保留）。
 *
 * 鑑權：沿用排程端點慣例 `authorizeSync`（Bearer SYNC_TOKEN，與
 * `/api/odd-lot/refresh`、`POST /api/health/repair`、`POST /api/cycle-entry/refresh`
 * 相同），供主 agent 於 P4 以 curl／GHA 無頭呼叫生產執行。
 * 後台 cookie 登入（isAdminUser）不適用無頭呼叫，故不採用。
 *
 * Body（JSON，預設 dry-run 只讀不寫）：
 * - assess：  { "action": "assess" }
 * - delete：  { "action": "delete", "date": "20261009", "confirm": true, "dryRun": false }
 *             （缺 confirm:true 或 dryRun:false 任一 → 只回 wouldDelete，不刪除）
 * - backfill：{ "action": "backfill", "date": "20261008", "dryRun": false }
 *             （預設 dry-run 只回 existing，不抓取寫入）
 */
export async function POST(req: Request) {
  const authorized = authorizeSync(req)
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {}

  const { status, body: resBody } = await handleOddLotRepair(
    { authorized, body },
    {
      listCounts: () => listOddLotDateCounts(),
      deleteByDate: async (date) => {
        await migrate()
        return deleteOddLotByDate(date)
      },
      backfillByDate: async (date) => {
        await migrate()
        const inserted = await fetchTwseOddLots(date)
        revalidateTag('odd-lot')
        return inserted
      },
      onLog: (message) => console.log(message),
    },
  )
  return NextResponse.json(resBody, { status })
}
