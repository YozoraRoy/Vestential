'use client'

import { useEffect, useMemo, useState } from 'react'
import { normalizeStockCode, type StockMultilingualName } from '@stock/core'

const clientNamesCache = new Map<string, StockMultilingualName>()

/**
 * 批次取得並快取多語系股票名稱（供僅有 symbol 的頁面如 /analyze、/dca、/journal 使用）。
 */
export function useStockNames(symbols: string[]): Record<string, StockMultilingualName> {
  const codes = useMemo(
    () => [...new Set(symbols.map((s) => normalizeStockCode(s)).filter(Boolean))],
    [symbols],
  )
  const codesKey = codes.join(',')

  const [tick, setTick] = useState(0)

  useEffect(() => {
    const missing = codes.filter((c) => !clientNamesCache.has(c))
    if (!missing.length) return
    let cancelled = false
    fetch(`/api/stocks/names?symbols=${encodeURIComponent(missing.join(','))}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.names) return
        for (const [k, v] of Object.entries(data.names as Record<string, StockMultilingualName>)) {
          clientNamesCache.set(k.toUpperCase(), v)
        }
        setTick((n) => n + 1)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [codesKey, codes])

  return useMemo(() => {
    const out: Record<string, StockMultilingualName> = {}
    for (const c of codes) {
      const hit = clientNamesCache.get(c)
      if (hit) out[c] = hit
    }
    void tick
    return out
  }, [codes, tick])
}
