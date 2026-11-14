import { isTwseTradingDay, taipeiTodayStr } from './twse-calendar'
import { taipeiHourOf, parseTwseNum } from './chip-radar'
import { computeLendingSignal, type LendingDataPoint, type LendingSignalResult } from './securities-lending'

const TWT93U_URL = 'https://www.twse.com.tw/rwd/zh/marginTrading/TWT93U'
const TWT72U_URL = 'https://www.twse.com.tw/rwd/zh/lending/TWT72U'
const FETCH_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 30 * 60 * 1000
const LOOKBACK_TRADING_DAYS = 22
const CONCURRENCY = 6

export interface DailyLendingRow {
  name: string
  balance: number
  benchmark: number
}

interface DayCacheEntry {
  rows: Map<string, DailyLendingRow>
  cachedAt: number
}

const twt93uDayCache = new Map<string, DayCacheEntry>()
const twt72uDayCache = new Map<string, DayCacheEntry>()

function addDaysIso(iso: string, delta: number): string {
  return new Date(Date.parse(`${iso}T12:00:00+08:00`) + delta * 86400000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

/** 取得最近 N 個已公布交易日（升冪 YYYY-MM-DD） */
export function recentLendingTradingDays(
  today: string = taipeiTodayStr(),
  count: number = LOOKBACK_TRADING_DAYS,
  hourTaipei: number = taipeiHourOf(),
): string[] {
  const days: string[] = []
  let cursor = today
  // 盤後約 19 點後才穩定有當日檔；盤前/盤中跳過今日
  if (isTwseTradingDay(cursor) && hourTaipei < 19) {
    cursor = addDaysIso(cursor, -1)
  }
  for (let i = 0; i < 60 && days.length < count; i++) {
    if (isTwseTradingDay(cursor)) {
      days.push(cursor)
    }
    cursor = addDaysIso(cursor, -1)
  }
  return days.reverse()
}

async function fetchTwseDay(
  kind: 'twt93u' | 'twt72u',
  dateIso: string,
): Promise<Map<string, DailyLendingRow>> {
  const cache = kind === 'twt93u' ? twt93uDayCache : twt72uDayCache
  const hit = cache.get(dateIso)
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) {
    return hit.rows
  }

  const yyyymmdd = dateIso.replace(/-/g, '')
  const baseUrl = kind === 'twt93u' ? TWT93U_URL : TWT72U_URL
  const url = `${baseUrl}?response=json&date=${yyyymmdd}`

  const rows = new Map<string, DailyLendingRow>()
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) return rows
    const json = (await res.json()) as { stat?: string; data?: unknown[][] }
    if (json?.stat !== 'OK' || !Array.isArray(json.data)) return rows

    for (const r of json.data) {
      if (!Array.isArray(r) || r.length < 6) continue
      const sym = String(r[0] ?? '').trim().toUpperCase()
      const name = String(r[1] ?? '').trim()
      if (!sym) continue

      if (kind === 'twt93u') {
        // TWT93U: [12]=借券賣出當日餘額, [7]=融券/借券總量次一營業日限額(或[13]借券可限額)
        const balance = parseTwseNum(r[12])
        const limitTotal = parseTwseNum(r[7])
        const limitLending = parseTwseNum(r[13])
        const benchmark = limitTotal > 0 ? limitTotal : limitLending
        rows.set(sym, { name, balance, benchmark })
      } else {
        // TWT72U: [5]=本日借券餘額股
        const balance = parseTwseNum(r[5])
        rows.set(sym, { name, balance, benchmark: 0 })
      }
    }
    cache.set(dateIso, { rows, cachedAt: Date.now() })
  } catch {
    // 單日失敗降級為空 Map，由外層以缺值處理
  }
  return rows
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (cursor < items.length) {
        const idx = cursor++
        out[idx] = await fn(items[idx]!)
      }
    }),
  )
  return out
}

export interface SymbolLendingPayload extends LendingSignalResult {
  symbol: string
  name: string | null
  asOf: string | null
  source: 'TWT93U' | 'TWT72U'
  benchmark: number
  series: LendingDataPoint[]
}

export async function getLendingSignalsForSymbols(
  symbols: string[],
): Promise<{ asOf: string | null; results: Record<string, SymbolLendingPayload> }> {
  const days = recentLendingTradingDays()
  const dayMaps = await mapPool(days, CONCURRENCY, (d) => fetchTwseDay('twt93u', d))

  const validDays: Array<{ date: string; map: Map<string, DailyLendingRow> }> = []
  for (let i = 0; i < days.length; i++) {
    if (dayMaps[i]!.size > 0) {
      validDays.push({ date: days[i]!, map: dayMaps[i]! })
    }
  }
  const asOf = validDays.length > 0 ? validDays[validDays.length - 1]!.date : null
  const results: Record<string, SymbolLendingPayload> = {}

  for (const rawSym of symbols) {
    const sym = rawSym.trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
    if (!sym) continue

    let name: string | null = null
    let benchmark = 0
    const series: LendingDataPoint[] = []
    let foundAny = false

    for (const d of validDays) {
      const row = d.map.get(sym)
      if (row) {
        foundAny = true
        if (!name && row.name) name = row.name
        if (row.benchmark > 0) benchmark = row.benchmark
        series.push({ date: d.date, balance: row.balance })
      } else {
        series.push({ date: d.date, balance: null })
      }
    }

    if (foundAny) {
      const sig = computeLendingSignal(series, benchmark)
      results[sym] = {
        symbol: sym,
        name,
        asOf,
        source: 'TWT93U',
        benchmark,
        series,
        ...sig,
      }
    }
  }

  return { asOf, results }
}

export async function getSingleSymbolLending(symbol: string): Promise<SymbolLendingPayload | null> {
  const sym = symbol.trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
  if (!sym) return null

  const batch = await getLendingSignalsForSymbols([sym])
  if (batch.results[sym]) return batch.results[sym]!

  // Fallback: 嘗試 TWT72U（含部分上櫃或非信用交易標的）
  const days = recentLendingTradingDays()
  const dayMaps = await mapPool(days, CONCURRENCY, (d) => fetchTwseDay('twt72u', d))
  const validDays: Array<{ date: string; map: Map<string, DailyLendingRow> }> = []
  for (let i = 0; i < days.length; i++) {
    if (dayMaps[i]!.size > 0) validDays.push({ date: days[i]!, map: dayMaps[i]! })
  }
  const asOf = validDays.length > 0 ? validDays[validDays.length - 1]!.date : null
  let name: string | null = null
  let foundAny = false
  const series: LendingDataPoint[] = []
  for (const d of validDays) {
    const row = d.map.get(sym)
    if (row) {
      foundAny = true
      if (!name && row.name) name = row.name
      series.push({ date: d.date, balance: row.balance })
    } else {
      series.push({ date: d.date, balance: null })
    }
  }
  if (!foundAny) return null
  // TWT72U 未附發行限額，若無 benchmark 依 ACCEPTANCE 標記 insufficientData
  const sig = computeLendingSignal(series, 0)
  return {
    symbol: sym,
    name,
    asOf,
    source: 'TWT72U',
    benchmark: 0,
    series,
    ...sig,
  }
}
