import { NextResponse } from 'next/server'
import { registry } from '@stock/market-data'
import type { CompanyProfile, Quote } from '@stock/market-data'

/**
 * Issue #119 D：台股裸代號正規化為 Yahoo 格式（預設補 .TW），避免裸代號被 Yahoo 誤判為港股（如 2330 -> 2330.HK）。
 */
function normalizeSymbolForMarket(symbol: string, market: string): string {
  const trimmed = symbol.trim().toUpperCase()
  const m = market.trim().toUpperCase()
  if (m === 'TW' || m === 'TPE') {
    if (/^\d{3,6}[A-Z0-9]{0,2}$/.test(trimmed) && !trimmed.endsWith('.TW') && !trimmed.endsWith('.TWO')) {
      return `${trimmed}.TW`
    }
  }
  return trimmed
}

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
 * Issue #107 / #119：
 *   - quote 與 profile 各自 try，任一失敗降級自己、不得 500；
 *   - quote.price <= 0 視為無效報價（金融數字不得幻覺），絕不對外回傳 0 價；
 *   - 台股裸代號補 .TW，杜絕跨市場落入港股；
 *   - quote 與 profile 皆命中 → 200 { quote, profile }；
 *   - quote 失敗但 profile 命中 → 200 { quote: null, profile }；
 *   - 兩者皆未命中 → 404 { error: 'symbol not found' }。
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const rawSymbol = searchParams.get('symbol')
  const market = searchParams.get('market') ?? 'TW'
  if (!rawSymbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 })

  const targetSymbol = normalizeSymbolForMarket(rawSymbol, market)
  const provider = registry.get('yahoo-finance')

  let quote: Quote | null = null
  try {
    const q = await provider.getQuote(targetSymbol, market)
    // 嚴格拒絕 <= 0 報價（金融數字不得回傳 0 價幻覺）
    if (q && Number.isFinite(q.price) && q.price > 0) {
      quote = q
    }
  } catch {
    quote = null
  }

  let profile: CompanyProfile | null = null
  try {
    profile = await provider.getProfile(targetSymbol, market)
  } catch {
    profile = null
  }

  if (!quote && !isProfileHit(targetSymbol, profile)) {
    return NextResponse.json({ error: 'symbol not found' }, { status: 404 })
  }
  return NextResponse.json({ quote, profile })
}
