import { z } from 'zod'
import { Market } from '@stock/core'

export const MarketDataRequestSchema = z.object({
  symbol: z.string(),
  market: z.nativeEnum(Market),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

export const OHLCVSchema = z.object({
  timestamp: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
})

export const QuoteSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  change: z.number(),
  changePercent: z.number(),
  volume: z.number(),
  timestamp: z.number(),
})

export type OHLCV = z.infer<typeof OHLCVSchema>
export type MarketDataRequest = z.infer<typeof MarketDataRequestSchema>
export type Quote = z.infer<typeof QuoteSchema>

export interface Fundamentals {
  symbol: string
  marketCap?: number
  peRatio?: number
  /** #173：預估本益比（Forward PE） */
  forwardPe?: number
  /** #173：股價淨值比（P/B） */
  priceToBook?: number
  /** #173：本益成長比（PEG） */
  pegRatio?: number
  eps?: number
  dividendYield?: number
  /** #34：Yahoo quoteSummary summaryDetail 既有欄位（小數，如 0.035＝3.5%）；缺值即 undefined。 */
  trailingAnnualDividendYield?: number
  /** #173：每股年配息（原幣） */
  dividendRate?: number
  /** #177：近 1 / 2 / 3 年滾動年均每股配息與資料跨度（年） */
  dividendRates?: {
    avg1y?: number
    avg2y?: number
    avg3y?: number
    spanYears?: number
  }
  /** #173：配息發放率（小數，如 0.52＝52%） */
  payoutRatio?: number
  /** #173：股東權益報酬率 ROE（小數，如 0.25＝25%） */
  returnOnEquity?: number
  /** #173：營業利益率（小數） */
  operatingMargins?: number
  /** #173：毛利率（小數） */
  grossMargins?: number
  /** #173：淨利率（小數） */
  profitMargins?: number
  /** #173：營收年增率（小數） */
  revenueGrowth?: number
  /** #173：獲利年增率（小數） */
  earningsGrowth?: number
  /** #173：負債權益比 Debt-to-Equity（Yahoo 原始百分比，如 45 代表 45%） */
  debtToEquity?: number
  /** #173：流動比率 Current Ratio（如 1.8） */
  currentRatio?: number
  /** #173：自由現金流（幣值） */
  freeCashflow?: number
  /** #173：營業現金流（幣值） */
  operatingCashflow?: number
  /** #173：52 週最高價 */
  fiftyTwoWeekHigh?: number
  /** #173：52 週最低價 */
  fiftyTwoWeekLow?: number
  /** #173：即時參考價 */
  currentPrice?: number
  /** #173：標的類型（EQUITY / ETF 等） */
  quoteType?: string
  revenue?: number
  netIncome?: number
  sector?: string
  industry?: string
}

export interface CompanyProfile {
  symbol: string
  name: string
  sector?: string
  industry?: string
  exchange?: string
  marketCap?: number
  description?: string
  /** Yahoo 的標的分類，例如 "EQUITY"（個股）、"ETF"、空白表示未知。 */
  quoteType?: string
}

/** 批量報價/基本面快照（Yahoo v7 finance/quote）——一次帶回多檔的市值、價格與類型。 */
export interface BatchQuote {
  symbol: string
  marketCap?: number
  price?: number
  name?: string
  quoteType?: string
}
