import type { ArenaAgentStatus, ArenaDivision, ArenaHolding, ArenaStrategyParams, ArenaTone } from './types.js'
import type { ArenaDecisionPhase } from './strategist.js'

export interface ArenaAgentRecord {
  id: number
  ownerUserId: string
  name: string
  division: ArenaDivision
  strategyId: string
  tone: ArenaTone
  initialCapital: number
  cash: number
  status: ArenaAgentStatus
  lastRoundDate: string | null
  seasonId: number | null
  seasonName: string | null
  personality: string | null
  strategyParams: ArenaStrategyParams
}

export interface ArenaTradeRecord {
  agentId: number
  seasonId?: number | null
  roundDate: string
  action: 'BUY' | 'SELL' | 'HOLD'
  /** 盤中時點 index（trade 階段才會有值）。 */
  slot?: number | null
  symbol?: string | null
  symbolName?: string | null
  shares?: number | null
  price?: number | null
  fee?: number | null
  tax?: number | null
  reason?: string | null
  model?: string | null
  fallbackUsed?: boolean | null
  error?: string | null
}

export interface ArenaSnapshotRecord {
  agentId: number
  seasonId?: number | null
  roundDate: string
  cash: number
  equity: number
  returnPct: number
}

export interface ArenaIntradayPriceRecord {
  roundDate: string
  symbol: string
  slot: number
  timeLabel?: string | null
  price: number
  changePct?: number | null
}

export interface ArenaDecisionLogRecord {
  agentId: number
  seasonId?: number | null
  roundDate: string
  phase: ArenaDecisionPhase
  slot?: number | null
  content: string
  model?: string | null
  fallbackUsed?: boolean | null
}

/** 除息快取列（Issue #54：twse_dividends 窗查詢的回傳形狀）。 */
export interface ArenaDividendQuote {
  symbol: string
  exDate: string
  cashDividend: number
}

/** 股利入帳列（Issue #54：寫入 arena_dividend_credits 的形狀）。 */
export interface ArenaDividendCreditInput {
  agentId: number
  symbol: string
  exDate: string
  shares: number
  amount: number
}

/** 引擎所需的資料存取面（由 apps/web 用 @stock/database 實作）。 */
export interface ArenaStore {
  listActiveAgents(): Promise<ArenaAgentRecord[]>
  getHoldings(agentId: number): Promise<ArenaHolding[]>
  replaceHoldings(agentId: number, holdings: ArenaHolding[], roundDate: string): Promise<void>
  insertTrade(record: ArenaTradeRecord): Promise<void>
  getRoundTrades(agentId: number, roundDate: string): Promise<Array<{ slot: number | null; action: string; error?: string | null }>>
  insertSnapshot(snapshot: ArenaSnapshotRecord): Promise<void>
  advanceRound(agentId: number, roundDate: string, cash: number): Promise<void>
  saveIntradayPrices(rows: ArenaIntradayPriceRecord[]): Promise<void>
  saveMarketBriefing(roundDate: string, content: string, model?: string | null, fallbackUsed?: boolean | null): Promise<void>
  getMarketBriefing(roundDate: string): Promise<{ content: string; fallbackUsed?: boolean | null } | null>
  insertDecisionLog(record: ArenaDecisionLogRecord): Promise<void>
  saveDiscussion(roundDate: string, content: string, model?: string | null, fallbackUsed?: boolean | null): Promise<void>
  /**
   * Issue #54 股利入帳 seam（可選：未實作的 store 直接跳過入帳，不擋結算）。
   * - getDividendsInWindow：窗內除息快取（symbol 正規化後比對；缺檔回 []）。
   * - saveDividendCredit：原子冪等寫入（已入帳過回 false）。
   * - hasDividendCredit：是否已入帳（讀端／對帳用）。
   */
  getDividendsInWindow?(symbols: string[], fromDate: string, toDate: string): Promise<ArenaDividendQuote[]>
  saveDividendCredit?(credit: ArenaDividendCreditInput): Promise<boolean>
  hasDividendCredit?(agentId: number, symbol: string, exDate: string): Promise<boolean>
}