import { NextResponse } from 'next/server'
import { migrate, fetchTwseOddLots, fetchStockGift } from '@stock/database'
import { getLastMarketTradingDay, isTaiwanMarketTradingDay } from '@/utils/taiwan-calendar'

function formatDateCompact(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const key = searchParams.get('key')
  const secret = process.env.CRON_SECRET || 'stock123'

  if (process.env.CRON_SECRET && key !== secret) {
    return NextResponse.json({ success: false, error: 'Unauthorized: Invalid cron key' }, { status: 401 })
  }

  try {
    await migrate()
    console.log('[API/Cron/Seed] Starting TWSE odd lots seed...')
    // Issue #65：fetcher 已改用帶日期端點 (TWT53U?date=YYYYMMDD)，每筆 date 恆等於
    // 其 TWSE 真實交易日；休市日回 stat !== 'OK' 時不寫入。此處仍以「最近開市日」
    // 作為預設目標，避免在休市日當天觸發無意義抓取。
    // 用 Asia/Taipei 判斷今天是否交易日（Azure 伺服器時區為 UTC，直接 new Date() 會算錯）。
    const nowTw = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
    const todayTw = new Date(`${nowTw}T00:00:00`)
    const targetDate = isTaiwanMarketTradingDay(todayTw) ? todayTw : getLastMarketTradingDay(todayTw)
    const dateStr = formatDateCompact(targetDate)
    const oddLotCount = await fetchTwseOddLots(dateStr)

    console.log('[API/Cron/Seed] Starting shareholder gifts seed...')
    const giftCount = await fetchStockGift()

    return NextResponse.json({
      success: true,
      message: 'Daily seed executed successfully',
      timestamp: new Date().toISOString(),
      results: {
        oddLotCount,
        giftCount,
      },
    })
  } catch (error: any) {
    console.error('[API/Cron/Seed] Failed to run cron seed:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to execute seed cron',
      },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  return GET(req)
}
