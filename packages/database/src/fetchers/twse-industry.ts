import { getDb, getAzurePoolPublic, dbQueryAll, dbQueryFirst } from '../db.js'
import sql from 'mssql'

/**
 * Issue #121：TWSE 上市公司基本資料（openapi t187ap03_L）→ stock_industry。
 *
 * 來源 `https://openapi.twse.com.tw/v1/opendata/t187ap03_L` 回傳 JSON 陣列，
 * 每列含「公司代號」「產業別」等欄位；產業別為 2 碼代碼（如 '24'），
 * 需映射為官方中文名（如「半導體業」）供前端「板塊」篩選與排序使用。
 *
 * 表結構：stock_industry(stock_id PK, industry_code, industry_name, market, updated_at)
 * - 上市公司的產業別來自 t187ap03_L（market='TWSE'）。
 * - 非公司代號標的（ETF／債券 ETF／存託憑證）不在來源內，改由零股成交代號經
 *   classifyNonStockCode() 規則歸類後補寫（market='NONSTOCK'、industry_code='00'）；
 *   查無規則者不寫入（前端顯示「—」）。
 */

const SOURCE_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'

const isAzureSql = (process.env.DATABASE_URL?.length ?? 0) > 0

/** TWSE 官方 33 種產業別代碼 → 中文名（2026-10 實測 t187ap03_L 全部代碼）。 */
export const TWSE_INDUSTRY_NAMES: Record<string, string> = {
  '01': '水泥工業',
  '02': '食品工業',
  '03': '塑膠工業',
  '04': '紡織纖維',
  '05': '電機機械',
  '06': '電器電纜',
  '08': '玻璃陶瓷',
  '09': '造紙工業',
  '10': '鋼鐵工業',
  '11': '橡膠工業',
  '12': '汽車工業',
  '14': '建材營造',
  '15': '航運業',
  '16': '觀光餐旅',
  '17': '金融保險業',
  '18': '貿易百貨',
  '20': '其他',
  '21': '化學工業',
  '22': '生技醫療業',
  '23': '油電燃氣業',
  '24': '半導體業',
  '25': '電腦及週邊設備業',
  '26': '光電業',
  '27': '通信網路業',
  '28': '電子零組件業',
  '29': '電子通路業',
  '30': '資訊服務業',
  '31': '其他電子業',
  '35': '綠能環保',
  '36': '數位雲端',
  '37': '運動休閒',
  '38': '居家生活',
  '91': '存託憑證',
}

/** 非公司代號標的的板塊名稱（與前端 lib/industry.ts 的常數一致）。 */
export const NON_STOCK_ETF = 'ETF'
export const NON_STOCK_BOND_ETF = '債券 ETF'
export const NON_STOCK_DR = '存託憑證'
/** 非公司代號標的的產業代碼（非官方代碼，明確標示不屬於 33 類）。 */
export const NON_STOCK_INDUSTRY_CODE = '00'
/** 非公司代號標的的 market 標記，與官方上市公司（TWSE）區隔。 */
export const NON_STOCK_MARKET = 'NONSTOCK'

export interface IndustryRow {
  stock_id: string
  industry_code: string
  industry_name: string
  market: string
  /** 同步時間（ISO）；未給時由 upsert 統一代入。 */
  updated_at?: string
}

interface TwseIndustryRaw {
  公司代號?: string
  產業別?: string
  [key: string]: unknown
}

/**
 * 把 t187ap03_L 的原始 JSON 陣列轉為 stock_industry 資料列（純函式，供單測）。
 * - 非陣列／非物件列／缺「公司代號」→ 略過該列（不 throw）。
 * - `industry_code` 補零成 2 碼（'1' → '01'）。
 * - 代碼不在對照表內 → 以代碼原文兜底當名稱（避免未知代碼整列消失）。
 */
