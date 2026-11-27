import { NextResponse } from 'next/server'
import { yahooFinanceProvider } from '@stock/market-data'
import { dbQueryAll, getTwseDividendsInWindow } from '@stock/database'
import { computeEtfMetrics } from '../../../../lib/etf-metrics'
import { isTaiwanSymbol, normalizeTaiwanSymbol } from '../../../../lib/taiwan-symbol'
import { taipeiTodayStr } from '../../../../lib/twse-calendar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * GET /api/analyze/etf-metrics?symbol=0050
 * 唯讀取得 ETF Phase 1 定量指標（季線/年線乖離、波動度、MDD、流動性、近1年配息），不消耗 LLM quota。
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const rawSymbol = (searchParams.get('symbol') ?? '').trim().toUpperCase()
    if (!rawSymbol) {
      return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })
    }

    const isTw = isTaiwanSymbol(rawSymbol)
    const plainSymbol = isTw
      ? normalizeTaiwanSymbol(rawSymbol).replace(/\.(TW|TWO)$/i, '')
      : rawSymbol
    const yahooCandidates = isTw
      ? /\.(TW|TWO)$/i.test(rawSymbol)
        ? [rawSymbol]
        : [`${plainSymbol}.TW`, `${plainSymbol}.TWO`]
      : [rawSymbol]

    const today = taipeiTodayStr()
    const startDate = addDays(today, -400) // 取 ~400 日確保 >= 240 個交易日

    let historyBars: Array<{ close: number; volume?: number | null }> = []
    let profileName: string | null = null

    for (const candidate of yahooCandidates) {
      try {
        const hist = await yahooFinanceProvider.getHistory(
          candidate,
          isTw ? 'TW' : 'US',
          startDate,
          today,
        )
        if (hist && hist.length > 0) {
          historyBars = hist.map((b) => ({ close: b.close, volume: b.volume }))
          const prof = await yahooFinanceProvider
            .getProfile(candidate, isTw ? 'TW' : 'US')
            .catch(() => null)
          profileName = prof?.name ?? null
          break
        }
      } catch {
        // 試下一個候選代號
      }
    }

    let industryName: string | null = null
    let dividendCash1y: number | null = null
    let dividendCount1y: number | null = null

    if (isTw) {
      const industryRows = await dbQueryAll<{ industry_name: string | null }>(
        'SELECT industry_name FROM stock_industry WHERE stock_id = @id',
        { id: plainSymbol },
      ).catch(() => [])
      industryName = industryRows[0]?.industry_name ?? null

      const divStart = addDays(today, -365)
      const divRows = await getTwseDividendsInWindow([plainSymbol], divStart, today).catch(
        () => [],
      )
      if (divRows.length > 0) {
        const cashSum = divRows.reduce((s, d) => s + (Number(d.cash_dividend) || 0), 0)
        if (cashSum > 0) {
          dividendCash1y = cashSum
          dividendCount1y = divRows.length
        }
      }
    }

    const report = computeEtfMetrics({
      symbol: plainSymbol,
      name: profileName,
      industryName,
      bars: historyBars,
      dividendCash1y,
      dividendCount1y,
    })

    return NextResponse.json(report)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'ETF metrics failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
