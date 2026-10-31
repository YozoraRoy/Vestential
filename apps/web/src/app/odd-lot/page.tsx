import { unstable_cache } from 'next/cache'
import { dbQueryAll, dbQueryFirst, ensureSeedData } from '@stock/database'
import { OddLotView, type OddLotItem } from '@/components/odd-lot-view'
import { Gift, Sparkles, TrendingUp } from 'lucide-react'
import { yahooFinanceProvider } from '@stock/market-data'
import { MarketDataError } from '@stock/core'
import {
  formatTradingDayWithWeekday,
  isCurrentlyHolidayOrWeekend,
} from '@/utils/taiwan-calendar'
import { getDict } from '@/i18n/server'

import SEEDED_ODD_LOTS from '@/data/seeded-odd-lots.json'

const FALLBACK_ODD_LOTS: OddLotItem[] = SEEDED_ODD_LOTS as OddLotItem[]

const MAX_PRICE_LOOKUPS = 50

interface OddLotData {
  trades: OddLotItem[]
  latestDate: string
}

// currentPrice fallback — fetch live price for stocks without odd-lot trade data (capped)
async function enrichPrices(items: OddLotItem[]): Promise<OddLotItem[]> {
  const itemsNeedingPrice = items.filter(
    (item) => !item.price || item.price <= 0 || isNaN(item.price)
  )
  if (itemsNeedingPrice.length > 0) {
    const stockIds = [...new Set(itemsNeedingPrice.map((item) => item.stock_id))]
    const capped = stockIds.slice(0, MAX_PRICE_LOOKUPS)
    if (capped.length < stockIds.length) {
      console.warn(`[OddLotPage] Capping price lookups to ${capped.length}/${stockIds.length}`)
    }
    await Promise.all(
      capped.map(async (sid) => {
        try {
          const quote = await yahooFinanceProvider.getQuote(`${sid}.TW`, 'TW')
          if (quote?.price && quote.price > 0) {
            const currentPrice = quote.price
            items.forEach((item) => {
              if (item.stock_id === sid) {
                item.current_price = currentPrice
              }
            })
          }
        } catch (err) {
          if (!(err instanceof MarketDataError)) {
            console.error(`[OddLotPage] Yahoo Finance fetch failed for ${sid}:`, err)
          }
        }
      })
    )
  }
  return items
}

// 從 DB 讀取真實資料。DB 不可用時直接 throw（避免 unstable_cache 把 seed fallback 快取 5 分鐘）。
async function loadOddLotData(stockId: string): Promise<OddLotData> {
  try {
    await ensureSeedData()
  } catch (e) {
    console.error('[OddLotPage] ensureSeedData failed:', e)
  }

  const latestDate = await dbQueryFirst<{ date: string }>(
    'SELECT date FROM odd_lot_trades ORDER BY date DESC LIMIT 1',
  )
  if (!latestDate) {
    throw new Error('odd_lot_trades unavailable')
  }

  const trades = stockId
    ? await dbQueryAll<OddLotItem>(
        `
        SELECT t.date, t.stock_id, t.stock_name, t.price, t.volume, t.bid_price, t.bid_volume, t.ask_price, t.ask_volume,
               g.gift_name, g.meeting_date, g.last_buy_date, g.distribution_method,
               g.gift_status, g.claim_rule, g.claim_rule_source, g.mops_gift_text,
               g.validation_status, g.validation_reason, g.twse_meeting_date,
               si.industry_code, si.industry_name
        FROM odd_lot_trades t
        LEFT JOIN (
          SELECT stock_id, gift_name, meeting_date, last_buy_date, distribution_method,
                 gift_status, claim_rule, claim_rule_source, mops_gift_text,
                 validation_status, validation_reason, twse_meeting_date,
                 ROW_NUMBER() OVER (PARTITION BY stock_id ORDER BY meeting_date DESC) AS rn
          FROM shareholder_gifts
        ) g ON g.stock_id = t.stock_id AND g.rn = 1
        LEFT JOIN stock_industry si ON si.stock_id = t.stock_id
        WHERE t.stock_id = @stock_id
        ORDER BY t.date DESC
        LIMIT 30
      `,
        { stock_id: stockId.toUpperCase() },
      )
    : await dbQueryAll<OddLotItem>(
        `
        SELECT t.date, t.stock_id, t.stock_name, t.price, t.volume, t.bid_price, t.bid_volume, t.ask_price, t.ask_volume,
               g.gift_name, g.meeting_date, g.last_buy_date, g.distribution_method,
               g.gift_status, g.claim_rule, g.claim_rule_source, g.mops_gift_text,
               g.validation_status, g.validation_reason, g.twse_meeting_date,
               si.industry_code, si.industry_name
        FROM odd_lot_trades t
        LEFT JOIN (
          SELECT stock_id, gift_name, meeting_date, last_buy_date, distribution_method,
                 gift_status, claim_rule, claim_rule_source, mops_gift_text,
                 validation_status, validation_reason, twse_meeting_date,
                 ROW_NUMBER() OVER (PARTITION BY stock_id ORDER BY meeting_date DESC) AS rn
          FROM shareholder_gifts
        ) g ON g.stock_id = t.stock_id AND g.rn = 1
        LEFT JOIN stock_industry si ON si.stock_id = t.stock_id
        WHERE t.date = @date
        ORDER BY t.volume DESC
        LIMIT 1500
      `,
        { date: latestDate.date },
      )

  return { trades: await enrichPrices(trades), latestDate: latestDate.date }
}

