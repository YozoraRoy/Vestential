import { getDb, getAzurePoolPublic } from '../db.js'
import sql from 'mssql'

export interface GiftRow {
  stock_id: string
  stock_name: string
  meeting_date: string
  last_buy_date: string
  gift_name: string
  gift_status: string
  source_url: string
}

const isAzureSql = (process.env.DATABASE_URL?.length ?? 0) > 0

const LIST_URLS = [
  'https://stock.gift/list?pred=high&no_id=1&no_copy=1&max=2000',
  'https://stock.gift/list?pred=mid&no_id=1&no_copy=1&max=2000',
  'https://stock.gift/list?pred=low&no_id=1&no_copy=1&max=2000',
]

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function toMonthDay(ymd: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(ymd || '')
  if (!m) return ymd
  return `${m[2]}/${m[3]}`
}

// ─── Nuxt __NUXT_DATA__ payload resolver ─────────────────────────
// Format (Nuxt 3.9+ / app payload v4):
//   data[0] is a wrapper tag (e.g. ["ShallowReactive", 1]) pointing into data.
//   Every value inside an object/array container is an integer index into data.
//   Leaf elements hold the actual primitives/strings.
function resolveNuxtPayload(data: any[], startIndex: number): any {
  const cache = new Map<number, any>()
  const isRef = (v: any): boolean =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < data.length

  function resolve(i: number): any {
    if (cache.has(i)) return cache.get(i)
    const el = data[i]
    let out: any
    if (Array.isArray(el)) {
      const tag = typeof el[0] === 'string' ? el[0] : null
      if (
        tag === 'ShallowReactive' || tag === 'Reactive' ||
        tag === 'Ref' || tag === 'ShallowRef' || tag === 'RefImpl'
      ) {
        out = isRef(el[1]) ? resolve(el[1]) : el[1]
      } else if (tag === 'EmptyRef' || tag === 'EmptyShallowRef') {
        out = undefined
      } else if (tag === 'Date') {
        out = el[1]
      } else {
        out = el.map((v: any) => (isRef(v) ? resolve(v) : v))
      }
    } else if (el && typeof el === 'object') {
      out = {}
      for (const [k, v] of Object.entries(el as Record<string, any>)) {
        out[k] = isRef(v) ? resolve(v) : v
      }
    } else {
      out = el
    }
    cache.set(i, out)
    return out
  }

  return resolve(startIndex)
}

interface NuxtStock {
  stockId?: string
  name?: string
  market?: string
  meetingContext?: {
    date?: string
    giftContent?: string
    giftStatus?: string
    lastBuyDate?: string
  }
}

