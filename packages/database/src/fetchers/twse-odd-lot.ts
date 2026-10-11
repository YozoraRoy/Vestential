import { getDb, getAzurePoolPublic, dbQueryAll, dbQueryFirst, dbExecute } from '../db.js'
import sql from 'mssql'

interface TwseOpenApiOddLotItem {
  Code: string
  Name: string
  TradeVolume: string
  Transaction: string
  TradeValue: string
  TradePrice: string
  BestBidPrice: string
  BestBidVolume: string
  BestAskPrice: string
  BestAskVolume: string
}

/**
 * TWSE 盤後零股帶日期端點回應（rwd/zh/afterTrading/TWT53U?date=YYYYMMDD&response=json）。
 * data 每列依序為：證券代號、證券名稱、成交股數、成交筆數、成交金額、
 * 成交價、最佳買價申報量(買價/買量)、最佳賣價(賣價/賣量)——共 10 欄，
 * 與舊鏡像端點 (openapi TWT53U) 的 Code/Name/... 欄位一一對應。
 */
interface TwseDatedOddLotResponse {
  stat: string
  date?: string
  fields?: string[]
  data?: string[][]
}

const DATED_URL = (date: string) =>
  `https://www.twse.com.tw/rwd/zh/afterTrading/TWT53U?date=${date}&response=json`

const isAzureSql = (process.env.DATABASE_URL?.length ?? 0) > 0

export async function fetchTwseOddLots(date?: string): Promise<number> {
  const targetDate = date || formatDate(new Date())
  return fetchForDate(targetDate)
}

/**
 * 解析 dated 端點回應。
 * - `stat !== 'OK'`（如休市日「很抱歉，沒有符合條件的資料!」）→ 回傳 null，呼叫端不得寫入。
 * - `stat === 'OK'` → 回傳正規化後的列（可能為空陣列，屬暫時性缺資料由呼叫端重試）。
 */
export function parseDatedOddLotResponse(json: unknown): TwseOpenApiOddLotItem[] | null {
  if (!json || typeof json !== 'object') return null
  const res = json as TwseDatedOddLotResponse
  if (res.stat !== 'OK') return null
  if (!Array.isArray(res.data)) return []

  const items: TwseOpenApiOddLotItem[] = []
  for (const row of res.data) {
    if (!Array.isArray(row) || row.length < 10) continue
    const code = String(row[0] ?? '').trim()
    if (!code || code === '合計') continue
    items.push({
      Code: code,
      Name: String(row[1] ?? '').trim(),
      TradeVolume: String(row[2] ?? ''),
      Transaction: String(row[3] ?? ''),
      TradeValue: String(row[4] ?? ''),
      TradePrice: String(row[5] ?? ''),
      BestBidPrice: String(row[6] ?? ''),
      BestBidVolume: String(row[7] ?? ''),
      BestAskPrice: String(row[8] ?? ''),
      BestAskVolume: String(row[9] ?? ''),
    })
  }
  return items
}

async function fetchForDate(targetDate: string): Promise<number> {
  const url = DATED_URL(targetDate)

  // Issue #65：改用帶日期端點，每筆 date 恆等於其 TWSE 真實交易日。
  // stat !== 'OK' 即當日無交易（休市/尚未公布），直接回傳 0 且不寫入——不重試。
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      })
      if (!res.ok) throw new Error(`TWSE dated TWT53U error: ${res.status}`)

      const json = (await res.json()) as unknown
      const stat = (json as TwseDatedOddLotResponse | null)?.stat
      if (typeof stat === 'string' && stat !== 'OK') {
        console.log(`TWSE dated TWT53U ${targetDate}: no trading data (stat=${stat}), skip without write`)
        return 0
      }

      const responseDate = (json as TwseDatedOddLotResponse)?.date
      if (responseDate && responseDate !== targetDate) {
        // 防呆：回應日期與請求日期不符時不寫入，避免重演 +1 天錯標。
        console.warn(`TWSE dated TWT53U date mismatch: requested ${targetDate} but got ${responseDate}, skip without write`)
        return 0
      }

      const items = parseDatedOddLotResponse(json) ?? []
      if (items.length === 0) {
        if (attempt < maxAttempts) {
          console.warn(`TWSE dated TWT53U empty list for ${targetDate}, retry ${attempt}/${maxAttempts}`)
          await sleep(1000 * attempt)
          continue
        }
        console.warn(`TWSE dated TWT53U returned empty list for ${targetDate}`)
        return 0
      }

      if (isAzureSql) {
        return insertAzureSql(items, targetDate)
      }
      return insertSqlite(items, targetDate)
    } catch (e) {
      if (attempt < maxAttempts) {
        console.warn(`TWSE dated TWT53U error for ${targetDate}, retry ${attempt}/${maxAttempts}:`, (e as Error).message)
        await sleep(1000 * attempt)
        continue
      }
      throw e
    }
  }
  return 0
}

/**
 * Issue #65 髒資料清理：刪除指定 date 的全部 odd_lot_trades 列。
 * 僅供清理錯標籤日期（如休市日 20261009）後再以 fetchTwseOddLots(正確日期) 回填。
 * 回傳刪除筆數。注意：生產執行留待 P4 由主 agent 確認，本任務不對生產 DB 寫入。
 */
