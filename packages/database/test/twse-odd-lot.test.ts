import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, existsSync } from 'node:fs'

// Issue #65：DB 路徑必須在載入 src/db.ts 之前決定（DB_PATH 於模組頂層讀取），
// 故本檔不使用靜態 import，全部於設定 env 後動態載入。
const tmpDb = join(tmpdir(), `odd-lot-65-test-${process.pid}.db`)
process.env.DATABASE_PATH = tmpDb

const { parseDatedOddLotResponse, fetchTwseOddLots, deleteOddLotByDate, listOddLotDateCounts } =
  await import('../src/fetchers/twse-odd-lot.js')
const { dbQueryAll, closeDb } = await import('../src/db.js')

after(() => {
  closeDb()
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    if (existsSync(f)) rmSync(f, { force: true })
  }
  delete process.env.DATABASE_PATH
})

// ── 固定 fixture：模擬 dated 端點 TWT53U?date=YYYYMMDD&response=json ──
const TRADING_FIXTURE_20261008 = {
  stat: 'OK',
  date: '20261008',
  fields: ['證券代號', '證券名稱', '成交股數', '成交筆數', '成交金額', '收盤價', '最佳買價', '最佳買量', '最佳賣價', '最佳賣量'],
  data: [
    ['2330', '台積電', '80,120', '1,234', '94,941,600', '1,185.00', '1,184.50', '5,000', '1,185.50', '6,000'],
    ['0050', '元大台灣50', '527,570', '5,636', '60,642,101', '114.95', '114.90', '61,679', '114.95', '1,172,866'],
    ['合計', '合計', '607,690', '6,870', '155,583,701', '--', '--', '0', '--', '0'],
    ['SHORT'],
  ],
}

// 休市日（2026-10-09 國慶補假）：stat 非 OK，無 data。
const HOLIDAY_FIXTURE_20261009 = {
  stat: '很抱歉，沒有符合條件的資料!',
  hints: '查無資料',
  total: null,
}

function mockFetch(handler: (dateParam: string) => unknown) {
  const original = globalThis.fetch
  ;(globalThis as any).fetch = async (url: string | URL | Request) => {
    const u = String(url)
    const m = u.match(/[?&]date=(\d{8})/)
    const dateParam = m?.[1] ?? ''
    return { ok: true, json: async () => handler(dateParam) }
  }
  return () => {
    globalThis.fetch = original
  }
}

// ── 純解析：fixture 斷言 ──
test('parseDatedOddLotResponse：交易日 fixture 正規化為列（跳過合計/畸形列）', () => {
  const items = parseDatedOddLotResponse(TRADING_FIXTURE_20261008)
  assert.ok(items)
  assert.equal(items.length, 2)
  const tsmc = items.find((i) => i.Code === '2330')
  assert.ok(tsmc)
  assert.equal(tsmc.Name, '台積電')
  assert.equal(tsmc.TradeVolume, '80,120')
  assert.equal(tsmc.TradePrice, '1,185.00')
})

test('parseDatedOddLotResponse：休市日 stat 非 OK → null（不得寫入）', () => {
  assert.equal(parseDatedOddLotResponse(HOLIDAY_FIXTURE_20261009), null)
  assert.equal(parseDatedOddLotResponse(null), null)
  assert.equal(parseDatedOddLotResponse({}), null)
})

// ── 端到端（mock fetch + 暫存 SQLite）：標籤須等於資料真實交易日 ──
test('fetchTwseOddLots(20261008)：寫入列全標 20261008，2330 與 dated 端點一致', async () => {
  const restore = mockFetch((dateParam) => {
    assert.equal(dateParam, '20261008')
    return TRADING_FIXTURE_20261008
  })
  try {
    const count = await fetchTwseOddLots('20261008')
    assert.equal(count, 2)

    const rows = await dbQueryAll<{ date: string; stock_id: string; price: number; volume: number }>(
      'SELECT date, stock_id, price, volume FROM odd_lot_trades WHERE date = @date',
      { date: '20261008' },
    )
    assert.equal(rows.length, 2)
    for (const r of rows) assert.equal(r.date, '20261008')

    const tsmc = rows.find((r) => r.stock_id === '2330')
    assert.ok(tsmc)
    assert.equal(tsmc.price, 1185)
    assert.equal(tsmc.volume, 80120)
  } finally {
    restore()
  }
})

test('fetchTwseOddLots(20261009 休市)：回 0 且不寫入任何列', async () => {
  const restore = mockFetch((dateParam) => {
    assert.equal(dateParam, '20261009')
    return HOLIDAY_FIXTURE_20261009
  })
  try {
    const count = await fetchTwseOddLots('20261009')
    assert.equal(count, 0)
    const rows = await dbQueryAll<{ date: string }>(
      'SELECT date FROM odd_lot_trades WHERE date = @date',
      { date: '20261009' },
    )
    assert.equal(rows.length, 0)
  } finally {
    restore()
  }
})

test('日期防呆：回應 date 與請求不符時不寫入（避免 +1 天錯標重演）', async () => {
  const restore = mockFetch(() => TRADING_FIXTURE_20261008) // 回 10/08 資料
  try {
    const count = await fetchTwseOddLots('20261009') // 卻標 10/09
    assert.equal(count, 0)
    const rows = await dbQueryAll<{ date: string }>(
      'SELECT date FROM odd_lot_trades WHERE date = @date',
      { date: '20261009' },
    )
    assert.equal(rows.length, 0)
  } finally {
    restore()
  }
})

test('deleteOddLotByDate：清掉錯標籤日期列並回報筆數', async () => {
  const deleted = await deleteOddLotByDate('20261008')
  assert.equal(deleted, 2)
  const rows = await dbQueryAll<{ date: string }>(
    'SELECT date FROM odd_lot_trades WHERE date = @date',
    { date: '20261008' },
  )
  assert.equal(rows.length, 0)
  assert.equal(await deleteOddLotByDate('20261008'), 0)

  const counts = await listOddLotDateCounts()
  assert.ok(!counts.some((c) => c.date === '20261008'))
})
