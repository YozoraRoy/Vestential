import { NextResponse } from 'next/server'
import { registry } from '@stock/market-data'
import { runDcaBacktest } from '@stock/backtest'
import { resolveYahooSymbol } from '@/lib/portfolio'
import { isCoreEtf, getUniverseTier } from '@stock/cycle-entry'
import { getMarketLevelDashboardData } from '@/lib/market-level'
import { getBottomRadarDashboardData } from '@/lib/bottom-radar'
import { buildTodayDcaSignal } from '@/lib/dca-lab-format'

export const dynamic = 'force-dynamic'

function parseNum(v: string | null, fallback: number, min: number, max: number): number {
  if (v == null || v.trim() === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const rawSymbol = searchParams.get('symbol')?.trim() || '0050'
  const symbol = rawSymbol.toUpperCase()

  const monthlyAmount = parseNum(searchParams.get('monthlyAmount'), 10000, 1000, 1000000)
  const investDay = parseNum(searchParams.get('investDay'), 6, 1, 28)
  const thresholdPct = parseNum(searchParams.get('threshold'), -5, -30, 0)
  const multiplier = parseNum(searchParams.get('multiplier'), 1.5, 1.1, 3.0)
  const years = parseNum(searchParams.get('years'), 5, 1, 15)

  try {
    const provider = registry.get('yahoo-finance')
    const yahooSymbol = await resolveYahooSymbol(symbol, 'tw')
    const end = new Date()
    const start = new Date(end)
    start.setFullYear(start.getFullYear() - years)

    const history = await provider.getHistory(
      yahooSymbol,
      'TW',
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10),
    )

    if (history.length < 20) {
      return NextResponse.json({ error: '歷史資料不足，無法執行定期定額回測' }, { status: 422 })
    }

    // 1. 執行雙軌定期定額回測
    const dcaResult = runDcaBacktest({
      data: history,
      monthlyAmount,
      investDay,
      smartDipThresholdPct: thresholdPct,
      smartDipMultiplier: multiplier,
      smartDipMaxTimesPerMonth: 1,
    })

    // 2. 獲取大盤水位與落底雷達，生成「今日 ETF 加碼倍率訊號」
    let marketLevel = null
    let bottomRadar = null
    try {
      const [mlData, brData] = await Promise.all([
        getMarketLevelDashboardData().catch(() => null),
        getBottomRadarDashboardData().catch(() => null),
      ])
      marketLevel = mlData?.current ?? null
      bottomRadar = brData ?? null
    } catch (err) {
      console.warn('[DCA API] Market level data fetch warning:', err)
    }

    // 最新季線與乖離率
    const lastPoint = dcaResult.chartData[dcaResult.chartData.length - 1]
    const currentBiasPct = lastPoint?.biasPct ?? null
    const currentClose = lastPoint?.close ?? null
    const currentMa60 = lastPoint?.ma60 ?? null

    const marketLevelStatus = marketLevel?.levelStatus ?? 'fair'
    const isRadarTriggered = Boolean(
      bottomRadar?.checklist &&
      [
        bottomRadar.checklist.marginMet,
        bottomRadar.checklist.biasMet,
        bottomRadar.checklist.patternMet,
        bottomRadar.checklist.futuresMet,
        bottomRadar.checklist.fxMet,
      ].filter(Boolean).length >= 2,
    )
    const { action, multiplier: recommendedMultiplier, actionBadge, reason } = buildTodayDcaSignal({
      currentBiasPct,
      thresholdPct,
      marketLevelStatus,
      isRadarTriggered,
    })

    const tier = getUniverseTier(symbol)
    const isCore = isCoreEtf(symbol)

    return NextResponse.json({
      success: true,
      symbol,
      tier,
      isCoreEtf: isCore,
      assetMeta: {
        tradingDaysCount: history.length,
        isNewAsset: history.length < 250,
        currentClose,
        currentMa60,
        currentBiasPct,
      },
      todaySignal: {
        action,
        multiplier: recommendedMultiplier,
        actionBadge,
        reason,
        currentBiasPct,
        currentClose,
        marketLevelStatus: marketLevel?.levelStatus ?? 'fair',
        compositePercentile: marketLevel?.compositePercentile ?? null,
        isRadarTriggered,
      },
      dca: dcaResult,
      params: {
        monthlyAmount,
        investDay,
        thresholdPct,
        multiplier,
        years,
      },
    })
  } catch (error: any) {
    console.error('[DCA Backtest API error]:', error)
    return NextResponse.json(
      { error: error?.message || '定期定額回測計算失敗' },
      { status: 500 }
    )
  }
}
