// Issue #69：零股存股試算所（/dca）純函式引擎（client-safe：零 Node/DB 依賴，可單測）。
//
// 模型（規格拍板）：
// - 還原權值（adjclose）逐月「第一個交易日」收盤買入（含零股小數，shares 可為小數）。
// - 配息按除息日再投入（reinvest）或領現（cash，現金累積不投入）。
// - 費率口徑沿用 `lib/portfolio-net.ts` 同公式：手續費 0.1425%×折讓（後台
//   `portfolio.fee_discount`，預設 6 折）、買賣各計、不足 NT$20 以 20 計；
//   證交稅賣出時扣（台股個股 0.3%／ETF 0.1%，`00` 開頭啟發式＋UI 加註可能誤判）。
//   手續費為「外加」：不扣減當月買入股數（shares = monthlyAmount / price），
//   費用另計入 buyFeesTotal；單測以此口徑手算（誤差 0）。
// - 報酬雙指標文案區分（UI tooltip＋公式註腳亦同步）：
//   - 總報酬（裸價差，沿 #44）：(期末市值_不含股利 − 投入本金) / 投入本金 ×100%
//   - 股利再投入加成：(期末總值 − 期末市值_不含股利) / 投入本金 ×100%（百分點）
//     reinvest 模式：期末總值＝含再投入股數的市值；cash 模式：期末總值＝市值＋累積現金股利。
// - 定存對照：每月投入以年利率複利終值；月利率採 r/12 簡化（公式註腳揭露）。
// - 年化報酬為定期定額簡化 CAGR：(期末總值/投入本金)^(12/nMonths)−1（非 XIRR，公式註腳揭露）。

import { DEFAULT_FEE_DISCOUNT, FEE_RATE, MIN_FEE, TAX_RATE_ETF, TAX_RATE_TW, isEtfSymbol } from './portfolio-net'

/** 定存對照預設年利率 1.5%（後台 `dca.savings_rate` 可調；本常數為兜底，不散落 hardcode）。 */
export const DCA_SAVINGS_RATE_DEFAULT = 0.015
/** 定存利率後台鍵（agent_settings；缺值／非法時用 DCA_SAVINGS_RATE_DEFAULT）。 */
export const DCA_SAVINGS_RATE_KEY = 'dca.savings_rate'
/** 手續費折讓後台鍵（沿用既有 `portfolio.fee_discount`，此處僅 re-export 鍵名供 API 共用）。 */
export const DCA_FEE_DISCOUNT_KEY = 'portfolio.fee_discount'
/** 快選標的（單檔試算；本單僅單檔，多標的組合另案）。 */
export const DCA_PRESET_SYMBOLS = ['0050', '00878', '00919'] as const

export type DcaDividendMode = 'reinvest' | 'cash'

export interface DcaPriceBar {
  /** 'YYYY-MM-DD'（lexicographic 可比）。 */
  date: string
  /** 還原收盤（adjclose；引擎只吃全還原數據，沿 yahoo-finance.ts:166 全域等比還原）。 */
  close: number
}

export interface DcaDividend {
  /** 除息日 'YYYY-MM-DD'。 */
  exDate: string
  /** 每股現金股利（元）。 */
  cashPerShare: number
}

export interface DcaSimulateInput {
  symbol: string
  monthlyAmount: number
  /** 模擬月數（如 5 年＝60）。 */
  nMonths: number
  /** 依日期升冪排列的日線（adjclose）；引擎取每月首筆為買入價。 */
  bars: DcaPriceBar[]
  dividends: DcaDividend[]
  dividendMode: DcaDividendMode
  includeFees: boolean
  /** 手續費折讓 0~1；缺省／非法用 DEFAULT_FEE_DISCOUNT（0.6）。 */
  feeDiscount?: number
  /** 定存年利率；缺省用 DCA_SAVINGS_RATE_DEFAULT。 */
  savingsAnnualRate?: number
}

export interface DcaMonthBuy {
  date: string
  price: number
  shares: number
  fee: number
}

