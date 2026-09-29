import { NextResponse } from 'next/server'
import {
  getPortfolioRecords,
  getPortfolioRecordsByGuest,
  listPortfolioRecordsForSync,
  migrate,
  updatePortfolioSyncedPrice,
  type PortfolioRecord,
} from '@stock/database'
import { getCurrentUserFromCookies } from '../../../../lib/auth'
import { applyGuestCookie, getCurrentGuestFromCookies, newGuestUid } from '../../../../lib/guest'
import { authorizeSync } from '../../../../lib/sync-auth'
import { reportServerError } from '../../../../lib/server-alert'
import { isTwseTradingDay, taipeiTodayStr } from '../../../../lib/twse-calendar'
import {
  computePnL,
  syncPortfolioPrices,
  PORTFOLIO_SYNC_MAX_PER_REQUEST,
  PORTFOLIO_SYNC_MAX_PER_RUN,
  type DividendYieldReason,
  type SyncableHolding,
} from '../../../../lib/portfolio'
import { ensureTodayDividends, ensureYieldHistoryBackfill } from '../../../../lib/twse-dividends'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteFailureReason = 'quote' | 'resolve' | 'save'

interface FailedItem {
  id: number
  symbol: string
  reason: RouteFailureReason
}

function toHoldings(records: PortfolioRecord[]): SyncableHolding[] {
  return records
    .filter((r) => r.id != null)
    .map((r) => ({
      id: r.id!,
      market: r.market === 'us' ? 'us' : 'tw',
      symbol: r.symbol,
      shares: r.shares,
      cost: r.cost,
      // #44：股息欄已移除（寫入一律 0；DB 欄保留，舊值不讀）。
      dividend: 0,
    }))
}

function byId(records: PortfolioRecord[]): Map<number, PortfolioRecord> {
  const m = new Map<number, PortfolioRecord>()
  for (const r of records) if (r.id != null) m.set(r.id, r)
  return m
}

/**
 * Issue #33：持倉現價同步 API（單一路徑三分支，選邊註明）。
 *
 * 選邊：不另開 /sync/schedule，統一 POST /api/portfolio/sync，
 * 以 SYNC_TOKEN 有無分流——排程呼叫帶 Bearer Token 走全掃分支，
 * 手動按鈕靠 cookie（登入掃本人／訪客掃 guest_uid）。
 * 理由：排程與手動共用同一份 best-effort＋寫回邏輯，避免雙份實作漂移；
 * 權限以 authorizeSync（沿用 cycle-entry refresh 慣例）區隔。
 *
   * 回傳：{ success, scope, scanned, updated, failed[{symbol,reason}], yields{recordId:yield|null}, yieldReasons{recordId:reason}, syncedAt, rateLimited }
  * - 排程重跑冪等：直接蓋 current_price＋price_synced_at，以最後一次同步時間為準，不產生重複列；
  * - #44：手填股息欄已移除（全程不讀不寫 dividend，總報酬以裸價差重算）；殖利率僅回傳參考值（yields），不寫庫；
  * - #35：排程／手動皆順帶更新當年除息快取（ensureTodayDividends，缺檔才抓；回傳 dividends{status,...}）；
  * - #44：同步鈕／排程順帶觸發 5 年殖利率回填（ensureYieldHistoryBackfill，每輪封頂＋斷點續抓，best-effort）；
  * - Yahoo 限流：記 console log＋reportServerError（#24 通道 30 分鐘同 key 去重＝告警節流），其餘持倉照常完成。
 */
