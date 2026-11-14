import { describe, it, expect } from 'vitest'
import { computeLendingSignal, type LendingDataPoint } from './securities-lending'

function makeSeries(values: Array<number | null>, startIso = '2026-10-01'): LendingDataPoint[] {
  const baseMs = Date.parse(`${startIso}T12:00:00Z`)
  return values.map((v, idx) => ({
    date: new Date(baseMs + idx * 86400000).toISOString().slice(0, 10),
    balance: v,
  }))
}

describe('Issue #151 securities-lending engine', () => {
  it('空序列：回 normal 且標記 insufficientData', () => {
    const res = computeLendingSignal([], 100_000)
    expect(res.level).toBe('normal')
    expect(res.insufficientData).toBe(true)
    expect(res.latestBalance).toBeNull()
    expect(res.consecutiveIncreaseDays).toBe(0)
  })

  it('benchmark 為 0 或無效時不除以零，回 level=normal 且 insufficientData=true', () => {
    const series = makeSeries([100, 110, 120, 130, 140, 200])
    const res = computeLendingSignal(series, 0)
    expect(res.level).toBe('normal')
    expect(res.insufficientData).toBe(true)
    expect(res.pctOfBenchmark).toBeNull()
    expect(res.reason).toBe('benchmark_zero_or_invalid')
  })

  it('單日缺值（null）與掛牌未滿 20 日：正確跳過缺值且不 crash', () => {
    const series = makeSeries([100, null, 110, 120, 130, 140])
    const res = computeLendingSignal(series, 10_000)
    expect(res.latestBalance).toBe(140)
    expect(res.ma20).toBeNull()
    expect(res.pctChange20d).toBeNull()
    expect(res.consecutiveIncreaseDays).toBe(4) // 100 -> 110 -> 120 -> 130 -> 140
    expect(res.pctOfBenchmark).toBe(1.4)
  })

  it('連續 3 日增且 zScore > 2 → level=alert（紅）', () => {
    // 前 17 天穩定在 1000，最後 3 天跳增：1100, 1200, 2500 -> 連增 3 天且 zScore 遠大於 2
    const vals = [...Array(17).fill(1000), 1100, 1200, 2500]
    const res = computeLendingSignal(makeSeries(vals), 100_000)
    expect(res.consecutiveIncreaseDays).toBe(3)
    expect(res.zScore).not.toBeNull()
    expect(res.zScore!).toBeGreaterThan(2)
    expect(res.level).toBe('alert')
    expect(res.insufficientData).toBe(false)
  })

  it('連續 2 日增或 zScore > 1.5 → level=watch（黃）', () => {
    // 連續 2 日增，但 zScore 不高
    const valsConsec2 = [1000, 1000, 1000, 1000, 1000, 990, 995, 1000]
    const res1 = computeLendingSignal(makeSeries(valsConsec2), 100_000)
    expect(res1.consecutiveIncreaseDays).toBe(2)
    expect(res1.level).toBe('watch')

    // 單日跳增（連增 1 天）但 zScore > 1.5
    const valsSpike = [...Array(19).fill(1000), 1500]
    const res2 = computeLendingSignal(makeSeries(valsSpike), 100_000)
    expect(res2.consecutiveIncreaseDays).toBe(1)
    expect(res2.zScore!).toBeGreaterThan(1.5)
    expect(res2.level).toBe('watch')
  })

  it('其餘正常情況 → level=normal（綠）', () => {
    const vals = [1000, 1010, 1005, 1000, 995, 990]
    const res = computeLendingSignal(makeSeries(vals), 100_000)
    expect(res.consecutiveIncreaseDays).toBe(0)
    expect(res.level).toBe('normal')
  })
})
