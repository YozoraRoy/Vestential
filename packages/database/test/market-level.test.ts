import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, existsSync } from 'node:fs'

const tmpDb = join(tmpdir(), `market-level-test-${process.pid}.db`)
process.env.DATABASE_PATH = tmpDb

const {
  upsertMarketLevel,
  upsertMarketLevels,
  getMarketLevels,
  getLatestMarketLevel,
  getMarketLevelByDate,
  closeDb,
} = await import('../src/index.js')

after(() => {
  closeDb()
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    if (existsSync(f)) rmSync(f, { force: true })
  }
  delete process.env.DATABASE_PATH
})

test('Issue #74 market_levels：單筆 upsert 與欄位讀取', async () => {
  await upsertMarketLevel({
    tradeDate: '2026-10-30',
    taiex: 49949.91,
    peRatio: 24.5,
    pbRatio: 2.8,
    dividendYield: 2.75,
    pePercentile: 88.5,
    pbPercentile: 85.0,
    compositePercentile: 86.75,
    levelStatus: 'overheated',
  })

  const row = await getMarketLevelByDate('2026-10-30')
  assert.ok(row)
  assert.equal(row.trade_date, '2026-10-30')
  assert.equal(row.taiex, 49949.91)
  assert.equal(row.pe_ratio, 24.5)
  assert.equal(row.pb_ratio, 2.8)
  assert.equal(row.dividend_yield, 2.75)
  assert.equal(row.pe_percentile, 88.5)
  assert.equal(row.pb_percentile, 85.0)
  assert.equal(row.composite_percentile, 86.75)
  assert.equal(row.level_status, 'overheated')
})

test('Issue #74 market_levels：同 trade_date 重複寫入為更新（冪等，不長重複列）', async () => {
  await upsertMarketLevel({
    tradeDate: '2026-10-30',
    taiex: 50000.0,
    peRatio: 24.8,
    pbRatio: 2.85,
    dividendYield: 2.70,
    pePercentile: 90.0,
    pbPercentile: 86.0,
    compositePercentile: 88.0,
    levelStatus: 'overheated',
  })

  const rows = await getMarketLevels(10)
  const matched = rows.filter((r) => r.trade_date === '2026-10-30')
  assert.equal(matched.length, 1)
  assert.equal(matched[0].taiex, 50000.0)
  assert.equal(matched[0].composite_percentile, 88.0)
})

test('Issue #74 market_levels：批次寫入與降序列表讀取', async () => {
  const batch = [
    {
      tradeDate: '2026-10-28',
      taiex: 49500.0,
      peRatio: 24.1,
      pbRatio: 2.75,
      dividendYield: 2.80,
      pePercentile: 85.0,
      pbPercentile: 82.0,
      compositePercentile: 83.5,
      levelStatus: 'overheated',
    },
    {
      tradeDate: '2026-10-29',
      taiex: 49700.0,
      peRatio: 24.3,
      pbRatio: 2.78,
      dividendYield: 2.77,
      pePercentile: 86.5,
      pbPercentile: 83.5,
      compositePercentile: 85.0,
      levelStatus: 'overheated',
    },
  ]
  const count = await upsertMarketLevels(batch)
  assert.equal(count, 2)

  const rows = await getMarketLevels(10)
  assert.ok(rows.length >= 3)
  // 確認降序：最新日期在前
  assert.equal(rows[0].trade_date, '2026-10-30')
  assert.equal(rows[1].trade_date, '2026-10-29')
  assert.equal(rows[2].trade_date, '2026-10-28')

  const latest = await getLatestMarketLevel()
  assert.ok(latest)
  assert.equal(latest.trade_date, '2026-10-30')
})

test('Issue #74 market_levels：非法日期防呆', async () => {
  await assert.rejects(
    async () => {
      await upsertMarketLevel({ tradeDate: 'invalid-date' })
    },
    /invalid market level row/,
  )

  const nonExistent = await getMarketLevelByDate('1999-01-01')
  assert.equal(nonExistent, null)
})
