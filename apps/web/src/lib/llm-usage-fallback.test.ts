import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

// ─── temp DB 隔離（必須在 import @stock/database 之前生效；目錄與 llm-usage-report.test.ts 區隔） ───
vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp'
  const dir = `${base}\\llm-usage-fallback46-test-${process.pid}`
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
  logLlmUsage,
  getLlmUsageReport,
  getLlmUsageDailyReport,
  getLlmUsageMinuteReport,
} from '@stock/database'

function testDir(): string {
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp'
  return join(base, `llm-usage-fallback46-test-${process.pid}`)
}

async function insertRaw(
  agent: string,
  model: string,
  usedFallback: number | null,
  prompt: number,
  completion: number,
  createdAt: string,
): Promise<void> {
  await dbExecute(
    `INSERT INTO llm_usage_logs (agent, model, usedFallback, promptTokens, completionTokens, totalTokens, created_at)
     VALUES (@agent, @model, @usedFallback, @prompt, @completion, @total, @createdAt)`,
    { agent, model, usedFallback, prompt, completion, total: prompt + completion, createdAt },
  )
}

beforeAll(async () => {
  rmSync(testDir(), { recursive: true, force: true })
  mkdirSync(testDir(), { recursive: true })
  await migrate()
  // 乾淨列：0/1 各一；髒列：432（生產級量級）、-5、NULL；跨兩 agent。
  await insertRaw('agentA', 'm1', 0, 100, 20, '2026-09-20 10:00:10')
  await insertRaw('agentA', 'm1', 1, 200, 40, '2026-09-20 10:00:50')
  await insertRaw('agentA', 'm1', 432, 300, 60, '2026-09-20 10:01:05')
  await insertRaw('agentA', 'm1', -5, 400, 80, '2026-09-20 11:00:00')
  await insertRaw('agentA', 'm1', null, 500, 100, '2026-09-20 11:05:00')
  await insertRaw('agentB', 'm2', 1, 600, 120, '2026-09-20 12:00:00')
})

afterAll(() => {
  closeDb()
  rmSync(testDir(), { recursive: true, force: true })
})

describe('#46 髒資料聚合口徑', () => {
  it('SUM(CASE WHEN =1)：只認 =1 為備援（髒值 432/-5/NULL 計 0）', async () => {
    const report = await getLlmUsageReport({ from: '2026-09-20', to: '2026-09-20' })
    expect(report.total.callCount).toBe(6)
    // 只有兩筆 =1
    expect(report.total.fallbackCalls).toBe(2)
    // 舊口徑 SUM 會是 429；新口徑恆 ≤ callCount
    expect(report.total.fallbackCalls).toBeLessThanOrEqual(report.total.callCount)
    const ratio = Math.round((report.total.fallbackCalls / report.total.callCount) * 100)
    expect(ratio).toBeGreaterThanOrEqual(0)
    expect(ratio).toBeLessThanOrEqual(100)
  })

  it('logLlmUsage 寫入只產生 0/1（flag 正確）', async () => {
    await logLlmUsage({ agent: 'flagT', model: 'm', usedFallback: true, promptTokens: 1, completionTokens: 1 })
    await logLlmUsage({ agent: 'flagF', model: 'm', usedFallback: false, promptTokens: 1, completionTokens: 1 })
    const rows = await dbQueryAll<{ usedFallback: number }>(
      `SELECT DISTINCT usedFallback FROM llm_usage_logs WHERE agent IN ('flagT','flagF')`,
    )
    expect(rows.map((r) => r.usedFallback).sort()).toEqual([0, 1])
  })
})

describe('#46 全頁交叉驗算', () => {
  it('summary：手工 SQL 加總一致（呼叫次數/total/Prompt/Completion）', async () => {
    const report = await getLlmUsageReport({ from: '2026-09-20', to: '2026-09-20' })
    const db = await dbQueryAll<{ prompt: number; completion: number; total: number; calls: number }>(
      `SELECT SUM(promptTokens) AS prompt, SUM(completionTokens) AS completion,
              SUM(totalTokens) AS total, COUNT(*) AS calls
       FROM llm_usage_logs WHERE created_at >= @from AND created_at <= @to`,
      { from: '2026-09-20 00:00:00', to: '2026-09-20 23:59:59' },
    )
    expect(report.total.callCount).toBe(db[0]!.calls)
    expect(report.total.promptTokens).toBe(db[0]!.prompt)
    expect(report.total.completionTokens).toBe(db[0]!.completion)
    expect(report.total.totalTokens).toBe(db[0]!.total)
  })

  it('Prompt+Completion=total（SUM 層級）', async () => {
    const report = await getLlmUsageReport({ from: '2026-09-20', to: '2026-09-20' })
    expect(report.total.totalTokens).toBe(report.total.promptTokens + report.total.completionTokens)
  })

  it('per-agent 加總=總數', async () => {
    const report = await getLlmUsageReport({ from: '2026-09-20', to: '2026-09-20' })
    const sum = (f: (a: (typeof report.agents)[number]) => number) => report.agents.reduce((n, a) => n + f(a), 0)
    expect(sum((a) => a.callCount)).toBe(report.total.callCount)
    expect(sum((a) => a.fallbackCalls)).toBe(report.total.fallbackCalls)
    expect(sum((a) => a.totalTokens)).toBe(report.total.totalTokens)
    expect(sum((a) => a.promptTokens)).toBe(report.total.promptTokens)
    expect(sum((a) => a.completionTokens)).toBe(report.total.completionTokens)
  })

  it('日報 grandTotal=summary 總數、日趨勢加總一致', async () => {
    const summary = await getLlmUsageReport({ from: '2026-09-20', to: '2026-09-20' })
    const daily = await getLlmUsageDailyReport({ from: '2026-09-20', to: '2026-09-20' })
    expect(daily.grandTotal.callCount).toBe(summary.total.callCount)
    expect(daily.grandTotal.totalTokens).toBe(summary.total.totalTokens)
    expect(daily.grandTotal.promptTokens).toBe(summary.total.promptTokens)
    expect(daily.grandTotal.completionTokens).toBe(summary.total.completionTokens)
    const daySum = daily.days.reduce((n, d) => n + d.total.callCount, 0)
    expect(daySum).toBe(daily.grandTotal.callCount)
  })

  it('分鐘級 buckets 加總=當日日總數（OTPM 口徑一致）', async () => {
    const daily = await getLlmUsageDailyReport({ from: '2026-09-20', to: '2026-09-20' })
    const minute = await getLlmUsageMinuteReport({ day: '2026-09-20' })
    const bucketCalls = minute.buckets.reduce((n, b) => n + b.callCount, 0)
    const bucketTokens = minute.buckets.reduce((n, b) => n + b.totalTokens, 0)
    expect(bucketCalls).toBe(daily.grandTotal.callCount)
    expect(bucketTokens).toBe(daily.grandTotal.totalTokens)
  })
})
