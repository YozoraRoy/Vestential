/**
 * Issue #163：/portfolio 股票買入／賣出交易與持股總覽自動結算引擎（client-safe）。
 *
 * - 手續費與證交稅自動試算：
 *   - 台股手續費：成交金額 * 0.1425% * 折數（最低 NT$ 20，四捨五入至整數）
 *   - 台股證交稅（賣出）：ETF（00 開頭）0.1%、一般股票 0.3%（無條件捨去或四捨五入至整數）
 *   - 美股：預設手續費與稅為 0，可由使用者手動微調
 * - 移動加權平均成本法結算：
 *   - 買入：新總成本 = 原總成本 + (成交價 * 股數 + 手續費)；合併同代號所有舊持倉為單一部位
 *   - 賣出：驗證不超賣；計算已實現損益 = (賣出成交額 - 賣出手續費 - 證交稅) - (原均價 * 賣出股數)
 *           若剩餘股數 <= 0 則全數清倉移除，否則依剩餘股數更新持股總覽
 */

export type TradeSide = 'buy' | 'sell'
export type TradeMarket = 'tw' | 'us'

export interface TradeFeeTaxEstimateInput {
  market: TradeMarket
  symbol: string
  side: TradeSide
  shares: number
  price: number
  /** 手續費折數（例如 0.6 表示 6 折、1 表示不打折） */
  feeDiscount: number
}

export interface TradeFeeTaxEstimate {
  fee: number
  tax: number
  grossAmount: number
  /** 買入為總付出成本（價金+費）；賣出為淨入帳金額（價金-費-稅） */
  netCashAmount: number
}

export function estimateTradeFeeAndTax(input: TradeFeeTaxEstimateInput): TradeFeeTaxEstimate {
  const shares = Math.max(0, Number(input.shares) || 0)
  const price = Math.max(0, Number(input.price) || 0)
  const grossAmount = shares * price

  if (grossAmount <= 0 || input.market === 'us') {
    const roundedGross = input.market === 'tw' ? Math.round(grossAmount) : Math.round(grossAmount * 100) / 100
    return {
      fee: 0,
      tax: 0,
      grossAmount: roundedGross,
      netCashAmount: roundedGross,
    }
  }

  const discount = Number.isFinite(input.feeDiscount) && input.feeDiscount > 0 ? input.feeDiscount : 1
  const rawFee = Math.round(grossAmount * 0.001425 * discount)
  const fee = grossAmount > 0 ? Math.max(20, rawFee) : 0

  const sym = input.symbol.trim().toUpperCase()
  const taxRate = input.side === 'sell' ? (sym.startsWith('00') ? 0.001 : 0.003) : 0
  const tax = input.side === 'sell' ? Math.floor(grossAmount * taxRate) : 0

  const roundedGross = Math.round(grossAmount)
  const netCashAmount = input.side === 'buy' ? roundedGross + fee : roundedGross - fee - tax

  return { fee, tax, grossAmount: roundedGross, netCashAmount }
}

export interface ExistingHoldingRow {
  id: number
  market: string
  symbol: string
  symbol_name?: string | null
  shares: number
  cost: number
  current_price: number
  dividend: number
  cost_basis: number
  strategy?: string | null
}

export interface PortfolioTradeInput {
  market: TradeMarket
  symbol: string
  symbolName?: string | null
  side: TradeSide
  shares: number
  price: number
  fee: number
  tax: number
  currentPrice?: number | null
  tradeDate: string
  note?: string | null
}

export interface SettledRecordPatch {
  market: TradeMarket
  symbol: string
  symbolName: string | null
  shares: number
  cost: number
  currentPrice: number
  dividend: number
  costBasis: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  totalReturn: number
  totalReturnPct: number
  yieldOnCost: number
  strategy: string | null
}

