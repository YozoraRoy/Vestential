import { yahooFinanceProvider } from '@stock/market-data'
import { getPortfolioRecords, getPortfolioRecordsByGuest } from '@stock/database'
import {
  computeConcentration,
  computeStress,
  resolveHoldingSector,
  UNCATEGORIZED_SECTOR,
  type ExcludedHolding,
  type RiskHoldingInput,
  type RiskMarket,
  type StressScenarioResult,
  type WeightRow,
  type SectorSlice,
} from './portfolio-risk'

function toFinite(n: unknown): number | null {
  const v = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(v) ? v : null
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sector lookup timeout')), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

/** fetchYahooProfile 回傳的精簡結果（產業解析只需要這三欄）。 */
interface YahooProfileLite {
  sector: string | null
  quoteType: string | null
  name: string | null
}

/**
 * Issue #105：取 Yahoo profile（`v1/finance/search`，sector 已 zh-TW 中文化）。
 * - 台股候選維持原規則：`2330` → `2330.TW` → `2330.TWO`。
 * - **不再**於 sector 為空時用 `industry` 頂替（英文 industry 會混進中文產業欄；industry 只留在
 *   data 層的 `CompanyProfile.industry`）。ETF 這類無 sector 的標的改用 `quoteType` 判別。
 * - 單檔上限 4 秒（維持原逾時）；失敗／逾時回 null 由呼叫端降級（fallback → 未分類）。
 */
async function fetchYahooProfile(symbol: string, market: RiskMarket): Promise<YahooProfileLite | null> {
  const upper = symbol.trim().toUpperCase()
  const candidates = market === 'tw'
    ? (/\.(TW|TWO)$/i.test(upper) ? [upper] : [`${upper}.TW`, `${upper}.TWO`])
    : [upper]
  for (const c of candidates) {
    try {
      const profile = await withTimeout(
        yahooFinanceProvider.getProfile(c, market === 'tw' ? 'TW' : 'US'),
        4000,
      )
      const sector = (profile?.sector ?? '').trim()
      const quoteType = (profile?.quoteType ?? '').trim()
      // 命中判準：有 sector 或 quoteType 才算這個候選對到標的（search 端點無精確比對時兩者皆空）；
      // 兩者皆空 → 換下一個候選（例：00687B.TW 查無 → 00687B.TWO 命中 ETF）。
      if (sector || quoteType) {
        return { sector: sector || null, quoteType: quoteType || null, name: profile?.name ?? null }
      }
    } catch {
      // 試下一個候選；全滅則回 null
    }
  }
  return null
}

export interface RiskGroupSnapshot {
  market: RiskMarket
  totalMarketValue: number
  includedCount: number
  weights: WeightRow[]
  top1Pct: number
  top3Pct: number
  weightSumPct: number
  sectors: SectorSlice[]
  sectorWeightSumPct: number
  scenarios: StressScenarioResult[]
}

export interface RiskSnapshot {
  asOf: string
  holdingsCount: number
  sectorSource: 'yahoo' | 'fallback' | 'mixed' | 'none'
  groups: RiskGroupSnapshot[]
  /** 頂層不納入試算者（各組 concentration.excluded 合併；Issue #26 crash 根因修）。 */
  excluded: ExcludedHolding[]
}

/**
 * 組合風險快照（records → 最新去重 → 產業解析 → 集中度＋壓力試算）。
 * 純計算，零 LLM；供 GET /api/portfolio/risk 與 POST /risk/summary 共用。
 */
export async function loadRiskSnapshot(
  fetcher: (limit: number) => Promise<Array<{
    market: string
    symbol: string
    symbol_name?: string | null
    shares?: unknown
    current_price?: unknown
  }>>,
): Promise<RiskSnapshot> {
  const records = await fetcher(100)

  const latest = new Map<string, (typeof records)[number]>()
  for (const r of records) {
    const m = r.market === 'us' ? 'us' : 'tw'
    const key = `${m}:${String(r.symbol ?? '').trim().toUpperCase()}`
    if (!latest.has(key)) latest.set(key, r)
  }

  const base = [...latest.values()].map((r) => {
    const market: RiskMarket = r.market === 'us' ? 'us' : 'tw'
    const symbol = String(r.symbol ?? '').trim().toUpperCase()
    const shares = toFinite(r.shares)
    const price = toFinite(r.current_price)
    const marketValue = shares != null && price != null ? shares * price : NaN
    return { market, symbol, symbolName: r.symbol_name ?? null, marketValue }
  }).filter((h) => h.symbol)

  const holdings: RiskHoldingInput[] = await Promise.all(
    base.map(async (h) => {
      if (!Number.isFinite(h.marketValue) || h.marketValue <= 0) {
        return { ...h, sector: null, sectorSource: 'none' as const }
      }
      const yahoo = await fetchYahooProfile(h.symbol, h.market)
      // Issue #105 優先序：Yahoo sector（中文）→ ETF 歸類 → FALLBACK_SECTOR_MAP → 未分類。
      const resolved = resolveHoldingSector({
        symbol: h.symbol,
        market: h.market,
        yahooSector: yahoo?.sector,
        quoteType: yahoo?.quoteType,
        companyName: yahoo?.name,
      })
      return { ...h, sector: resolved.sector, sectorSource: resolved.sectorSource }
    }),
  )

  const concentrations = (['tw', 'us'] as RiskMarket[]).map((market) =>
    computeConcentration(holdings.filter((h) => h.market === market)),
  )
  const groups: RiskGroupSnapshot[] = (['tw', 'us'] as RiskMarket[]).map((market, i) => {
    const concentration = concentrations[i]
    return {
      market,
      totalMarketValue: concentration.totalMarketValue,
      includedCount: concentration.includedCount,
      weights: concentration.weights,
      top1Pct: concentration.top1Pct,
      top3Pct: concentration.top3Pct,
      weightSumPct: concentration.weightSumPct,
      sectors: concentration.sectors,
      sectorWeightSumPct: concentration.sectorWeightSumPct,
      scenarios: computeStress(concentration),
    }
  })

  const sectorSources = new Set(holdings.map((h) => h.sectorSource))
  const sectorSource: RiskSnapshot['sectorSource'] = sectorSources.size > 1
    ? 'mixed'
    : ([...sectorSources][0] as RiskSnapshot['sectorSource'] | undefined) ?? 'none'

  return {
    asOf: new Date().toISOString(),
    holdingsCount: groups.reduce((s, g) => s + g.includedCount, 0),
    sectorSource,
    groups,
    excluded: concentrations.flatMap((c) => c.excluded),
  }
}

export { UNCATEGORIZED_SECTOR }
