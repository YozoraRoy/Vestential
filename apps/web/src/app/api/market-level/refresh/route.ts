import { NextResponse } from 'next/server'
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

// ── 頻率限制：同一目標交易日 60 秒內不重複對外呼叫 TWSE ──
const THROTTLE_MS = 60 * 1000
let lastRefreshTime = 0

/**
 * POST /api/market-level/refresh
 * 提供前端大盤水位儀表板「手動更新」按鈕呼叫：
 * 立即同步加權指數收盤點位、BWIBBU 估值分位與落底指標，並帶 60 秒防刷節流。
 */
export async function POST() {
  const now = Date.now()
  if (now - lastRefreshTime < THROTTLE_MS) {
    const [data, bottomRadar] = await Promise.all([
      getMarketLevelDashboardData(),
      getBottomRadarDashboardData().catch(() => null),
    ])
    return NextResponse.json({
      success: true,
      throttled: true,
      message: '資料已是最新（60 秒內剛同步過）',
      current: data.current,
      history: data.history,
      bottomRadar,
      disclaimer: COMPLIANCE_DISCLAIMER,
      timestamp: new Date().toISOString(),
    })
  }

  try {
    const result = await syncMarketLevel()
    lastRefreshTime = Date.now()
    return NextResponse.json({
      success: true,
      throttled: false,
      message: `已成功同步最新大盤水位與落底指標（${result.today}）`,
      current: result.updated.current,
      history: result.updated.history,
      bottomRadar: result.bottomRadar,
      today: result.today,
      disclaimer: COMPLIANCE_DISCLAIMER,
      timestamp: new Date().toISOString(),
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : '手動同步大盤水位失敗'
    console.error('[MarketLevel/refresh] POST error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
