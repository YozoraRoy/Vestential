import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, existsSync } from 'node:fs'

// Issue #121：DB 路徑必須在載入 src/db.ts 之前決定（DB_PATH 於模組頂層讀取），
// 故本檔不使用靜態 import，全部於設定 env 後動態載入。
const tmpDb = join(tmpdir(), `stock-industry-121-test-${process.pid}.db`)
process.env.DATABASE_PATH = tmpDb

const { parseIndustryRows, classifyNonStockCode, fetchTwseIndustry, buildNonStockRows, backfillNonStockIndustries, TWSE_INDUSTRY_NAMES } =
  await import('../src/fetchers/twse-industry.js')
const { dbQueryAll, dbExecute, closeDb } = await import('../src/db.js')

after(() => {
  closeDb()
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    if (existsSync(f)) rmSync(f, { force: true })
  }
  delete process.env.DATABASE_PATH
})

// ── fixture：t187ap03_L 形狀（只留本測試需要的欄位） ──
const LISTED_FIXTURE = [
  { 公司代號: '2330', 公司簡稱: '台積電', 產業別: '24' },
  { 公司代號: '2881', 公司簡稱: '富邦金', 產業別: '17' },
  { 公司代號: '1301', 公司簡稱: '台塑', 產業別: '03' },
  { 公司代號: '2002', 公司簡稱: '中鋼', 產業別: '10' },
  { 公司代號: '2603', 公司簡稱: '長榮', 產業別: '15' },
  { 公司代號: '2357', 公司簡稱: '華碩', 產業別: '25' },
]

// ── 純函式：代碼對照 ──
test('parseIndustryRows：industry_code 補零 2 碼、中文名對照正確', () => {
  const rows = parseIndustryRows(LISTED_FIXTURE)
  assert.equal(rows.length, 6)

  const byId = Object.fromEntries(rows.map((r) => [r.stock_id, r]))
  assert.equal(byId['2330'].industry_code, '24')
  assert.equal(byId['2330'].industry_name, '半導體業')
  assert.equal(byId['2881'].industry_name, '金融保險業')
  assert.equal(byId['1301'].industry_name, '塑膠工業')
  assert.equal(byId['2002'].industry_name, '鋼鐵工業')
  assert.equal(byId['2603'].industry_name, '航運業')
  assert.equal(byId['2357'].industry_name, '電腦及週邊設備業')
  assert.equal(byId['2330'].market, 'TWSE')
})

test('parseIndustryRows：單碼產業別補零（1 → 01），未知代碼以原文兜底', () => {
  const rows = parseIndustryRows([
    { 公司代號: '1101', 產業別: '1' },
    { 公司代號: '9999', 產業別: '77' },
  ])
  assert.equal(rows[0].industry_code, '01')
  assert.equal(rows[0].industry_name, '水泥工業')
  assert.equal(rows[1].industry_name, '77')
})

test('parseIndustryRows：缺欄位／畸形列略過、非陣列 / 非 JSON 回空陣列（不 throw）', () => {
  assert.deepEqual(parseIndustryRows(null), [])
  assert.deepEqual(parseIndustryRows(undefined), [])
  assert.deepEqual(parseIndustryRows('<html>error</html>'), [])
  assert.deepEqual(parseIndustryRows({ stat: 'error' }), [])

  const rows = parseIndustryRows([
    { 公司代號: '2330', 產業別: '24' },
    { 公司代號: '', 產業別: '24' },
    { 產業別: '24' },
    { 公司代號: '2881' },
    null,
    'oops',
    { 公司代號: '2330', 產業別: '17' }, // 重複代號：只留第一筆
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].stock_id, '2330')
  assert.equal(rows[0].industry_code, '24')
})

test('TWSE_INDUSTRY_NAMES：33 個官方產業別代碼', () => {
  assert.equal(Object.keys(TWSE_INDUSTRY_NAMES).length, 33)
  assert.equal(TWSE_INDUSTRY_NAMES['24'], '半導體業')
  assert.equal(TWSE_INDUSTRY_NAMES['91'], '存託憑證')
})

// ── 純函式：非公司代號歸類 ──
test('classifyNonStockCode：ETF／債券 ETF／存託憑證規則', () => {
  assert.equal(classifyNonStockCode('00679B'), '債券 ETF')
  assert.equal(classifyNonStockCode('00687B'), '債券 ETF')
  assert.equal(classifyNonStockCode('0050'), 'ETF')
  assert.equal(classifyNonStockCode('00878'), 'ETF')
  assert.equal(classifyNonStockCode('9105'), '存託憑證')
  assert.equal(classifyNonStockCode('2330'), null) // 一般公司代號：走官方產業別對照
  assert.equal(classifyNonStockCode('9999'), null) // 未知股號：未分類（不寫入，前端顯示「—」）
  assert.equal(classifyNonStockCode(''), null)
})

