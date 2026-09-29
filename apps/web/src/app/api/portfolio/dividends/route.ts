import { NextResponse } from 'next/server'
import { getTwseDividendsByYear, migrate } from '@stock/database'
import { taipeiTodayStr } from '../../../../lib/twse-calendar'
import { getDividendsCacheInfo } from '../../../../lib/twse-dividends'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Issue #35：除息快取讀取（唯讀，不觸發抓取；抓取由同步鈕／16:00 排程順帶做）。
 * #44：支援多年度（5 年殖利率）：`years=2022,2023,2024,2025,2026`（預設當年，
 * 舊 `year=` 單年參數沿用相容）；回傳 coverage（分年筆數＋缺年標記，供 UI
 * 「年份不全」註記；缺年回填由同步鈕／排程順帶做，此處唯讀不觸發）。
 * GET /api/portfolio/dividends?symbols=2002,2330&year=2026
 * 回傳 { success, year, today, dividends[{symbol,ex_date,cash_dividend}],
 *         coverage[{year,rows,missing}], cacheAsOf, isTradingDay, reason }。
 * reason（無檔原因，UI 顯示非空白）：'non-trading-day'（今日非交易日）|
 *   'cache-pending'（今日快取尚未同步）| 'empty-file'（今日 TWSE 無除息公告）| null（正常）。
 */
export async function GET(req: Request) {
  try {
    await migrate()
    const url = new URL(req.url)
    const today = taipeiTodayStr()
    const singleYear = url.searchParams.get('year') ?? ''
    const yearsParam = (url.searchParams.get('years') ?? '').trim()
    // #44：years CSV 優先（5 年窗）；否則沿用單 year（預設當年，相容舊呼叫）。
    const years = yearsParam
      ? [...new Set(yearsParam.split(',').map((s) => s.trim()).filter((s) => /^\d{4}$/.test(s)))].slice(0, 6)
      : [(/^\d{4}$/.test(singleYear) ? singleYear : today.slice(0, 4))]
    const year = years[years.length - 1] ?? today.slice(0, 4)
    const symbolsParam = (url.searchParams.get('symbols') ?? '').trim().toUpperCase()
    const wanted = new Set(
      symbolsParam.split(',').map((s) => s.trim()).filter(Boolean),
    )

    const all: Array<{ symbol: string; ex_date: string; cash_dividend: number }> = []
    const coverage: Array<{ year: string; rows: number; missing: boolean }> = []
    for (const y of years) {
      const list = await getTwseDividendsByYear(y)
      coverage.push({ year: y, rows: list.length, missing: list.length === 0 })
      for (const r of list) {
        if (wanted.size > 0 && !wanted.has(r.symbol.toUpperCase())) continue
        all.push({ symbol: r.symbol, ex_date: r.ex_date, cash_dividend: r.cash_dividend })
      }
    }
    const dividends = all

    const { cacheAsOf, isTradingDay } = await getDividendsCacheInfo(today)
    let reason: string | null = null
    if (!isTradingDay) reason = 'non-trading-day'
    else if (cacheAsOf !== today) reason = 'cache-pending'
    else if (dividends.length === 0) reason = 'empty-file'

    return NextResponse.json({
      success: true,
      year,
      years,
      today,
      dividends,
      coverage,
      cacheAsOf,
      isTradingDay,
      reason,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'dividends read failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
