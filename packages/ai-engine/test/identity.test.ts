import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIdentityContext, sanitizeStockName } from '../src/identity.js'

test('sanitizeStockName - 去尾端註記星號、其餘字元不動', () => {
  assert.equal(sanitizeStockName('國巨*'), '國巨')
  assert.equal(sanitizeStockName(' 台積電 '), '台積電')
  assert.equal(sanitizeStockName('Yageo Corporation'), 'Yageo Corporation')
  assert.equal(sanitizeStockName('***'), null)
  assert.equal(sanitizeStockName(''), null)
  assert.equal(sanitizeStockName(null), null)
})

test('buildIdentityContext - 中英正名都在：公司行含中文與英文', () => {
  const block = buildIdentityContext({ ticker: '2327.TW', nameZh: '國巨*', nameEn: 'Yageo Corporation' })
  assert.ok(block.includes('Identity (authoritative, do not override):'))
  assert.ok(block.includes('- Company: 國巨（Yageo Corporation）'))
  assert.ok(block.includes('- Ticker: 2327.TW'))
  assert.ok(block.includes('this block wins'))
})

test('buildIdentityContext - 只有英文名時只列英文（不重複拼接）', () => {
  const block = buildIdentityContext({ ticker: '2327.TW', nameEn: 'Yageo Corporation' })
  assert.ok(block.includes('- Company: Yageo Corporation'))
  assert.ok(!block.includes('（Yageo Corporation）'))
})

test('buildIdentityContext - 中英相同時不重複拼接', () => {
  const block = buildIdentityContext({ ticker: 'SPCX', nameZh: 'SPCX', nameEn: 'SPCX' })
  assert.ok(block.includes('- Company: SPCX'))
})

test('buildIdentityContext - 查無正名：要求以代號稱呼、不得猜公司', () => {
  const block = buildIdentityContext({ ticker: '00999.TW' })
  assert.ok(block.includes('No verified company name was provided'))
  assert.ok(block.includes('Do not guess a company name'))
  assert.ok(!block.includes('this block wins'))
})
