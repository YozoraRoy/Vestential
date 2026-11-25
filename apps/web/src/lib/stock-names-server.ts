/**
 * Server-side 多語系股票名稱批次解析與主檔補寫 helper（Issue #190 / #191 / #192）。
 */

import {
  isLikelyEnglishStockName,
  isTwStockSymbol,
  normalizeStockCode,
  resolveStockDisplayName,
  type StockMultilingualName,
} from '@stock/core'
import { resolveStockName as resolveUniverseZhName } from '@stock/cycle-entry'
import {
  ensureTwStockNamesSynced,
  getStockMultilingualNames,
  upsertStockNames,
  type StockNameUpsertInput,
} from '@stock/database'

export async function resolveServerStockNames(
  symbols: string[],
  opts?: {
    yahooNames?: Map<string, string | null | undefined> | Record<string, string | null | undefined>
    knownZhNames?: Map<string, string | null | undefined> | Record<string, string | null | undefined>
    marketHint?: 'TW' | 'US'
    source?: string
    syncIfNeeded?: boolean
  },
): Promise<Record<string, StockMultilingualName>> {
  const codes = [...new Set(symbols.map(normalizeStockCode).filter(Boolean))]
  if (!codes.length) return {}

  if (opts?.syncIfNeeded !== false) {
    // 絕不阻塞即時請求；僅於背景非同步觸發節流同步。
    void ensureTwStockNamesSynced().catch(() => 0)
  }

  const dbMap = await getStockMultilingualNames(codes).catch(
    () => ({}) as Awaited<ReturnType<typeof getStockMultilingualNames>>,
  )

  const readMap = (
    m: Map<string, string | null | undefined> | Record<string, string | null | undefined> | undefined,
    rawSym: string,
    code: string,
  ): string | null => {
    if (!m) return null
    const val = m instanceof Map ? (m.get(code) ?? m.get(rawSym)) : (m[code] ?? m[rawSym])
    const t = typeof val === 'string' ? val.trim() : ''
    return t && t.toUpperCase() !== code ? t : null
  }

  const out: Record<string, StockMultilingualName> = {}
  const toUpsert: StockNameUpsertInput[] = []

  for (const rawSym of symbols) {
    const code = normalizeStockCode(rawSym)
    if (!code || out[code]) continue

    const db = dbMap[code]
    const market = isTwStockSymbol(rawSym, db?.market ?? opts?.marketHint) ? 'TW' : 'US'

    const yName = readMap(opts?.yahooNames, rawSym, code)
    const yEn = yName && isLikelyEnglishStockName(yName) ? yName : null
    const yZh = yName && !isLikelyEnglishStockName(yName) ? yName : null

    const kZh = readMap(opts?.knownZhNames, rawSym, code)
    const uZh = market === 'TW' ? resolveUniverseZhName(code) : code
    const universeZh = uZh && uZh !== code ? uZh : null

    const nameZh = db?.nameZh || kZh || universeZh || yZh || null
    const nameEn = db?.nameEn || yEn || null
    const nameJa = db?.nameJa || null

    out[code] = { nameZh, nameEn, nameJa, market }

    if ((nameZh && !db?.nameZh) || (nameEn && !db?.nameEn)) {
      toUpsert.push({
        symbol: code,
        nameZh,
        nameEn,
        market,
        source: opts?.source ?? 'server_resolve',
      })
    }
  }

  if (toUpsert.length > 0) {
    await upsertStockNames(toUpsert).catch(() => 0)
  }

  return out
}

export { resolveStockDisplayName }
