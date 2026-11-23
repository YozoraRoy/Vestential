import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveStockDisplayName,
  formatStockLabel,
  normalizeStockCode,
  isTwStockSymbol,
  isLikelyEnglishStockName,
} from '@stock/core'
import {
  migrate,
  closeDb,
  upsertStockNames,
  getStockMultilingualName,
  getStockMultilingualNames,
  getStockNameById,
} from '../src/index.js'

test('resolveStockDisplayName & formatStockLabel 依語系與市場別正確解析', () => {
  // 台股 ETF 有中英文
  const twEtf = { nameZh: '元大台灣50', nameEn: 'Yuanta/P-shares Taiwan Top 50 ETF', market: 'TW' }
  assert.equal(resolveStockDisplayName('0050.TW', twEtf, 'zh-TW'), '元大台灣50')
  assert.equal(resolveStockDisplayName('0050', twEtf, 'en'), 'Yuanta/P-shares Taiwan Top 50 ETF')
  assert.equal(resolveStockDisplayName('0050', twEtf, 'ja'), '元大台湾50')
  assert.equal(formatStockLabel('0050.TW', twEtf, 'zh-TW'), '0050 元大台灣50')

  // 台股 ETF 無日文對照時，ja fallback 至英文
  const twEtfNoJa = { nameZh: '國泰永續高股息', nameEn: 'Cathay MSCI Taiwan ESG Sustainability High Dividend Yield ETF', market: 'TW' }
  assert.equal(resolveStockDisplayName('00878', twEtfNoJa, 'zh-TW'), '國泰永續高股息')
  assert.equal(resolveStockDisplayName('00878', twEtfNoJa, 'ja'), 'Cathay MSCI Taiwan ESG Sustainability High Dividend Yield ETF')

  // 台股 ETF 只有英文、無 DB 中文時，zh-TW 透過靜態字典 fallback 至中文
  assert.equal(
    resolveStockDisplayName('00919', { nameEn: 'Capital TIP Customized Taiwan Select High Dividend ETF', market: 'TW' }, 'zh-TW'),
    '群益台灣精選高息',
  )

  // 美股在 zh-TW 保留英文官方名稱
  const usStock = { nameEn: 'Apple Inc.', market: 'US' }
  assert.equal(resolveStockDisplayName('AAPL', usStock, 'zh-TW'), 'Apple Inc.')
  assert.equal(resolveStockDisplayName('AAPL', usStock, 'en'), 'Apple Inc.')
  assert.equal(formatStockLabel('AAPL', usStock, 'zh-TW'), 'AAPL Apple Inc.')

  // 完全無名稱時回傳正規化代號
  assert.equal(resolveStockDisplayName('9999.TWO', null, 'zh-TW'), '9999')
  assert.equal(formatStockLabel('9999.TWO', null, 'zh-TW'), '9999')

  assert.equal(normalizeStockCode('0050.tw'), '0050')
  assert.equal(isTwStockSymbol('00679B'), true)
  assert.equal(isTwStockSymbol('AAPL'), false)
  assert.equal(isLikelyEnglishStockName('Yuanta Taiwan 50'), true)
  assert.equal(isLikelyEnglishStockName('元大台灣50'), false)
})

test('stock_names SQLite 寫入、合併保留非空欄位與查詢', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stock-names-test-'))
  const prevDbPath = process.env.DATABASE_PATH
  const prevDbUrl = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  process.env.DATABASE_PATH = join(dir, 'test.db')

  try {
    await migrate()

    const count = await upsertStockNames([
      { symbol: '0050.TW', nameZh: '元大台灣50', market: 'TW', source: 'twse' },
      { symbol: '00919', nameZh: '群益台灣精選高息', market: 'TW', source: 'twse' },
      { symbol: 'AAPL', nameEn: 'Apple Inc.', market: 'US', source: 'yahoo' },
    ])
    assert.equal(count, 3)

    // 補寫英文名時不應把既有的 name_zh 覆蓋成 null
    await upsertStockNames([
      { symbol: '0050', nameEn: 'Yuanta Taiwan Top 50 ETF', market: 'TW', source: 'yahoo' },
    ])

    const one = await getStockMultilingualName('0050.TW')
    assert.ok(one)
    assert.equal(one.nameZh, '元大台灣50')
    assert.equal(one.nameEn, 'Yuanta Taiwan Top 50 ETF')
    assert.equal(one.market, 'TW')

    // 既有 getStockNameById 也能查到 stock_names 的中文正名
    assert.equal(await getStockNameById('00919'), '群益台灣精選高息')

    const batch = await getStockMultilingualNames(['0050', 'AAPL', 'UNKNOWN'])
    assert.equal(batch['0050']?.nameZh, '元大台灣50')
    assert.equal(batch['AAPL']?.nameEn, 'Apple Inc.')
    assert.equal(batch['UNKNOWN'], undefined)
  } finally {
    await closeDb()
    if (prevDbPath === undefined) delete process.env.DATABASE_PATH
    else process.env.DATABASE_PATH = prevDbPath
    if (prevDbUrl !== undefined) process.env.DATABASE_URL = prevDbUrl
    rmSync(dir, { recursive: true, force: true })
  }
})
