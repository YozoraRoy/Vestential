/**
 * Issue #44：當年殖利率＋5 年平均殖利率（client-safe 純函式，手算可重現）。
 * Issue #95：口徑修正——當年改 YTD、5 年平均改「去年為止 5 個完整年度」。
 *
 * 選邊註明（沿用 portfolio-dividends.ts 模式：零依賴，不放 lib/portfolio.ts，
 * 避免把 Node/DB 依賴拉進 browser bundle）：
 * - 資料源：`twse_dividends` 快取（TWT48U 每日累積＋TWT49U 月表歷史＋官方
 *   `t187ap45_L` 權息精確值；DB 結構不動）。
 * - 當年殖利率＝今年**已除息**（`ex_date <= 今天`）每股現金合計 ÷ 現價 ×100%
 *   （與 `estimateDividendYtd` 同口徑；已公告未除息的預告事件不計入，否則
 *   未來事件會把當年殖利率提前墊高）。手算：今年 `ex_date ≤ 今日` 的
 *   `cash_dividend` 加總 ÷ 現價。
 * - 5 年平均殖利率＝（Σ最近 5 個**完整年度**（(Y-5)..(Y-1)，不含當年）每股合計
 *   ÷ 有資料年數）÷ 現價 ×100%；缺年（整年 0 筆快取）不補 0、不計入平均，
 *   只記 missingYears，UI 註「年份不全」。
 * - 美股無真源 → 呼叫端只對 market==='tw' 計算（此檔不擋 market，純算）。
 * - #94：Yahoo「殖利率（參考）」欄已下架（quoteSummary 恆 404），此檔不再有對照欄位。
 */

export interface YieldHistoryEntry {
  symbol: string
  ex_date: string
  cash_dividend: number
}

/** 5 年平均回看年數（去年為止的 5 個完整年度：(Y-5)..(Y-1)）。 */
export const YIELD_HISTORY_YEARS = 5

/** 資料讀取窗年數（含當年）：(Y-5)..Y 共 6 年（對齊回填窗 `YIELD_BACKFILL_YEARS`＝6）。 */
export const YIELD_DATA_YEARS = YIELD_HISTORY_YEARS + 1

export interface YearlyPerShare {
  year: string
  /** 該年每股現金合計（元）。 */
  perShareTotal: number
  /** 該年計入事件數（除息筆數；0＝該年無快取＝缺年）。 */
  count: number
}

/**
 * 依年份列出每股合計（years 須為 'YYYY' 陣列；回傳順序同輸入）。
 * `today`（'YYYY-MM-DD'）有值時僅計 `ex_date <= today`（YTD 口徑；#95）；
 * 省略時計入該年全部事件（歷史年份用）。
 */
export function yearlyPerShareTotals(
  symbol: string,
  rows: YieldHistoryEntry[],
  years: string[],
  today?: string | null,
): YearlyPerShare[] {
  const sym = (symbol ?? '').trim().toUpperCase()
  const cutoff = typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : null
  return years.map((year) => {
    let perShareTotal = 0
    let count = 0
    if (sym && /^\d{4}$/.test(year)) {
      for (const r of rows ?? []) {
        if ((r.symbol ?? '').trim().toUpperCase() !== sym) continue
        const ex = (r.ex_date ?? '').trim()
        const cash = Number(r.cash_dividend)
        if (!ex.startsWith(year) || !/^\d{4}-\d{2}-\d{2}$/.test(ex)) continue
        if (cutoff != null && ex > cutoff) continue
        if (!Number.isFinite(cash) || cash <= 0) continue
        perShareTotal += cash
        count++
      }
    }
    return { year, perShareTotal, count }
  })
}

/**
 * 當年殖利率（%）：今年已除息每股合計 ÷ 現價 ×100。
 * 現價非法／≤0 回 null（UI 顯示「—」，不報錯）。
 */
export function computeCurrentYearYield(perShareTotal: number, currentPrice: number): number | null {
  if (!Number.isFinite(perShareTotal) || perShareTotal < 0) return null
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null
  return (perShareTotal / currentPrice) * 100
}

export interface FiveYearAvgYield {
  /** 5 年平均殖利率（%；無任一年資料或現價非法時為 null）。 */
  value: number | null
  /** 有資料年份（count>0）。 */
  coveredYears: string[]
  /** 缺年（整年 0 筆快取；UI 註「年份不全」）。 */
  missingYears: string[]
  /** 缺年即為 true（即使 value 有值）。 */
  partial: boolean
}

/**
 * 5 年平均殖利率：**最近 5 個完整年度**（呼叫端以 yieldWindowYears 產生
 * (Y-5)..(Y-1)，不含當年）每股合計取平均，再除以現價 ×100。
 * 公式：avg＝（Σ coveredYears每股合計 ÷ coveredYears年數）÷ 現價 ×100%。
 */
export function computeFiveYearAvgYield(
  yearly: YearlyPerShare[],
  currentPrice: number,
): FiveYearAvgYield {
  const covered = (yearly ?? []).filter((y) => y.count > 0)
  const missingYears = (yearly ?? []).filter((y) => y.count === 0).map((y) => y.year)
  const coveredYears = covered.map((y) => y.year)
  if (covered.length === 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return { value: null, coveredYears, missingYears, partial: true }
  }
  const avgPerShare = covered.reduce((s, y) => s + y.perShareTotal, 0) / covered.length
  return { value: (avgPerShare / currentPrice) * 100, coveredYears, missingYears, partial: missingYears.length > 0 }
}

/**
 * 5 年平均的年度窗＝**去年為止 5 個完整年度**：(Y-5)..(Y-1)（不含當年；#95）。
 * 呼叫端以 todayStr.slice(0,4) 傳入當年；非法輸入回空陣列。
 */
export function yieldWindowYears(currentYear: string, windowSize: number = YIELD_HISTORY_YEARS): string[] {
  const y = Number(currentYear)
  if (!Number.isInteger(y) || windowSize < 1) return []
  const out: string[] = []
  for (let i = windowSize; i >= 1; i--) out.push(String(y - i))
  return out
}

/**
 * 資料讀取窗＝(Y-5)..Y（含當年，共 6 年；#95）：供 `/api/portfolio/dividends?years=`
 * 一次取足「當年 YTD ＋ 5 個完整年度」兩種口徑所需資料。
 */
export function yieldDataYears(currentYear: string): string[] {
  const y = Number(currentYear)
  if (!Number.isInteger(y)) return []
  const out: string[] = []
  for (let i = YIELD_HISTORY_YEARS; i >= 0; i--) out.push(String(y - i))
  return out
}
