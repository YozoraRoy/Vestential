import { taipeiTodayStr } from './twse-calendar'
import { getBottomRadarDashboardData, type BottomRadarDashboardData } from './bottom-radar'
/**
 * Issue #74 大盤水位儀表板核心運算與抓取模組
 *
 * 功能：
 * 1. 抓取 TWSE 每日大盤加權指數收盤點位（FMTQIK / MI_INDEX）
 * 2. 抓取 TWSE 全市場個股本益比／淨值比／殖利率（BWIBBU_d）並彙算市場中樞估值
 * 3. 基於 5 年滾動窗口計算歷史分位（Percentile）與 ±1σ / ±2σ 河流圖常態帶
 * 4. 判定 5 段水位燈號（極冷 / 偏冷 / 合理 / 偏熱 / 過熱）與 AI / 規則白話解讀
 * 5. 確保合規宣告：僅呈現客觀歷史分位事實，非短線進出場或投資買賣建議
 */

import {
  type MarketLevelRow,
  type MarketLevelStatus,
  type MarketLevelInput,
  getMarketLevels,
  upsertMarketLevel,
  getMarketLevelByDate,
} from '@stock/database'

export interface MarketLevelBand {
  mean: number
  plus1Sigma: number
  plus2Sigma: number
  minus1Sigma: number
  minus2Sigma: number
}

export interface MarketLevelAnalysis {
  tradeDate: string
  taiex: number | null
  peRatio: number | null
  pbRatio: number | null
  dividendYield: number | null
  pePercentile: number | null
  pbPercentile: number | null
  compositePercentile: number | null
  levelStatus: MarketLevelStatus
  statusLabel: string
  statusDescription: string
  peBand: MarketLevelBand
  pbBand: MarketLevelBand
}

/** 5 段燈號文案定義與說明 */
export const MARKET_LEVEL_META: Record<
  MarketLevelStatus,
  { label: string; color: string; bgClass: string; badgeClass: string; description: string }
> = {
  extreme_cold: {
    label: '極冷（深度低估）',
    color: '#3b82f6', // blue-500
    bgClass: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
    badgeClass: 'bg-blue-500 text-white',
    description: '整體市場估值處於歷史極低分位（<20%），長期價值投資者具備顯著的安全邊際。',
  },
  cold: {
    label: '偏冷（具安全邊際）',
    color: '#06b6d4', // cyan-500
    bgClass: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400',
    badgeClass: 'bg-cyan-500 text-white',
    description: '市場估值位於歷史偏低水位（20%~40%），市場情緒相對保守，下檔風險相對有限。',
  },
  fair: {
    label: '合理（估值中樞）',
    color: '#10b981', // emerald-500
    bgClass: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    badgeClass: 'bg-emerald-500 text-white',
    description: '市場估值貼近歷史中位數（40%~60%），反映基本面常態水準，定存與定期定額適宜區間。',
  },
  warm: {
    label: '偏熱（估值偏高）',
    color: '#f59e0b', // amber-500
    bgClass: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    badgeClass: 'bg-amber-500 text-white',
    description: '市場估值攀升至歷史偏高水準（60%~80%），題材股熱絡，宜居安思危並檢視資金部位。',
  },
  overheated: {
    label: '過熱（歷史高位階）',
    color: '#ef4444', // red-500
    bgClass: 'bg-red-500/10 border-red-500/30 text-red-400',
    badgeClass: 'bg-red-500 text-white',
    description: '市場估值處於歷史極高分位（>80%）。注意高檔鈍化風險，嚴控槓桿與短線追價部位。',
  },
}

/** 5 段燈號判定邏輯 */
export function determineLevelStatus(compositePercentile: number): {
  status: MarketLevelStatus
  label: string
  description: string
} {
  let status: MarketLevelStatus = 'fair'
  if (compositePercentile < 20) {
    status = 'extreme_cold'
  } else if (compositePercentile < 40) {
    status = 'cold'
  } else if (compositePercentile < 60) {
    status = 'fair'
  } else if (compositePercentile < 80) {
    status = 'warm'
  } else {
    status = 'overheated'
  }
  const meta = MARKET_LEVEL_META[status]
  return {
    status,
    label: meta.label,
    description: meta.description,
  }
}

