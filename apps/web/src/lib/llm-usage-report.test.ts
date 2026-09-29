import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

// ─── temp DB 隔離（必須在 import @stock/database 之前生效） ────────
vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp'
  const dir = `${base}\\llm-usage-report-test-${process.pid}`
  process.env.DATABASE_PATH = `${dir}\\llm-usage.db`
  delete process.env.DATABASE_URL // 強制 SQLite 後端
})

import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  migrate,
  dbExecute,
  dbQueryAll,
  closeDb,
  getLlmUsageDailyReport,
  getLlmUsageMinuteReport,
  groupLlmUsageByDay,
  groupLlmUsageByMinute,
  taipeiDayOf,
  taipeiMinuteOf,
  LLM_OTPM_LIMIT,
  LLM_OTPM_ALERT_THRESHOLD,
  LLM_USAGE_DAILY_MAX_DAYS,
} from '@stock/database'

function testDir(): string {
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp'
  return join(base, `llm-usage-report-test-${process.pid}`)
}

async function insertLog(agent: string, prompt: number, completion: number, createdAt: string): Promise<void> {
  await dbExecute(
    `INSERT INTO llm_usage_logs (agent, model, usedFallback, promptTokens, completionTokens, totalTokens, created_at)
     VALUES (@agent, @model, 0, @prompt, @completion, @total, @createdAt)`,
    { agent, model: 'qwen-test', prompt, completion, total: prompt + completion, createdAt },
  )
}

beforeAll(async () => {
  rmSync(testDir(), { recursive: true, force: true })
  mkdirSync(testDir(), { recursive: true })
  await migrate()
  // 9/20：agentA 兩筆同分鐘（還原尖峰形狀）＋ agentB 次分鐘；跨日界兩筆。
  await insertLog('agentA', 500, 300, '2026-09-20 10:00:10')
  await insertLog('agentA', 100, 50, '2026-09-20 10:00:50')
  await insertLog('agentB', 200, 100, '2026-09-20 10:01:05')
  await insertLog('agentA', 6, 4, '2026-09-20 23:59:59')
  await insertLog('agentA', 12, 8, '2026-09-21 00:00:01')
  await insertLog('agentB', 50, 50, '2026-09-21 08:00:00')
})

afterAll(() => {
  closeDb()
  rmSync(testDir(), { recursive: true, force: true })
})

describe('OTPM 常數（#45 規格值）', () => {
  it('上限 1000、告警閾值 800、日報上限 31 天', () => {
    expect(LLM_OTPM_LIMIT).toBe(1000)
    expect(LLM_OTPM_ALERT_THRESHOLD).toBe(800)
    expect(LLM_USAGE_DAILY_MAX_DAYS).toBe(31)
  })
})

describe('台北日界（字串牆鐘＋Date 瞬時）', () => {
  it('SQLite 牆鐘字串直接取台北日／分鐘', () => {
    expect(taipeiDayOf('2026-09-20 23:59:59')).toBe('2026-09-20')
    expect(taipeiDayOf('2026-09-21 00:00:01')).toBe('2026-09-21')
    expect(taipeiMinuteOf('2026-09-20 10:00:50')).toBe('2026-09-20 10:00')
  })
  it('Date 物件（Azure DATETIME2 風格）按 +08:00 換算', () => {
    // 2026-09-20T15:59Z = 台北 23:59（9/20）；16:00Z = 台北 00:00（9/21）
    expect(taipeiDayOf(new Date('2026-09-20T15:59:00Z'))).toBe('2026-09-20')
    expect(taipeiDayOf(new Date('2026-09-20T16:00:00Z'))).toBe('2026-09-21')
  })
})

