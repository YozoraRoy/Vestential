import { NextResponse } from 'next/server'
import { normalizeStockCode } from '@stock/core'
import { getCurrentUserFromCookies } from '../../../../lib/auth'
import { applyGuestCookie, getCurrentGuestFromCookies, newGuestUid } from '../../../../lib/guest'
import { deletePortfolioRecord, getPortfolioRecords, getPortfolioRecordsByGuest, type PortfolioRecord } from '@stock/database'
import { resolveServerStockNames } from '../../../../lib/stock-names-server'

async function attachMultilingualNames(records: PortfolioRecord[]) {
  if (!records.length) return records
  const namesMap = await resolveServerStockNames(
    records.map((r) => r.symbol),
    { syncIfNeeded: false, source: 'portfolio_records' },
  ).catch(() => ({} as Record<string, unknown>))
  return records.map((r) => ({
    ...r,
    names: namesMap[normalizeStockCode(r.symbol)] ?? undefined,
  }))
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100)

  try {
    const user = await getCurrentUserFromCookies()
    if (user) {
      const records = await attachMultilingualNames(await getPortfolioRecords(user.id, limit))
      return NextResponse.json({ success: true, records, mode: 'user' })
    }

    // 訪客模式：無 cookie 則建立一個 workspace（不回 401）。
    let gid = await getCurrentGuestFromCookies()
    if (!gid) gid = newGuestUid()
    const records = await attachMultilingualNames(await getPortfolioRecordsByGuest(gid, limit))
    const res = NextResponse.json({ success: true, records, mode: 'guest' })
    await applyGuestCookie(res, gid)
    return res
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * DELETE /api/portfolio/records?id=123 — 刪除一筆持股紀錄（限登入本人，Issue #25）。
 * 授權風格沿用 journal [id] route：未登入 401；id 不存在或非本人皆回 404（不洩漏存在性）。
 */
export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUserFromCookies()
    if (!user) {
      return NextResponse.json({ error: 'login required' }, { status: 401 })
    }
    const url = new URL(req.url)
    const id = Number(url.searchParams.get('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'invalid record id' }, { status: 400 })
    }
    const deleted = await deletePortfolioRecord(id, user.id)
    if (!deleted) {
      return NextResponse.json({ error: 'record not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}