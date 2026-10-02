import type { ArenaHolding } from './types.js'
import type { ArenaStore } from './store.js'

/**
 * Issue #54：競技場現金股利自動入帳（close 收盤結算一步）。
 *
 * 規則（使用者已確認簡化版）：
 * - 只看「結算時持有」（st.holdings）；賣出後不再發。
 * - ex_date 落在近 10 交易日窗內才發；歷史股利不追溯（窗外永不掃）。
 * - 同一 (agent, symbol, ex_date) 只發一次（store.saveDividendCredit 原子冪等）。
 * - 快取缺檔／store 未實作 → 回 0（跳過，不炸，不擋快照）。
 */

/** 近 10 交易日窗的日曆天近似（10 交易日 ≈ 14 日曆天，含週末）。 */
export const ARENA_DIVIDEND_LOOKBACK_DAYS = 14

/** 股利 symbol 正規化（與 @stock/database normalizeArenaDividendSymbol 同規則，兩邊對齊）。 */
export function normalizeArenaDividendSymbol(symbol: string): string {
  const s = (symbol ?? '').trim().toUpperCase()
  const m = s.match(/^(\d{4,6}[A-Z]?)\.(TW|TWO)$/)
  return m ? m[1]! : s
}

/** YYYY-MM-DD 加減日（UTC 運算，避開時區邊界）。 */
export function addDaysIso(dateStr: string, days: number): string {
  const t = Date.parse(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(t) || !Number.isInteger(days)) return dateStr
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10)
}

/** 股利掃描窗：[roundDate - 14 天, roundDate]（含兩端）。 */
export function arenaDividendWindow(roundDate: string): { from: string; to: string } {
  return { from: addDaysIso(roundDate, -ARENA_DIVIDEND_LOOKBACK_DAYS), to: roundDate }
}

/** 入帳金額 = round2(shares × cash_dividend)；非法輸入回 0（呼叫端跳過）。 */
export function arenaDividendAmount(shares: number, cashDividend: number): number {
  if (!Number.isFinite(shares) || shares <= 0) return 0
  if (!Number.isFinite(cashDividend) || cashDividend <= 0) return 0
  return Math.round(shares * cashDividend * 100) / 100
}

/**
 * 對單一 agent 執行股利入帳，回傳本次新入帳總額（round2）。
 * best-effort：任一步失敗只跳過該筆／回 0，永不 throw（由 engine 記 errors）。
 */
export async function creditArenaDividends(
  store: ArenaStore,
  agentId: number,
  roundDate: string,
  holdings: ArenaHolding[],
): Promise<number> {
  if (!store.getDividendsInWindow || !store.saveDividendCredit) return 0
  if (!Number.isInteger(agentId) || agentId <= 0) return 0
  if (!/^\d{4}-\d{2}-\d{2}$/.test(roundDate)) return 0

  const sharesBySymbol = new Map<string, number>()
  for (const h of holdings ?? []) {
    if (!Number.isFinite(h.shares) || h.shares <= 0) continue
    const sym = normalizeArenaDividendSymbol(h.symbol)
    if (!sym) continue
    sharesBySymbol.set(sym, (sharesBySymbol.get(sym) ?? 0) + h.shares)
  }
  if (sharesBySymbol.size === 0) return 0

  const { from, to } = arenaDividendWindow(roundDate)
  let quotes: Awaited<ReturnType<NonNullable<ArenaStore['getDividendsInWindow']>>>
  try {
    quotes = await store.getDividendsInWindow([...sharesBySymbol.keys()], from, to)
  } catch {
    return 0 // 缺快取／查詢失敗 → 跳過
  }
  if (!quotes || quotes.length === 0) return 0

  let total = 0
  for (const q of quotes) {
    const sym = normalizeArenaDividendSymbol(q.symbol)
    const shares = sharesBySymbol.get(sym)
    if (shares === undefined || shares <= 0) continue
    if (!q.exDate || q.exDate < from || q.exDate > to) continue
    const amount = arenaDividendAmount(shares, Number(q.cashDividend))
    if (amount <= 0) continue
    let credited = false
    try {
      credited = await store.saveDividendCredit({ agentId, symbol: sym, exDate: q.exDate, shares, amount })
    } catch {
      continue
    }
    if (credited) total = Math.round((total + amount) * 100) / 100
  }
  return total
}
