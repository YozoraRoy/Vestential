/**
 * Issue #153：股利現金流月領自由配置引擎（client-safe，零 DB/網路依賴）。
 *
 * - 目標檔位：2 萬 / 4 萬（預設）/ 6 萬 / 8 萬 / 10 萬（以稅後實拿為準）
 * - 一律從零開始試算（不帶入既有持股）
 * - 二代健保補充保費（2.11%）：串接 `getTaxable54cRatio` 僅針對 54C >= 20,000 元扣繳
 */

import {
  isLikelyEnglishStockName,
  isTwStockSymbol,
  resolveStockDisplayName,
  type StockMultilingualName,
} from '@stock/core'
import { computeNhiSupplementFee, DEFAULT_PAY_LAG_DAYS, NHI_SUPPLEMENT_THRESHOLD } from './dividend-calendar'
import { getTaxable54cRatio } from './etf-dividend-composition'

export const CASHFLOW_TARGET_PRESETS = [20_000, 40_000, 60_000, 80_000, 100_000] as const
export const DEFAULT_CASHFLOW_TARGET = 40_000

export type CashflowStyleId = 'balanced' | 'tech-growth' | 'low-vol'

export interface CashflowStyleTemplate {
  id: CashflowStyleId
  name: string
  desc: string
  allocations: { symbol: string; weight: number }[]
}

export const CASHFLOW_STYLE_TEMPLATES: CashflowStyleTemplate[] = [
  {
    id: 'balanced',
    name: '均衡月月領',
    desc: '高股息季配三巨頭錯開配息月，12 個月現金流最平均',
    allocations: [
      { symbol: '0056', weight: 0.34 },
      { symbol: '00878', weight: 0.33 },
      { symbol: '00919', weight: 0.33 },
    ],
  },
  {
    id: 'tech-growth',
    name: '科技含息成長',
    desc: '市值＋半導體＋高息混搭，兼顧股價成長與季度現金流',
    allocations: [
      { symbol: '0050', weight: 0.34 },
      { symbol: '00891', weight: 0.33 },
      { symbol: '00919', weight: 0.33 },
    ],
  },
  {
    id: 'low-vol',
    name: '高息低波防禦',
    desc: '低波動與高填息因子配置，適合重視本金穩定之領息族',
    allocations: [
      { symbol: '00713', weight: 0.34 },
      { symbol: '00878', weight: 0.33 },
      { symbol: '00918', weight: 0.33 },
    ],
  },
]

export interface PlanDividendEvent {
  exDate: string
  payDate: string
  payMonth: number
  cashDividend: number
}

export interface PlanAssetProfile {
  symbol: string
  name: string
  names?: StockMultilingualName
  price: number
  dividend54cRatio: number
  /** 最近 12 個月（實際領息分布）配息事件；不依賴猜測捏造未發放紀錄 */
  events: PlanDividendEvent[]
  /** 合計近 12 個月每股現金股利 */
  annualDivPerShare: number
  /** 若紀錄未滿完整一年（例如新掛牌不足 1 年且為空或極少次），提供UI標註 */
  insufficientHistory: boolean
}

export interface PlanAllocationInput {
  asset: PlanAssetProfile
  /** 張數（1 張 = 1,000 股） */
  lots: number
}

export interface PlanMonthDetail {
  month: number
  gross: number
  nhiFee: number
  net: number
  items: Array<{
    symbol: string
    name: string
    names?: StockMultilingualName
    lots: number
    cashDividend: number
    gross: number
    nhiFee: number
    net: number
    payDate: string
  }>
}

export interface PlanAssetEvaluation {
  symbol: string
  name: string
  names?: StockMultilingualName
  price: number
  lots: number
  capital: number
  annualGross: number
  annualNhiFee: number
  annualNet: number
  dividend54cRatio: number
  maxSingle54c: number
  nhiTriggered: boolean
  /** 單次欲避開 NT$20,000 二代健保起扣門檻的安全上限張數（若 54C=0 則 null 無上限） */
  safeMaxLots: number | null
  insufficientHistory: boolean
}

export interface CashflowPlanEvaluation {
  targetMonthlyNet: number
  totalCapital: number
  annualGross: number
  annualNhiFee: number
  annualNet: number
  monthlyAvgNet: number
  portfolioYieldPct: number
  assets: PlanAssetEvaluation[]
  months: PlanMonthDetail[]
}

