import {
  type ArenaDecision,
  type ArenaHolding,
  type ArenaStrategyParams,
  ARENA_FEE_MIN,
  ARENA_FEE_RATE,
  ARENA_MAX_POSITION_RATIO,
  ARENA_SELL_TAX_RATE,
  ARENA_SLIPPAGE_DEFAULT,
} from './types.js'

export interface ArenaLedgerEntry {
  action: 'BUY' | 'SELL' | 'HOLD'
  symbol?: string
  symbolName?: string
  shares?: number
  /** 成交價（收盤價 ± slippage），BUY/SELL 時有值。 */
  price?: number
  /** 成交金額（Shares × 成交價，未含費用）。 */
  notional?: number
  fee?: number
  tax?: number
  reason?: string
}

export interface ArenaLedgerResult {
  entries: ArenaLedgerEntry[]
  rejected: ArenaLedgerEntry[]
  cash: number
  holdings: ArenaHolding[]
  equity: number
}

export function computeArenaEquity(
  cash: number,
  holdings: ArenaHolding[],
  closes: Record<string, number>,
): number {
  let total = cash
  for (const h of holdings) {
    const px = closes[h.symbol]
    if (px !== undefined && px > 0) total += h.shares * px
  }
  return Math.round(total * 100) / 100
}

function mergeHolding(
  holdings: ArenaHolding[],
  symbol: string,
  symbolName: string | undefined,
  deltaShares: number,
  execPrice: number,
): void {
  const existing = holdings.find((h) => h.symbol === symbol)
  if (existing) {
    const totalShares = existing.shares + deltaShares
    existing.avgCost =
      totalShares <= 0
        ? 0
        : (existing.avgCost * existing.shares + execPrice * deltaShares) / totalShares
    existing.shares = totalShares
    existing.symbolName = symbolName ?? existing.symbolName
    if (existing.shares <= 0) {
      const idx = holdings.indexOf(existing)
      holdings.splice(idx, 1)
    }
  } else if (deltaShares > 0) {
    holdings.push({ symbol, symbolName, shares: deltaShares, avgCost: execPrice })
  }
}


export interface ApplyArenaDecisionParams {
  cash: number
  holdings: ArenaHolding[]
  /** symbol -> 收盤價或盤中時點價（key 為無後綴代號，例如 2330）。 */
  closes: Record<string, number>
  symbolNames?: Record<string, string>
  decision: ArenaDecision
  slippage?: number
  /** 細部策略參數（可省略；省略即不啟用停損/現金緩衝/下單上限稽核）。 */
  strategyParams?: Partial<ArenaStrategyParams>
  /**
   * #40 對帳識別：守衛觸發時的 log 帶上 agent＋round＋slot，方便週一對帳。
   * 省略則 log 不帶識別（純 ledger 單測情境）。
   */
  guardContext?: { agentId?: number; roundDate?: string; slot?: number | null }
}

/**
 * #40 總量守衛擋單原因（engine 對帳 log 以此前綴／全字比對識別，勿散落字串比對）。
 * 語氣沿用既有 rejected 風格（參照「現金不足」「未持有該標的」）。
 */
export const ARENA_GUARD_CUMULATIVE_PREFIX = '現金不足（同輪累計買入含費用'
export const ARENA_GUARD_NEGATIVE_PROCEEDS_REASON = '賣出所得不足以支付費用'

export function isArenaGuardRejection(reason: string | undefined): boolean {
  if (!reason) return false
  return reason.startsWith(ARENA_GUARD_CUMULATIVE_PREFIX) || reason === ARENA_GUARD_NEGATIVE_PROCEEDS_REASON
}