export function parseIndustryRows(payload: unknown): IndustryRow[] {
  if (!Array.isArray(payload)) return []

  const rows: IndustryRow[] = []
  const seen = new Set<string>()

  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue
    const raw = entry as TwseIndustryRaw
    const stockId = String(raw['公司代號'] ?? '').trim()
    if (!stockId) continue
    if (seen.has(stockId)) continue

    const code = String(raw['產業別'] ?? '').trim()
    if (!code) continue
    const padded = code.padStart(2, '0')

    seen.add(stockId)
    rows.push({
      stock_id: stockId,
      industry_code: padded,
      industry_name: TWSE_INDUSTRY_NAMES[padded] ?? code,
      market: 'TWSE',
    })
  }

  return rows
}

/**
 * 非公司代號標的的板塊歸類（純函式，供單測）。
 * - `00679B`／`00687B` 等「4–6 碼數字＋英文尾碼且含 B」→ 債券 ETF
 * - `0050`／`00878` 等 `00` 開頭 4–6 碼 → ETF
 * - `9105` 等 `91` 開頭 4–6 碼、或以 `-DR` 結尾 → 存託憑證
 * - 其餘（含 `2330` 這類一般公司代號）→ null，交由官方產業別對照
 */
export function classifyNonStockCode(stockId: string): string | null {
  const id = String(stockId ?? '').trim().toUpperCase()
  if (!id) return null

  if (/^\d{4,6}[A-Z]$/.test(id) && id.includes('B')) return NON_STOCK_BOND_ETF
  if (/^00\d{2,4}$/.test(id)) return NON_STOCK_ETF
  if (/^91\d{2,4}$/.test(id)) return NON_STOCK_DR
  if (id.endsWith('-DR')) return NON_STOCK_DR
  return null
}

/**
 * 由零股成交代號產生「非公司標的」的 stock_industry 列（純函式，供單測）。
 * ETF／債券 ETF／存託憑證在 t187ap03_L（上市公司基本資料）裡查無資料，
 * 需另行歸類才能讓前端板塊欄與 chips 出現這三類板塊。
 * 無法歸類者（一般公司代號如 2330、未知代號）略過；重複代號去重。
 */
export function buildNonStockRows(stockIds: string[], updatedAt: string): IndustryRow[] {
  const rows: IndustryRow[] = []
  const seen = new Set<string>()

  for (const raw of stockIds ?? []) {
    const id = String(raw ?? '').trim().toUpperCase()
    if (!id || seen.has(id)) continue
    const name = classifyNonStockCode(id)
    if (!name) continue
    seen.add(id)
    rows.push({
      stock_id: id,
      industry_code: NON_STOCK_INDUSTRY_CODE,
      industry_name: name,
      market: NON_STOCK_MARKET,
      updated_at: updatedAt,
    })
  }

  return rows
}

/**
 * 抓取 TWSE 上市產業別並 upsert 進 stock_industry，回傳成功寫入筆數。
 * 任何失敗（網路、非 JSON、格式變動）只 log 並回 0，不 throw、不寫半套資料。
 */
export async function fetchTwseIndustry(): Promise<number> {
  let payload: unknown
  try {
    const res = await fetch(SOURCE_URL, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      console.warn(`[TWSE industry] t187ap03_L HTTP ${res.status}, skip without write`)
      return 0
    }
    const text = await res.text()
    try {
      payload = JSON.parse(text)
    } catch {
      console.warn('[TWSE industry] t187ap03_L returned non-JSON body, skip without write')
      return 0
    }
  } catch (e) {
    console.warn('[TWSE industry] t187ap03_L fetch failed, skip without write:', (e as Error).message)
    return 0
  }

  const rows = parseIndustryRows(payload)
  if (rows.length === 0) {
    console.warn('[TWSE industry] t187ap03_L parsed 0 rows, skip without write')
    return 0
  }

  return upsertRows(rows, new Date().toISOString(), 'TWSE industry')
}

/**
 * 補寫「非公司標的」板塊（ETF／債券 ETF／存託憑證）。
 * 資料來源是本專案已抓到的零股成交代號（odd_lot_trades），因為這些標的
 * 不在 t187ap03_L（上市公司基本資料）內，只能由代號規則歸類。
 * - `date` 省略時取最新交易日；查無交易日／0 列 → 回 0，不 throw。
 * - 同一 stock_id 主鍵 upsert，重跑冪等。
 */