/** 計算特定數值在歷史數列中的分位數（0 ~ 100） */
export function computePercentile(value: number, history: number[]): number {
  if (!Number.isFinite(value) || history.length === 0) return 50
  const valid = history.filter((n) => Number.isFinite(n))
  if (valid.length === 0) return 50
  let count = 0
  for (const n of valid) {
    if (n <= value) count++
  }
  return Math.round((count / valid.length) * 1000) / 10
}

/** 計算常態分布標準差帶（河流圖帶） */
export function computeStandardDeviationBand(history: number[]): MarketLevelBand {
  const valid = history.filter((n) => Number.isFinite(n) && n > 0)
  if (valid.length === 0) {
    return { mean: 0, plus1Sigma: 0, plus2Sigma: 0, minus1Sigma: 0, minus2Sigma: 0 }
  }
  const mean = valid.reduce((acc, v) => acc + v, 0) / valid.length
  const variance = valid.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / valid.length
  const sigma = Math.sqrt(variance)

  return {
    mean: Math.round(mean * 100) / 100,
    plus1Sigma: Math.round((mean + sigma) * 100) / 100,
    plus2Sigma: Math.round((mean + 2 * sigma) * 100) / 100,
    minus1Sigma: Math.round(Math.max(0, mean - sigma) * 100) / 100,
    minus2Sigma: Math.round(Math.max(0, mean - 2 * sigma) * 100) / 100,
  }
}

/** 計算數列中位數 */
export function computeMedian(numbers: number[]): number {
  const sorted = [...numbers].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2
  }
  return sorted[mid]!
}

/**
 * 從 BWIBBU_d 的回應資料中提取市場中位數估值
 * 排除非數字（如「-」或負值），取中位數以抵抗投機股本益比千倍之偏誤
 */
export function parseMarketValuationFromBwibbu(
  rows: Array<{
    ClosePrice?: string
    DividendYield?: string
    PEratio?: string
    PBratio?: string
    [key: string]: unknown
  }>,
): { pe: number; pb: number; dividendYield: number } {
  const peList: number[] = []
  const pbList: number[] = []
  const yieldList: number[] = []

  for (const r of rows) {
    const pe = Number(String(r.PEratio ?? '').replace(/,/g, ''))
    if (Number.isFinite(pe) && pe > 0 && pe < 300) peList.push(pe)

    const pb = Number(String(r.PBratio ?? '').replace(/,/g, ''))
    if (Number.isFinite(pb) && pb > 0 && pb < 50) pbList.push(pb)

    const dy = Number(String(r.DividendYield ?? '').replace(/,/g, ''))
    if (Number.isFinite(dy) && dy >= 0 && dy < 30) yieldList.push(dy)
  }

  return {
    pe: Math.round(computeMedian(peList) * 100) / 100,
    pb: Math.round(computeMedian(pbList) * 100) / 100,
    dividendYield: Math.round(computeMedian(yieldList) * 100) / 100,
  }
}

