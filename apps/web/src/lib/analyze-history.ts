export const ANALYZE_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export interface AnalyzeRecordLike {
  ticker: string
  created_at?: string | null
  deleted_at?: string | null
}

/** 去除台股 `.TW` / `.TWO` 後綴並轉大寫，便於 `0056` 與 `0056.TW` 比對。 */
function stripTwSuffix(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
}

/** 解析 DB `created_at`（SQLite `YYYY-MM-DD HH:MM:SS` 或 ISO 字串）為 epoch ms。 */
export function parseRecordTimestampMs(createdAt?: string | null): number | null {
  if (!createdAt) return null
  const raw = createdAt.trim()
  if (!raw) return null
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T') + (raw.endsWith('Z') ? '' : 'Z')
  const ms = Date.parse(normalized)
  if (Number.isFinite(ms)) return ms
  const fallback = Date.parse(raw)
  return Number.isFinite(fallback) ? fallback : null
}

/**
 * 找出指定標的在時間窗（預設 7 天）內最新一筆未軟刪除的分析紀錄；若無則回傳 `null`。
 */
export function findLatestRecentRecordForSymbol<T extends AnalyzeRecordLike>(
  records: readonly T[],
  symbol: string,
  nowMs: number = Date.now(),
  windowMs: number = ANALYZE_RECENT_WINDOW_MS,
): T | null {
  const target = stripTwSuffix(symbol)
  if (!target) return null

  let best: T | null = null
  let bestMs = -Infinity
  for (const rec of records) {
    if (rec.deleted_at) continue
    if (stripTwSuffix(rec.ticker) !== target) continue
    const ts = parseRecordTimestampMs(rec.created_at)
    if (ts === null) continue
    const age = nowMs - ts
    if (age <= windowMs && ts > bestMs) {
      best = rec
      bestMs = ts
    }
  }
  return best
}
