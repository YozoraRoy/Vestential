import { NextResponse } from 'next/server'
import {
  deletePortfolioRecordByOwner,
  getPortfolioRecords,
  getPortfolioRecordsByGuest,
  getPortfolioTransactions,
  getPortfolioTransactionsByGuest,
  insertPortfolioTransaction,
  savePortfolioRecord,
  updatePortfolioRecordByOwner,
  type PortfolioTransactionRow,
} from '@stock/database'
import { getCurrentUserFromCookies } from '../../../../lib/auth'
import { applyGuestCookie, getCurrentGuestFromCookies, newGuestUid } from '../../../../lib/guest'
import { settlePortfolioTrade, type TradeMarket, type TradeSide } from '../../../../lib/portfolio-trade'

function summarizeTransactions(rows: PortfolioTransactionRow[]) {
  let totalRealizedPnl = 0
  let totalBuyAmount = 0
  let totalSellAmount = 0
  let buyCount = 0
  let sellCount = 0
  for (const r of rows) {
    if (r.side === 'buy') {
      buyCount++
      totalBuyAmount += Number(r.total_amount) || 0
    } else {
      sellCount++
      totalSellAmount += Number(r.total_amount) || 0
      totalRealizedPnl += Number(r.realized_pnl) || 0
    }
  }
  return {
    totalRealizedPnl: Math.round(totalRealizedPnl * 100) / 100,
    totalBuyAmount: Math.round(totalBuyAmount * 100) / 100,
    totalSellAmount: Math.round(totalSellAmount * 100) / 100,
    buyCount,
    sellCount,
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 300)

  try {
    const user = await getCurrentUserFromCookies()
    if (user) {
      const transactions = await getPortfolioTransactions(user.id, limit)
      return NextResponse.json({
        success: true,
        transactions,
        summary: summarizeTransactions(transactions),
        mode: 'user',
      })
    }

    let gid = await getCurrentGuestFromCookies()
    if (!gid) gid = newGuestUid()
    const transactions = await getPortfolioTransactionsByGuest(gid, limit)
    const res = NextResponse.json({
      success: true,
      transactions,
      summary: summarizeTransactions(transactions),
      mode: 'guest',
    })
    await applyGuestCookie(res, gid)
    return res
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to load transactions'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const market: TradeMarket = body.market === 'us' ? 'us' : 'tw'
    const side: TradeSide = body.side === 'sell' ? 'sell' : 'buy'
    const symbol = String(body.symbol ?? '').trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
    const symbolName = typeof body.symbolName === 'string' && body.symbolName.trim() ? body.symbolName.trim() : null
    const shares = Number(body.shares)
    const price = Number(body.price)
    const fee = Number(body.fee ?? 0)
    const tax = Number(body.tax ?? 0)
    const currentPrice = body.currentPrice != null ? Number(body.currentPrice) : null
    const tradeDate =
      typeof body.tradeDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.tradeDate.trim())
        ? body.tradeDate.trim()
        : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null

    const user = await getCurrentUserFromCookies()
    let guestUid: string | null = null
    if (!user) {
      guestUid = (await getCurrentGuestFromCookies()) ?? newGuestUid()
    }

    const existingRecords = (
      user ? await getPortfolioRecords(user.id, 200) : await getPortfolioRecordsByGuest(guestUid!, 200)
    ).filter((r): r is typeof r & { id: number } => typeof r.id === 'number')

    let settlement
    try {
      settlement = settlePortfolioTrade(existingRecords, {
        market,
        symbol,
        symbolName,
        side,
        shares,
        price,
        fee,
        tax,
        currentPrice,
        tradeDate,
        note,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '交易結算驗證失敗'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const ownerFilter = { userId: user?.id ?? null, guestUid }

    if (settlement.action === 'create' && settlement.settledRecord) {
      await savePortfolioRecord({
        user_id: user?.id ?? 0,
        guestUid: user ? null : guestUid,
        market: settlement.settledRecord.market,
        symbol: settlement.settledRecord.symbol,
        symbolName: settlement.settledRecord.symbolName,
        shares: settlement.settledRecord.shares,
        cost: settlement.settledRecord.cost,
        currentPrice: settlement.settledRecord.currentPrice,
        dividend: settlement.settledRecord.dividend,
        costBasis: settlement.settledRecord.costBasis,
        marketValue: settlement.settledRecord.marketValue,
        unrealizedPnl: settlement.settledRecord.unrealizedPnl,
        unrealizedPnlPct: settlement.settledRecord.unrealizedPnlPct,
        totalReturn: settlement.settledRecord.totalReturn,
        totalReturnPct: settlement.settledRecord.totalReturnPct,
        yieldOnCost: settlement.settledRecord.yieldOnCost,
        strategy: settlement.settledRecord.strategy,
      })
    } else if (settlement.action === 'update' && settlement.primaryRecordId && settlement.settledRecord) {
      await updatePortfolioRecordByOwner(settlement.primaryRecordId, ownerFilter, {
        market: settlement.settledRecord.market,
        symbol: settlement.settledRecord.symbol,
        symbolName: settlement.settledRecord.symbolName,
        shares: settlement.settledRecord.shares,
        cost: settlement.settledRecord.cost,
        currentPrice: settlement.settledRecord.currentPrice,
        dividend: settlement.settledRecord.dividend,
        costBasis: settlement.settledRecord.costBasis,
        marketValue: settlement.settledRecord.marketValue,
        unrealizedPnl: settlement.settledRecord.unrealizedPnl,
        unrealizedPnlPct: settlement.settledRecord.unrealizedPnlPct,
        totalReturn: settlement.settledRecord.totalReturn,
        totalReturnPct: settlement.settledRecord.totalReturnPct,
        yieldOnCost: settlement.settledRecord.yieldOnCost,
        strategy: settlement.settledRecord.strategy,
      })
      for (const dupId of settlement.removeRecordIds) {
        await deletePortfolioRecordByOwner(dupId, ownerFilter)
      }
    } else if (settlement.action === 'delete') {
      for (const delId of settlement.removeRecordIds) {
        await deletePortfolioRecordByOwner(delId, ownerFilter)
      }
    }

    const transactionId = await insertPortfolioTransaction({
      userId: user?.id ?? 0,
      guestUid: user ? null : guestUid,
      market,
      symbol,
      symbolName: settlement.settledRecord?.symbolName ?? symbolName,
      side,
      shares,
      price,
      fee,
      tax,
      totalAmount: settlement.totalAmount,
      realizedPnl: settlement.realizedPnl,
      realizedPnlPct: settlement.realizedPnlPct,
      tradeDate,
      note,
    })

    const [updatedRecords, updatedTransactions] = await Promise.all([
      user ? getPortfolioRecords(user.id, 100) : getPortfolioRecordsByGuest(guestUid!, 100),
      user ? getPortfolioTransactions(user.id, 100) : getPortfolioTransactionsByGuest(guestUid!, 100),
    ])

    const res = NextResponse.json({
      success: true,
      transactionId,
      settlement,
      records: updatedRecords,
      transactions: updatedTransactions,
      summary: summarizeTransactions(updatedTransactions),
    })
    if (!user && guestUid) {
      await applyGuestCookie(res, guestUid)
    }
    return res
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to settle trade'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
