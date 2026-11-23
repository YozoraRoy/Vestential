import { upsertStockNames, type StockNameUpsertInput } from '../db.js'

/**
 * Issue #190：TWSE / TPEx 全市場股票與 ETF 中文名稱同步。
 *
 * - TWSE OpenAPI `STOCK_DAY_ALL`：涵蓋全部上市股票與上市 ETF（Code / Name）。
 * - TPEx OpenAPI `tpex_mainboard_daily_close_quotes`：涵蓋全部上櫃股票與上櫃 ETF（SecuritiesCompanyCode / CompanyName）。
 * - 提供 `ensureTwStockNamesSynced()` 節流函式（6 小時內只同步一次），供 API 按需補齊全市場中文主檔。
 */

const TWSE_STOCK_DAY_ALL_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
const TPEX_DAILY_CLOSE_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'

const SYNC_TTL_MS = 6 * 60 * 60 * 1000
let lastSyncAt = 0
let inFlightSync: Promise<number> | null = null

async function fetchJsonWithTimeout(url: string, timeoutMs = 10_000): Promise<unknown[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

export async function syncTwseAndTpexStockNames(): Promise<number> {
  const [twseRows, tpexRows] = await Promise.all([
    fetchJsonWithTimeout(TWSE_STOCK_DAY_ALL_URL),
    fetchJsonWithTimeout(TPEX_DAILY_CLOSE_URL),
  ])

  const items: StockNameUpsertInput[] = []

  for (const raw of twseRows) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const code = typeof r.Code === 'string' ? r.Code.trim().toUpperCase() : ''
    const name = typeof r.Name === 'string' ? r.Name.trim() : ''
    if (!code || !name) continue
    items.push({ symbol: code, nameZh: name, market: 'TW', source: 'twse_stock_day_all' })
  }

  for (const raw of tpexRows) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const code = typeof r.SecuritiesCompanyCode === 'string' ? r.SecuritiesCompanyCode.trim().toUpperCase() : ''
    const name = typeof r.CompanyName === 'string' ? r.CompanyName.trim() : ''
    if (!code || !name) continue
    items.push({ symbol: code, nameZh: name, market: 'TW', source: 'tpex_daily_close' })
  }

  if (!items.length) return 0
  return upsertStockNames(items)
}

/** 節流按需同步（6 小時內僅執行一次；失敗不拋錯，避免影響主查詢流程） */
export async function ensureTwStockNamesSynced(): Promise<number> {
  const now = Date.now()
  if (now - lastSyncAt < SYNC_TTL_MS) return 0
  if (inFlightSync) return inFlightSync

  inFlightSync = syncTwseAndTpexStockNames()
    .then((count) => {
      if (count > 0) lastSyncAt = Date.now()
      return count
    })
    .catch(() => 0)
    .finally(() => {
      inFlightSync = null
    })

  return inFlightSync
}
