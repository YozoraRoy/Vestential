/**
 * Issue #151：借券賣出餘額異常監測純函式引擎（client-safe，零 Node/DB 依賴）。
 *
 * 門檻規則（可調參數）：
 * - 連續 3 日增 且 zScore > 2   → 'alert'（紅）
 * - 連續 2 日增 或 zScore > 1.5 → 'watch'（黃）
 * - 其餘                         → 'normal'（綠）
 * - benchmark <= 0（或無有效資料）：不除以零，回 'normal' 並標記 insufficientData: true
 */

export type LendingLevel = 'normal' | 'watch' | 'alert'

export interface LendingDataPoint {
  /** 'YYYY-MM-DD' */
  date: string
  /** 借券賣出餘額（股）；null 表示該日缺值 */
  balance: number | null
}

export interface LendingThresholds {
  alertConsecDays: number
  alertZScore: number
  watchConsecDays: number
  watchZScore: number
}

export const DEFAULT_LENDING_THRESHOLDS: LendingThresholds = {
  alertConsecDays: 3,
  alertZScore: 2,
  watchConsecDays: 2,
  watchZScore: 1.5,
}

export interface LendingSignalResult {
  latestBalance: number | null
  pctOfBenchmark: number | null
  ma5: number | null
  ma20: number | null
  ma5Change: number | null
  ma20Change: number | null
  pctChange5d: number | null
  pctChange20d: number | null
  consecutiveIncreaseDays: number
  zScore: number | null
  level: LendingLevel
  insufficientData: boolean
  reason: string | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function pctChange(latest: number, base: number): number | null {
  if (!Number.isFinite(base) || base <= 0) return null
  return round2(((latest - base) / base) * 100)
}

function mean(nums: readonly number[]): number {
  return nums.reduce((s, v) => s + v, 0) / nums.length
}

/**
 * 計算單一標的借券賣出餘額異常訊號。
 */
export function computeLendingSignal(
  series: readonly LendingDataPoint[],
  benchmark: number,
  thresholds: LendingThresholds = DEFAULT_LENDING_THRESHOLDS,
): LendingSignalResult {
  const validBenchmark = Number.isFinite(benchmark) && benchmark > 0

  const clean = (series ?? [])
    .filter(
      (p) =>
        DATE_RE.test((p.date ?? '').trim()) &&
        p.balance != null &&
        Number.isFinite(p.balance) &&
        p.balance >= 0,
    )
    .map((p) => ({ date: p.date.trim(), balance: p.balance as number }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  // 去重同日（保留最後一筆）
  const deduped: Array<{ date: string; balance: number }> = []
  for (const item of clean) {
    if (deduped.length > 0 && deduped[deduped.length - 1]!.date === item.date) {
      deduped[deduped.length - 1] = item
    } else {
      deduped.push(item)
    }
  }

  if (!validBenchmark || deduped.length === 0) {
    return {
      latestBalance: deduped.length > 0 ? deduped[deduped.length - 1]!.balance : null,
      pctOfBenchmark: null,
      ma5: null,
      ma20: null,
      ma5Change: null,
      ma20Change: null,
      pctChange5d: null,
      pctChange20d: null,
      consecutiveIncreaseDays: 0,
      zScore: null,
      level: 'normal',
      insufficientData: true,
      reason: !validBenchmark ? 'benchmark_zero_or_invalid' : 'no_valid_series',
    }
  }

  const n = deduped.length
  const latestBalance = deduped[n - 1]!.balance
  const pctOfBenchmark = round2((latestBalance / benchmark) * 100)

  // 連續增加天數（由最新一日往前）
  let consecutiveIncreaseDays = 0
  for (let i = n - 1; i > 0; i--) {
    if (deduped[i]!.balance > deduped[i - 1]!.balance) {
      consecutiveIncreaseDays++
    } else {
      break
    }
  }

  const ma5Slice = n >= 5 ? deduped.slice(n - 5).map((d) => d.balance) : null
  const ma20Slice = n >= 20 ? deduped.slice(n - 20).map((d) => d.balance) : null
  const ma5 = ma5Slice ? round2(mean(ma5Slice)) : null
  const ma20 = ma20Slice ? round2(mean(ma20Slice)) : null
  const ma5Change = ma5 != null ? pctChange(latestBalance, ma5) : null
  const ma20Change = ma20 != null ? pctChange(latestBalance, ma20) : null

  const pctChange5d = n >= 6 ? pctChange(latestBalance, deduped[n - 1 - 5]!.balance) : null
  const pctChange20d = n >= 21 ? pctChange(latestBalance, deduped[n - 1 - 20]!.balance) : null

  // z-score（以最近最多 20 日樣本計算，至少需 5 筆）
  let zScore: number | null = null
  const zWindow = deduped.slice(Math.max(0, n - 20)).map((d) => d.balance)
  if (zWindow.length >= 5) {
    const m = mean(zWindow)
    const variance = zWindow.reduce((acc, v) => acc + (v - m) ** 2, 0) / zWindow.length
    const stddev = Math.sqrt(variance)
    if (stddev > 0) {
      zScore = round2((latestBalance - m) / stddev)
    } else {
      zScore = 0
    }
  }

  const insufficientData = n < 5
  let level: LendingLevel = 'normal'
  if (
    consecutiveIncreaseDays >= thresholds.alertConsecDays &&
    zScore != null &&
    zScore > thresholds.alertZScore
  ) {
    level = 'alert'
  } else if (
    consecutiveIncreaseDays >= thresholds.watchConsecDays ||
    (zScore != null && zScore > thresholds.watchZScore)
  ) {
    level = 'watch'
  }

  return {
    latestBalance,
    pctOfBenchmark,
    ma5,
    ma20,
    ma5Change,
    ma20Change,
    pctChange5d,
    pctChange20d,
    consecutiveIncreaseDays,
    zScore,
    level,
    insufficientData,
    reason: insufficientData ? 'insufficient_history' : null,
  }
}