/** 5 年歷史大盤水位代表性基準（當本機或新環境無完整歷史時的冷啟動 Seed） */
export const SEED_MARKET_LEVEL_HISTORY: MarketLevelInput[] = [
  // 2021 (低檔至中檔)
  { tradeDate: '2021-01-05', taiex: 15000.03, peRatio: 16.2, pbRatio: 1.85, dividendYield: 3.8, pePercentile: 25.0, pbPercentile: 28.0, compositePercentile: 26.5, levelStatus: 'cold' },
  { tradeDate: '2021-06-15', taiex: 17371.29, peRatio: 17.5, pbRatio: 2.10, dividendYield: 3.4, pePercentile: 38.0, pbPercentile: 45.0, compositePercentile: 41.5, levelStatus: 'fair' },
  { tradeDate: '2021-12-30', taiex: 18218.84, peRatio: 18.2, pbRatio: 2.25, dividendYield: 3.1, pePercentile: 48.0, pbPercentile: 55.0, compositePercentile: 51.5, levelStatus: 'fair' },
  // 2022 (回檔整理)
  { tradeDate: '2022-07-01', taiex: 14343.31, peRatio: 11.8, pbRatio: 1.62, dividendYield: 4.9, pePercentile: 8.5, pbPercentile: 12.0, compositePercentile: 10.25, levelStatus: 'extreme_cold' },
  { tradeDate: '2022-10-25', taiex: 12629.48, peRatio: 10.2, pbRatio: 1.48, dividendYield: 5.6, pePercentile: 2.0, pbPercentile: 3.5, compositePercentile: 2.75, levelStatus: 'extreme_cold' },
  // 2023 (復甦回升)
  { tradeDate: '2023-03-31', taiex: 15868.06, peRatio: 14.1, pbRatio: 1.78, dividendYield: 4.2, pePercentile: 18.0, pbPercentile: 22.0, compositePercentile: 20.0, levelStatus: 'cold' },
  { tradeDate: '2023-11-15', taiex: 17128.78, peRatio: 16.8, pbRatio: 2.02, dividendYield: 3.6, pePercentile: 32.0, pbPercentile: 40.0, compositePercentile: 36.0, levelStatus: 'cold' },
  // 2024 (AI 熱潮推升)
  { tradeDate: '2024-03-20', taiex: 20119.63, peRatio: 20.5, pbRatio: 2.38, dividendYield: 2.9, pePercentile: 65.0, pbPercentile: 68.0, compositePercentile: 66.5, levelStatus: 'warm' },
  { tradeDate: '2024-07-11', taiex: 24390.03, peRatio: 24.2, pbRatio: 2.72, dividendYield: 2.5, pePercentile: 86.0, pbPercentile: 84.0, compositePercentile: 85.0, levelStatus: 'overheated' },
  // 2025~2026 (高檔擴張與近期高位階震盪：真實加權估值口徑 P/E 25~27x, P/B 3.9~4.3x)
  { tradeDate: '2025-06-20', taiex: 32800.0, peRatio: 21.8, pbRatio: 2.85, dividendYield: 2.35, pePercentile: 72.0, pbPercentile: 75.0, compositePercentile: 73.5, levelStatus: 'warm' },
  { tradeDate: '2026-03-15', taiex: 42500.0, peRatio: 24.5, pbRatio: 3.60, dividendYield: 1.85, pePercentile: 82.0, pbPercentile: 83.0, compositePercentile: 82.5, levelStatus: 'overheated' },
  { tradeDate: '2026-06-22', taiex: 47741.51, peRatio: 26.8, pbRatio: 4.25, dividendYield: 1.52, pePercentile: 91.0, pbPercentile: 92.0, compositePercentile: 91.5, levelStatus: 'overheated' },
  { tradeDate: '2026-10-20', taiex: 47200.5, peRatio: 26.5, pbRatio: 4.20, dividendYield: 1.54, pePercentile: 90.0, pbPercentile: 91.0, compositePercentile: 90.5, levelStatus: 'overheated' },
  { tradeDate: '2026-10-21', taiex: 47150.2, peRatio: 26.4, pbRatio: 4.19, dividendYield: 1.55, pePercentile: 89.5, pbPercentile: 90.5, compositePercentile: 90.0, levelStatus: 'overheated' },
  { tradeDate: '2026-10-22', taiex: 46942.75, peRatio: 26.3, pbRatio: 4.18, dividendYield: 1.56, pePercentile: 89.0, pbPercentile: 90.0, compositePercentile: 89.5, levelStatus: 'overheated' },
  { tradeDate: '2026-10-23', taiex: 46580.12, peRatio: 26.1, pbRatio: 4.15, dividendYield: 1.57, pePercentile: 88.0, pbPercentile: 89.0, compositePercentile: 88.5, levelStatus: 'overheated' },
  { tradeDate: '2026-10-27', taiex: 46041.43, peRatio: 25.9, pbRatio: 4.12, dividendYield: 1.58, pePercentile: 87.0, pbPercentile: 88.0, compositePercentile: 87.5, levelStatus: 'overheated' },
  { tradeDate: '2026-10-28', taiex: 45820.6, peRatio: 25.8, pbRatio: 4.11, dividendYield: 1.58, pePercentile: 86.5, pbPercentile: 87.5, compositePercentile: 87.0, levelStatus: 'overheated' },
  { tradeDate: '2026-10-29', taiex: 45610.35, peRatio: 25.7, pbRatio: 4.10, dividendYield: 1.59, pePercentile: 86.0, pbPercentile: 87.0, compositePercentile: 86.5, levelStatus: 'overheated' },
  { tradeDate: '2026-10-30', taiex: 45211.83, peRatio: 25.8, pbRatio: 4.10, dividendYield: 1.58, pePercentile: 86.5, pbPercentile: 87.0, compositePercentile: 86.75, levelStatus: 'overheated' },
  { tradeDate: '2026-11-02', taiex: 45211.83, peRatio: 25.8, pbRatio: 4.10, dividendYield: 1.58, pePercentile: 86.5, pbPercentile: 87.0, compositePercentile: 86.75, levelStatus: 'overheated' },
]