function addDays(isoDate: string, days: number): string {
  const ts = Date.parse(`${isoDate}T00:00:00Z`)
  if (!Number.isFinite(ts)) return isoDate
  return new Date(ts + days * 86_400_000).toISOString().slice(0, 10)
}

/** 依當前語系解析顯示名稱（相容舊 localStorage 僅存單一英文 name 的紀錄） */
export function getPlanAssetDisplayName(
  symbol: string,
  fallbackName: string | undefined,
  names: StockMultilingualName | undefined,
  locale: string,
): string {
  const effectiveNames: StockMultilingualName = names ?? (
    isLikelyEnglishStockName(fallbackName)
      ? { nameEn: fallbackName, market: isTwStockSymbol(symbol) ? 'TW' : 'US' }
      : { nameZh: fallbackName, market: isTwStockSymbol(symbol) ? 'TW' : 'US' }
  )
  return resolveStockDisplayName(symbol, effectiveNames, locale)
}

/** 將近 12 個月原始配息列整理成 PlanAssetProfile（不自行乘倍捏造）。 */
export function buildAssetProfile(params: {
  symbol: string
  name: string
  names?: StockMultilingualName
  price: number
  rawDividends: Array<{ ex_date: string; pay_date?: string | null; cash_dividend: number }>
  today: string
}): PlanAssetProfile {
  const sym = params.symbol.trim().toUpperCase()
  const { ratio } = getTaxable54cRatio(sym)

  // 只取近 12 個月內的實際已發生或已公告除息
  const cutoffTs = Date.parse(`${params.today}T00:00:00Z`) - 366 * 86_400_000
  const cutoffIso = new Date(cutoffTs).toISOString().slice(0, 10)

  const seen = new Set<string>()
  const events: PlanDividendEvent[] = []
  for (const r of params.rawDividends) {
    const exDate = (r.ex_date ?? '').trim()
    const div = Number(r.cash_dividend)
    if (!exDate || exDate < cutoffIso || !Number.isFinite(div) || div <= 0) continue
    if (seen.has(exDate)) continue
    seen.add(exDate)
    const payDate =
      r.pay_date && /^\d{4}-\d{2}-\d{2}$/.test(r.pay_date.trim())
        ? r.pay_date.trim()
        : addDays(exDate, DEFAULT_PAY_LAG_DAYS)
    const payMonth = Number(payDate.slice(5, 7))
    if (payMonth < 1 || payMonth > 12) continue
    events.push({ exDate, payDate, payMonth, cashDividend: div })
  }

  events.sort((a, b) => (a.payDate < b.payDate ? -1 : 1))
  const annualDivPerShare = Math.round(events.reduce((s, e) => s + e.cashDividend, 0) * 10_000) / 10_000
  return {
    symbol: sym,
    name: params.name || sym,
    names: params.names,
    price: params.price,
    dividend54cRatio: ratio,
    events,
    annualDivPerShare,
    insufficientHistory: events.length === 0,
  }
}

