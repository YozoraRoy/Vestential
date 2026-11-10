import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { logLlmUsage, migrate } from '@stock/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 內部收集安全 Token（優先讀取專用 INGEST_TOKEN，次選 AUTH_SECRET 或內建預設）
const VALID_TOKEN = process.env.INTERNAL_INGEST_TOKEN || process.env.AUTH_SECRET || 'llm-usage-internal-secret-token'

export async function POST(req: NextRequest) {
  await migrate()

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()

  if (!token || token !== VALID_TOKEN) {
    return NextResponse.json({ success: false, error: 'Unauthorized: Invalid ingestion token' }, { status: 401 })
  }

  try {
    const body = await req.json()
    if (!body || !body.agent || !body.model) {
      return NextResponse.json({ success: false, error: 'Missing required fields: agent, model' }, { status: 400 })
    }

    const promptTokens = Number(body.promptTokens ?? 0)
    const completionTokens = Number(body.completionTokens ?? 0)
    const totalTokens = Number(body.totalTokens ?? (promptTokens + completionTokens))

    // 若未主動帶入 costTwd，根據 DeepSeek 官方牌價自動換算 TWD (1 USD ≈ 32 TWD, 離峰 5 折)
    let costTwd = Number(body.costTwd ?? 0.0)
    if (costTwd === 0 && (promptTokens > 0 || completionTokens > 0)) {
      // deepseek-chat 牌價：Input $0.14/1M, Output $0.28/1M (離峰五折為 $0.07 / $0.14)
      const isOffPeak = true // 排程於 19:00~21:00 執行皆屬離峰
      const rate = isOffPeak ? 0.5 : 1.0
      const inputCostUsd = (promptTokens / 1_000_000) * 0.14 * rate
      const outputCostUsd = (completionTokens / 1_000_000) * 0.28 * rate
      costTwd = Number(((inputCostUsd + outputCostUsd) * 32.0).toFixed(4))
    }

    await logLlmUsage({
      project: String(body.project || 'travelplan'),
      agent: String(body.agent),
      model: String(body.model),
      usedFallback: Boolean(body.usedFallback),
      promptTokens,
      completionTokens,
      costTwd,
      executionMs: Number(body.executionMs ?? 0),
    })

    return NextResponse.json({
      success: true,
      data: {
        project: body.project || 'travelplan',
        agent: body.agent,
        totalTokens,
        costTwd,
      },
    })
  } catch (err: any) {
    console.error('[API /api/internal/llm-usage] Error:', err)
    return NextResponse.json({ success: false, error: err?.message || 'Internal error' }, { status: 500 })
  }
}
