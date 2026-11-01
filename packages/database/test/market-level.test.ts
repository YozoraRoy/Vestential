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
    taiex: 45211.83,
    peRatio: 22.1,
    pbRatio: 2.52,
    dividendYield: 2.85,
    pePercentile: 73.0,
    pbPercentile: 72.0,
    compositePercentile: 72.5,
    levelStatus: 'warm',
  })

  const row = await getMarketLevelByDate('2026-10-30')
  assert.ok(row)
  assert.equal(row.trade_date, '2026-10-30')
  assert.equal(row.taiex, 45211.83)
  assert.equal(row.pe_ratio, 22.1)
  assert.equal(row.pb_ratio, 2.52)
  assert.equal(row.dividend_yield, 2.85)
  assert.equal(row.pe_percentile, 73.0)
  assert.equal(row.pb_percentile, 72.0)
  assert.equal(row.composite_percentile, 72.5)
  assert.equal(row.level_status, 'warm')
})

test('Issue #74 market_levels：同 trade_date 重複寫入為更新（冪等，不長重複列）', async () => {
  await upsertMarketLevel({
    tradeDate: '2026-10-30',
    taiex: 45500.0,
    peRatio: 22.3,
    pbRatio: 2.55,
    dividendYield: 2.80,
    pePercentile: 75.0,
    pbPercentile: 73.0,
    compositePercentile: 74.0,
    levelStatus: 'warm',
  })

  const rows = await getMarketLevels(10)
  const matched = rows.filter((r) => r.trade_date === '2026-10-30')
  assert.equal(matched.length, 1)
  assert.equal(matched[0].taiex, 45500.0)
  assert.equal(matched[0].composite_percentile, 74.0)
})

test('Issue #74 market_levels：批次寫入與降序列表讀取', async () => {
  const batch = [
    {
      tradeDate: '2026-10-27',
      taiex: 46041.43,
      peRatio: 22.8,
      pbRatio: 2.62,
      dividendYield: 2.75,
      pePercentile: 78.0,
      pbPercentile: 77.0,
      compositePercentile: 77.5,
      levelStatus: 'warm',
    },
    {
      tradeDate: '2026-10-29',
      taiex: 45800.0,
      peRatio: 22.5,
      pbRatio: 2.58,
      dividendYield: 2.78,
      pePercentile: 76.0,
      pbPercentile: 75.0,
      compositePercentile: 75.5,
      levelStatus: 'warm',
    },
  ]
  const count = await upsertMarketLevels(batch)
  assert.equal(count, 2)

  const rows = await getMarketLevels(10)
  assert.ok(rows.length >= 3)
  // 確認降序：最新日期在前
  assert.equal(rows[0].trade_date, '2026-10-30')
  assert.equal(rows[1].trade_date, '2026-10-29')
  assert.equal(rows[2].trade_date, '2026-10-27')

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
