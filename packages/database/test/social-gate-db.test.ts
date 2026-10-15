import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, existsSync } from 'node:fs'

// Issue #79：DB gate 時間窗行為（真 SQLite，斷言 SQL＋wall-clock 格式＋狀態過濾）。
// DB 路徑必須在載入 src/db.ts 之前決定（DB_PATH 於模組頂層讀取），
// 故本檔不使用靜態 import，全部於設定 env 後動態載入（同 twse-odd-lot.test.ts）。
const tmpDb = join(tmpdir(), `social-gate-79-test-${process.pid}.db`)
process.env.DATABASE_PATH = tmpDb

const {
  dbExecute,
  hasAnySocialPublishedSince,
  countSocialPublishedSince,
  closeDb,
} = await import('../src/db.js')

after(() => {
  closeDb()
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    if (existsSync(f)) rmSync(f, { force: true })
  }
  delete process.env.DATABASE_PATH
})

async function seedSocialRow(opts: {
  platform?: string
  editionKey?: string
  status?: string
  publishedAt?: string | null
  createdAt?: string
}): Promise<void> {
  const {
    platform = 'instagram',
    editionKey = `ed-${Math.random().toString(36).slice(2)}`,
    status = 'published',
    publishedAt = '2026-10-14 03:02:00',
    createdAt = '2026-10-14 03:02:00',
  } = opts
  await dbExecute(
    `INSERT INTO social_posts (platform, edition_key, content, status, published_at, created_at)
     VALUES (@platform, @editionKey, @content, @status, @publishedAt, @createdAt)`,
    { platform, editionKey, content: 'c', status, publishedAt, createdAt },
  )
}

beforeEach(async () => {
  await dbExecute('DELETE FROM social_posts')
})

// UTC 日曆日邊界：dayStart 以來有 published 即擋同日第二跑
test('當日有 published → has=true（同日第二跑跳過）', async () => {
  await seedSocialRow({ platform: 'instagram', publishedAt: '2026-10-14 03:02:00' })

  assert.equal(await hasAnySocialPublishedSince('2026-10-14 00:00:00'), true)
  assert.equal(await countSocialPublishedSince('2026-10-14 00:00:00'), 1)
})

// failed／deferred 不計入、不阻擋 gate
test('當日僅 failed／deferred（無 published）→ has=false 照發', async () => {
  await seedSocialRow({ platform: 'instagram', status: 'failed', publishedAt: null })
  await seedSocialRow({ platform: 'threads', status: 'deferred', publishedAt: null })

  assert.equal(await hasAnySocialPublishedSince('2026-10-14 00:00:00'), false)
  assert.equal(await countSocialPublishedSince('2026-10-14 00:00:00'), 0)
})

// rolling-24h 陷阱：昨日 03:00 延遲發文不擋今日（日曆日邊界歸屬昨日）
test('昨日 published、今日無 → 今日 gate 通過（跨日正常再發）', async () => {
  await seedSocialRow({
    platform: 'instagram',
    editionKey: '2026-10-13T00:00:00Z',
    publishedAt: '2026-10-13 03:00:00',
    createdAt: '2026-10-13 03:00:00',
  })

  assert.equal(await hasAnySocialPublishedSince('2026-10-13 00:00:00'), true)
  assert.equal(await hasAnySocialPublishedSince('2026-10-14 00:00:00'), false)
})

// published_at 為 NULL 的異常列退回以 created_at 判斷（COALESCE 兜底）
test('published_at NULL 時以 created_at 兜底', async () => {
  await seedSocialRow({ platform: 'facebook', publishedAt: null, createdAt: '2026-10-14 01:00:00' })

  assert.equal(await hasAnySocialPublishedSince('2026-10-14 00:00:00'), true)
  assert.equal(await hasAnySocialPublishedSince('2026-10-15 00:00:00'), false)
})

// 同形 wall-clock 字串比較：同日稍晚的列一定 >= 當日 00:00:00
test('同日多平台 published 皆計入（字串比較即時間比較）', async () => {
  await seedSocialRow({ platform: 'instagram', publishedAt: '2026-10-14 00:30:00' })
  await seedSocialRow({ platform: 'threads', publishedAt: '2026-10-14 12:00:00' })
  await seedSocialRow({ platform: 'facebook', publishedAt: '2026-10-14 23:59:59' })

  assert.equal(await countSocialPublishedSince('2026-10-14 00:00:00'), 3)
})