export async function POST(req: Request) {
  try {
    await migrate()

    // ── 分支 1：排程（SYNC_TOKEN）全掃：登入戶＋訪客（guest_uid）皆含 ──
    if (authorizeSync(req)) {
      const today = taipeiTodayStr()
      if (!isTwseTradingDay(today)) {
        return NextResponse.json({
          success: true,
          scope: 'schedule',
          skipped: true,
          reason: 'non-trading-day',
          date: today,
        })
      }
      const targets: SyncableHolding[] = []
      const PAGE = 200
      for (let offset = 0; offset < PORTFOLIO_SYNC_MAX_PER_RUN; offset += PAGE) {
        const page = await listPortfolioRecordsForSync(PAGE, offset)
        if (page.length === 0) break
        for (const t of page) {
          targets.push({
            id: t.id,
            market: t.market === 'us' ? 'us' : 'tw',
            symbol: t.symbol,
            shares: t.shares,
            cost: t.cost,
            // #44：股息欄已移除（寫入一律 0；DB 欄保留，舊值不讀）。
            dividend: 0,
          })
        }
        if (page.length < PAGE) break
      }
      // 排程只同步現價（includeYield=false）：quoteSummary 逐檔成本高，
      // 全掃開殖利率易觸發 Yahoo 限流；殖利率參考由手動同步回填。
      const result = await syncPortfolioPrices(targets, { includeYield: false })
      const failed: FailedItem[] = result.failed.map((f) => ({ ...f }))
      let written = 0
      const targetById = new Map(targets.map((t) => [t.id, t]))
      for (const u of result.updated) {
        const base = targetById.get(u.id)
        if (!base) continue
        // #44：裸價差重算（不再讀舊 dividend 值）。
        const pnl = computePnL({ market: base.market, shares: base.shares, cost: base.cost, currentPrice: u.price })
        const ok = await updatePortfolioSyncedPrice(u.id, {
          currentPrice: u.price,
          marketValue: pnl.marketValue,
          unrealizedPnl: pnl.unrealizedPnl,
          unrealizedPnlPct: pnl.unrealizedPnlPct,
          totalReturn: pnl.totalReturn,
          totalReturnPct: pnl.totalReturnPct,
          syncedAt: result.syncedAt,
        })
        if (ok) written++
        else failed.push({ id: u.id, symbol: u.symbol, reason: 'save' })
      }
      if (result.rateLimited) {
        console.error(`[PortfolioSync/schedule] Yahoo rate limited: scanned=${targets.length} written=${written} failed=${failed.length}`)
        void reportServerError({ route: 'POST /api/portfolio/sync (schedule)', status: 429, error: `Yahoo rate limited during scheduled sync (scanned ${targets.length})` })
      }
      // #35：排程順帶更新當年除息快取（缺檔才抓；best-effort，不擋現價同步主流程）。
      // #44：順帶觸發 5 年殖利率回填（封頂＋斷點續抓，best-effort）。
      const dividends = await ensureTodayDividends(today)
      const yieldBackfill = await ensureYieldHistoryBackfill(today)
      return NextResponse.json({
        success: true,
        scope: 'schedule',
        scanned: targets.length,
        updated: written,
        failed,
        yields: {},
        yieldReasons: {},
        syncedAt: result.syncedAt,
        rateLimited: result.rateLimited,
        dividends,
        yieldBackfill,
      })
    }

    // ── 分支 2/3：手動（登入掃本人／訪客掃 guest_uid），附殖利率參考 ──
    const user = await getCurrentUserFromCookies()
    let records: PortfolioRecord[]
    let scope: 'user' | 'guest'
    let guestUid: string | null = null
    let createdGuest = false
    if (user) {
      scope = 'user'
      records = await getPortfolioRecords(user.id, PORTFOLIO_SYNC_MAX_PER_REQUEST)
    } else {
      scope = 'guest'
      guestUid = await getCurrentGuestFromCookies()
      if (!guestUid) {
        guestUid = newGuestUid()
        createdGuest = true
      }
      records = await getPortfolioRecordsByGuest(guestUid, PORTFOLIO_SYNC_MAX_PER_REQUEST)
    }

    const holdings = toHoldings(records)
    const recordById = byId(records)
    const result = await syncPortfolioPrices(holdings, { includeYield: true })
    const failed: FailedItem[] = result.failed.map((f) => ({ ...f }))
    const yields: Record<number, number | null> = {}
    // #34：殖利率缺值原因（recordId→'no-data'|'timeout'|'rate-limited'；有值不列）。
    const yieldReasons: Record<number, DividendYieldReason> = {}
    let written = 0
    for (const u of result.updated) {
      const base = recordById.get(u.id)
      if (!base) continue
      yields[u.id] = u.dividendYield
      if (u.dividendYield == null && u.dividendYieldReason) yieldReasons[u.id] = u.dividendYieldReason
      // #44：裸價差重算（不再讀舊 dividend 值）。
      const pnl = computePnL({ market: base.market, shares: base.shares, cost: base.cost, currentPrice: u.price })
      const ok = await updatePortfolioSyncedPrice(u.id, {
        currentPrice: u.price,
        marketValue: pnl.marketValue,
        unrealizedPnl: pnl.unrealizedPnl,
        unrealizedPnlPct: pnl.unrealizedPnlPct,
        totalReturn: pnl.totalReturn,
        totalReturnPct: pnl.totalReturnPct,
        syncedAt: result.syncedAt,
      })
      if (ok) written++
      else failed.push({ id: u.id, symbol: u.symbol, reason: 'save' })
    }
    if (result.rateLimited) {
      console.error(`[PortfolioSync/${scope}] Yahoo rate limited: scanned=${holdings.length} written=${written} failed=${failed.length}`)
      void reportServerError({ route: 'POST /api/portfolio/sync', status: 429, error: `Yahoo rate limited during manual sync (scanned ${holdings.length})` })
    }
    // #35：同步鈕順帶更新當年除息快取（缺檔才抓；best-effort，不擋主流程）。
    // #44：順帶觸發 5 年殖利率回填（封頂＋斷點續抓，best-effort）。
    const dividends = await ensureTodayDividends(taipeiTodayStr())
    const yieldBackfill = await ensureYieldHistoryBackfill(taipeiTodayStr())
    const res = NextResponse.json({
      success: true,
      scope,
      scanned: holdings.length,
      updated: written,
      failed,
      yields,
      yieldReasons,
      syncedAt: result.syncedAt,
      rateLimited: result.rateLimited,
      dividends,
      yieldBackfill,
    })
    if (createdGuest && guestUid) await applyGuestCookie(res, guestUid)
    return res
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'sync failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