test('buildNonStockRows：ETF／債券 ETF／DR 產生列，公司代號與重複代號不產生', () => {
  const updatedAt = '2026-10-31T00:00:00.000Z'
  const rows = buildNonStockRows(
    ['0050', '00679B', '00687B', '00878', '9105', '2330', '2881A', '0050'],
    updatedAt,
  )

  assert.equal(rows.length, 5)
  const byId = Object.fromEntries(rows.map((r) => [r.stock_id, r]))
  assert.equal(byId['0050'].industry_name, 'ETF')
  assert.equal(byId['0050'].industry_code, '00')
  assert.equal(byId['0050'].market, 'NONSTOCK')
  assert.equal(byId['0050'].updated_at, updatedAt)
  assert.equal(byId['00878'].industry_name, 'ETF')
  assert.equal(byId['00679B'].industry_name, '債券 ETF')
  assert.equal(byId['00687B'].industry_name, '債券 ETF')
  assert.equal(byId['9105'].industry_name, '存託憑證')

  // 一般公司代號（2330）／非 B 尾碼特別股（2881A）不歸類
  assert.equal(byId['2330'], undefined)
  assert.equal(byId['2881A'], undefined)

  // 空輸入／畸形輸入 → 空陣列、不 throw
  assert.deepEqual(buildNonStockRows([], updatedAt), [])
  assert.deepEqual(buildNonStockRows(null as unknown as string[], updatedAt), [])
})

// ── 端到端（mock fetch + 暫存 SQLite）：upsert 冪等、非 JSON 不寫入 ──
function mockFetch(handler: () => { ok?: boolean; status?: number; text: string }) {
  const original = globalThis.fetch
  ;(globalThis as any).fetch = async () => {
    const res = handler()
    return { ok: res.ok ?? true, status: res.status ?? 200, text: async () => res.text }
  }
  return () => {
    globalThis.fetch = original
  }
}

test('fetchTwseIndustry：寫入 stock_industry，重跑一次筆數不變（冪等）', async () => {
  const restore = mockFetch(() => ({ text: JSON.stringify(LISTED_FIXTURE) }))
  try {
    const first = await fetchTwseIndustry()
    assert.equal(first, 6)

    const second = await fetchTwseIndustry()
    assert.equal(second, 6)

    const rows = await dbQueryAll<{ stock_id: string; industry_code: string; industry_name: string }>(
      'SELECT stock_id, industry_code, industry_name FROM stock_industry',
    )
    assert.equal(rows.length, 6)
    const tsmc = rows.find((r) => r.stock_id === '2330')
    assert.ok(tsmc)
    assert.equal(tsmc.industry_code, '24')
    assert.equal(tsmc.industry_name, '半導體業')
  } finally {
    restore()
  }
})

test('fetchTwseIndustry：非 JSON（HTML 錯誤頁）／5xx → 回 0 且不寫入、不 throw', async () => {
  const before = await dbQueryAll<{ stock_id: string }>('SELECT stock_id FROM stock_industry')

  const restoreHtml = mockFetch(() => ({ text: '<html><body>maintenance</body></html>' }))
  try {
    assert.equal(await fetchTwseIndustry(), 0)
  } finally {
    restoreHtml()
  }

  const restore5xx = mockFetch(() => ({ ok: false, status: 503, text: '' }))
  try {
    assert.equal(await fetchTwseIndustry(), 0)
  } finally {
    restore5xx()
  }

  const restoreThrow = mockFetch(() => {
    throw new Error('network down')
  })
  try {
    assert.equal(await fetchTwseIndustry(), 0)
  } finally {
    restoreThrow()
  }

  const after = await dbQueryAll<{ stock_id: string }>('SELECT stock_id FROM stock_industry')
  assert.equal(after.length, before.length)
})

test('backfillNonStockIndustries：由零股成交代號補寫 ETF／債券 ETF 列（冪等）', async () => {
  const insertTrade = (stockId: string, stockName: string) =>
    dbExecute(
      `INSERT OR REPLACE INTO odd_lot_trades (date, stock_id, stock_name, price, volume, bid_price, bid_volume, ask_price, ask_volume)
       VALUES ('20261030', @sid, @name, 100, 1000, 100, 10, 101, 10)`,
      { sid: stockId, name: stockName },
    )

  await insertTrade('0050', '元大台灣50')
  await insertTrade('00679B', '元大美債20年')
  await insertTrade('2330', '台積電')
  await insertTrade('2881A', '富邦金甲特')

  const first = await backfillNonStockIndustries('20261030')
  assert.equal(first, 2)

  const rows = await dbQueryAll<{
    stock_id: string
    industry_code: string
    industry_name: string
    market: string
  }>('SELECT stock_id, industry_code, industry_name, market FROM stock_industry')
  const byId = Object.fromEntries(rows.map((r) => [r.stock_id, r]))

  assert.equal(byId['0050'].industry_name, 'ETF')
  assert.equal(byId['0050'].industry_code, '00')
  assert.equal(byId['0050'].market, 'NONSTOCK')
  assert.equal(byId['00679B'].industry_name, '債券 ETF')
  // 一般公司代號與非 B 尾碼特別股不寫入
  assert.equal(byId['2881A'], undefined)
  // 既有官方產業列不被覆蓋（2330 仍為半導體業）
  assert.equal(byId['2330'].industry_name, '半導體業')

  const totalBefore = rows.length
  const second = await backfillNonStockIndustries('20261030')
  assert.equal(second, 2)
  const rowsAfter = await dbQueryAll<{ stock_id: string }>('SELECT stock_id FROM stock_industry')
  assert.equal(rowsAfter.length, totalBefore)

  // 無交易日 → 回 0、不 throw
  assert.equal(await backfillNonStockIndustries('20991231'), 0)
})

test('backfillNonStockIndustries：省略 date 時取最新交易日', async () => {
  const count = await backfillNonStockIndustries()
  assert.equal(count, 2)
})
