import { NextResponse } from 'next/server'
import { registry } from '@stock/market-data'
import { runGridSearch } from '@stock/backtest'
import { resolveYahooSymbol } from '@/lib/portfolio'
import { isCoreEtf } from '@stock/cycle-entry'

/** 一個交易年約多少交易日。 */
const TRADING_DAYS_PER_YEAR = 250

export const dynamic = 'force-dynamic'

function parseNum(v: string | null, fallback: number, min: number, max: number): number {
  if (v == null || v.trim() === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function checkIsEtf(symbol: string): boolean {
  const clean = symbol.trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
  return isCoreEtf(symbol) || clean.startsWith('00')
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol')?.trim()
  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })
  }

  const isEtf = checkIsEtf(symbol)
  // 原型 ETF 波動較平穩，預設停利採 10%；個股預設 25%
  const defaultTarget = isEtf ? 10 : 25

  const holdingDays = parseNum(searchParams.get('holdingDays'), 252, 1, 252)
  const targetPct = parseNum(searchParams.get('target'), defaultTarget, 1, 100)
  const stopPct = parseNum(searchParams.get('stop'), 12, 1, 100)
  const years = parseNum(searchParams.get('years'), 15, 1, 15)

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
      return NextResponse.json({ error: '資料不足，無法執行回測' }, { status: 422 })
    }

    // 計算新上市標的中繼資料（供「🌱 新掛牌 ETF 觀察卡」顯示）
    const firstBar = history[0]
    const latestBar = history[history.length - 1]
    const tradingDaysCount = history.length
    const isNewAsset = tradingDaysCount < TRADING_DAYS_PER_YEAR // 上市未滿 1 年
    const firstClose = firstBar?.close ?? null
    const latestClose = latestBar?.close ?? null
    const changeFromFirstPct =
      firstClose != null && latestClose != null && firstClose > 0
        ? ((latestClose - firstClose) / firstClose) * 100
        : null

    const assetMeta = {
      isEtf,
      isNewAsset,
      tradingDaysCount,
      firstDate: firstBar?.timestamp ?? null,
      firstClose,
      latestClose,
      changeFromFirstPct,
    }

    if (history.length < 61) {
      // 滿 20 日但未滿 61 日（無法計算 60MA 季線回測）：以資產中繼資料回傳空回測
      return NextResponse.json(
        {
          bestThreshold: 0,
          totalTrades: 0,
          winRate: null,
          avgDaysToTarget: null,
          wins: 0,
          losses: 0,
          neutral: 0,
          belowTarget: false,
          allThresholds: [],
          series: history.map((b) => ({
            date: b.timestamp,
            close: b.close,
            ma60: null,
            bias: null,
            trigger: false,
          })),
          usage: { startDate: start.getTime(), endDate: end.getTime(), dataPoints: history.length, entryThresholdPct: 0, holdingDays, targetPct, stopPct, years },
          assetMeta,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    // 依據標的實際有效交易天數與持有天數，動態計算合理的最低採樣筆數（minTrades）
    // 避免新上市標的（如 IPO 僅 1~2 年）因理論上限僅 1~2 筆而導致全部閾值被過濾為 0。
    const effectiveDays = Math.min(years * TRADING_DAYS_PER_YEAR, Math.max(1, history.length - 60))
    const maxTheoreticalTrades = Math.max(1, Math.floor(effectiveDays / holdingDays))
    // 若上市未滿 2 年，minTrades 允許降至 1，讓新 ETF 能看到哪怕 1 次關鍵歷史觸發
    const minTradesLowerBound = isNewAsset ? 1 : 2
    const minTrades = Math.min(10, Math.max(minTradesLowerBound, Math.floor(maxTheoreticalTrades * 0.25)))

    const result = runGridSearch(history, {
      minTrades,
      params: {
        holdingDays,
        targetProfit: targetPct / 100,
        maxDrawdown: stopPct / 100,
      },
    })

    // 圖表序列長度隨所選年數調整（勝率回測亦以該年數為準）。
    const chartLookback = years * TRADING_DAYS_PER_YEAR
    return NextResponse.json(
      {
        ...result,
        series: result.series.slice(-chartLookback),
        usage: { ...result.usage, holdingDays, targetPct, stopPct, years },
        assetMeta,
      },
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? '回測失敗' }, { status: 500 })
  }
}
