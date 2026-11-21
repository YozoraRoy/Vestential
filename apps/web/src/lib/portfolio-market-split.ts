/**
 * Issue #175：/portfolio 台股／美股分市場篩選與個別統計純計算函式（client-safe，零 Node/DB 依賴）。
 *
 * 原則：
 * - 台股（NT$）與美股（US$）嚴格分開計算與加總，絕不跨幣別混加。
 * - 所有除法皆有零守衛（costBasis <= 0 或空陣列回 0，不回傳 NaN）。
 * - 台股核心資產配置比例只以台股部位作分母，不被美股稀釋。
 */

import { getUniverseTier } from '@stock/cycle-entry'
import { computeNetPnL } from './portfolio-net'

export type MarketFilter = 'all' | 'tw' | 'us'
export type SplitMarket = 'tw' | 'us'

export interface MarketRecordLike {
  market: string
  symbol: string
  shares: number
  cost: number
  current_price: number
  cost_basis: number
  market_value: number
  unrealized_pnl: number
}

export interface MarketPortfolioStats {
  market: SplitMarket
  count: number
  totalCost: number
  totalMarketValue: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  netPnl: number
  netPnlPct: number
}

export interface SplitPortfolioStats {
  tw: MarketPortfolioStats
  us: MarketPortfolioStats
  totalCount: number
}

function numOrZero(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : 0
}

function emptyMarketStats(market: SplitMarket): MarketPortfolioStats {
  return {
    market,
    count: 0,
    totalCost: 0,
    totalMarketValue: 0,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    netPnl: 0,
    netPnlPct: 0,
  }
}

/** 分市場（tw / us）個別計算持倉檔數、成本、市值、未實現損益與含稅費淨損益 */
export function computeMarketPortfolioStats(
  records: MarketRecordLike[],
  feeDiscount?: number,
): SplitPortfolioStats {
  const tw = emptyMarketStats('tw')
  const us = emptyMarketStats('us')

  for (const r of records) {
    const m: SplitMarket = r.market === 'us' ? 'us' : 'tw'
    const bucket = m === 'us' ? us : tw
    bucket.count += 1
    bucket.totalCost += numOrZero(r.cost_basis)
    bucket.totalMarketValue += numOrZero(r.market_value)
    bucket.unrealizedPnl += numOrZero(r.unrealized_pnl)

    const net = computeNetPnL({
      market: m,
      symbol: r.symbol,
      shares: numOrZero(r.shares),
      cost: numOrZero(r.cost),
      currentPrice: numOrZero(r.current_price),
      discount: feeDiscount,
    })
    bucket.netPnl += net.netPnl
  }

  tw.unrealizedPnlPct = tw.totalCost > 0 ? (tw.unrealizedPnl / tw.totalCost) * 100 : 0
  tw.netPnlPct = tw.totalCost > 0 ? (tw.netPnl / tw.totalCost) * 100 : 0
  us.unrealizedPnlPct = us.totalCost > 0 ? (us.unrealizedPnl / us.totalCost) * 100 : 0
  us.netPnlPct = us.totalCost > 0 ? (us.netPnl / us.totalCost) * 100 : 0

  return {
    tw,
    us,
    totalCount: tw.count + us.count,
  }
}

export interface TwCoreAssetStats {
  totalMarketValue: number
  coreMarketValue: number
  ratioPct: number
  coreCount: number
  twCount: number
}

/** 計算台股核心資產配置比例（嚴格排除美股，避免美股市值稀釋分母） */
export function computeTwCoreAssetStats(records: Pick<MarketRecordLike, 'market' | 'symbol' | 'market_value'>[]): TwCoreAssetStats {
  let totalMarketValue = 0
  let coreMarketValue = 0
  let twCount = 0
  let coreCount = 0

  for (const r of records) {
    if (r.market === 'us') continue
    const mv = Math.max(0, numOrZero(r.market_value))
    totalMarketValue += mv
    twCount += 1
    const tier = getUniverseTier(r.symbol)
    if (tier === 'ETF' || tier === 'TOP_50' || tier === 'TOP_100') {
      coreMarketValue += mv
      coreCount += 1
    }
  }

  const ratioPct = totalMarketValue > 0 ? (coreMarketValue / totalMarketValue) * 100 : 0
  return {
    totalMarketValue,
    coreMarketValue,
    ratioPct,
    coreCount,
    twCount,
  }
}

export interface MarketTransactionLike {
  market: string
  side: 'buy' | 'sell'
  total_amount: number
  realized_pnl: number | null
}

export interface MarketTransactionSummary {
  market: SplitMarket
  buyCount: number
  sellCount: number
  totalBuyAmount: number
  totalSellAmount: number
  totalRealizedPnl: number
}

/** 分市場彙總交易結算紀錄（買入額、賣出額、已實現損益），不混加不同幣別 */
export function summarizeTransactionsByMarket(transactions: MarketTransactionLike[]): {
  tw: MarketTransactionSummary
  us: MarketTransactionSummary
} {
  const tw: MarketTransactionSummary = {
    market: 'tw',
    buyCount: 0,
    sellCount: 0,
    totalBuyAmount: 0,
    totalSellAmount: 0,
    totalRealizedPnl: 0,
  }
  const us: MarketTransactionSummary = {
    market: 'us',
    buyCount: 0,
    sellCount: 0,
    totalBuyAmount: 0,
    totalSellAmount: 0,
    totalRealizedPnl: 0,
  }

  for (const tx of transactions) {
    const bucket = tx.market === 'us' ? us : tw
    const amt = numOrZero(tx.total_amount)
    if (tx.side === 'buy') {
      bucket.buyCount += 1
      bucket.totalBuyAmount += amt
    } else {
      bucket.sellCount += 1
      bucket.totalSellAmount += amt
      bucket.totalRealizedPnl += numOrZero(tx.realized_pnl)
    }
  }

  return { tw, us }
}
