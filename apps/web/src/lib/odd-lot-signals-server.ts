import { dbQueryAll } from '@stock/database'
import {
  ODD_LOT_LOOKBACK_DAYS,
  detectOddLotSignals,
  type OddLotSignal,
} from './odd-lot-signals'

export interface OddLotSignalAttachable {
  date: string
  stock_id: string
  price: number
  volume: number
  current_price?: number | null
}

/**
 * 為零股成交列批次附加 `signals`（additive 欄位，不改動既有欄位結構）。
 * 歷史成交量取自 `odd_lot_trades` 在 `baseDate` 之前最近 `ODD_LOT_LOOKBACK_DAYS` 個交易日。
 */
export async function attachOddLotSignals<T extends OddLotSignalAttachable>(
  trades: T[],
  baseDate?: string | null,
): Promise<Array<T & { signals: OddLotSignal }>> {
  if (!trades || trades.length === 0) return []

  const refDate = baseDate || trades[0]?.date
  const historyByStock = new Map<string, number[]>()

  if (refDate) {
    try {
      const recentDates = await dbQueryAll<{ date: string }>(
        `SELECT DISTINCT date FROM odd_lot_trades WHERE date < @refDate ORDER BY date DESC`,
        { refDate },
      )
      const windowDates = recentDates.slice(0, ODD_LOT_LOOKBACK_DAYS)
      if (windowDates.length > 0) {
        const minDate = windowDates[windowDates.length - 1].date
        const historyRows = await dbQueryAll<{ stock_id: string; volume: number }>(
          `SELECT stock_id, volume FROM odd_lot_trades WHERE date >= @minDate AND date < @refDate`,
          { minDate, refDate },
        )
        for (const row of historyRows) {
          const sid = String(row.stock_id ?? '').trim().toUpperCase()
          if (!sid) continue
          const arr = historyByStock.get(sid)
          if (arr) {
            arr.push(Number(row.volume))
          } else {
            historyByStock.set(sid, [Number(row.volume)])
          }
        }
      }
    } catch {
      // 歷史查詢失敗時安全降級為空歷史（insufficientHistory = true）
    }
  }

  return trades.map((item) => {
    const sid = String(item.stock_id ?? '').trim().toUpperCase()
    const historyVolumes = historyByStock.get(sid) ?? []
    const signals = detectOddLotSignals({
      currentVolume: item.volume,
      currentOddPrice: item.price,
      historyVolumes,
      closePrice: item.current_price ?? null,
    })
    return { ...item, signals }
  })
}