/** 計算目前配置之 12 個月實際領錢分佈、所需本金與 54C 健保精算。 */
export function evaluateCashflowPlan(
  allocations: PlanAllocationInput[],
  targetMonthlyNet: number,
): CashflowPlanEvaluation {
  const months: PlanMonthDetail[] = Array.from({ length: 12 }, (_, idx) => ({
    month: idx + 1,
    gross: 0,
    nhiFee: 0,
    net: 0,
    items: [],
  }))

  let totalCapital = 0
  let annualGross = 0
  let annualNhiFee = 0
  let annualNet = 0

  const assets: PlanAssetEvaluation[] = allocations.map(({ asset, lots }) => {
    const safeLots = Math.max(0, Math.round(lots))
    const shares = safeLots * 1000
    const capital = Math.round(shares * asset.price)
    totalCapital += capital

    let assetGross = 0
    let assetNhi = 0
    let assetNet = 0
    let maxSingle54c = 0
    let maxSingleDiv = 0

    for (const ev of asset.events) {
      if (shares <= 0) continue
      const gross = Math.round(shares * ev.cashDividend)
      const taxable54c = Math.round(gross * asset.dividend54cRatio)
      if (taxable54c > maxSingle54c) maxSingle54c = taxable54c
      if (ev.cashDividend > maxSingleDiv) maxSingleDiv = ev.cashDividend
      const nhiFee = computeNhiSupplementFee(taxable54c)
      const net = gross - nhiFee

      assetGross += gross
      assetNhi += nhiFee
      assetNet += net

      const m = months[ev.payMonth - 1]!
      m.gross += gross
      m.nhiFee += nhiFee
      m.net += net
      m.items.push({
        symbol: asset.symbol,
        name: asset.name,
        names: asset.names,
        lots: safeLots,
        cashDividend: ev.cashDividend,
        gross,
        nhiFee,
        net,
        payDate: ev.payDate,
      })
    }

    annualGross += assetGross
    annualNhiFee += assetNhi
    annualNet += assetNet

    const perLotMax54c = maxSingleDiv * 1000 * asset.dividend54cRatio
    const safeMaxLots =
      perLotMax54c > 0 ? Math.floor((NHI_SUPPLEMENT_THRESHOLD - 1) / perLotMax54c) : null

    return {
      symbol: asset.symbol,
      name: asset.name,
      names: asset.names,
      price: asset.price,
      lots: safeLots,
      capital,
      annualGross: assetGross,
      annualNhiFee: assetNhi,
      annualNet: assetNet,
      dividend54cRatio: asset.dividend54cRatio,
      maxSingle54c,
      nhiTriggered: maxSingle54c >= NHI_SUPPLEMENT_THRESHOLD,
      safeMaxLots,
      insufficientHistory: asset.insufficientHistory,
    }
  })

  const monthlyAvgNet = Math.round(annualNet / 12)
  const portfolioYieldPct =
    totalCapital > 0 ? Math.round((annualNet / totalCapital) * 10_000) / 100 : 0

  return {
    targetMonthlyNet,
    totalCapital,
    annualGross,
    annualNhiFee,
    annualNet,
    monthlyAvgNet,
    portfolioYieldPct,
    assets,
    months,
  }
}

/**
 * 依目標月領金額與權重，反推各標的初始建議張數（以稅後實拿達標為準）。
 */
export function solveTargetLots(
  items: Array<{ asset: PlanAssetProfile; weight: number }>,
  targetMonthlyNet: number,
): PlanAllocationInput[] {
  const targetAnnualNet = Math.max(0, targetMonthlyNet) * 12
  const validItems = items.filter((x) => x.asset.annualDivPerShare > 0)
  if (validItems.length === 0 || targetAnnualNet === 0) {
    return items.map((x) => ({ asset: x.asset, lots: 0 }))
  }

  const totalWeight = validItems.reduce((s, x) => s + Math.max(0, x.weight), 0) || validItems.length
  const lotsMap = new Map<string, number>()

  for (const item of items) {
    if (item.asset.annualDivPerShare <= 0) {
      lotsMap.set(item.asset.symbol, 0)
      continue
    }
    const normWeight = (item.weight > 0 ? item.weight : 1) / totalWeight
    const targetForAsset = targetAnnualNet * normWeight
    const annualPerLot = item.asset.annualDivPerShare * 1000
    // 預估稅後（扣除可能約 1% 的 54C 健保耗損初估值）
    const initLots = Math.max(1, Math.floor(targetForAsset / (annualPerLot * 0.99)))
    lotsMap.set(item.asset.symbol, initLots)
  }

  // 迭代補張數至年化稅後實拿 >= targetAnnualNet（安全上限 200 次迴圈）
  for (let step = 0; step < 200; step++) {
    const current = items.map((x) => ({ asset: x.asset, lots: lotsMap.get(x.asset.symbol) ?? 0 }))
    const evalRes = evaluateCashflowPlan(current, targetMonthlyNet)
    if (evalRes.annualNet >= targetAnnualNet) break

    // 挑選最能提升「權重比例落差」或殖利率較佳的可配息標的加 1 張
    let bestSym = validItems[0]!.asset.symbol
    let bestScore = -Infinity
    for (const v of validItems) {
      const lots = lotsMap.get(v.asset.symbol) ?? 0
      const cap = lots * 1000 * v.asset.price
      const curShare = evalRes.totalCapital > 0 ? cap / evalRes.totalCapital : 0
      const desiredShare = (v.weight > 0 ? v.weight : 1) / totalWeight
      const score = desiredShare - curShare
      if (score > bestScore) {
        bestScore = score
        bestSym = v.asset.symbol
      }
    }
    lotsMap.set(bestSym, (lotsMap.get(bestSym) ?? 0) + 1)
  }

  return items.map((x) => ({
    asset: x.asset,
    lots: lotsMap.get(x.asset.symbol) ?? 0,
  }))
}
