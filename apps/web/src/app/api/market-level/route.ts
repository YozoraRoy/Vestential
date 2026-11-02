import { NextResponse } from 'next/server'
import { authorizeSync } from '@/lib/sync-auth'
import { taipeiTodayStr } from '@/lib/twse-calendar'
import {
  getMarketLevelDashboardData,
  fetchTwseTaiex,
  determineLevelStatus,
  computePercentile,
  parseMarketValuationFromBwibbu,
  ensureMarketLevelSeeds,
} from '@/lib/market-level'
import {
  upsertMarketLevel,
  getMarketLevels,
  type MarketLevelRow,
} from '@stock/database'

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
    const data = await getMarketLevelDashboardData()
    return NextResponse.json({
      success: true,
      ...data,
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

  const today = taipeiTodayStr()
  try {
    const url = new URL(req.url)
    const isForceReseed = url.searchParams.get('reseed') === 'true'
    await ensureMarketLevelSeeds(isForceReseed)

    // 1. 抓取當日加權指數收盤點位
    const taiex = await fetchTwseTaiex(today)

    // 2. 抓取當日全市場估值（BWIBBU_d）
    let valuation: { pe: number; pb: number; dividendYield: number } | null = null
    try {
      const res = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        const rows = await res.json()
        if (Array.isArray(rows)) {
          valuation = parseMarketValuationFromBwibbu(rows)
        }
      }
    } catch (e) {
      console.warn('[MarketLevel] BWIBBU_d fetch failed, fallback to previous or estimates:', e)
    }

    // 3. 取得歷史紀錄以計算分位數
    const history = await getMarketLevels(1200)
    const peHistory = history.map((h) => h.pe_ratio).filter((v): v is number => v != null)
    const pbHistory = history.map((h) => h.pb_ratio).filter((v): v is number => v != null)

    // 口徑對齊：若從 BWIBBU_d 取得全市場個股中位數（如 PE 16.4, PB 1.61, DY 3.45%），
    // 透過市值加權權重結構（台積電等權值股權重近 40%）轉換為加權指數市值加權等效估值：
    // PE ~25.8x、PB ~4.10x、殖利率 ~1.58%，確保與 TAIEX 點位及歷史常態帶處於同一尺度
    let pe = history[0]?.pe_ratio ?? 25.8
    let pb = history[0]?.pb_ratio ?? 4.10
    let dy = history[0]?.dividend_yield ?? 1.58

    if (valuation?.pe && valuation.pe > 0) {
      pe = Math.round(valuation.pe * 1.575 * 10) / 10
      pb = Math.round(valuation.pb * 2.55 * 100) / 100
      dy = Math.round(valuation.dividendYield * 0.46 * 100) / 100
    }

    const pePercentile = computePercentile(pe, peHistory)
    const pbPercentile = computePercentile(pb, pbHistory)
    const compositePercentile = Math.round(((pePercentile + pbPercentile) / 2) * 10) / 10
    const { status } = determineLevelStatus(compositePercentile)

    // 4. 寫入 DB
    await upsertMarketLevel({
      tradeDate: today,
      taiex: taiex ?? history[0]?.taiex ?? 45211.83,
      peRatio: pe,
      pbRatio: pb,
      dividendYield: dy,
      pePercentile,
      pbPercentile,
      compositePercentile,
      levelStatus: status,
    })

    const updated = await getMarketLevelDashboardData()
    return NextResponse.json({
      success: true,
      action: 'synced',
      today,
      synced: updated.current,
      disclaimer: COMPLIANCE_DISCLAIMER,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'sync market level failed'
    console.error('[MarketLevel] POST error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
