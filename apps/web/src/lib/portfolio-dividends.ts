/**
 * Issue #35：當年累計股息 YTD 估算（client-safe 純函式）。
 *
 * 選邊註明：不放 `lib/portfolio.ts`（該檔頂層 import `@stock/database`，
 * client component 若值 import 會把 better-sqlite3/mssql 拉進 browser bundle，
 * 導致 `next build` 失敗），故獨立此零依賴新檔；server 端（sync／dividends
 * route）讀快取，前端以快取列純算、手算可重現。
 *
 * 公式：YTD＝Σ(今年 ex_date≤今天 的每股現金股利)×持有股數。
 * - 持有起算以持股紀錄 created_at 的日期部分近似（年中建倉前的除息不計→
 *   可能低估，UI 註腳揭露）；
 * - 手填 dividend 全程不碰：估算值僅並列顯示（UI 標「估」），不寫庫不覆蓋；
 * - 美股無真源（維持 Yahoo＋手填），呼叫端只對 market==='tw' 估算。
 */

export interface DividendYtdEntry {
  symbol: string
  ex_date: string
  cash_dividend: number
  /** Issue #101：除息日昨收（TWT49U 前收；缺值 null）＝逐年已實現殖利率分母用。 */
  prev_close?: number | null
}

export interface DividendYtdEstimate {
  /** 估算總額＝每股合計×股數（元）。 */
  total: number
  /** 每股合計（元）。 */
  perShareTotal: number
  /** 計入筆數（除息事件數）。 */
  count: number
  /** 持有起算日 'YYYY-MM-DD'（created_at 近似；非法時退回年初）。 */
  fromDate: string
  /** 恆為 true：呼叫端以此標「估」。 */
  estimated: true
}

/** 取 created_at 的日期部分；非法／缺失時退回該年 01-01（註腳揭露近似）。 */
export function dividendHoldingStartDate(createdAt: string | null | undefined, year: string): string {
  const m = (createdAt ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m && m[1] === year) return `${m[1]}-${m[2]}-${m[3]}`
  return `${year}-01-01`
}

export function estimateDividendYtd(
  symbol: string,
  shares: number,
  createdAt: string | null | undefined,
  rows: DividendYtdEntry[],
  todayStr: string,
): DividendYtdEstimate {
  const year = todayStr.slice(0, 4)
  const fromDate = dividendHoldingStartDate(createdAt, year)
  const sym = (symbol ?? '').trim().toUpperCase()
  let perShareTotal = 0
  let count = 0
  if (sym && shares > 0) {
    for (const r of rows ?? []) {
      if ((r.symbol ?? '').trim().toUpperCase() !== sym) continue
      const ex = (r.ex_date ?? '').trim()
      const cash = Number(r.cash_dividend)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ex)) continue
      if (!ex.startsWith(year) || ex > todayStr || ex < fromDate) continue
      if (!Number.isFinite(cash) || cash <= 0) continue
      perShareTotal += cash
      count++
    }
  }
  return { total: perShareTotal * shares, perShareTotal, count, fromDate, estimated: true as const }
}