export interface DcaEquityPoint {
  date: string
  investedCum: number
  sharesCum: number
  marketValue: number
  /** reinvest＝市值；cash＝市值＋當時累積現金股利。 */
  totalValue: number
}

export interface DcaSimulateResult {
  symbol: string
  dividendMode: DcaDividendMode
  includeFees: boolean
  feeDiscount: number
  nMonths: number
  invested: number
  shares: number
  endPrice: number
  endDate: string
  marketValue: number
  /** 不含股利的基準市值（基準股數×期末價；裸價差分子用）。 */
  baselineMarketValue: number
  /** cash 模式累積現金股利；reinvest 模式為 0（已轉為股數）。 */
  cashDividends: number
  /** 期末總值（reinvest＝marketValue；cash＝marketValue＋cashDividends）。 */
  totalValue: number
  /** 總報酬（裸價差）%＝(baseline−invested)/invested×100。 */
  grossReturnPct: number
  /** 股利加成（百分點）＝(total−baseline)/invested×100。 */
  divBoostPp: number
  /** 含股利總報酬 %＝(total−invested)/invested×100。 */
  totalReturnPct: number
  /** 簡化年化 %（定期定額 CAGR 近似，非 XIRR）。 */
  annualizedPct: number
  buyFeesTotal: number
  sellFee: number
  tax: number
  taxRate: number
  isEtf: boolean
  /** 淨期末總值＝total−buyFees−sellFee−tax（includeFees=false 時等於 total）。 */
  netTotal: number
  netReturnPct: number
  buys: DcaMonthBuy[]
  equityCurve: DcaEquityPoint[]
  /** 最大回撤月份（'YYYY-MM-DD'，權益曲線波峰→波谷最大者之波谷月；無回撤為 null）。 */
  maxDrawdownMonth: string | null
  maxDrawdownPct: number | null
  /** 定存對照終值（同額按月存、年利率 savingsAnnualRate、月利 r/12）。 */
  savingsValue: number
  savingsAnnualRate: number
  savingsMultiple: number | null
}

function normalizeDiscount(v: number | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_FEE_DISCOUNT
}

function normalizeRate(v: number | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n < 1 ? n : DCA_SAVINGS_RATE_DEFAULT
}

/** 定存終值：每月投入 monthly，n 個月，年利率 annual（月利＝annual/12，期末一次到期）。 */
export function savingsFutureValue(monthly: number, nMonths: number, annualRate: number): number {
  const m = Number(monthly)
  const n = Math.floor(Number(nMonths))
  const r = normalizeRate(annualRate)
  if (!(m > 0) || !(n > 0)) return 0
  const rm = r / 12
  if (rm === 0) return m * n
  // 第 k 筆（k=0..n-1，月初投入近似期末計息 n-1-k 期）
  let fv = 0
  for (let k = 0; k < n; k++) fv += m * Math.pow(1 + rm, n - 1 - k)
  return fv
}

/** 每月首交易日：依 YYYY-MM 分組取每組日期最小者（bars 需升冪；非法列略過）。 */
export function pickMonthlyFirstBars(bars: DcaPriceBar[]): DcaPriceBar[] {
  const byMonth = new Map<string, DcaPriceBar>()
  for (const b of bars ?? []) {
    const date = (b?.date ?? '').slice(0, 10)
    const close = Number(b?.close)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (!Number.isFinite(close) || close <= 0) continue
    const key = date.slice(0, 7)
    const prev = byMonth.get(key)
    if (!prev || date < prev.date) byMonth.set(key, { date, close })
  }
  return [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => v)
}

