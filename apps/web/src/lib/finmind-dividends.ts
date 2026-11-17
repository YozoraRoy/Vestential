/**
 * FinMind TaiwanStockDividend 懶載入回填層：
 * - 取得官方已公告之「現金股利發放日 (CashDividendPaymentDate)」並寫回 twse_dividends.pay_date。
 * - 順帶補齊當期最新除息公告（例如 00891 2026-11-17 除息 1.55 / 2026-12-11 發放）。
 * - 採同標的 6 小時記憶體冷卻快取 + 8 秒短 timeout，不擋主流程。
 */

import { upsertTwseDividends, type TwseDividendInput } from '@stock/database'

const FINMIND_URL = 'https://api.finmindtrade.com/api/v4/data'
const FETCH_TIMEOUT_MS = 8_000
const COOLDOWN_MS = 6 * 60 * 60 * 1000
const MAX_SYMBOLS_PER_CALL = 15

const syncedAtMap = new Map<string, number>()

interface FinMindDividendRow {
  CashExDividendTradingDate?: string
  CashDividendPaymentDate?: string
  CashEarningsDistribution?: number | string
  CashStatutorySurplus?: number | string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function syncFinMindDividendsForSymbols(
  symbols: string[],
  existingRows: Array<{ symbol: string; ex_date: string; pay_date?: string | null }>,
  today: string,
): Promise<number> {
  const now = Date.now()
  const currentYear = Number(today.slice(0, 4))
  const minCheckYear = `${currentYear - 1}-01-01`

  // 檢查哪些標的缺近兩年 pay_date 或超過冷卻時間尚未同步最新公告
  const missingPaySet = new Set<string>()
  for (const r of existingRows) {
    if (r.ex_date >= minCheckYear && !r.pay_date) {
      missingPaySet.add(r.symbol.toUpperCase())
    }
  }

  const targets = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
    .filter((sym) => {
      const last = syncedAtMap.get(sym) ?? 0
      // 若缺 pay_date 且距離上次檢查已超過 5 分鐘，或超過 6 小時例行冷卻，則抓取
      if (missingPaySet.has(sym)) return now - last > 5 * 60 * 1000
      return now - last > COOLDOWN_MS
    })
    .slice(0, MAX_SYMBOLS_PER_CALL)

  if (targets.length === 0) return 0

  const startDate = `${currentYear - 1}-01-01`
  const toUpsert: TwseDividendInput[] = []

  // 最多 4 路並發抓取，避免觸發 FinMind 瞬時限流
  let idx = 0
  const workers = Array.from({ length: Math.min(4, targets.length) }, async () => {
    while (idx < targets.length) {
      const sym = targets[idx++]!
      syncedAtMap.set(sym, now)
      try {
        const url = `${FINMIND_URL}?dataset=TaiwanStockDividend&data_id=${encodeURIComponent(sym)}&start_date=${startDate}`
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        if (!res.ok) continue
        const json = (await res.json().catch(() => null)) as { data?: FinMindDividendRow[] } | null
        const rows = Array.isArray(json?.data) ? json!.data! : []
        for (const row of rows) {
          const exDate = (row.CashExDividendTradingDate ?? '').trim()
          const payDateRaw = (row.CashDividendPaymentDate ?? '').trim()
          if (!DATE_RE.test(exDate)) continue
          const payDate = DATE_RE.test(payDateRaw) ? payDateRaw : null
          const cashDiv =
            Number(row.CashEarningsDistribution ?? 0) + Number(row.CashStatutorySurplus ?? 0)
          if (!Number.isFinite(cashDiv) || cashDiv <= 0) continue
          toUpsert.push({
            symbol: sym,
            ex_date: exDate,
            cash_dividend: Math.round(cashDiv * 1_000_000) / 1_000_000,
            pay_date: payDate,
          })
        }
      } catch {
        // best-effort：單檔逾時或失敗不影響整體頁面
      }
    }
  })

  await Promise.all(workers)
  if (toUpsert.length === 0) return 0
  return upsertTwseDividends(toUpsert).catch(() => 0)
}
