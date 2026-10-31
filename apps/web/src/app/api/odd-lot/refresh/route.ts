import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { fetchTwseOddLots, fetchTwseIndustry, backfillNonStockIndustries, fetchStockGift, migrate } from '@stock/database'
import { getLastMarketTradingDay, isTaiwanMarketTradingDay } from '@/utils/taiwan-calendar'
import { authorizeSync } from '@/lib/sync-auth'
import { getCurrentUserFromCookies } from '@/lib/auth'

function toCompact(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// 把接受的三種日期格式（YYYYMMDD / YYYY-MM-DD / YYYY/MM/DD）正規化成 YYYYMMDD。
function normalizeDate(input?: string | null): string | null {
  if (!input) return null
  const cleaned = input.trim().replace(/[-\/]/g, '')
  if (!/^\d{8}$/.test(cleaned)) return null
  return cleaned
}

// ── 頻率限制：同一目標日期 10 分鐘內不重複抓取（避免濫用 / 過熱 / 重複寫入） ──
const THROTTLE_MS = 10 * 60 * 1000
const lastRun = new Map<string, number>()

export async function POST(req: Request) {
  // 授權門檻：GHA 排程（SYNC_TOKEN）或已登入使用者（手動更新按鈕）二擇一。
  const isAuthorized =
    authorizeSync(req) ||
    (async () => {
      try {
        return !!(await getCurrentUserFromCookies())
      } catch {
        return false
      }
    })()

  if (!(await isAuthorized)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // 用 Asia/Taipei 時區判斷今天是否交易日（避免伺服器時區 UTC 造成算錯）。
    // 排程可透過 ?date=YYYYMMDD 明確指定當日交易日。
    const now = new Date()
    const nowTw = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(now) // YYYY-MM-DD
    const todayTw = new Date(`${nowTw}T00:00:00`)
    const targetDate =
      normalizeDate(new URL(req.url).searchParams.get('date')) ??
      (isTaiwanMarketTradingDay(todayTw) ? toCompact(todayTw) : toCompact(getLastMarketTradingDay(todayTw)))

    const prev = lastRun.get(targetDate)
    if (prev && Date.now() - prev < THROTTLE_MS) {
      return NextResponse.json({
        success: true,
        throttled: true,
        oddLotCount: 0,
        industryCount: 0,
        giftCount: 0,
        targetDate,
        timestamp: new Date().toISOString(),
      })
    }

    await migrate()
    const oddLotCount = await fetchTwseOddLots(targetDate)

    // Issue #121：板塊（TWSE 官方產業別 + 非公司標的歸類）附掛同步。
    // 兩段各自 try/catch：任一失敗只 log、不阻斷零股寫入、不轉 500，industryCount 為兩者相加。
    let industryCount = 0
    try {
      industryCount = await fetchTwseIndustry() // 來源：t187ap03_L（上市公司產業別）
    } catch (e) {
      console.error('[API/odd-lot/refresh] industry sync (t187ap03_L) failed (ignored):', e)
    }
    try {
      industryCount += await backfillNonStockIndustries(targetDate) // 來源：odd_lot_trades 代號規則（ETF／債券 ETF／DR）
    } catch (e) {
      console.error('[API/odd-lot/refresh] industry backfill (non-stock codes) failed (ignored):', e)
    }

    const giftCount = await fetchStockGift()
    lastRun.set(targetDate, Date.now())
    revalidateTag('odd-lot')

    return NextResponse.json({
      success: true,
      throttled: false,
      oddLotCount,
      industryCount,
      giftCount,
      targetDate,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('[API/odd-lot/refresh] Failed:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to refresh data' },
      { status: 500 },
    )
  }
}