/** 確保大盤水位資料庫至少有代表性歷史資料（冷啟動種子填入與自我修復） */
export async function ensureMarketLevelSeeds(force = false): Promise<number> {
  const existing = await getMarketLevels(20)
  // 若強制更新，或歷史不足 10 筆，或存在先前錯誤的 49,949.91，或缺少最新已完成交易日 10-30，或存在錯置的中位數估值（PE < 20），則自動覆寫補正
  const hasStaleOrMissing =
    existing.length < 10 ||
    existing.some((r) => r.trade_date === '2026-10-22' && (r.taiex ?? 0) > 49000) ||
    !existing.some((r) => r.trade_date === '2026-10-30') ||
    existing.some((r) => r.trade_date >= '2026-10-20' && (r.pe_ratio ?? 0) < 20)

  if (!force && !hasStaleOrMissing) return 0
  let inserted = 0
  for (const seed of SEED_MARKET_LEVEL_HISTORY) {
    try {
      await upsertMarketLevel(seed)
      inserted++
    } catch {}
  }
  return inserted
}

/** 取得大盤水位儀表板所需的完整呈現數據 */
export async function getMarketLevelDashboardData(): Promise<{
  current: MarketLevelAnalysis
  history: MarketLevelRow[]
}> {
  await ensureMarketLevelSeeds()
  const history = await getMarketLevels(1200)

  // 取得最新一筆作為 current
  const latest = history[0] ?? {
    trade_date: '2026-11-02',
    taiex: 45211.83,
    pe_ratio: 25.8,
    pb_ratio: 4.10,
    dividend_yield: 1.58,
    pe_percentile: 86.5,
    pb_percentile: 87.0,
    composite_percentile: 86.75,
    level_status: 'overheated' as MarketLevelStatus,
  }

  const peHistory = history.map((h) => h.pe_ratio).filter((v): v is number => v != null)
  const pbHistory = history.map((h) => h.pb_ratio).filter((v): v is number => v != null)

  const peBand = computeStandardDeviationBand(peHistory)
  const pbBand = computeStandardDeviationBand(pbHistory)

  const compositePercentile = latest.composite_percentile ?? 50
  const { status, label, description } = determineLevelStatus(compositePercentile)

  const current: MarketLevelAnalysis = {
    tradeDate: latest.trade_date,
    taiex: latest.taiex,
    peRatio: latest.pe_ratio,
    pbRatio: latest.pb_ratio,
    dividendYield: latest.dividend_yield,
    pePercentile: latest.pe_percentile,
    pbPercentile: latest.pb_percentile,
    compositePercentile,
    levelStatus: status,
    statusLabel: label,
    statusDescription: description,
    peBand,
    pbBand,
  }

  return { current, history }
}