describe('getLlmUsageDailyReport（per-agent 每日 in/out）', () => {
  it('日報數字與 DB 加總一致', async () => {
    const report = await getLlmUsageDailyReport({ from: '2026-09-20', to: '2026-09-21' })
    expect(report.days.map((d) => d.date)).toEqual(['2026-09-20', '2026-09-21'])

    const db = await dbQueryAll<{ prompt: number; completion: number; total: number; calls: number }>(
      `SELECT SUM(promptTokens) AS prompt, SUM(completionTokens) AS completion,
              SUM(totalTokens) AS total, COUNT(*) AS calls
       FROM llm_usage_logs WHERE created_at >= @from AND created_at <= @to`,
      { from: '2026-09-20 00:00:00', to: '2026-09-21 23:59:59' },
    )
    expect(report.grandTotal.promptTokens).toBe(db[0].prompt)
    expect(report.grandTotal.completionTokens).toBe(db[0].completion)
    expect(report.grandTotal.totalTokens).toBe(db[0].total)
    expect(report.grandTotal.callCount).toBe(db[0].calls)
  })

  it('跨日界分屬兩天、per-agent 分組正確', async () => {
    const report = await getLlmUsageDailyReport({ from: '2026-09-20', to: '2026-09-21' })
    const day1 = report.days[0]
    const aA = day1.agents.find((a) => a.agent === 'agentA')!
    // 800 + 150 + 10（23:59:59 仍屬 9/20）
    expect(aA.totalTokens).toBe(960)
    expect(aA.callCount).toBe(3)
    expect(aA.promptTokens).toBe(606)
    expect(aA.completionTokens).toBe(354)
    const day2 = report.days[1]
    expect(day2.agents.find((a) => a.agent === 'agentA')!.totalTokens).toBe(20)
    expect(day2.total.totalTokens).toBe(120)
  })

  it('無資料的日子補全 0（7 日趨勢可直接畫）', async () => {
    const report = await getLlmUsageDailyReport({ from: '2026-09-22', to: '2026-09-23' })
    expect(report.days).toHaveLength(2)
    expect(report.days[0].agents).toEqual([])
    expect(report.days[0].total.totalTokens).toBe(0)
  })

  it('區間超過 31 天直接拒絕', async () => {
    await expect(getLlmUsageDailyReport({ from: '2026-08-01', to: '2026-09-20' })).rejects.toThrow(/31/)
  })

  it('from 晚於 to 直接拒絕', async () => {
    await expect(getLlmUsageDailyReport({ from: '2026-09-21', to: '2026-09-20' })).rejects.toThrow()
  })
})

describe('getLlmUsageMinuteReport（分鐘級 OTPM 估算）', () => {
  it('還原尖峰形狀：同分鐘合併、peak 指向最高分鐘', async () => {
    const report = await getLlmUsageMinuteReport({ day: '2026-09-20' })
    expect(report.estimated).toBe(true)
    expect(report.otpmLimit).toBe(1000)
    const b1000 = report.buckets.find((b) => b.minute === '2026-09-20 10:00')!
    expect(b1000.totalTokens).toBe(950)
    expect(b1000.callCount).toBe(2)
    expect(report.peak?.minute).toBe('2026-09-20 10:00')
    // 全 0 分鐘省略
    expect(report.buckets.length).toBe(3)
  })

  it('單分鐘＞800 標 overThreshold（UI 標紅＋告警）', async () => {
    const report = await getLlmUsageMinuteReport({ day: '2026-09-20' })
    expect(report.overMinutes).toEqual(['2026-09-20 10:00'])
    const quiet = await getLlmUsageMinuteReport({ day: '2026-09-21' })
    expect(quiet.overMinutes).toEqual([])
    expect(quiet.peak?.overThreshold).toBe(false)
  })
})

describe('純函式 groupLlmUsageByDay / groupLlmUsageByMinute', () => {
  it('區間外列忽略、=800 不算超標（＞800 才算）', () => {
    const days = groupLlmUsageByDay(
      [
        { agent: 'x', promptTokens: 1, completionTokens: 1, totalTokens: 2, created_at: '2026-09-20 12:00:00' },
        { agent: 'x', promptTokens: 1, completionTokens: 1, totalTokens: 2, created_at: '2026-09-25 12:00:00' },
      ],
      '2026-09-20',
      '2026-09-20',
    )
    expect(days).toHaveLength(1)
    expect(days[0].total.totalTokens).toBe(2)

    const buckets = groupLlmUsageByMinute(
      [{ agent: 'x', promptTokens: 400, completionTokens: 400, totalTokens: 800, created_at: '2026-09-20 12:00:00' }],
      '2026-09-20',
    )
    expect(buckets[0].overThreshold).toBe(false)
  })
})
