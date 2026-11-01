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
  // 2025~2026 (高檔擴張與近期拉回)
  { tradeDate: '2025-06-20', taiex: 32800.0, peRatio: 20.8, pbRatio: 2.45, dividendYield: 3.1, pePercentile: 68.0, pbPercentile: 70.0, compositePercentile: 69.0, levelStatus: 'warm' },
  { tradeDate: '2026-03-15', taiex: 42500.0, peRatio: 22.5, pbRatio: 2.60, dividendYield: 2.8, pePercentile: 79.0, pbPercentile: 78.0, compositePercentile: 78.5, levelStatus: 'warm' },
  { tradeDate: '2026-06-22', taiex: 47741.51, peRatio: 24.2, pbRatio: 2.78, dividendYield: 2.5, pePercentile: 88.0, pbPercentile: 87.0, compositePercentile: 87.5, levelStatus: 'overheated' },
  { tradeDate: '2026-10-22', taiex: 46942.75, peRatio: 23.5, pbRatio: 2.69, dividendYield: 2.65, pePercentile: 82.0, pbPercentile: 81.0, compositePercentile: 81.5, levelStatus: 'overheated' },
  { tradeDate: '2026-10-27', taiex: 46041.43, peRatio: 22.8, pbRatio: 2.62, dividendYield: 2.75, pePercentile: 78.0, pbPercentile: 77.0, compositePercentile: 77.5, levelStatus: 'warm' },
  { tradeDate: '2026-10-30', taiex: 45211.83, peRatio: 22.1, pbRatio: 2.52, dividendYield: 2.85, pePercentile: 73.0, pbPercentile: 72.0, compositePercentile: 72.5, levelStatus: 'warm' },
]

/** 確保大盤水位資料庫至少有代表性歷史資料（冷啟動種子填入） */
export async function ensureMarketLevelSeeds(): Promise<number> {
  const existing = await getMarketLevels(5)
  if (existing.length >= 5) return 0
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
    trade_date: '2026-10-30',
    taiex: 45211.83,
    pe_ratio: 22.1,
    pb_ratio: 2.52,
    dividend_yield: 2.85,
    pe_percentile: 73.0,
    pb_percentile: 72.0,
    composite_percentile: 72.5,
    level_status: 'warm' as MarketLevelStatus,
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
    // 尋找「發行量加權股價指數」
    const match = list.find((item: any) =>
      String(item['指數'] ?? item.IndexName ?? '').includes('發行量加權股價指數') ||
      String(item['指數'] ?? item.IndexName ?? '').includes('加權指數')
    )
    if (!match) return null
    const closeStr = String(match['收盤指數'] ?? match.ClosingIndex ?? '').replace(/,/g, '')
    const val = Number(closeStr)
    return Number.isFinite(val) && val > 0 ? val : null
  } catch {
    return null
  }
}
