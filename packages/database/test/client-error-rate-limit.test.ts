import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, existsSync } from 'node:fs'

const tmpDb = join(tmpdir(), `client-error-171-test-${process.pid}.db`)
process.env.DATABASE_PATH = tmpDb

const {
  dbExecute,
  dbQueryAll,
  logApiError,
  countRecentClientErrors,
  closeDb,
} = await import('../src/db.js')

after(() => {
  closeDb()
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    if (existsSync(f)) rmSync(f, { force: true })
  }
  delete process.env.DATABASE_PATH
})

beforeEach(async () => {
  await dbExecute('DELETE FROM api_error_logs')
})

test('countRecentClientErrors 僅計入窗口內（<= 60s）同遮罩 IP 的 CLIENT 紀錄', async () => {
  const ip = '203.0.113.*'

  // 插入 2 筆超過 60 秒前的舊紀錄（應不計入）
  await dbExecute(
    `INSERT INTO api_error_logs (category, route, method, status_code, duration_ms, actor_type, client_ip, error_message, created_at)
     VALUES ('api_error', '/api/quote', 'CLIENT', 504, 1000, 'guest', @ip, 'old error', datetime('now', 'localtime', '-90 seconds'))`,
    { ip },
  )
  await dbExecute(
    `INSERT INTO api_error_logs (category, route, method, status_code, duration_ms, actor_type, client_ip, error_message, created_at)
     VALUES ('api_error', '/api/quote', 'CLIENT', 504, 1000, 'guest', @ip, 'old error 2', datetime('now', 'localtime', '-65 seconds'))`,
    { ip },
  )

  // 插入 1 筆非 CLIENT（GET）的紀錄與 1 筆不同 IP 的 CLIENT 紀錄（皆不應計入）
  await logApiError({
    category: 'api_error',
    route: '/api/quote',
    method: 'GET',
    statusCode: 500,
    durationMs: 100,
    actorType: 'guest',
    clientIp: ip,
    errorMessage: 'server error',
  })
  await logApiError({
    category: 'api_error',
    route: '/api/quote',
    method: 'CLIENT',
    statusCode: 504,
    durationMs: 100,
    actorType: 'guest',
    clientIp: '198.51.100.*',
    errorMessage: 'other ip',
  })

  assert.equal(await countRecentClientErrors(ip, 60_000), 0)

  // 寫入 10 筆窗口內 CLIENT 紀錄
  for (let i = 0; i < 10; i++) {
    await logApiError({
      category: 'api_error',
      route: '/api/quote',
      method: 'CLIENT',
      statusCode: 504,
      durationMs: 200,
      actorType: 'guest',
      clientIp: ip,
      errorMessage: `err-${i}`,
    })
  }

  assert.equal(await countRecentClientErrors(ip, 60_000), 10)
  const totalRows = await dbQueryAll<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM api_error_logs WHERE client_ip = @ip AND method = @method', {
    ip,
    method: 'CLIENT',
  })
  assert.equal(Number(totalRows[0]?.cnt ?? 0), 12)
})
