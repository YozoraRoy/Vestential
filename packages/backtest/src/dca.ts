import type { OHLCV } from './index'
import { computeSMA, computeBias60MA } from './index'

export interface DcaOptions {
  data: OHLCV[]
  monthlyAmount: number
  investDay?: number // 預設 6
  smartDipThresholdPct?: number // 預設 -5 (即 -5%)
  smartDipMultiplier?: number // 預設 1.5 (加碼為 1.5x，即額外加碼 0.5x)
  smartDipMaxTimesPerMonth?: number // 預設 1
}

export interface DcaTrackMetrics {
  totalInvested: number
  totalShares: number
  finalValue: number
  totalReturn: number
  roiPct: number
  annualizedReturnPct: number
  avgCostPerShare: number
}

export interface DcaDipEvent {
  date: number // timestamp
  dateStr: string
  close: number
  ma60: number
  biasPct: number
  amount: number
  sharesBought: number
}

export interface DcaPoint {
  date: number
  dateStr: string
  close: number
  ma60: number | null
  biasPct: number | null
  stdInvested: number
  stdValue: number
  smartInvested: number
  smartValue: number
  isDipEvent: boolean
  isInvestDay: boolean
}

export interface DcaBacktestResult {
  standard: DcaTrackMetrics
  smart: DcaTrackMetrics & {
    dipTriggerCount: number
    extraReturn: number
    extraRoiPct: number
    costReductionPct: number
  }
  chartData: DcaPoint[]
  dipEvents: DcaDipEvent[]
  meta: {
    startDate: number
    endDate: number
    monthsCount: number
    monthlyAmount: number
    smartDipThresholdPct: number
    smartDipMultiplier: number
  }
}

function getTwDateParts(ts: number) {
  // 兼顧秒與毫秒 timestamp
  const ms = ts < 1e11 ? ts * 1000 : ts
  const d = new Date(ms + 8 * 3600 * 1000)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  return { year, month, day, dateStr, monthKey, ms }
}

/**
 * 執行定期定額（純定期定額 vs 季線負乖離智慧加碼）雙軌歷史回測
 */
