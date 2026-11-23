/**
 * Client-safe 股票名稱顯示 helper（Issue #190 / #191 / #192）。
 * 包裝 `@stock/core` 的 `resolveStockDisplayName` 與 `formatStockLabel`，
 * 並相容尚未回傳 `names` 物件的舊資料（例如 DB 歷史持倉 `symbol_name` 或 `localStorage` 舊快取）。
 */

import {
  formatStockLabel,
  isLikelyEnglishStockName,
  isTwStockSymbol,
  normalizeStockCode,
  resolveStockDisplayName,
  type StockMultilingualName,
} from '@stock/core'

export type { StockMultilingualName }

export function buildEffectiveStockNames(
  symbol: string,
  fallbackName?: string | null,
  names?: StockMultilingualName | null,
  market?: 'TW' | 'US' | string | null,
): StockMultilingualName {
  const isTw = isTwStockSymbol(symbol, names?.market ?? market)
  const resolvedMarket = isTw ? 'TW' : 'US'
  if (names) {
    return {
      ...names,
      market: names.market ?? resolvedMarket,
    }
  }
  const trimmed = (fallbackName ?? '').trim()
  if (!trimmed || trimmed.toUpperCase() === normalizeStockCode(symbol)) {
    return { market: resolvedMarket }
  }
  return isLikelyEnglishStockName(trimmed)
    ? { nameEn: trimmed, market: resolvedMarket }
    : { nameZh: trimmed, market: resolvedMarket }
}

/** 依當前語系取得股票顯示名稱（不含代號） */
export function displayStockName(
  symbol: string,
  locale: string,
  opts?: {
    fallbackName?: string | null
    names?: StockMultilingualName | null
    market?: 'TW' | 'US' | string | null
  },
): string {
  const eff = buildEffectiveStockNames(symbol, opts?.fallbackName, opts?.names, opts?.market)
  return resolveStockDisplayName(symbol, eff, locale)
}

/** 依當前語系取得「代號 ＋ 名稱」標籤（若無名稱則僅回傳代號） */
export function displayStockLabel(
  symbol: string,
  locale: string,
  opts?: {
    fallbackName?: string | null
    names?: StockMultilingualName | null
    market?: 'TW' | 'US' | string | null
  },
): string {
  const eff = buildEffectiveStockNames(symbol, opts?.fallbackName, opts?.names, opts?.market)
  return formatStockLabel(symbol, eff, locale)
}