export async function backfillNonStockIndustries(date?: string): Promise<number> {
  try {
    const targetDate =
      date ||
      (await dbQueryFirst<{ date: string }>(
        'SELECT date FROM odd_lot_trades ORDER BY date DESC LIMIT 1',
      ))?.date
    if (!targetDate) {
      console.warn('[Non-stock industry] odd_lot_trades has no trading date, backfill skipped')
      return 0
    }

    const trades = await dbQueryAll<{ stock_id: string }>(
      'SELECT DISTINCT stock_id FROM odd_lot_trades WHERE date = @date',
      { date: targetDate },
    )
    if (trades.length === 0) {
      console.log(`[Non-stock industry] ${targetDate}: no odd-lot trades, backfill skipped`)
      return 0
    }

    const rows = buildNonStockRows(
      trades.map((t) => t.stock_id),
      new Date().toISOString(),
    )
    if (rows.length === 0) {
      console.log(`[Non-stock industry] ${targetDate}: no non-stock codes, backfill skipped`)
      return 0
    }

    return await upsertRows(rows, new Date().toISOString(), `Non-stock industry ${targetDate}`)
  } catch (e) {
    console.warn('[Non-stock industry] backfill failed, skip without write:', (e as Error).message)
    return 0
  }
}

/** 依連線型態分派 upsert（SQLite / Azure SQL 共用同一組寫入語意）。 */
async function upsertRows(
  rows: IndustryRow[],
  updatedAt: string,
  label: string,
): Promise<number> {
  if (rows.length === 0) return 0
  if (isAzureSql) {
    return insertAzureSql(rows, updatedAt, label)
  }
  return insertSqlite(rows, updatedAt, label)
}

function insertSqlite(rows: IndustryRow[], updatedAt: string, label = 'TWSE industry'): number {
  const db = getDb()
  if (!db) return 0

  const insert = db.prepare(`
    INSERT OR REPLACE INTO stock_industry (stock_id, industry_code, industry_name, market, updated_at)
    VALUES (@stock_id, @industry_code, @industry_name, @market, @updated_at)
  `)

  const transaction = db.transaction(() => {
    let count = 0
    for (const row of rows) {
      insert.run({ ...row, updated_at: row.updated_at ?? updatedAt })
      count++
    }
    return count
  })

  const count = transaction()
  console.log(`[${label}] ${count} rows upserted (SQLite)`)
  return count
}

async function insertAzureSql(
  rows: IndustryRow[],
  updatedAt: string,
  label = 'TWSE industry',
): Promise<number> {
  const pool = await getAzurePoolPublic()
  if (!pool) return 0

  const batchSize = 200
  let total = 0

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const req = pool.request()
    const values: string[] = []

    batch.forEach((row, idx) => {
      const p = `p${idx}`
      values.push(`(@${p}_sid, @${p}_code, @${p}_name, @${p}_market, @${p}_updated)`)
      req.input(`${p}_sid`, sql.NVarChar(20), row.stock_id)
      req.input(`${p}_code`, sql.NVarChar(10), row.industry_code)
      req.input(`${p}_name`, sql.NVarChar(50), row.industry_name)
      req.input(`${p}_market`, sql.NVarChar(20), row.market)
      req.input(`${p}_updated`, sql.NVarChar(30), row.updated_at ?? updatedAt)
    })

    if (values.length === 0) continue

    await req.query(`
      MERGE INTO stock_industry AS t
      USING (VALUES ${values.join(',')}) AS s(stock_id, industry_code, industry_name, market, updated_at)
      ON t.stock_id = s.stock_id
      WHEN MATCHED THEN UPDATE SET
        industry_code = s.industry_code, industry_name = s.industry_name,
        market = s.market, updated_at = s.updated_at
      WHEN NOT MATCHED THEN INSERT (stock_id, industry_code, industry_name, market, updated_at)
        VALUES (s.stock_id, s.industry_code, s.industry_name, s.market, s.updated_at);
    `)
    total += values.length
  }

  console.log(`[${label}] ${total} rows upserted (AzureSQL)`)
  return total
}
