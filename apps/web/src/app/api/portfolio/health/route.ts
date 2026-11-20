import { NextResponse } from 'next/server'
import { yahooFinanceProvider, type Fundamentals } from '@stock/market-data'
import { getPortfolioRecords, getPortfolioRecordsByGuest, getTwseDividendsByYear, migrate } from '@stock/database'
import { getCurrentUserFromCookies } from '../../../../lib/auth'
import { applyGuestCookie, getCurrentGuestFromCookies, newGuestUid } from '../../../../lib/guest'
import { withApiAudit } from '@/lib/api-audit'
import { taipeiTodayStr } from '../../../../lib/twse-calendar'
import { computeYieldBreakdown, yieldDataYears, type YieldHistoryEntry } from '../../../../lib/portfolio-yield'
import { resolveHoldingSector } from '../../../../lib/portfolio-risk'
import {
  evaluatePortfolioHealth,
  type HealthMarket,
  type HoldingHealthInput,
} from '../../../../lib/portfolio-health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function toFinite(n: unknown): number | null {
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) ? v : null
}

function cleanSymbol(symbol: string): string {
  return (symbol ?? '').trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
}

function hasAnyFundamentalData(f: Fundamentals): boolean {
  return (
    f.peRatio != null ||
    f.forwardPe != null ||
    f.priceToBook != null ||
    f.returnOnEquity != null ||
    f.freeCashflow != null ||
    f.operatingCashflow != null ||
    f.fiftyTwoWeekHigh != null ||
    f.marketCap != null
  )
}

async function fetchFundamentalsForHolding(
  symbol: string,
  market: HealthMarket,
): Promise<{ fundamentals: Fundamentals | null; sector: string | null; quoteType: string | null }> {
  const upper = symbol.trim().toUpperCase()
  const candidates =
    market === 'tw'
      ? /\.(TW|TWO)$/i.test(upper)
        ? [upper]
        : [`${upper}.TW`, `${upper}.TWO`]
      : [upper]

  let fundamentals: Fundamentals | null = null
  let yahooSector: string | null = null
  let quoteType: string | null = null
  let companyName: string | null = null

  for (const cand of candidates) {
    try {
      const [fRes, pRes] = await Promise.allSettled([
        yahooFinanceProvider.getFundamentals(cand, market === 'tw' ? 'TW' : 'US'),
        yahooFinanceProvider.getProfile(cand, market === 'tw' ? 'TW' : 'US'),
      ])
      const f = fRes.status === 'fulfilled' ? fRes.value : null
      const p = pRes.status === 'fulfilled' ? pRes.value : null

      if (p?.sector) yahooSector = p.sector
      if (p?.quoteType) quoteType = p.quoteType
      if (p?.name) companyName = p.name

      if (f && hasAnyFundamentalData(f)) {
        fundamentals = f
        if (!quoteType && f.quoteType) quoteType = f.quoteType
        break
      }
    } catch {
      // 單一候選失敗則試下一個
    }
  }

  const resolved = resolveHoldingSector({
    symbol,
    market,
    yahooSector,
    quoteType,
    companyName,
  })

  return {
    fundamentals,
    sector: resolved.sector,
    quoteType,
  }
}

/** 簡易限並發 map，避免一次打過多 Yahoo 請求觸發限流 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIdx = 0
  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++
      results[idx] = await fn(items[idx])
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

/**
 * GET /api/portfolio/health — 組合基本面健檢（純計算，零 LLM、不扣額度）。
 * - 與 /api/portfolio/risk 同口徑：支援登入用戶與 guest cookie，以每 (market, symbol) 最新一筆去重。
 * - 單一標的取數失敗不導致整包 500，降級為 insufficient。
 */
export async function GET(req: Request) {
  return withApiAudit(req, '/api/portfolio/health', () => handleGet())
}

