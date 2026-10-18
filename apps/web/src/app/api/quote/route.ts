import { NextResponse } from 'next/server'
import { registry } from '@stock/market-data'
import type { CompanyProfile, Quote } from '@stock/market-data'

/**
 * Issue #107：`getProfile` 查無資料時**不拋錯**，而是回 `emptyProfile(symbol)`
 * （即 `{ symbol, name: symbol }`，見 packages/market-data/src/providers/yahoo-profile.ts）。
 * 因此「命中」的判定必須看可觀察訊號，不能只看有無回傳物件：
 *   1. `name` 有值且「不等於輸入代號」→ 有抓到真實名稱（name 退回代號即查無此標的）；
 *   2. 或 `sector`／`quoteType`／`industry`／`exchange` 任一有值 → 有真實分類資料。
 * 兩者皆否即視為未命中（例：`ZZZZZZ.NOPE`；或 search 只回近似代號如 `00687B.TWO` 者）。
 */
function isProfileHit(symbol: string, profile: CompanyProfile | null | undefined): boolean {
  if (!profile) return false
  const name = typeof profile.name === 'string' ? profile.name.trim() : ''
  if (name && name.toUpperCase() !== symbol.trim().toUpperCase()) return true
  return Boolean(profile.sector || profile.quoteType || profile.industry || profile.exchange)
}

/**
 * Issue #107：`getQuote`（v8 chart 對未知標的回 404）與 `getProfile` 必須**各自** try，
 * 任一失敗只降級自己、不得讓整個 route 500（改動前兩者在同一個 try，getQuote 一拋
 * 就連 getProfile 都不執行，未知標的直接 500）。
 *
 * 回應語意：
 *   - quote 與 profile 皆命中 → `200 { quote, profile }`（形狀與內容不變）
 *   - quote 失敗但 profile 命中 → `200 { quote: null, profile }`
 *   - 兩者皆未命中（未命中／查無此標的）→ `404 { error: 'symbol not found' }`
 *   - 任何輸入皆不得 500，也不回傳例外訊息（原 `e.message` 洩漏內部錯誤）
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol')
  const market = searchParams.get('market') ?? 'TW'
  if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })

  const provider = registry.get('yahoo-finance')

  let quote: Quote | null = null
  try {
    quote = await provider.getQuote(symbol, market)
  } catch {
    quote = null
  }

  let profile: CompanyProfile | null = null
  try {
    profile = await provider.getProfile(symbol, market)
  } catch {
    profile = null
  }

  if (!quote && !isProfileHit(symbol, profile)) {
    return NextResponse.json({ error: 'symbol not found' }, { status: 404 })
  }
  return NextResponse.json({ quote, profile })
}
