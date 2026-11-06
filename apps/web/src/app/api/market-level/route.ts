import { NextResponse } from 'next/server'
import { authorizeSync } from '@/lib/sync-auth'
import {
  getMarketLevelDashboardData,
  syncMarketLevel,
} from '@/lib/market-level'
import { getBottomRadarDashboardData } from '@/lib/bottom-radar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COMPLIANCE_DISCLAIMER =
  '【合規警語與免責聲明】本大盤水位儀表板僅呈現臺灣證券交易所公布之全市場客觀統計數據與歷史分位推算，' +
  '不代表任何證券投資諮詢、買賣推介、目標價預測或獲利保證。市場處於歷史高檔或低檔時估值指標可能長期鈍化，' +
  '投資人應依自身財務狀況與風險承受度獨立判斷並自負盈虧。'

/**
 * Issue #74 大盤水位儀表板 API
 *
 * GET /api/market-level:
 * 查詢當日水位分析、歷史分位、五段燈號與河流圖帶狀歷史
 */
export async function GET() {
  try {
    const [data, bottomRadar] = await Promise.all([
      getMarketLevelDashboardData(),
      getBottomRadarDashboardData().catch((err) => {
        console.warn('[MarketLevel] getBottomRadarDashboardData error:', err)
        return null
      }),
    ])
    return NextResponse.json({
      success: true,
      ...data,
      bottomRadar,
      disclaimer: COMPLIANCE_DISCLAIMER,
      timestamp: new Date().toISOString(),
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'failed to fetch market levels'
    console.error('[MarketLevel] GET error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/**
 * POST /api/market-level:
 * 管理端觸發當日大盤水位資料抓取與歷史分位運算（Bearer SYNC_TOKEN）
 */
export async function POST(req: Request) {
  if (!authorizeSync(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const url = new URL(req.url)
    const isForceReseed = url.searchParams.get('reseed') === 'true'
    const result = await syncMarketLevel({ forceReseed: isForceReseed })

    return NextResponse.json({
      success: true,
      action: 'synced',
      today: result.today,
      synced: result.updated.current,
      bottomRadar: result.bottomRadar,
      disclaimer: COMPLIANCE_DISCLAIMER,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'sync market level failed'
    console.error('[MarketLevel] POST error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
