import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, rmSync } from 'node:fs'

const tmpDb = join(tmpdir(), `client-error-route-171-${process.pid}.db`)

vi.mock('@/lib/auth', () => ({
  getCurrentUserFromReq: vi.fn(async () => null),
}))

describe('POST /api/telemetry/client-error (Issue #171 DB 限流整合測試)', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let dbExecute: (sql: string, params?: Record<string, unknown>) => Promise<void>
  let dbQueryAll: <T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>) => Promise<T[]>
  let closeDb: () => void

  beforeAll(async () => {
    process.env.DATABASE_PATH = tmpDb
    const dbMod = await import('@stock/database')
    dbExecute = dbMod.dbExecute
    dbQueryAll = dbMod.dbQueryAll
    closeDb = dbMod.closeDb
    const routeMod = await import('./route')
    POST = routeMod.POST
  })

  beforeEach(async () => {
    await dbExecute('DELETE FROM api_error_logs')
  })

  afterAll(() => {
    closeDb()
    for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
      if (existsSync(f)) rmSync(f, { force: true })
    }
    delete process.env.DATABASE_PATH
  })

  function makeReq(ip = '203.0.113.45') {
    return new NextRequest('https://vestential.com/api/telemetry/client-error', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
        'user-agent': 'Mozilla/5.0 Chrome/126.0',
      },
      body: JSON.stringify({
        route: '/api/quote',
        statusCode: 504,
        durationMs: 15000,
        errorMessage: 'Gateway timeout',
      }),
    })
  }

  it('同遮罩 IP 連送 10 筆皆寫入，第 11 筆回 429 且 DB 筆數仍為 10', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await POST(makeReq('203.0.113.45'))
      expect(res.status).toBe(200)
    }

    const res11 = await POST(makeReq('203.0.113.99')) // 同遮罩 IP: 203.0.113.*
    expect(res11.status).toBe(429)

    const rows = await dbQueryAll<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM api_error_logs WHERE method = 'CLIENT' AND client_ip = '203.0.113.*'",
    )
    expect(Number(rows[0]?.cnt ?? 0)).toBe(10)
  })

  it('窗口外舊紀錄（>60 秒前）不計入，當前請求仍可通過', async () => {
    for (let i = 0; i < 10; i++) {
      await dbExecute(
        `INSERT INTO api_error_logs (category, route, method, status_code, duration_ms, actor_type, client_ip, error_message, created_at)
         VALUES ('api_error', '/api/quote', 'CLIENT', 504, 1000, 'guest', '198.51.100.*', 'stale error', datetime('now', 'localtime', '-90 seconds'))`,
      )
    }

    const res = await POST(makeReq('198.51.100.12'))
    expect(res.status).toBe(200)

    const rows = await dbQueryAll<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM api_error_logs WHERE method = 'CLIENT' AND client_ip = '198.51.100.*'",
    )
    expect(Number(rows[0]?.cnt ?? 0)).toBe(11)
  })
})
