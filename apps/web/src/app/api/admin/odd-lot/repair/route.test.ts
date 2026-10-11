import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@stock/database', () => ({
  fetchTwseOddLots: vi.fn(),
  deleteOddLotByDate: vi.fn(),
  listOddLotDateCounts: vi.fn(),
  migrate: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}))

import { POST } from './route'
import {
  fetchTwseOddLots,
  deleteOddLotByDate,
  listOddLotDateCounts,
  migrate,
} from '@stock/database'

const SYNC_TOKEN = 'test-sync-token-0123456789abcdef'

function postRequest(body: unknown, token?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  return new Request('http://localhost/api/admin/odd-lot/repair', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SYNC_TOKEN = SYNC_TOKEN
  vi.mocked(listOddLotDateCounts).mockResolvedValue([
    { date: '20261009', cnt: 1200 },
    { date: '20261008', cnt: 1150 },
  ])
  vi.mocked(deleteOddLotByDate).mockResolvedValue(1200)
  vi.mocked(fetchTwseOddLots).mockResolvedValue(1150)
})

describe('POST /api/admin/odd-lot/repair｜鑑權（沿用 SYNC_TOKEN bearer）', () => {
  it('無 token 回 401', async () => {
    const res = await POST(postRequest({ action: 'assess' }))
    expect(res.status).toBe(401)
  })
  it('錯誤 token 回 401', async () => {
    const res = await POST(postRequest({ action: 'assess' }, 'wrong-token-0123456789abcdef'))
    expect(res.status).toBe(401)
  })
  it('正確 Bearer token 放行 assess', async () => {
    const res = await POST(postRequest({ action: 'assess' }, SYNC_TOKEN))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.counts).toHaveLength(2)
  })
})

describe('POST /api/admin/odd-lot/repair｜dry-run 零寫入', () => {
  it('assess 不呼叫任何寫入函式', async () => {
    await POST(postRequest({ action: 'assess' }, SYNC_TOKEN))
    expect(deleteOddLotByDate).not.toHaveBeenCalled()
    expect(fetchTwseOddLots).not.toHaveBeenCalled()
    expect(migrate).not.toHaveBeenCalled()
  })
  it('delete 無 confirm 不執行刪除', async () => {
    const res = await POST(postRequest({ action: 'delete', date: '20261009', dryRun: false }, SYNC_TOKEN))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.wouldDelete).toBe(1200)
    expect(json.deleted).toBe(0)
    expect(deleteOddLotByDate).not.toHaveBeenCalled()
  })
  it('backfill 預設 dry-run 不抓取寫入', async () => {
    const res = await POST(postRequest({ action: 'backfill', date: '20261008' }, SYNC_TOKEN))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.inserted).toBe(0)
    expect(fetchTwseOddLots).not.toHaveBeenCalled()
    expect(migrate).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/odd-lot/repair｜確認後執行', () => {
  it('delete confirm:true＋dryRun:false 執行刪除', async () => {
    const res = await POST(
      postRequest({ action: 'delete', date: '20261009', confirm: true, dryRun: false }, SYNC_TOKEN),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.deleted).toBe(1200)
    expect(deleteOddLotByDate).toHaveBeenCalledWith('20261009')
  })
  it('backfill dryRun:false 沿既有寫入路徑執行（migrate＋dated fetcher）', async () => {
    const res = await POST(postRequest({ action: 'backfill', date: '20261008', dryRun: false }, SYNC_TOKEN))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.inserted).toBe(1150)
    expect(migrate).toHaveBeenCalled()
    expect(fetchTwseOddLots).toHaveBeenCalledWith('20261008')
  })
})
