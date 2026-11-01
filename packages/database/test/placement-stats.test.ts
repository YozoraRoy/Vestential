import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, existsSync } from 'node:fs'

const tmpDb = join(tmpdir(), `placement-stats-test-${process.pid}.db`)
process.env.DATABASE_PATH = tmpDb
delete process.env.DATABASE_URL

const { migrate, logPlacementEvent, getPlacementEventStats, closeDb } = await import('../src/db.js')

after(() => {
  closeDb()
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    if (existsSync(f)) rmSync(f, { force: true })
  }
  delete process.env.DATABASE_PATH
})

test('getPlacementEventStats｜Issue #119 GROUP BY 相容性與統計回傳', async () => {
  await migrate()

  await logPlacementEvent('page_view')
  await logPlacementEvent('backtest_run', { symbol: '2330' })
  await logPlacementEvent('backtest_run', { symbol: '2330' })
  await logPlacementEvent('backtest_run', { symbol: '0050' })

  const stats = await getPlacementEventStats()
  assert.equal(stats.pageViews, 1)
  assert.equal(stats.runCount, 3)

  assert.ok(Array.isArray(stats.runBySymbol))
  const hit2330 = stats.runBySymbol.find((r) => r.symbol === '2330')
  assert.ok(hit2330)
  assert.equal(hit2330.count, 2)

  assert.ok(Array.isArray(stats.runByUser))
  assert.ok(stats.runByUser.length >= 1)
  assert.equal(typeof stats.runByUser[0].count, 'number')
})