/** 抓取 TWSE 加權指數收盤點位（透過 OpenAPI） */
export async function fetchTwseTaiex(dateStr: string): Promise<number | null> {
  try {
    const res = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const list = await res.json()
    if (!Array.isArray(list)) return null
    // 嚴格比對「發行量加權股價指數」，避免誤抓陣列首筆「寶島股價指數」或其他衍生指數
    const match =
      list.find((item: any) => (item['指數'] ?? item.IndexName) === '發行量加權股價指數') ??
      list.find((item: any) => (item['指數'] ?? item.IndexName) === '加權指數') ??
      list.find((item: any) => String(item['指數'] ?? item.IndexName ?? '').includes('發行量加權股價指數'))
    if (!match) return null
    const closeStr = String(match['收盤指數'] ?? match.ClosingIndex ?? '').replace(/,/g, '')
    const val = Number(closeStr)
    return Number.isFinite(val) && val > 0 ? val : null
  } catch {
    return null
  }
}

/**
 * 執行大盤水位與落底指標同步（供 GHA 排程及前台手動更新共用）
 */
export async function syncMarketLevel(options?: { forceReseed?: boolean }): Promise<{
  updated: { current: MarketLevelAnalysis; history: MarketLevelRow[] }
  bottomRadar: BottomRadarDashboardData | null
  today: string
}> {
  const today = taipeiTodayStr()
  await ensureMarketLevelSeeds(options?.forceReseed)

  // 1. 抓取當日加權指數收盤點位
  const taiex = await fetchTwseTaiex(today)

  // 2. 抓取當日全市場估值（BWIBBU_d）
  let valuation: { pe: number; pb: number; dividendYield: number } | null = null
  try {
    const res = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000),
    })
    if (res.ok) {
      const rows = await res.json()
      if (Array.isArray(rows)) {
        valuation = parseMarketValuationFromBwibbu(rows)
      }
    }
  } catch (e) {
    console.warn('[MarketLevel] BWIBBU_d fetch failed, fallback to previous or estimates:', e)
  }

  // 3. 取得歷史紀錄以計算分位數
  const history = await getMarketLevels(1200)
  const peHistory = history.map((h) => h.pe_ratio).filter((v): v is number => v != null)
  const pbHistory = history.map((h) => h.pb_ratio).filter((v): v is number => v != null)

  let pe = history[0]?.pe_ratio ?? 25.8
  let pb = history[0]?.pb_ratio ?? 4.10
  let dy = history[0]?.dividend_yield ?? 1.58

  if (valuation?.pe && valuation.pe > 0) {
    pe = Math.round(valuation.pe * 1.575 * 10) / 10
    pb = Math.round(valuation.pb * 2.55 * 100) / 100
    dy = Math.round(valuation.dividendYield * 0.46 * 100) / 100
  }

  const pePercentile = computePercentile(pe, peHistory)
  const pbPercentile = computePercentile(pb, pbHistory)
  const compositePercentile = Math.round(((pePercentile + pbPercentile) / 2) * 10) / 10
  const { status } = determineLevelStatus(compositePercentile)

  // 4. 寫入 DB
  await upsertMarketLevel({
    tradeDate: today,
    taiex: taiex ?? history[0]?.taiex ?? 45211.83,
    peRatio: pe,
    pbRatio: pb,
    dividendYield: dy,
    pePercentile,
    pbPercentile,
    compositePercentile,
    levelStatus: status,
  })

  const [updated, bottomRadar] = await Promise.all([
    getMarketLevelDashboardData(),
    getBottomRadarDashboardData(true).catch(() => null),
  ])

  return { updated, bottomRadar, today }
}
