import { NextResponse } from 'next/server'
import { isLikelyEnglishStockName, resolveStockDisplayName, type StockMultilingualName } from '@stock/core'
import { resolveStockName } from '@stock/cycle-entry'
import { fetchBatchQuotes, yahooFinanceProvider } from '@stock/market-data'
import {
  ensureTwStockNamesSynced,
  getStockMultilingualNames,
  getTwseDividendsByYear,
  migrate,
  taipeiTodayStr,
  upsertStockNames,
} from '@stock/database'
import { buildAssetProfile, type PlanAssetProfile } from '@/lib/cashflow-plan'
import { syncFinMindDividendsForSymbols } from '@/lib/finmind-dividends'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORE_PLAN_SYMBOLS = ['0050', '0056', '00878', '00919', '00891', '00713', '00918'] as const
const DEFAULT_FALLBACK_NAMES: Record<string, string> = {
  '0050': '元大台灣50',
  '0056': '元大高股息',
  '00878': '國泰永續高股息',
  '00919': '群益台灣精選高息',
  '00891': '中信關鍵半導體',
  '00713': '元大台灣高息低波',
  '00918': '大華優利高填息30',
}

const CACHE_TTL_MS = 10 * 60 * 1000
let memCache: { expiresAt: number; today: string; profiles: Record<string, PlanAssetProfile> } | null = null

export async function GET() {
  try {
    const today = taipeiTodayStr()
    if (memCache && memCache.today === today && memCache.expiresAt > Date.now()) {
      return NextResponse.json({ success: true, today, cached: true, profiles: memCache.profiles })
    }

    await migrate()
    await ensureTwStockNamesSynced().catch(() => 0)
    const currentYear = Number(today.slice(0, 4))
    const years = [String(currentYear - 1), String(currentYear)]

    const loadAllRows = async () => {
      const out: Array<{ symbol: string; ex_date: string; cash_dividend: number; pay_date?: string | null }> = []
      for (const y of years) {
        const list = await getTwseDividendsByYear(y).catch(() => [])
        for (const r of list) {
          if (CORE_PLAN_SYMBOLS.includes(r.symbol.toUpperCase() as (typeof CORE_PLAN_SYMBOLS)[number])) {
            out.push(r)
          }
        }
      }
      return out
    }

    let rows = await loadAllRows()
    const written = await syncFinMindDividendsForSymbols([...CORE_PLAN_SYMBOLS], rows, today).catch(() => 0)
    if (written > 0) {
      rows = await loadAllRows()
    }

    // 抓取最新報價
    const priceMap = new Map<string, { price: number; name?: string }>()
    try {
      const batch = await fetchBatchQuotes(CORE_PLAN_SYMBOLS.map((s) => `${s}.TW`))
      for (const b of batch) {
        const sym = (b.symbol ?? '').toUpperCase().replace(/\.(TW|TWO)$/i, '')
        if (b.price && b.price > 0) {
          priceMap.set(sym, { price: b.price, name: b.name })
        }
      }
    } catch {}

    // 單檔補抓缺漏報價
    await Promise.all(
      CORE_PLAN_SYMBOLS.map(async (sym) => {
        if (priceMap.has(sym)) return
        try {
          const q = await yahooFinanceProvider.getQuote(`${sym}.TW`, 'TW')
          if (q.price > 0) priceMap.set(sym, { price: q.price })
        } catch {}
      }),
    )

    const dbNamesMap = await getStockMultilingualNames([...CORE_PLAN_SYMBOLS]).catch(
      () => ({}) as Awaited<ReturnType<typeof getStockMultilingualNames>>,
    )
    const toUpsert: Array<{ symbol: string; nameZh?: string | null; nameEn?: string | null; market: 'TW'; source: string }> = []
    const profiles: Record<string, PlanAssetProfile> = {}

    for (const sym of CORE_PLAN_SYMBOLS) {
      const dbNames = dbNamesMap[sym]
      const qInfo = priceMap.get(sym)
      const qEn = qInfo?.name && isLikelyEnglishStockName(qInfo.name) ? qInfo.name : null
      const fallbackZh = resolveStockName(sym)
      const nameZh = dbNames?.nameZh || (fallbackZh !== sym ? fallbackZh : null) || DEFAULT_FALLBACK_NAMES[sym] || null
      const nameEn = dbNames?.nameEn || qEn || null
      const names: StockMultilingualName = {
        nameZh,
        nameEn,
        nameJa: dbNames?.nameJa ?? null,
        market: 'TW',
      }
      if ((nameZh && !dbNames?.nameZh) || (nameEn && !dbNames?.nameEn)) {
        toUpsert.push({ symbol: sym, nameZh, nameEn, market: 'TW', source: 'cashflow_presets' })
      }
      const name = resolveStockDisplayName(sym, names, 'zh-TW')
      const price = qInfo?.price ?? 0
      const symRows = rows.filter((r) => r.symbol.toUpperCase() === sym)
      profiles[sym] = buildAssetProfile({
        symbol: sym,
        name,
        names,
        price,
        rawDividends: symRows,
        today,
      })
    }

    if (toUpsert.length > 0) {
      await upsertStockNames(toUpsert).catch(() => 0)
    }

    memCache = { expiresAt: Date.now() + CACHE_TTL_MS, today, profiles }
    return NextResponse.json({ success: true, today, cached: false, profiles })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'cashflow presets failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