export function simulateDca(input: DcaSimulateInput): DcaSimulateResult {
  const symbol = (input.symbol ?? '').trim().toUpperCase()
  const monthlyAmount = Number(input.monthlyAmount)
  const nMonths = Math.floor(Number(input.nMonths))
  const feeDiscount = normalizeDiscount(input.feeDiscount)
  const savingsAnnualRate = normalizeRate(input.savingsAnnualRate)
  const includeFees = input.includeFees !== false
  const dividendMode: DcaDividendMode = input.dividendMode === 'cash' ? 'cash' : 'reinvest'
  const isEtf = isEtfSymbol(symbol)
  const taxRate = isEtf ? TAX_RATE_ETF : TAX_RATE_TW

  const empty: DcaSimulateResult = {
    symbol, dividendMode, includeFees, feeDiscount, nMonths,
    invested: 0, shares: 0, endPrice: 0, endDate: '',
    marketValue: 0, baselineMarketValue: 0, cashDividends: 0, totalValue: 0,
    grossReturnPct: 0, divBoostPp: 0, totalReturnPct: 0, annualizedPct: 0,
    buyFeesTotal: 0, sellFee: 0, tax: 0, taxRate, isEtf,
    netTotal: 0, netReturnPct: 0, buys: [], equityCurve: [],
    maxDrawdownMonth: null, maxDrawdownPct: null,
    savingsValue: 0, savingsAnnualRate, savingsMultiple: null,
  }
  if (!(monthlyAmount > 0) || !(nMonths > 0)) return empty
  const monthlyBars = pickMonthlyFirstBars(input.bars ?? [])
  if (monthlyBars.length === 0) return empty
  // 取最近 nMonths 個月（期間回溯口徑；不足時有多少算多少，n 以實際買入月為準）。
  const windowBars = monthlyBars.slice(-nMonths)
  const endBar = windowBars[windowBars.length - 1]
  const endPrice = endBar.close
  const endDate = endBar.date

  const divs = (input.dividends ?? [])
    .map((d) => ({ exDate: (d?.exDate ?? '').slice(0, 10), cashPerShare: Number(d?.cashPerShare) }))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.exDate) && Number.isFinite(d.cashPerShare) && d.cashPerShare > 0)
    .sort((a, b) => (a.exDate < b.exDate ? -1 : 1))
  // 除息日再投入價：首筆 date >= exDate 的日線收盤；找不到用期末價。
  const allBars = (input.bars ?? [])
    .filter((b) => /^\d{4}-\d{2}-\d{2}$/.test((b?.date ?? '').slice(0, 10)) && Number.isFinite(Number(b?.close)) && Number(b?.close) > 0)
    .map((b) => ({ date: (b.date as string).slice(0, 10), close: Number(b.close) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const priceOnOrAfter = (exDate: string): number => {
    for (const b of allBars) if (b.date >= exDate) return b.close
    return endPrice
  }

  // 基準買入（不含股利）：shares = amount / price；fee 外加。
  const buys: DcaMonthBuy[] = []
  let invested = 0
  let baselineShares = 0
  let buyFeesTotal = 0
  for (const bar of windowBars) {
    const price = bar.close
    const shares = monthlyAmount / price
    const fee = includeFees ? Math.max(Math.round(monthlyAmount * FEE_RATE * feeDiscount), MIN_FEE) : 0
    buys.push({ date: bar.date, price, shares, fee })
    invested += monthlyAmount
    baselineShares += shares
    buyFeesTotal += fee
  }
  const baselineMarketValue = baselineShares * endPrice

  let shares = baselineShares
  let cashDividends = 0
  if (dividendMode === 'reinvest') {
    // 依除息日序：持有股數＝買入日 <= exDate 的基準股數＋此前再投入股數。
    let reinvestShares = 0
    // buys 升冪；逐除息日累加當時持有。
    for (const d of divs) {
      let held = reinvestShares
      for (const b of buys) if (b.date <= d.exDate) held += b.shares
      if (!(held > 0)) continue
      const cash = held * d.cashPerShare
      const px = priceOnOrAfter(d.exDate)
      if (!(px > 0)) continue
      reinvestShares += cash / px
    }
    shares = baselineShares + reinvestShares
  } else {
    for (const d of divs) {
      let held = 0
      for (const b of buys) if (b.date <= d.exDate) held += b.shares
      if (!(held > 0)) continue
      cashDividends += held * d.cashPerShare
    }
  }

  const marketValue = shares * endPrice
  const totalValue = dividendMode === 'reinvest' ? marketValue : marketValue + cashDividends
  const grossReturnPct = invested > 0 ? ((baselineMarketValue - invested) / invested) * 100 : 0
  const divBoostPp = invested > 0 ? ((totalValue - baselineMarketValue) / invested) * 100 : 0
  const totalReturnPct = invested > 0 ? ((totalValue - invested) / invested) * 100 : 0
  const actualMonths = buys.length
  const annualizedPct =
    invested > 0 && totalValue > 0 && actualMonths > 0
      ? (Math.pow(totalValue / invested, 12 / actualMonths) - 1) * 100
      : 0

  const sellFee = includeFees ? Math.max(Math.round(marketValue * FEE_RATE * feeDiscount), MIN_FEE) : 0
  const tax = includeFees ? Math.round(marketValue * taxRate) : 0
  const netTotal = totalValue - buyFeesTotal - sellFee - tax
  const netReturnPct = invested > 0 ? ((netTotal - invested) / invested) * 100 : 0

  // 權益曲線（逐買入月；reinvest 近似：除息日 <= 該月買入日的再投入已計入）。
  const equityCurve: DcaEquityPoint[] = []
  if (dividendMode === 'reinvest') {
    let reinvestCum = 0
    let sharesCum = 0
    let investedCum = 0
    const pending = [...divs]
    for (const b of buys) {
      sharesCum += b.shares
      investedCum += monthlyAmount
      while (pending.length > 0 && pending[0].exDate <= b.date) {
        const d = pending.shift()!
        // 當時持有＝買入日<=exDate 的基準股數＋此前再投入股數。
        let held = reinvestCum
        for (const bb of buys) if (bb.date <= d.exDate) held += bb.shares
        const px = priceOnOrAfter(d.exDate)
        if (px > 0 && held > 0) reinvestCum += (held * d.cashPerShare) / px
      }
      const tot = sharesCum + reinvestCum
      const mv = tot * b.price
      equityCurve.push({ date: b.date, investedCum, sharesCum: tot, marketValue: mv, totalValue: mv })
    }
  } else {
    let sharesCum = 0
    let investedCum = 0
    let cashCum = 0
    const pending = [...divs]
    for (const b of buys) {
      sharesCum += b.shares
      investedCum += monthlyAmount
      while (pending.length > 0 && pending[0].exDate <= b.date) {
        const d = pending.shift()!
        let held = 0
        for (const bb of buys) if (bb.date <= d.exDate) held += bb.shares
        cashCum += held * d.cashPerShare
      }
      const mv = sharesCum * b.price
      equityCurve.push({ date: b.date, investedCum, sharesCum, marketValue: mv, totalValue: mv + cashCum })
    }
    // cashDividends 主計算已含全部除息事件（含最後買入月之後者）；曲線僅作回撤用途。
  }
  // reinvest 尾端除息（最後買入月之後）不影響曲線回撤計算；總值以主計算為準。

  let peak = -Infinity
  let maxDd: number | null = null
  let maxDdMonth: string | null = null
  for (const p of equityCurve) {
    if (p.totalValue > peak) peak = p.totalValue
    if (peak > 0) {
      const dd = ((p.totalValue - peak) / peak) * 100
      if (maxDd == null || dd < maxDd) {
        maxDd = dd
        maxDdMonth = p.date
      }
    }
  }
  const hasDrawdown = maxDd != null && maxDd < 0

  const savingsValue = savingsFutureValue(monthlyAmount, actualMonths, savingsAnnualRate)
  const savingsMultiple = savingsValue > 0 ? totalValue / savingsValue : null

  return {
    symbol, dividendMode, includeFees, feeDiscount, nMonths: actualMonths,
    invested, shares, endPrice, endDate,
    marketValue, baselineMarketValue, cashDividends, totalValue,
    grossReturnPct, divBoostPp, totalReturnPct, annualizedPct,
    buyFeesTotal, sellFee, tax, taxRate, isEtf,
    netTotal, netReturnPct, buys, equityCurve,
    maxDrawdownMonth: hasDrawdown ? maxDdMonth : null,
    maxDrawdownPct: hasDrawdown ? maxDd : null,
    savingsValue, savingsAnnualRate, savingsMultiple,
  }
}