async function handleGet() {
  try {
    await migrate()
    const user = await getCurrentUserFromCookies()
    let guestUid: string | null = null
    let createdGuest = false
    if (!user) {
      guestUid = await getCurrentGuestFromCookies()
      if (!guestUid) {
        guestUid = newGuestUid()
        createdGuest = true
      }
    }

    const records = user
      ? await getPortfolioRecords(user.id, 100)
      : await getPortfolioRecordsByGuest(guestUid as string, 100)

    const latest = new Map<string, (typeof records)[number]>()
    for (const r of records) {
      const m: HealthMarket = r.market === 'us' ? 'us' : 'tw'
      const sym = String(r.symbol ?? '').trim().toUpperCase()
      if (!sym) continue
      const key = `${m}:${sym}`
      if (!latest.has(key)) latest.set(key, r)
    }

    const uniqueRows = [...latest.values()]

    // 台股唯讀載入近 5 年 TWSE 股利資料（用於 5 年平均殖利率與配息年數）
    const twSymbols = new Set(
      uniqueRows
        .filter((r) => r.market !== 'us')
        .map((r) => cleanSymbol(String(r.symbol ?? ''))),
    )

    const today = taipeiTodayStr()
    const curYearStr = today.slice(0, 4)
    const yearsToRead = yieldDataYears(curYearStr)
    const dividendsBySymbol = new Map<string, YieldHistoryEntry[]>()

    if (twSymbols.size > 0) {
      const yearLists = await Promise.all(
        yearsToRead.map((y) => getTwseDividendsByYear(y).catch(() => [])),
      )
      for (const list of yearLists) {
        for (const row of list) {
          const sym = cleanSymbol(row.symbol)
          if (!twSymbols.has(sym)) continue
          const arr = dividendsBySymbol.get(sym) ?? []
          arr.push({
            symbol: sym,
            ex_date: row.ex_date,
            cash_dividend: row.cash_dividend,
            prev_close: row.prev_close ?? null,
          })
          dividendsBySymbol.set(sym, arr)
        }
      }
    }

    const healthInputs = await mapWithConcurrency(uniqueRows, 5, async (r): Promise<HoldingHealthInput> => {
      const market: HealthMarket = r.market === 'us' ? 'us' : 'tw'
      const symbol = String(r.symbol ?? '').trim().toUpperCase()
      const shares = toFinite(r.shares) ?? 0
      const cost = toFinite(r.cost) ?? 0
      const currentPrice = toFinite(r.current_price) ?? 0
      const costBasis = shares * cost
      const marketValue = shares * currentPrice
      const unrealizedPnlPct = costBasis > 0 ? ((marketValue - costBasis) / costBasis) * 100 : 0

      const { fundamentals, sector, quoteType } = await fetchFundamentalsForHolding(symbol, market)

      let twseAvgYield5y: number | null = null
      let twseDividendYears5y: number | null = null
      if (market === 'tw') {
        const clean = cleanSymbol(symbol)
        const entries = dividendsBySymbol.get(clean) ?? []
        if (entries.length > 0 && currentPrice > 0) {
          const breakdown = computeYieldBreakdown(clean, entries, today, currentPrice)
          if (breakdown.avg5.value != null) {
            twseAvgYield5y = Math.round(breakdown.avg5.value * 100) / 100
          }
          twseDividendYears5y = breakdown.avg5.years.filter((y) => y.count > 0).length
        }
      }

      return {
        market,
        symbol,
        symbolName: r.symbol_name ?? null,
        shares,
        cost,
        currentPrice,
        marketValue,
        unrealizedPnlPct,
        sector,
        twseAvgYield5y,
        twseDividendYears5y,
        fundamentals: fundamentals
          ? {
              ...fundamentals,
              quoteType: quoteType ?? fundamentals.quoteType,
            }
          : quoteType
            ? { quoteType }
            : null,
      }
    })

    const report = evaluatePortfolioHealth(healthInputs)
    const res = NextResponse.json({ success: true, ...report })
    if (createdGuest && guestUid) await applyGuestCookie(res, guestUid)
    return res
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : '基本面健檢載入失敗'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
