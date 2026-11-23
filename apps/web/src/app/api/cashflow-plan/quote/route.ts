import { NextResponse, type NextRequest } from 'next/server'
import { isLikelyEnglishStockName, isTwStockSymbol, resolveStockDisplayName, type StockMultilingualName } from '@stock/core'
import { resolveStockName } from '@stock/cycle-entry'
import { fetchBatchQuotes, yahooFinanceProvider } from '@stock/market-data'
import {
  ensureTwStockNamesSynced,
  getStockMultilingualName,
  getTwseDividendsByYear,
  migrate,
  taipeiTodayStr,
  upsertStockNames,
} from '@stock/database'
import { buildAssetProfile } from '@/lib/cashflow-plan'
import { syncFinMindDividendsForSymbols } from '@/lib/finmind-dividends'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const raw = (new URL(req.url).searchParams.get('symbol') ?? '').trim().toUpperCase()
    const clean = raw.replace(/\.(TW|TWO)$/i, '')
    if (!clean || !/^[A-Z0-9]{2,10}$/.test(clean)) {
      return NextResponse.json({ success: false, error: '請輸入有效台股代號' }, { status: 400 })
    }

    await migrate()
    await ensureTwStockNamesSynced().catch(() => 0)
    const today = taipeiTodayStr()
    const currentYear = Number(today.slice(0, 4))

    // 取報價與 Yahoo 名稱（先 .TW，失敗試 .TWO）
    let price = 0
    let yahooName: string | null = null
    try {
      const batch = await fetchBatchQuotes([`${clean}.TW`, `${clean}.TWO`])
      const hit = batch.find((b) => b.price && b.price > 0)
      if (hit && hit.price) {
        price = hit.price
        yahooName = hit.name || null
      }
    } catch {}
    if (price <= 0) {
      for (const ticker of [`${clean}.TW`, `${clean}.TWO`]) {
        try {
          const q = await yahooFinanceProvider.getQuote(ticker, 'TW')
          if (q.price > 0) {
            price = q.price
            break
          }
        } catch {}
      }
    }

    if (price <= 0) {
      return NextResponse.json({ success: false, error: `查無 ${clean} 之最新報價` }, { status: 404 })
    }

    const loadRows = async () => {
      const rows: Array<{ symbol: string; ex_date: string; cash_dividend: number; pay_date?: string | null }> = []
      for (const y of [String(currentYear - 1), String(currentYear)]) {
        const list = await getTwseDividendsByYear(y).catch(() => [])
        for (const r of list) {
          if (r.symbol.toUpperCase() === clean) rows.push(r)
        }
      }
      return rows
    }

    let rows = await loadRows()
    const written = await syncFinMindDividendsForSymbols([clean], rows, today).catch(() => 0)
    if (written > 0) rows = await loadRows()

    const dbNames = await getStockMultilingualName(clean).catch(() => null)
    const fallbackZh = resolveStockName(clean)
    const qEn = yahooName && isLikelyEnglishStockName(yahooName) ? yahooName : null
    const qZh = yahooName && !isLikelyEnglishStockName(yahooName) ? yahooName : null
    const nameZh = dbNames?.nameZh || (fallbackZh !== clean ? fallbackZh : null) || qZh || null
    const nameEn = dbNames?.nameEn || qEn || null
    const market = isTwStockSymbol(clean, dbNames?.market) ? 'TW' : 'US'
    const names: StockMultilingualName = {
      nameZh,
      nameEn,
      nameJa: dbNames?.nameJa ?? null,
      market,
    }
    if ((nameZh && !dbNames?.nameZh) || (nameEn && !dbNames?.nameEn)) {
      await upsertStockNames([{ symbol: clean, nameZh, nameEn, market, source: 'cashflow_quote' }]).catch(() => 0)
    }
    const name = resolveStockDisplayName(clean, names, 'zh-TW')
    const profile = buildAssetProfile({
      symbol: clean,
      name,
      names,
      price,
      rawDividends: rows,
      today,
    })

    return NextResponse.json({ success: true, profile })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'cashflow quote failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
