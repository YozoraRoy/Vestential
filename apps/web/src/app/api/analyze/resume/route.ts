import { TradingEngine } from '@stock/ai-engine'
import { getAnalysisJobById, updateAnalysisJob, type AnalysisJobAgentState } from '@stock/database'
import { DEFAULT_ANALYSIS_LANGUAGE, type AnalysisLanguage } from '@stock/core'
import { getCurrentUserFromCookies } from '../../../../lib/auth'
import { runAnalysisStream } from '../run-analysis'

let _engine: TradingEngine | null = null
let _engineError: string | null = null

function getEngine(): TradingEngine {
  if (_engineError) throw new Error(_engineError)
  if (_engine) return _engine
  try {
    _engine = new TradingEngine()
    return _engine
  } catch (e: any) {
    _engineError = `TradingEngine init failed: ${e.message}`
    throw new Error(_engineError)
  }
}

/** 從 job 找出要續跑的 agent：優先取 failed_agent，否則取第一個未完成（pending/failed）的 agent。 */
function resolveResumeFrom(
  enabledAgents: string[],
  agentStates: Record<string, AnalysisJobAgentState>,
  failedAgent?: string | null,
): string | null {
  if (failedAgent && enabledAgents.includes(failedAgent)) return failedAgent
  for (const a of enabledAgents) {
    const st = agentStates[a]?.state
    if (!st || st === 'pending' || st === 'failed') return a
  }
  return null
}

export async function POST(req: Request) {
  try {
    const { jobId } = await req.json()
    if (!jobId || !Number.isInteger(Number(jobId))) {
      return new Response(JSON.stringify({ error: 'jobId required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const user = await getCurrentUserFromCookies()
    if (!user) {
      return new Response(JSON.stringify({ error: 'login required' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }

    const job = await getAnalysisJobById(Number(jobId))
    if (!job) {
      return new Response(JSON.stringify({ error: 'analysis job not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }

    // 防越權：job 必須屬於當前使用者
    if (job.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
    }

    // 只有未完成（failed / partial）的 job 可續跑
    if (job.status === 'completed') {
      return new Response(JSON.stringify({ error: 'analysis job already completed' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    if (job.status === 'running') {
      return new Response(JSON.stringify({ error: 'analysis job is still running' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    if (job.status !== 'failed' && job.status !== 'partial') {
      return new Response(JSON.stringify({ error: `analysis job not resumable (status=${job.status})` }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    let enabledAgents: string[] = []
    let agentStates: Record<string, AnalysisJobAgentState> = {}
    let existingState: any = {}
    try {
      enabledAgents = JSON.parse(job.enabled_agents || '[]')
      agentStates = JSON.parse(job.agent_states || '{}')
      existingState = JSON.parse(job.state_snapshot || '{}')
    } catch (e) {
      console.error('[API/Analyze/Resume] Failed to parse job JSON:', e)
      return new Response(JSON.stringify({ error: 'analysis job data corrupted' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    if (enabledAgents.length === 0) {
      return new Response(JSON.stringify({ error: 'analysis job has no enabled agents' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const resumeFrom = resolveResumeFrom(enabledAgents, agentStates, job.failed_agent)
    if (!resumeFrom) {
      return new Response(JSON.stringify({ error: 'analysis job has nothing to resume' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    // 先把 job 標回 running，避免續跑期間被再次續跑（基本併發防護）
    await updateAnalysisJob(job.id, { status: 'running' })

    const outputLanguage: AnalysisLanguage =
      existingState.outputLanguage === 'en' || existingState.outputLanguage === 'ja' || existingState.outputLanguage === 'zh-TW'
        ? existingState.outputLanguage
        : DEFAULT_ANALYSIS_LANGUAGE

    const encoder = new TextEncoder()
    let engine: TradingEngine

    try {
      engine = getEngine()
    } catch (e: any) {
      // 標回 failed，讓使用者可再試
      await updateAnalysisJob(job.id, { status: 'failed' })
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        }

        try {
          await runAnalysisStream({
            engine,
            ticker: job.ticker,
            date: job.date,
            language: outputLanguage,
            enabledAgents,
            jobId: job.id,
            userId: user.id,
            send,
            initialAgentStates: agentStates,
            run: (onProgress, onAgentComplete) =>
              engine.resumeAnalysis(
                {
                  ticker: job.ticker,
                  date: job.date,
                  resumeFrom,
                  existingState,
                  enabledAgents,
                  language: outputLanguage,
                },
                onProgress,
                onAgentComplete,
              ),
          })
        } catch (e: any) {
          send('error', { message: e.message })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}