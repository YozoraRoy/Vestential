import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, existsSync } from 'node:fs'

// Issue #101：twse_dividends 增 prev_close（除息日昨收）。
// DB 路徑須在載入 src/db.ts 之前決定（DB_PATH 於模組頂層讀取），故動態 import。
const tmpDb = join(tmpdir(), `twse-div-101-test-${process.pid}.db`)
process.env.DATABASE_PATH = tmpDb

const { migrate, upsertTwseDividends, getTwseDividendsByYear, dbQueryAll, dbExecute, closeDb } =
  await import('../src/db.js')

after(() => {
  closeDb()
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    if (existsSync(f)) rmSync(f, { force: true })
  }
  delete process.env.DATABASE_PATH
})

async function columns(): Promise<string[]> {
  const rows = await dbQueryAll<{ name: string }>('PRAGMA table_info(twse_dividends)')
  return rows.map((r) => r.name)
}

async function rowFor(symbol: string, exDate: string) {
  const year = exDate.slice(0, 4)
  const rows = await getTwseDividendsByYear(year)
  return rows.find((r) => r.symbol === symbol && r.ex_date === exDate)
}

test('schema：twse_dividends 有 prev_close，且既有欄位仍在（向下相容）', async () => {
  await migrate()
  const cols = await columns()
  assert.ok(cols.includes('prev_close'), `prev_close 缺少：${cols.join(',')}`)
  for (const c of ['id', 'symbol', 'ex_date', 'cash_dividend', 'created_at']) {
    assert.ok(cols.includes(c), `既有欄位 ${c} 不得消失`)
  }
})

test('upsert：INSERT 帶入 prev_close', async () => {
  const written = await upsertTwseDividends([
    { symbol: '00878', ex_date: '2026-08-18', cash_dividend: 1.01, prev_close: 33.75 },
  ])
  assert.equal(written, 1)
  const row = await rowFor('00878', '2026-08-18')
  assert.ok(row)
  assert.equal(row.cash_dividend, 1.01)
  assert.equal(row.prev_close, 33.75)
})

test('upsert：UPDATE 只在傳入值非 null 才覆蓋 prev_close（不得被 null 抹掉）', async () => {
  // TWT48U 每日預告列無前收 → 傳 null，須保留既有 33.75（僅更新現金股利）。
  await upsertTwseDividends([
    { symbol: '00878', ex_date: '2026-08-18', cash_dividend: 1.02, prev_close: null },
  ])
  let row = await rowFor('00878', '2026-08-18')
  assert.equal(row?.cash_dividend, 1.02)
  assert.equal(row?.prev_close, 33.75)

  // 未帶 prev_close（undefined）同樣不得抹除。
  await upsertTwseDividends([{ symbol: '00878', ex_date: '2026-08-18', cash_dividend: 1.01 }])
  row = await rowFor('00878', '2026-08-18')
  assert.equal(row?.cash_dividend, 1.01)
  assert.equal(row?.prev_close, 33.75)

  // 有值 → 覆蓋（重新回填可修正前收）。
  await upsertTwseDividends([
    { symbol: '00878', ex_date: '2026-08-18', cash_dividend: 1.01, prev_close: 33.8 },
  ])
  row = await rowFor('00878', '2026-08-18')
  assert.equal(row?.prev_close, 33.8)
})

test('upsert：非正數／非有限的前收一律視為無值（不寫 0 代墊）', async () => {
  await upsertTwseDividends([
    { symbol: '00929', ex_date: '2026-09-17', cash_dividend: 0.38, prev_close: 0 },
    { symbol: '00929', ex_date: '2026-08-19', cash_dividend: 0.38, prev_close: Number.NaN },
  ])
  assert.equal((await rowFor('00929', '2026-09-17'))?.prev_close, null)
  assert.equal((await rowFor('00929', '2026-08-19'))?.prev_close, null)
})

test('migration 032 重跑冪等：欄位已存在（migrations 記錄被清）時不炸、不重建表', async () => {
  await dbExecute('DELETE FROM migrations WHERE name = @name', {
    name: '032_twse_dividends_prev_close.sql',
  })
  const recorded = await dbQueryAll<{ name: string }>(
    'SELECT name FROM migrations WHERE name = @name',
    { name: '032_twse_dividends_prev_close.sql' },
  )
  assert.equal(recorded.length, 0)

  // 第二次套用：ALTER 會撞 duplicate column → runner 須 skip 並記錄，不 throw。
  await migrate()
  await migrate()

  const cols = await columns()
  assert.equal(cols.filter((c) => c === 'prev_close').length, 1, 'prev_close 不得重複')
  const after = await dbQueryAll<{ name: string }>(
    'SELECT name FROM migrations WHERE name = @name',
    { name: '032_twse_dividends_prev_close.sql' },
  )
  assert.equal(after.length, 1, 'migration 須重新記錄')

  // 冪等重跑不得動到資料。
  const row = await rowFor('00878', '2026-08-18')
  assert.equal(row?.cash_dividend, 1.01)
  assert.equal(row?.prev_close, 33.8)
})
