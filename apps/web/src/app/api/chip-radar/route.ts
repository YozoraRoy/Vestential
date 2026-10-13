import { NextResponse } from 'next/server'
import { migrate } from '@stock/database'
import { isTwseTradingDay, taipeiTodayStr } from '../../../lib/twse-calendar'
import { ensureChipRadar, MARGIN_DIVERGE_AVAILABLE } from '../../../lib/chip-radar'
import { alertChipDigest, alertChipFetchFailed } from '../../../lib/chip-alerts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Issue #71：主力籌碼雷達異常榜（唯讀）。
 *
 * - 資料源＝TWT38U（外資合計超）＋TWT44U（投信超）dated JSON 近 5 交易日即算
 *   （沿 `lib/twse-dividends.ts` 逾時降級模式）；本 route 讀時即算、不寫表、
 *   不建新 cron（讀時順帶 best-effort，沿既有排程順帶語義）；
 * - 佔比＝|法人淨超×收盤|／STOCK_DAY_ALL 成交額；缺報價不列榜；
 * - 融資未含（PoC FAIL）：diverge 永 false，margin 欄固定「未含融資」；
 * - 休市（正源 isTwseTradingDay 非交易日）→ closed，頁面顯示「休市無新盤」；
 * - 降級（缺日／無報價）經既有 `sendMarketFocusAlert` 信件管線告警
 *   （讀時順帶、30 分鐘去重）；異常榜 digest 經 `sendChipRadarDigest`
 *   寄既有訂閱者（email-only，無新渠道）；
 * - 無 DB migration（僅讀既有 `agent_settings` 閾值）。
 * - GET /api/chip-radar
 */

export async function GET() {
  try {
    await migrate()
    const today = taipeiTodayStr()
    const isTradingDay = isTwseTradingDay(today)
    const snap = await ensureChipRadar(today)

    // 讀時順帶通知（皆 best-effort＋30 分鐘去重，不新增渠道／cron）：
    // - 降級（缺日／無報價／可用日不足）：告警信；
    // - 有榜：當日 digest 寄既有訂閱者（日別去重由 sendChipRadarDigest 把關）。
    if (snap.degraded && snap.degradedReason !== 'non-trading-day') {
      void alertChipFetchFailed(`${snap.degradedReason ?? 'unknown'}（資料時間 ${snap.asOf ?? '無'}）`)
    }
    if (snap.asOf && snap.items.length > 0 && !snap.degradedReason?.startsWith('insufficient')) {
      void alertChipDigest(
        snap.asOf,
        snap.items.map((i) => ({
          symbol: i.symbol,
          name: i.name,
          direction: i.direction === 'buy' ? 'buy' : 'sell',
          days: i.days,
          netShares: i.netShares,
          ratioPct: i.ratioPct,
        })),
        snap.scanned,
      )
    }

    return NextResponse.json({
      success: true,
      today,
      as_of: snap.asOf,
      is_trading_day: isTradingDay,
      status: snap.status,
      degraded: snap.degraded,
      degraded_reason: snap.degradedReason,
      notice: snap.notice,
      source: 'TWSE TWT38U 外資合計＋TWT44U 投信（上市；未含融資、自營商另表）＋openapi STOCK_DAY_ALL 收盤/成交額',
      margin_available: MARGIN_DIVERGE_AVAILABLE,
      thresholds: {
        consec_days: snap.thresholds.consecDays,
        ratio_pct: snap.thresholds.ratioPct,
        margin_diverge_on: snap.thresholds.marginDivergeOn,
      },
      window_days: snap.windowDays,
      scanned: snap.scanned,
      items: snap.items,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'chip-radar read failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
