/**
 * Issue #212：TWSE ETF 即時淨值（NAV）與折溢價率公開端點讀取＋5 分鐘記憶體快取。
 * 資料源：https://mis.twse.com.tw/stock/data/all_etf.txt
 *
 * - a: ETF 代號（如 "0050"）
 * - c: 已發行受益權單位數
 * - e: 成交價
 * - f: 預估淨值（NAV）
 * - g: 折溢價幅度（%，正＝溢價、負＝折價）
 * - i/j: 資料日期與時間（YYYYMMDD / HH:mm:ss）
 */

export interface TwseEtfNavSnapshot {
  symbol: string
  nav: number
  price: number | null
  premiumDiscountPct: number
  issuedUnits: number | null
  estimatedAumTwd: number | null
  updatedAt: string | null
}

const TWSE_ALL_ETF_URL = 'https://mis.twse.com.tw/stock/data/all_etf.txt'
const CACHE_TTL_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 5_000

let cache: { map: Map<string, TwseEtfNavSnapshot>; fetchedAt: number } | null = null

function toPositiveNum(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

function toFiniteNum(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

/** 純函式解析 TWSE all_etf.txt JSON 回應為 symbol -> TwseEtfNavSnapshot 對照表。 */
export function parseTwseAllEtfPayload(raw: unknown): Map<string, TwseEtfNavSnapshot> {
  const map = new Map<string, TwseEtfNavSnapshot>()
  if (!raw || typeof raw !== 'object') return map

  const groups = (raw as { a1?: unknown }).a1
  if (!Array.isArray(groups)) return map

  for (const group of groups) {
    const msgs = (group as { msgArray?: unknown })?.msgArray
    if (!Array.isArray(msgs)) continue
    for (const row of msgs) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const symbol = String(r.a ?? '').trim().toUpperCase()
      if (!symbol) continue

      const nav = toPositiveNum(r.f)
      const premiumDiscountPct = toFiniteNum(r.g)
      if (nav == null || premiumDiscountPct == null) continue

      const price = toPositiveNum(r.e)
      const issuedUnits = toPositiveNum(r.c)
      const estimatedAumTwd = issuedUnits != null ? Math.round(nav * issuedUnits) : null
      const dateStr = String(r.i ?? '').trim()
      const timeStr = String(r.j ?? '').trim()
      const updatedAt = dateStr && timeStr ? `${dateStr} ${timeStr}` : dateStr || null

      map.set(symbol, {
        symbol,
        nav,
        price,
        premiumDiscountPct: Math.round(premiumDiscountPct * 100) / 100,
        issuedUnits,
        estimatedAumTwd,
        updatedAt,
      })
    }
  }
  return map
}

export function clearTwseEtfNavCache(): void {
  cache = null
}

/** 取得單一台灣 ETF 最新淨值與折溢價快照（5 分鐘記憶體快取，失敗回 null）。 */
export async function getTwseEtfNav(symbol: string): Promise<TwseEtfNavSnapshot | null> {
  const key = symbol.trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
  if (!key) return null

  const now = Date.now()
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.map.get(key) ?? null
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(TWSE_ALL_ETF_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Vestential/1.0)',
        Accept: 'application/json, text/plain, */*',
      },
      signal: controller.signal,
    })
    if (!res.ok) return cache?.map.get(key) ?? null
    const json = await res.json()
    const map = parseTwseAllEtfPayload(json)
    if (map.size > 0) {
      cache = { map, fetchedAt: now }
      return map.get(key) ?? null
    }
  } catch {
    // 外部端點逾時或解析失敗時安全降級
  } finally {
    clearTimeout(timer)
  }
  return cache?.map.get(key) ?? null
}
