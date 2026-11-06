import { NextResponse } from 'next/server'
import {
  CORE_ETF_UNIVERSE,
  TOP_50_STOCKS_UNIVERSE,
  TOP_51_100_STOCKS_UNIVERSE,
  getUniverseTier,
} from '@stock/cycle-entry'

export const dynamic = 'force-dynamic'

export interface TopVolumeItem {
  rank: number
  symbol: string
  name: string
  volume: number
  value?: number
  price?: number
  category?: 'etf' | 'stocks'
  tier?: string
}

type Range = 'day' | 'week' | 'month' | 'quarter'
type Category = 'etf' | 'stocks'

/** 各範圍約需抓取的交易日數（跳過週末/假日，實際可能略少）。 */
const RANGE_DAYS: Record<Range, number> = {
  day: 1,
  week: 5,
  month: 22,
  quarter: 66,
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'

// 服務端 TTL 快取
const cache = new Map<string, { at: number; json: TopVolumeItem[] }>()
const TTL_MS: Record<Range, number> = {
  day: 5 * 60 * 1000,
  week: 30 * 60 * 1000,
  month: 30 * 60 * 1000,
  quarter: 30 * 60 * 1000,
}

function parseNum(v: string | undefined): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function cleanCode(code: string): string {
  return code.trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
}

// 建立核心原型 ETF 與 Top 100 白名單 Set
const CORE_ETF_SET = new Set(CORE_ETF_UNIVERSE.map((u) => cleanCode(u.symbol)))
const TOP_100_SET = new Set([
  ...TOP_50_STOCKS_UNIVERSE.map((u) => cleanCode(u.symbol)),
  ...TOP_51_100_STOCKS_UNIVERSE.map((u) => cleanCode(u.symbol)),
])

/** 產生「截至 date」往前 minDays 個工作日（週一~五）的日期清單（YYYYMMDD）。 */
function genWorkingDates(endYear: number, endMonth: number, endDay: number, minDays: number): string[] {
  const out: string[] = []
  const date = new Date(endYear, endMonth - 1, endDay)
  let guard = 0
  while (out.length < minDays && guard < 400) {
    guard++
    const d = date.getDate()
    const m = date.getMonth() + 1
    const y = date.getFullYear()
    const dow = date.getDay()
    if (dow !== 0 && dow !== 6) {
      out.unshift(
        `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`,
      )
    }
    date.setDate(d - 1)
  }
  return out
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { headers: { 'User-Agent': UA }, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let idx = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++
      results[cur] = await fn(items[cur])
    }
  })
  await Promise.all(workers)
  return results
}

async function fetchDayVolumes(dateStr: string): Promise<Map<string, { volume: number; name: string }>> {
  const url = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${dateStr}&type=ALLBUT0999`
  const res = await fetchWithTimeout(url, 15000)
  if (!res.ok) throw new Error(`TWSE MI_INDEX error: ${res.status} (${dateStr})`)
  const j = await res.json()
  const map = new Map<string, { volume: number; name: string }>()
  for (const tb of Array.isArray(j?.tables) ? j.tables : []) {
    const f: string[] = tb?.fields ?? []
    if (!f.includes('成交股數')) continue
    const data = tb?.data
    if (!Array.isArray(data) || data.length === 0) continue
    const ci = f.indexOf('證券代號')
    const ni = f.indexOf('證券名稱')
    const vi = f.indexOf('成交股數')
    for (const row of data) {
      const code = row[ci]
      if (code == null) continue
      const volume = parseNum(row[vi])
      const c = cleanCode(code)
      if (map.has(c)) {
        map.get(c)!.volume += volume
      } else {
        map.set(c, { volume, name: row[ni] ?? code })
      }
    }
  }
  return map
}

async function fetchTodayAll(): Promise<TopVolumeItem[]> {
  const res = await fetchWithTimeout('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', 15000)
  if (!res.ok) throw new Error(`TWSE STOCK_DAY_ALL error: ${res.status}`)
  const arr = await res.json()
  if (!Array.isArray(arr)) return []
  return arr
    .map((r: any) => ({
      rank: 0,
      symbol: cleanCode(String(r.Code ?? '')),
      name: String(r.Name ?? r.Code ?? '').trim(),
      volume: parseNum(r.TradeVolume),
      value: parseNum(r.TradeValue),
      price: parseNum(r.ClosingPrice),
    }))
    .filter((r: any) => r.symbol && r.volume > 0)
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const rawRange = searchParams.get('range') ?? 'day'
  const range: Range = rawRange === 'week' || rawRange === 'month' || rawRange === 'quarter' ? rawRange : 'day'
  const rawCategory = searchParams.get('category') ?? 'etf'
  const category: Category = rawCategory === 'stocks' ? 'stocks' : 'etf'
  const count = 20

  const cacheKey = `${category}|${range}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < TTL_MS[range]) {
    return NextResponse.json({ category, range, asOf: hit.at, results: hit.json })
  }

  try {
    let allItems: TopVolumeItem[] = []
    if (range === 'day') {
      allItems = await fetchTodayAll()
    } else {
      const minDays = RANGE_DAYS[range]
      const now = new Date()
      const dates = genWorkingDates(now.getFullYear(), now.getMonth() + 1, now.getDate(), minDays)
      const maps = await mapLimit(dates, 6, (d) => fetchDayVolumes(d))
      const agg = new Map<string, { volume: number; name: string }>()
      for (const m of maps) {
        for (const [code, { volume, name }] of m) {
          if (agg.has(code)) {
            agg.get(code)!.volume += volume
          } else {
            agg.set(code, { volume, name })
          }
        }
      }
      allItems = [...agg.entries()].map(([symbol, v]) => ({
        rank: 0,
        symbol,
        name: v.name,
        volume: v.volume,
      }))
    }

    // 依 category 白名單過濾（嚴格排除槓桿反向 ETF 與非 Top 100 中小型投機股）
    let filtered: TopVolumeItem[] = []
    if (category === 'etf') {
      filtered = allItems.filter((item) => CORE_ETF_SET.has(item.symbol))
      // 若 TWSE OpenAPI 今日剛好缺少部分新 ETF 資料，保底以核心清單填補
      if (filtered.length < 5) {
        const existing = new Set(filtered.map((f) => f.symbol))
        for (const etf of CORE_ETF_UNIVERSE) {
          const sym = cleanCode(etf.symbol)
          if (!existing.has(sym)) {
            filtered.push({ rank: 0, symbol: sym, name: etf.name, volume: 1000 })
          }
        }
      }
    } else {
      filtered = allItems.filter((item) => TOP_100_SET.has(item.symbol))
    }

    const results = filtered
      .sort((a, b) => b.volume - a.volume)
      .slice(0, count)
      .map((item, i) => ({
        ...item,
        rank: i + 1,
        category,
        tier: getUniverseTier(item.symbol),
      }))

    cache.set(cacheKey, { at: Date.now(), json: results })
    return NextResponse.json({ category, range, asOf: Date.now(), results })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '取得排行失敗' }, { status: 500 })
  }
}