// 5 分鐘伺服器端資料快取：5 分鐘內再次瀏覽不會重跑 DB/Yahoo 查詢
const getCachedOddLotData = unstable_cache(
  (stockId: string) => loadOddLotData(stockId),
  ['odd-lot-data'],
  { revalidate: 300, tags: ['odd-lot'] },
)

export default async function OddLotPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stock_id?: string }>
}) {
  const params = await searchParams
  const stockId = (params.stock_id ?? '').trim()
  const initialQuery = params.q ?? params.stock_id ?? ''

  let displayItems: OddLotItem[] = []
  let latestDateStr = ''
  try {
    const data = await getCachedOddLotData(stockId)
    displayItems = data.trades
    latestDateStr = data.latestDate
  } catch (e) {
    // DB 不可用：改用 seed fallback（不經快取，避免把 fallback 塞進 unstable_cache）
    console.error('[OddLotPage] DB unavailable, using seed fallback:', e)
    displayItems = stockId
      ? FALLBACK_ODD_LOTS.filter((item) => item.stock_id.toUpperCase() === stockId.toUpperCase())
      : FALLBACK_ODD_LOTS
    await enrichPrices(displayItems)
    if (displayItems.length > 0) {
      latestDateStr = displayItems[0].date
    }
  }

  const holidayInfo = isCurrentlyHolidayOrWeekend()
  const formattedLatestDate = formatTradingDayWithWeekday(latestDateStr)
  const dict = await getDict()
  const d = dict.oddLot

  return (
    <div className="w-full min-h-screen px-4 md:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <TrendingUp className="w-6 h-6 text-[var(--accent)]" />
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">{d.title}</h1>
          </div>
          <p className="text-sm text-[var(--text-secondary)]">
            {d.subtitle}
            {latestDateStr && (
              <span className="ml-2 font-medium text-[var(--accent)]">
                · {d.latestTradingDay}{formattedLatestDate}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {holidayInfo.isHoliday && (
            <div className="bg-amber-500/10 border border-amber-500/30 px-3.5 py-1.5 rounded-xl flex items-center gap-2 text-xs text-amber-300">
              <Sparkles className="w-4 h-4 shrink-0 text-amber-400" />
              <span>
                {d.holidayBanner.replace('{reason}', holidayInfo.reason ?? '')}
              </span>
            </div>
          )}
          <div className="bg-[var(--bg-card)] border border-white/10 px-4 py-2 rounded-xl flex items-center gap-2 text-xs">
            <Gift className="w-4 h-4 text-[var(--accent-green)]" />
            <span>{d.giftBadge}</span>
          </div>
        </div>
      </div>

      <OddLotView
        initialItems={displayItems}
        latestDate={latestDateStr}
        initialQuery={initialQuery}
      />
    </div>
  )
}