export async function deleteOddLotByDate(date: string): Promise<number> {
  const row = await dbQueryFirst<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM odd_lot_trades WHERE date = @date',
    { date },
  )
  const count = row?.cnt ?? 0
  if (count === 0) return 0
  await dbExecute('DELETE FROM odd_lot_trades WHERE date = @date', { date })
  console.log(`odd_lot_trades ${date}: ${count} mislabelled rows deleted`)
  return count
}

/**
 * 列出目前 DB 內各 date 的筆數（唯讀），供評估歷史是否整體偏移、決定回填範圍。
 */
export async function listOddLotDateCounts(limit = 30): Promise<{ date: string; cnt: number }[]> {
  const rows = await dbQueryAll<{ date: string; cnt: number }>(
    'SELECT date, COUNT(*) AS cnt FROM odd_lot_trades GROUP BY date ORDER BY date DESC LIMIT 30',
  )
  return rows.slice(0, limit)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function insertSqlite(items: TwseOpenApiOddLotItem[], targetDate: string): number {
  const db = getDb()
  if (!db) return 0

  const insert = db.prepare(`
    INSERT OR REPLACE INTO odd_lot_trades (date, stock_id, stock_name, price, volume, bid_price, bid_volume, ask_price, ask_volume)
    VALUES (@date, @stock_id, @stock_name, @price, @volume, @bid_price, @bid_volume, @ask_price, @ask_volume)
  `)

  const transaction = db.transaction(() => {
    let count = 0
    for (const item of items) {
      const stockId = item.Code?.trim()
      if (!stockId) continue

      insert.run({
        date: targetDate,
        stock_id: stockId,
        stock_name: item.Name?.trim() || stockId,
        price: parseNum(item.TradePrice),
        volume: parseInt(String(item.TradeVolume ?? '0').replace(/,/g, ''), 10) || 0,
        bid_price: parseNum(item.BestBidPrice),
        bid_volume: parseInt(String(item.BestBidVolume ?? '0').replace(/,/g, ''), 10) || 0,
        ask_price: parseNum(item.BestAskPrice),
        ask_volume: parseInt(String(item.BestAskVolume ?? '0').replace(/,/g, ''), 10) || 0,
      })
      count++
    }
    return count
  })

  const count = transaction()
  console.log(`TWSE dated odd lots ${targetDate}: ${count} rows inserted (SQLite)`)
  return count
}

async function insertAzureSql(items: TwseOpenApiOddLotItem[], targetDate: string): Promise<number> {
  const pool = await getAzurePoolPublic()
  if (!pool) return 0

  const batchSize = 200
  let total = 0

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const req = pool.request()
    const values: string[] = []

    batch.forEach((item, idx) => {
      const stockId = item.Code?.trim()
      if (!stockId) return
      const p = `p${idx}`
      values.push(`(@${p}_date, @${p}_sid, @${p}_sname, @${p}_price, @${p}_vol, @${p}_bp, @${p}_bv, @${p}_ap, @${p}_av)`)
      req.input(`${p}_date`, sql.NVarChar(20), targetDate)
      req.input(`${p}_sid`, sql.NVarChar(20), stockId)
      req.input(`${p}_sname`, sql.NVarChar(100), item.Name?.trim() || stockId)
      req.input(`${p}_price`, sql.Float, parseNum(item.TradePrice))
      req.input(`${p}_vol`, sql.Int, parseInt(String(item.TradeVolume ?? '0').replace(/,/g, ''), 10) || 0)
      req.input(`${p}_bp`, sql.Float, parseNum(item.BestBidPrice))
      req.input(`${p}_bv`, sql.Int, parseInt(String(item.BestBidVolume ?? '0').replace(/,/g, ''), 10) || 0)
      req.input(`${p}_ap`, sql.Float, parseNum(item.BestAskPrice))
      req.input(`${p}_av`, sql.Int, parseInt(String(item.BestAskVolume ?? '0').replace(/,/g, ''), 10) || 0)
    })

    if (values.length === 0) continue

    await req.query(`
      MERGE INTO odd_lot_trades AS t
      USING (VALUES ${values.join(',')}) AS s(date, stock_id, stock_name, price, volume, bid_price, bid_volume, ask_price, ask_volume)
      ON t.date = s.date AND t.stock_id = s.stock_id
      WHEN MATCHED THEN UPDATE SET
        stock_name = s.stock_name, price = s.price, volume = s.volume,
        bid_price = s.bid_price, bid_volume = s.bid_volume,
        ask_price = s.ask_price, ask_volume = s.ask_volume
      WHEN NOT MATCHED THEN INSERT (date, stock_id, stock_name, price, volume, bid_price, bid_volume, ask_price, ask_volume)
        VALUES (s.date, s.stock_id, s.stock_name, s.price, s.volume, s.bid_price, s.bid_volume, s.ask_price, s.ask_volume);
    `)
    total += values.length
  }

  console.log(`TWSE dated odd lots ${targetDate}: ${total} rows upserted (AzureSQL)`)
  return total
}

function parseNum(val: string | undefined): number | null {
  if (!val) return null
  const cleaned = String(val).replace(/,/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

export function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}