// Fetch + parse one stock.gift list page (no browser needed).
async function fetchListPage(url: string): Promise<GiftRow[]> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, 'accept': 'text/html' },
  })
  if (!res.ok) throw new Error(`stock.gift HTTP ${res.status} for ${url}`)
  const html = await res.text()

  const m = html.match(
    /<script type="application\/json" data-nuxt-data="nuxt-app" data-ssr="true" id="__NUXT_DATA__">([\s\S]*?)<\/script>/,
  )
  if (!m) throw new Error('stock.gift __NUXT_DATA__ script not found')
  const data = JSON.parse(m[1])
  const root = resolveNuxtPayload(data, 0)

  // stock-filter state = { count, totalCost, stocks }
  const filter = root?.data?.pinia?.stockFilter ?? root?.data?.['stock-filter']
  const stocks: NuxtStock[] = filter?.stocks ?? []
  if (!Array.isArray(stocks)) throw new Error('stock.gift stocks array not found')

  const rows: GiftRow[] = []
  const seen = new Set<string>()
  for (const stock of stocks) {
    const stockId = String(stock?.stockId ?? '').trim()
    const stockName = String(stock?.name ?? '').trim()
    if (!/^\d{4,6}$/.test(stockId)) continue
    // ETF / 債券 ETF / REITs / ETN 絕不發放股東會紀念品，統一跳過不納入
    if (
      stockId.startsWith('00') ||
      stockId.startsWith('01') ||
      stockId.startsWith('02') ||
      stockName.toUpperCase().includes('ETF')
    ) {
      continue
    }
    const ctx = stock.meetingContext ?? {}
    const key = `${stockId}|${ctx.date || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      stock_id: stockId,
      stock_name: stockName,
      meeting_date: toMonthDay(ctx.date || ''),
      last_buy_date: toMonthDay(ctx.lastBuyDate || ''),
      gift_name: normalizeGiftName(stockId, String(ctx.giftContent ?? '').trim()),
      gift_status: String(ctx.giftStatus ?? '').trim(),
      source_url: url,
    })
  }
  return rows
}

export async function fetchStockGiftRows(): Promise<GiftRow[]> {
  const allRows: GiftRow[] = []
  const seen = new Set<string>()
  for (const url of LIST_URLS) {
    try {
      const rows = await fetchListPage(url)
      let added = 0
      for (const row of rows) {
        const key = `${row.stock_id}|${row.meeting_date}`
        if (seen.has(key)) continue
        seen.add(key)
        allRows.push(row)
        added++
      }
      console.log(`stock.gift (${url.split('pred=')[1]?.split('&')[0] ?? '?'}): ${rows.length} rows, +${added} new`)
    } catch (err) {
      console.warn(`stock.gift failed for ${url}:`, err instanceof Error ? err.message : err)
    }
  }
  return allRows
}

export async function fetchStockGift(): Promise<number> {
  const rows = await fetchStockGiftRows()
  const total = isAzureSql ? await replaceGiftsAzureSql(rows) : replaceGiftsSqlite(rows)
  console.log(`stock.gift total: ${total} unique gifts upserted`)
  return total
}

function replaceGiftsSqlite(rows: GiftRow[]): number {
  const db = getDb()
  if (!db) return 0
  const del = db.prepare('DELETE FROM shareholder_gifts WHERE stock_id = @stock_id')
  const ins = db.prepare(`
    INSERT INTO shareholder_gifts
      (stock_id, stock_name, meeting_date, last_buy_date, gift_name, gift_status, distribution_method, distribution_location, source_url)
    VALUES (@stock_id, @stock_name, @meeting_date, @last_buy_date, @gift_name, @gift_status, '', '', @source_url)
  `)
  const tx = db.transaction(() => {
    for (const row of rows) {
      del.run({ stock_id: row.stock_id })
      ins.run(row)
    }
    return rows.length
  })
  return tx()
}

async function replaceGiftsAzureSql(rows: GiftRow[]): Promise<number> {
  const pool = await getAzurePoolPublic()
  if (!pool) return 0
  const batchSize = 150
  let total = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)

    const delReq = pool.request()
    const ids: string[] = []
    batch.forEach((row, idx) => {
      delReq.input(`sid${idx}`, sql.NVarChar(20), row.stock_id)
      ids.push(`@sid${idx}`)
    })
    await delReq.query(`DELETE FROM shareholder_gifts WHERE stock_id IN (${ids.join(',')})`)

    const req = pool.request()
    const values: string[] = []
    batch.forEach((row, idx) => {
      const p = `g${idx}`
      values.push(`(@${p}_sid, @${p}_sname, @${p}_md, @${p}_lbd, @${p}_gn, @${p}_gs, @${p}_dm, @${p}_dl, @${p}_su)`)
      req.input(`${p}_sid`, sql.NVarChar(20), row.stock_id)
      req.input(`${p}_sname`, sql.NVarChar(100), row.stock_name)
      req.input(`${p}_md`, sql.NVarChar(20), row.meeting_date || null)
      req.input(`${p}_lbd`, sql.NVarChar(20), row.last_buy_date || null)
      req.input(`${p}_gn`, sql.NVarChar(500), row.gift_name)
      req.input(`${p}_gs`, sql.NVarChar(50), row.gift_status || null)
      req.input(`${p}_dm`, sql.NVarChar(200), '')
      req.input(`${p}_dl`, sql.NVarChar(500), '')
      req.input(`${p}_su`, sql.NVarChar(1000), row.source_url)
    })
    await req.query(`
      INSERT INTO shareholder_gifts
        (stock_id, stock_name, meeting_date, last_buy_date, gift_name, gift_status, distribution_method, distribution_location, source_url)
      VALUES ${values.join(',')}
    `)
    total += batch.length
  }
  return total
}

// 特殊已知標的實體/電子禮卡精準對照表
const KNOWN_GIFT_MAP: Record<string, string> = {
  '3034': '50元超商商品卡 (7-11/全家)', // 聯詠
  '2340': '50元超商商品卡（7-11商品卡）', // 台亞
  '4999': '超商咖啡兌換券 (電子商品卡)', // 鑫禾
  '4746': '統一超商 35元商品卡 (7-11提貨卡)', // 台耀
}

export function normalizeGiftName(stockId: string, rawGiftName: string): string {
  if (!rawGiftName || rawGiftName === '-') return '-'

  if (KNOWN_GIFT_MAP[stockId]) {
    return KNOWN_GIFT_MAP[stockId]
  }

  const lower = rawGiftName.trim().toLowerCase()
  if (lower === 'egift' || lower === 'e-gift' || lower === '電子禮卡') {
    return '50元超商電子商品卡 (7-11/全家)'
  }

  return rawGiftName
}