export interface PortfolioSettlementResult {
  action: 'create' | 'update' | 'delete'
  /** 若為 update / delete，要保留更新的那筆 primary record id */
  primaryRecordId: number | null
  /** 若同代號原有多筆持倉，合併結算後應移除的多餘 record id 清單 */
  removeRecordIds: number[]
  /** action !== 'delete' 時的新持股欄位 */
  settledRecord: SettledRecordPatch | null
  /** 寫入交易明細表的成交金額（買：價金+費；賣：價金-費-稅） */
  totalAmount: number
  realizedPnl: number | null
  realizedPnlPct: number | null
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function settlePortfolioTrade(
  existingRows: readonly ExistingHoldingRow[],
  trade: PortfolioTradeInput,
): PortfolioSettlementResult {
  const sym = trade.symbol.trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
  if (!sym) throw new Error('請輸入股票代號')
  if (!Number.isFinite(trade.shares) || trade.shares <= 0) throw new Error('成交股數必須大於 0')
  if (!Number.isFinite(trade.price) || trade.price <= 0) throw new Error('成交價格必須大於 0')
  if (!Number.isFinite(trade.fee) || trade.fee < 0) throw new Error('手續費不可為負數')
  if (!Number.isFinite(trade.tax) || trade.tax < 0) throw new Error('證交稅不可為負數')

  const matched = existingRows.filter(
    (r) => (r.market === 'us' ? 'us' : 'tw') === trade.market && r.symbol.trim().toUpperCase() === sym,
  )

  const gross = trade.shares * trade.price
  const currentPrice =
    trade.currentPrice && Number.isFinite(trade.currentPrice) && trade.currentPrice > 0
      ? trade.currentPrice
      : matched[0]?.current_price && matched[0].current_price > 0
        ? matched[0].current_price
        : trade.price

  const existingShares = matched.reduce((s, r) => s + (Number(r.shares) || 0), 0)
  const existingCostBasis = matched.reduce(
    (s, r) => s + (Number(r.cost_basis) > 0 ? Number(r.cost_basis) : (Number(r.cost) || 0) * (Number(r.shares) || 0)),
    0,
  )
  const avgExistingCost = existingShares > 0 ? existingCostBasis / existingShares : 0
  const maxDividend = matched.reduce((m, r) => Math.max(m, Number(r.dividend) || 0), 0)
  const inheritedName = trade.symbolName?.trim() || matched.find((r) => r.symbol_name)?.symbol_name || null
  const inheritedStrategy = matched.find((r) => r.strategy)?.strategy ?? null

  if (trade.side === 'buy') {
    const buyCostTotal = gross + trade.fee
    const nextShares = round4(existingShares + trade.shares)
    const nextCostBasis = round2(existingCostBasis + buyCostTotal)
    const nextAvgCost = nextShares > 0 ? round4(nextCostBasis / nextShares) : 0
    const marketValue = round2(nextShares * currentPrice)
    const unrealizedPnl = round2(marketValue - nextCostBasis)
    const unrealizedPnlPct = nextCostBasis > 0 ? round2((unrealizedPnl / nextCostBasis) * 100) : 0
    const divIncome = round2(nextShares * maxDividend)
    const totalReturn = round2(unrealizedPnl + divIncome)
    const totalReturnPct = nextCostBasis > 0 ? round2((totalReturn / nextCostBasis) * 100) : 0
    const yieldOnCost = nextAvgCost > 0 ? round2((maxDividend / nextAvgCost) * 100) : 0

    const primaryRecordId = matched[0]?.id ?? null
    const removeRecordIds = matched.slice(1).map((r) => r.id)

    return {
      action: primaryRecordId !== null ? 'update' : 'create',
      primaryRecordId,
      removeRecordIds,
      settledRecord: {
        market: trade.market,
        symbol: sym,
        symbolName: inheritedName,
        shares: nextShares,
        cost: nextAvgCost,
        currentPrice,
        dividend: maxDividend,
        costBasis: nextCostBasis,
        marketValue,
        unrealizedPnl,
        unrealizedPnlPct,
        totalReturn,
        totalReturnPct,
        yieldOnCost,
        strategy: inheritedStrategy,
      },
      totalAmount: round2(buyCostTotal),
      realizedPnl: null,
      realizedPnlPct: null,
    }
  }

  // 賣出結算
  if (matched.length === 0 || existingShares <= 0) {
    throw new Error(`目前持股總覽查無 ${sym} 部位，無法賣出`)
  }
  if (trade.shares > existingShares + 1e-6) {
    throw new Error(`賣出股數（${trade.shares}）不可大於目前持有股數（${existingShares}）`)
  }

  const netProceeds = gross - trade.fee - trade.tax
  const soldCostBasis = avgExistingCost * trade.shares
  const realizedPnl = round2(netProceeds - soldCostBasis)
  const realizedPnlPct = soldCostBasis > 0 ? round2((realizedPnl / soldCostBasis) * 100) : 0

  const remainingShares = round4(Math.max(0, existingShares - trade.shares))
  const primaryRecordId = matched[0]!.id

  if (remainingShares <= 1e-6) {
    return {
      action: 'delete',
      primaryRecordId,
      removeRecordIds: matched.map((r) => r.id),
      settledRecord: null,
      totalAmount: round2(netProceeds),
      realizedPnl,
      realizedPnlPct,
    }
  }

  const nextCostBasis = round2(avgExistingCost * remainingShares)
  const nextAvgCost = round4(avgExistingCost)
  const marketValue = round2(remainingShares * currentPrice)
  const unrealizedPnl = round2(marketValue - nextCostBasis)
  const unrealizedPnlPct = nextCostBasis > 0 ? round2((unrealizedPnl / nextCostBasis) * 100) : 0
  const divIncome = round2(remainingShares * maxDividend)
  const totalReturn = round2(unrealizedPnl + divIncome)
  const totalReturnPct = nextCostBasis > 0 ? round2((totalReturn / nextCostBasis) * 100) : 0
  const yieldOnCost = nextAvgCost > 0 ? round2((maxDividend / nextAvgCost) * 100) : 0

  return {
    action: 'update',
    primaryRecordId,
    removeRecordIds: matched.slice(1).map((r) => r.id),
    settledRecord: {
      market: trade.market,
      symbol: sym,
      symbolName: inheritedName,
      shares: remainingShares,
      cost: nextAvgCost,
      currentPrice,
      dividend: maxDividend,
      costBasis: nextCostBasis,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPct,
      totalReturn,
      totalReturnPct,
      yieldOnCost,
      strategy: inheritedStrategy,
    },
    totalAmount: round2(netProceeds),
    realizedPnl,
    realizedPnlPct,
  }
}