export function applyArenaDecision(params: ApplyArenaDecisionParams): ArenaLedgerResult {
  const { cash, holdings, closes, symbolNames, decision, slippage } = params
  const sp = params.strategyParams
  const slip = slippage ?? ARENA_SLIPPAGE_DEFAULT
  let cashAfter = cash
  const holdingsAfter = holdings.map((h) => ({ ...h }))
  const entries: ArenaLedgerEntry[] = []
  const rejected: ArenaLedgerEntry[] = []

  const round2 = (n: number) => Math.round(n * 100) / 100

  // ── #40 總量守衛：同輪買單累計預扣 ──────────────────────────────
  // roundStartCash：本輪起始現金；reservedBuy：本輪已成交買單累計預扣
  // （含手續費／滑價邊際，execPrice 已內含 slippage）；roundSellProceeds：
  // 本輪賣出（含自動停損）累計所得。超額買單整筆擋掉並記 rejected。
  // 歷史負現金不追溯：起始現金若已為負，守衛只擋新買單，不回填舊帳。
  const roundStartCash = round2(cash)
  let reservedBuy = 0
  let roundSellProceeds = 0
  const guardTag = (): string => {
    const c = params.guardContext
    const who = c?.agentId !== undefined ? `agent#${c.agentId}` : 'agent#?'
    const when = c?.roundDate ?? '?'
    const slot = c?.slot === null || c?.slot === undefined ? '-' : String(c.slot)
    return `[ArenaLedger#40] ${who} round=${when} slot=${slot}`
  }

  /** 強制停損：個股現價自成本跌幅達 stopLossPct% → 自動減碼一半。 */
  if (sp?.stopLossPct && sp.stopLossPct > 0) {
    for (const h of [...holdingsAfter]) {
      const mark = closes[h.symbol]
      if (!mark || mark <= 0 || h.avgCost <= 0) continue
      if (mark <= h.avgCost * (1 - sp.stopLossPct / 100)) {
        const shares = Math.max(1, Math.floor(h.shares / 2))
        const execPrice = round2(mark * (1 - slip))
        const notional = round2(shares * execPrice)
        const fee = round2(Math.max(ARENA_FEE_MIN, notional * ARENA_FEE_RATE))
        const tax = round2(notional * ARENA_SELL_TAX_RATE)
        const proceeds = round2(notional - fee - tax)
        if (proceeds < 0) {
          // #40：手續費倒掛的停損賣出會吃掉現金 → 跳過（擋）並記 rejected＋log
          const reason = ARENA_GUARD_NEGATIVE_PROCEEDS_REASON
          rejected.push({ action: 'SELL', symbol: h.symbol, symbolName: h.symbolName, shares, reason })
          console.warn(`${guardTag()} 自動停損跳過 SELL ${h.symbol} x${shares}：${reason}（所得 ${proceeds}）`)
          continue
        }
        cashAfter = round2(cashAfter + proceeds)
        roundSellProceeds = round2(roundSellProceeds + proceeds)
        mergeHolding(holdingsAfter, h.symbol, h.symbolName, -shares, execPrice)
        entries.push({
          action: 'SELL',
          symbol: h.symbol,
          symbolName: h.symbolName,
          shares,
          price: execPrice,
          notional,
          fee,
          tax,
          reason: `自動停損：成本 ${round2(h.avgCost)}、現價 ${mark}，跌幅達 ${sp.stopLossPct}% 強制減碼一半`,
        })
      }
    }
  }

  let tradeCount = 0
  const maxTrades = sp?.maxTradesPerSlot != null ? Math.max(0, sp.maxTradesPerSlot) : Infinity
  const bufferPct = sp?.minCashBufferPct != null ? Math.max(0, sp.minCashBufferPct) : 0

  for (const action of decision.actions) {
    if (action.action === 'HOLD') {
      entries.push({ action: 'HOLD', symbol: action.symbol, reason: action.reason })
      continue
    }

    const px = closes[action.symbol]
    if (px === undefined || px <= 0) {
      rejected.push({ action: action.action, symbol: action.symbol, reason: '標的不在股票池或無收盤價' })
      continue
    }
    const name = symbolNames?.[action.symbol]

    if (action.action === 'BUY') {
      if (tradeCount >= maxTrades) {
        rejected.push({ action: action.action, symbol: action.symbol, shares: action.shares, reason: '超過本時點下單筆數上限' })
        continue
      }
      const shares = action.shares && action.shares > 0 ? Math.floor(action.shares) : 1
      const execPrice = round2(px * (1 + slip))
      const notional = round2(shares * execPrice)
      const fee = round2(Math.max(ARENA_FEE_MIN, notional * ARENA_FEE_RATE))
      const cost = round2(notional + fee)

      // #40 總量守衛：同輪累計預扣（含手續費／滑價邊際），超額整筆擋掉並記 rejected
      const availableThisRound = round2(roundStartCash + roundSellProceeds)
      if (round2(reservedBuy + cost) > availableThisRound) {
        const reason = `${ARENA_GUARD_CUMULATIVE_PREFIX} ${round2(reservedBuy + cost)} 超過本輪可用 ${availableThisRound}）`
        rejected.push({ action: action.action, symbol: action.symbol, shares, reason })
        console.warn(`${guardTag()} 總量守衛擋單 BUY ${action.symbol} x${shares}：${reason}`)
        continue
      }

      const projectedHoldings = holdingsAfter.map((h) => ({ ...h }))
      mergeHolding(projectedHoldings, action.symbol, name, shares, execPrice)
      const closesAbs = { ...closes }
      closesAbs[action.symbol] = px
      const projectedEquity = computeArenaEquity(cashAfter - cost, projectedHoldings, closesAbs)
      const newRatio = ((projectedHoldings.find((h) => h.symbol === action.symbol)?.shares ?? 0) * px) / projectedEquity

      if (bufferPct > 0 && projectedEquity > 0) {
        const required = projectedEquity * (bufferPct / 100)
        if (cashAfter - cost < round2(required)) {
          rejected.push({
            action: action.action,
            symbol: action.symbol,
            shares,
            reason: `買入後現金低於權益 ${bufferPct}% 的現金緩衝下限`,
          })
          continue
        }
      }
      if (cost > cashAfter) {
        rejected.push({ action: action.action, symbol: action.symbol, shares, reason: '現金不足' })
        continue
      }
      if (projectedEquity > 0 && newRatio > ARENA_MAX_POSITION_RATIO) {
        rejected.push({
          action: action.action,
          symbol: action.symbol,
          shares,
          reason: `買入後占比 ${(newRatio * 100).toFixed(0)}% 超過單檔上限 ${(ARENA_MAX_POSITION_RATIO * 100).toFixed()}%`,
        })
        continue
      }

      cashAfter = round2(cashAfter - cost)
      reservedBuy = round2(reservedBuy + cost)
      mergeHolding(holdingsAfter, action.symbol, name, shares, execPrice)
      tradeCount++
      entries.push({
        action: 'BUY',
        symbol: action.symbol,
        symbolName: name,
        shares,
        price: execPrice,
        notional,
        fee,
        reason: action.reason,
      })
    } else {
      if (tradeCount >= maxTrades) {
        rejected.push({ action: action.action, symbol: action.symbol, shares: action.shares, reason: '超過本時點下單筆數上限' })
        continue
      }
      const existing = holdingsAfter.find((h) => h.symbol === action.symbol)
      const owned = existing?.shares ?? 0
      if (owned <= 0) {
        rejected.push({ action: action.action, symbol: action.symbol, shares: action.shares, reason: '未持有該標的' })
        continue
      }
      const shares = action.shares && action.shares > 0 ? Math.min(Math.floor(action.shares), owned) : owned
      const execPrice = round2(px * (1 - slip))
      const notional = round2(shares * execPrice)
      const fee = round2(Math.max(ARENA_FEE_MIN, notional * ARENA_FEE_RATE))
      const tax = round2(notional * ARENA_SELL_TAX_RATE)
      const proceeds = round2(notional - fee - tax)
      if (proceeds < 0) {
        // #40：手續費倒掛的賣出會吃掉現金 → 擋掉並記 rejected＋log
        const reason = ARENA_GUARD_NEGATIVE_PROCEEDS_REASON
        rejected.push({ action: action.action, symbol: action.symbol, shares, reason })
        console.warn(`${guardTag()} 總量守衛擋單 SELL ${action.symbol} x${shares}：${reason}（所得 ${proceeds}）`)
        continue
      }

      cashAfter = round2(cashAfter + proceeds)
      roundSellProceeds = round2(roundSellProceeds + proceeds)
      mergeHolding(holdingsAfter, action.symbol, name, -shares, execPrice)
      tradeCount++
      entries.push({
        action: 'SELL',
        symbol: action.symbol,
        symbolName: name,
        shares,
        price: execPrice,
        notional,
        fee,
        tax,
        reason: action.reason,
      })
    }
  }

  if (entries.length === 0) {
    entries.push({ action: 'HOLD', reason: '無達成任何交易，維持現狀' })
  }

  // ── #40 成交對帳：cash 恆 ≥ 0 ───────────────────────────────────
  // 正常情況下逐筆＋總量守衛已保證不為負；此為最終防線（有違即箝制＋log，
  // 不回填歷史、不竄改已成交分錄，僅確保寫回 DB 的 cash 不為負）。
  let settledCash = round2(cashAfter)
  if (settledCash < 0) {
    console.warn(`${guardTag()} 成交對帳異常：cashAfter=${settledCash}（已箝制為 0，請對帳；歷史負現金不追溯）`)
    settledCash = 0
  }

  const equity = computeArenaEquity(settledCash, holdingsAfter, closes)
  return { entries, rejected, cash: settledCash, holdings: holdingsAfter, equity }
}