export function runDcaBacktest(options: DcaOptions): DcaBacktestResult {
  const {
    data,
    monthlyAmount,
    investDay = 6,
    smartDipThresholdPct = -5,
    smartDipMultiplier = 1.5,
    smartDipMaxTimesPerMonth = 1,
  } = options

  if (!data || data.length === 0) {
    throw new Error('Data array cannot be empty')
  }

  // 確保依照時間遞增排序
  const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp)
  const closes = sorted.map((d) => d.close)
  const ma60 = computeSMA(closes, 60)
  const bias = computeBias60MA(closes, ma60)

  let stdShares = 0
  let stdInvested = 0

  let smartShares = 0
  let smartInvested = 0

  const dipEvents: DcaDipEvent[] = []
  const chartData: DcaPoint[] = []

  // 按月份記錄狀態
  let currentMonthKey = ''
  let monthDcaExecuted = false
  let monthDipCount = 0
  let distinctMonthsCount = 0

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i]
    const close = item.close
    const { monthKey, day, dateStr, ms } = getTwDateParts(item.timestamp)
    const currentMa = ma60[i]
    const currentBias = bias[i]
    const currentBiasPct = currentBias != null ? currentBias * 100 : null

    // 換月重置狀態
    if (monthKey !== currentMonthKey) {
      currentMonthKey = monthKey
      monthDcaExecuted = false
      monthDipCount = 0
      distinctMonthsCount += 1
    }

    let isInvestDay = false
    let isDipEvent = false

    // 1. 每月常態定期定額扣款：如果在 investDay (含) 之後且該月尚未扣款，執行扣款
    if (!monthDcaExecuted && day >= investDay) {
      isInvestDay = true
      monthDcaExecuted = true

      // A 軌標準買入
      const boughtStdShares = monthlyAmount / close
      stdShares += boughtStdShares
      stdInvested += monthlyAmount

      // B 軌基礎買入
      const boughtSmartShares = monthlyAmount / close
      smartShares += boughtSmartShares
      smartInvested += monthlyAmount
    }

    // 2. B 軌季線負乖離智慧逢低加碼
    // 條件：已有 60MA 乖離率，且乖離率 <= 門檻，且該月加碼次數未達上限
    if (
      currentBiasPct != null &&
      currentBiasPct <= smartDipThresholdPct &&
      monthDipCount < smartDipMaxTimesPerMonth
    ) {
      isDipEvent = true
      monthDipCount += 1

      // 額外加碼金額：(multiplier - 1) * monthlyAmount
      // 例如 multiplier = 1.5，加碼 0.5x；若 multiplier = 2.0，加碼 1.0x
      const dipAmount = monthlyAmount * Math.max(0.1, smartDipMultiplier - 1)
      const boughtDipShares = dipAmount / close
      smartShares += boughtDipShares
      smartInvested += dipAmount

      dipEvents.push({
        date: ms,
        dateStr,
        close,
        ma60: currentMa!,
        biasPct: currentBiasPct,
        amount: Math.round(dipAmount),
        sharesBought: boughtDipShares,
      })
    }

    // 紀錄時間序列點（取每日或有變動的點，此處全量記錄供平滑繪圖）
    chartData.push({
      date: ms,
      dateStr,
      close,
      ma60: currentMa,
      biasPct: currentBiasPct,
      stdInvested: Math.round(stdInvested),
      stdValue: Math.round(stdShares * close),
      smartInvested: Math.round(smartInvested),
      smartValue: Math.round(smartShares * close),
      isDipEvent,
      isInvestDay,
    })
  }

  const latestClose = closes[closes.length - 1]
  const firstMs = getTwDateParts(sorted[0].timestamp).ms
  const lastMs = getTwDateParts(sorted[sorted.length - 1].timestamp).ms
  const years = Math.max(0.01, (lastMs - firstMs) / (365.25 * 86400 * 1000))

  // 計算 A 軌最終指標
  const stdFinalValue = Math.round(stdShares * latestClose)
  const stdTotalReturn = Math.round(stdFinalValue - stdInvested)
  const stdRoiPct = stdInvested > 0 ? (stdTotalReturn / stdInvested) * 100 : 0
  const stdAnnualizedReturnPct =
    years > 0.1 && stdRoiPct > -100
      ? (Math.pow(Math.max(0.001, 1 + stdRoiPct / 100), 1 / years) - 1) * 100
      : stdRoiPct
  const stdAvgCost = stdShares > 0 ? stdInvested / stdShares : 0

  // 計算 B 軌最終指標
  const smartFinalValue = Math.round(smartShares * latestClose)
  const smartTotalReturn = Math.round(smartFinalValue - smartInvested)
  const smartRoiPct = smartInvested > 0 ? (smartTotalReturn / smartInvested) * 100 : 0
  const smartAnnualizedReturnPct =
    years > 0.1 && smartRoiPct > -100
      ? (Math.pow(Math.max(0.001, 1 + smartRoiPct / 100), 1 / years) - 1) * 100
      : smartRoiPct
  const smartAvgCost = smartShares > 0 ? smartInvested / smartShares : 0

  const costReductionPct = stdAvgCost > 0 ? ((stdAvgCost - smartAvgCost) / stdAvgCost) * 100 : 0
  const extraReturn = smartFinalValue - stdFinalValue
  const extraRoiPct = smartRoiPct - stdRoiPct

  return {
    standard: {
      totalInvested: Math.round(stdInvested),
      totalShares: Math.round(stdShares * 100) / 100,
      finalValue: stdFinalValue,
      totalReturn: stdTotalReturn,
      roiPct: Math.round(stdRoiPct * 100) / 100,
      annualizedReturnPct: Math.round(stdAnnualizedReturnPct * 100) / 100,
      avgCostPerShare: Math.round(stdAvgCost * 100) / 100,
    },
    smart: {
      totalInvested: Math.round(smartInvested),
      totalShares: Math.round(smartShares * 100) / 100,
      finalValue: smartFinalValue,
      totalReturn: smartTotalReturn,
      roiPct: Math.round(smartRoiPct * 100) / 100,
      annualizedReturnPct: Math.round(smartAnnualizedReturnPct * 100) / 100,
      avgCostPerShare: Math.round(smartAvgCost * 100) / 100,
      dipTriggerCount: dipEvents.length,
      extraReturn: Math.round(extraReturn),
      extraRoiPct: Math.round(extraRoiPct * 100) / 100,
      costReductionPct: Math.round(costReductionPct * 100) / 100,
    },
    chartData,
    dipEvents,
    meta: {
      startDate: firstMs,
      endDate: lastMs,
      monthsCount: distinctMonthsCount,
      monthlyAmount,
      smartDipThresholdPct,
      smartDipMultiplier,
    },
  }
}
