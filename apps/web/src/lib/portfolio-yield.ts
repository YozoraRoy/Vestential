/**
 * Issue #44：當年殖利率＋5 年平均殖利率（client-safe 純函式，手算可重現）。
 *
 * 選邊註明（沿用 portfolio-dividends.ts 模式：零依賴，不放 lib/portfolio.ts，
 * 避免把 Node/DB 依賴拉進 browser bundle）：
 * - 資料源：`twse_dividends` 快取（TWT48U 除權除息預告表逐日累積；DB 結構不動）。
 * - 當年殖利率＝今年每股現金合計 ÷ 現價 ×100%（與 estimateDividendYtd 同一加總，
 *   手算：把該代號今年 ex_date≤今日之 cash_dividend 加總，除以現價）。
 * - 5 年平均殖利率＝（Σ有資料年份每股合計 ÷ 有資料年數）÷ 現價 ×100%。
 *   缺年（整年 0 筆快取）不補 0、不計入平均，只記 missingYears，UI 註「年份不全」。
 * - 美股無真源 → 呼叫端只對 market==='tw' 計算（此檔不擋 market，純算）。
 * - 參考殖利率（Yahoo dividendYield 系）行為不動，見 lib/portfolio.ts fetchDividendYield。
 */

export interface YieldHistoryEntry {
  symbol: string
  ex_date: string
  cash_dividend: number
}

/** 殖利率回看年數（當年＋前 4 年）。 */
export const YIELD_HISTORY_YEARS = 5

export interface YearlyPerShare {
  year: string
  /** 該年每股現金合計（元）。 */
  perShareTotal: number
  /** 該年計入事件數（除息筆數；0＝該年無快取＝缺年）。 */
  count: number
}

/** 依年份列出每股合計（years 須為 'YYYY' 陣列；回傳順序同輸入）。 */
export function yearlyPerShareTotals(
  symbol: string,
  rows: YieldHistoryEntry[],
  years: string[],
): YearlyPerShare[] {
  const sym = (symbol ?? '').trim().toUpperCase()
  return years.map((year) => {
    let perShareTotal = 0
    let count = 0
    if (sym && /^\d{4}$/.test(year)) {
      for (const r of rows ?? []) {
        if ((r.symbol ?? '').trim().toUpperCase() !== sym) continue
        const ex = (r.ex_date ?? '').trim()
        const cash = Number(r.cash_dividend)
        if (!ex.startsWith(year) || !/^\d{4}-\d{2}-\d{2}$/.test(ex)) continue
        if (!Number.isFinite(cash) || cash <= 0) continue
        perShareTotal += cash
        count++
      }
    }
    return { year, perShareTotal, count }
  })
}

/**
 * 當年殖利率（%）：今年每股合計 ÷ 現價 ×100。
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
 * 5 年平均殖利率：有資料年份每股合計取平均，再除以現價 ×100。
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

/** 目標年份窗（當年＋前 4 年；呼叫端以 todayStr.slice(0,4) 傳入當年）。 */
export function yieldWindowYears(currentYear: string, windowSize: number = YIELD_HISTORY_YEARS): string[] {
  const y = Number(currentYear)
  if (!Number.isInteger(y)) return []
  const out: string[] = []
  for (let i = windowSize - 1; i >= 0; i--) out.push(String(y - i))
  return out
}
