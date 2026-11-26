import { NextResponse } from 'next/server'
import {
  deletePortfolioTransactionByOwner,
  getPortfolioTransactionByOwner,
  getPortfolioTransactions,
  getPortfolioTransactionsByGuest,
  updatePortfolioTransactionByOwner,
  type PortfolioTransactionRow,
} from '@stock/database'
import { getCurrentUserFromCookies } from '../../../../../lib/auth'
import { getCurrentGuestFromCookies } from '../../../../../lib/guest'
import { recomputeTransactionAmounts } from '../../../../../lib/portfolio-trade'

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

async function resolveOwner() {
  const user = await getCurrentUserFromCookies()
  const guestUid = user ? null : await getCurrentGuestFromCookies()
  return { user, guestUid, ownerFilter: { userId: user?.id ?? null, guestUid } }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const txId = Number(id)
    if (!Number.isInteger(txId) || txId <= 0) {
      return NextResponse.json({ error: '無效的交易紀錄 ID' }, { status: 400 })
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { user, guestUid, ownerFilter } = await resolveOwner()
    if (!user && !guestUid) {
      return NextResponse.json({ error: '未登入或無訪客身分' }, { status: 401 })
    }

    const existing = await getPortfolioTransactionByOwner(txId, ownerFilter)
    if (!existing) {
      return NextResponse.json({ error: '找不到該筆交易結算紀錄' }, { status: 404 })
    }

    const computed = recomputeTransactionAmounts(existing, {
      tradeDate: typeof body.tradeDate === 'string' ? body.tradeDate : undefined,
      shares: body.shares !== undefined ? Number(body.shares) : undefined,
      price: body.price !== undefined ? Number(body.price) : undefined,
      fee: body.fee !== undefined ? Number(body.fee) : undefined,
      tax: body.tax !== undefined ? Number(body.tax) : undefined,
      realizedPnl: body.realizedPnl !== undefined ? (body.realizedPnl === null ? null : Number(body.realizedPnl)) : undefined,
      note: body.note !== undefined ? (typeof body.note === 'string' ? body.note : null) : undefined,
    })

    const ok = await updatePortfolioTransactionByOwner(txId, ownerFilter, computed)
    if (!ok) {
      return NextResponse.json({ error: '更新交易結算紀錄失敗' }, { status: 500 })
    }

    const transactions = user
      ? await getPortfolioTransactions(user.id, 100)
      : await getPortfolioTransactionsByGuest(guestUid!, 100)

    return NextResponse.json({
      success: true,
      transactions,
      summary: summarizeTransactions(transactions),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '更新失敗'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const txId = Number(id)
    if (!Number.isInteger(txId) || txId <= 0) {
      return NextResponse.json({ error: '無效的交易紀錄 ID' }, { status: 400 })
    }

    const { user, guestUid, ownerFilter } = await resolveOwner()
    if (!user && !guestUid) {
      return NextResponse.json({ error: '未登入或無訪客身分' }, { status: 401 })
    }

    const deleted = await deletePortfolioTransactionByOwner(txId, ownerFilter)
    if (!deleted) {
      return NextResponse.json({ error: '找不到該筆交易結算紀錄' }, { status: 404 })
    }

    const transactions = user
      ? await getPortfolioTransactions(user.id, 100)
      : await getPortfolioTransactionsByGuest(guestUid!, 100)

    return NextResponse.json({
      success: true,
      transactions,
      summary: summarizeTransactions(transactions),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '刪除失敗'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
