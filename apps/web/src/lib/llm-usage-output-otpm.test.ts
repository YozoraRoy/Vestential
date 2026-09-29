import { describe, it, expect } from 'vitest'

import { groupLlmUsageByMinute, LLM_OTPM_ALERT_THRESHOLD } from '@stock/database'

const DAY = '2026-09-29'

describe('#47 OTPM 改用輸出口徑（completion 加總）', () => {
  it('prompt 大 output 小不觸發 800 告警（無誤報）', () => {
    const buckets = groupLlmUsageByMinute(
      [
        // 同分鐘：prompt 灌水 5000，輸出僅 100；總量 5100（舊口徑會誤報）
        { agent: 'a', promptTokens: 5000, completionTokens: 100, totalTokens: 5100, created_at: `${DAY} 11:40:10` },
      ],
      DAY,
    )
    expect(LLM_OTPM_ALERT_THRESHOLD).toBe(800)
    expect(buckets).toHaveLength(1)
    expect(buckets[0].outputTokens).toBe(100)
    expect(buckets[0].promptTokens).toBe(5000)
    expect(buckets[0].totalTokens).toBe(5100)
    expect(buckets[0].overThreshold).toBe(false)
  })

  it('output 真超 800 觸發告警（含標紅 overThreshold）', () => {
    const buckets = groupLlmUsageByMinute(
      [
        { agent: 'a', promptTokens: 50, completionTokens: 850, totalTokens: 900, created_at: `${DAY} 11:41:10` },
      ],
      DAY,
    )
    expect(buckets[0].outputTokens).toBe(850)
    expect(buckets[0].overThreshold).toBe(true)
  })

  it('同批 11:40–44 資料 output 重算尖峰遠低於總量版 8180（固定測資對照）', () => {
    // 模擬誤報批：5 分鐘、總量合計 8180（舊口徑尖峰 1636/分鐘），但輸出每分鐘僅 ~130。
    const rows = [
      { agent: 'm', promptTokens: 1500, completionTokens: 136, totalTokens: 1636, created_at: `${DAY} 11:40:10` },
      { agent: 'm', promptTokens: 1500, completionTokens: 136, totalTokens: 1636, created_at: `${DAY} 11:41:10` },
      { agent: 'm', promptTokens: 1500, completionTokens: 136, totalTokens: 1636, created_at: `${DAY} 11:42:10` },
      { agent: 'm', promptTokens: 1500, completionTokens: 136, totalTokens: 1636, created_at: `${DAY} 11:43:10` },
      { agent: 'm', promptTokens: 1500, completionTokens: 136, totalTokens: 1636, created_at: `${DAY} 11:44:10` },
    ]
    const buckets = groupLlmUsageByMinute(rows, DAY)
    expect(buckets).toHaveLength(5)
    const outputPeak = Math.max(...buckets.map((b) => b.outputTokens))
    const totalPeak = Math.max(...buckets.map((b) => b.totalTokens))
    // 總量版對照：單分鐘 1636（＞800 誤報）；輸出重算：單分鐘 136，遠低於 8180 總量與 800 閾值
    expect(totalPeak).toBe(1636)
    expect(outputPeak).toBe(136)
    expect(outputPeak).toBeLessThan(800)
    expect(outputPeak).toBeLessThan(8180)
    expect(buckets.every((b) => !b.overThreshold)).toBe(true)
  })
})
