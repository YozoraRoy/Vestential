import { TradingEngine, type AnalyzeRunResult, type ProgressCallback, type AgentCompleteCallback } from '@stock/ai-engine'
import {
  saveAnalysisRecord,
  updateAnalysisJob,
  type AnalysisJobAgentState,
} from '@stock/database'
import type { AnalysisLanguage } from '@stock/core'

/**
 * AI 分析執行流（/api/analyze 與 /api/analyze/resume 共用）：
 * - 每個 agent 完成：即時更新 analysis_jobs（agent_states + state_snapshot）並推送 SSE 'agent_complete'
 * - 成功：job 更新為 completed、存 analysis_records（status=completed）、推送 SSE 'result'
 * - 任一 agent 失敗：job 更新為 failed（保留已完成進度）、存 analysis_records（status=partial，僅當有已完成 agent）、
 *   推送 SSE 'partial_result'（含已完成 state + 失敗 agent + error + jobId）
 */
export interface StreamRunContext {
  engine: TradingEngine
  ticker: string
  date: string
  language: AnalysisLanguage
  enabledAgents: string[]
  jobId: number
  send: (event: string, data: any) => void
  /**
   * Resume 時從既有 job 讀回的 agent_states，用來 seed 本次 run 的起始狀態，
   * 避免 resume 後 updateAnalysisJob 把先前已完成的 agent 覆蓋成 pending。
   * 新跑（/api/analyze）不傳此參數，agentStates 從空物件起算。
   */
  initialAgentStates?: Record<string, AnalysisJobAgentState>
  /** 實際呼叫 engine 的方式（新跑 vs 續跑差異在此）。 */
  run: (
    onProgress: ProgressCallback,
    onAgentComplete: AgentCompleteCallback,
  ) => Promise<AnalyzeRunResult>
  /**
   * B2 配額失敗退還：新跑（/api/analyze）傳入，失敗分支呼叫退款；
   * 續跑/resume 不傳（本不扣故不退，避免重複退）。
   */
  onFailure?: () => Promise<void> | void
}

export async function runAnalysisStream(ctx: StreamRunContext): Promise<void> {
  const { engine, ticker, date, language, enabledAgents, jobId, send, initialAgentStates } = ctx
  // Resume 時 seed 既有 agent_states，避免覆蓋先前完成的 agent；
  // 新跑時 initialAgentStates 為 undefined，fallback 為空物件（行為不變）。
  const agentStates: Record<string, AnalysisJobAgentState> = { ...initialAgentStates }

  const result = await ctx.run(
    (step, detail) => send('progress', { step, detail }),
    (agent, reportField, content, partialState) => {
      agentStates[agent] = { state: 'completed', reportField, content }
      // fire-and-forget：進度存檔不阻塞 SSE 串流
      void updateAnalysisJob(jobId, {
        agentStates: { ...agentStates },
        stateSnapshot: partialState,
      })
      send('agent_complete', { agent, reportField, content, jobId })
    },
  )

  const modelPlan = engine.getModelPlan()

  // ── 失敗（部分完成）路徑 ──
  if (result.failedAgent) {
    const finalAgentStates: Record<string, AnalysisJobAgentState> = {
      ...agentStates,
      [result.failedAgent]: { state: 'failed', error: result.error || '' },
    }
    for (const a of enabledAgents) {
      if (!finalAgentStates[a]) finalAgentStates[a] = { state: 'pending' }
    }

    try {
      await updateAnalysisJob(jobId, {
        status: 'failed',
        agentStates: finalAgentStates,
        stateSnapshot: result.state,
        failedAgent: result.failedAgent,
        error: result.error || '',
      })
    } catch (e) {
      console.error('[API/Analyze] Failed to update analysis job (partial):', e)
    }

    // 部分完成也存 analysis_records（僅當至少一個 agent 完成；全部失敗則不留歷史）
    if (result.completedAgents.length > 0) {
      const partialPayload = {
        status: 'partial',
        jobId,
        signal: result.signal,
        decision: result.state.finalDecision,
        tokenUsage: result.tokenUsage,
        modelPlan,
        language,
        enabledAgents,
        assetType: result.state.assetType,
        failedAgent: result.failedAgent,
        error: result.error || '',
        reports: {
          market: result.state.marketReport,
          sentiment: result.state.sentimentReport,
          news: result.state.newsReport,
          fundamentals: result.state.fundamentalsReport,
        },
      }
      try {
        const decisionObj = typeof result.state.finalDecision === 'object' ? result.state.finalDecision : {}
        await saveAnalysisRecord({
          ticker,
          recommendation: result.signal || (decisionObj as any)?.rating || (decisionObj as any)?.final_decision || 'Hold',
          summary: (decisionObj as any)?.investmentThesis || (decisionObj as any)?.rationale || (typeof result.state.finalDecision === 'string' ? result.state.finalDecision : '') || '分析未完成（部分完成）',
          fullReport: partialPayload,
          modelUsage: JSON.stringify(result.tokenUsage.agents),
          primaryModels: JSON.stringify(modelPlan),
          fallbackUsed: result.tokenUsage.agents.reduce((n, a) => n + (a.fallbackCalls ?? 0), 0) > 0,
          fallbackCount: result.tokenUsage.agents.reduce((n, a) => n + (a.fallbackCalls ?? 0), 0),
        })
      } catch (dbErr) {
        console.error('[API/Analyze] Failed to save partial analysis record to DB:', dbErr)
      }
    }

    send('partial_result', {
      jobId,
      completedAgents: result.completedAgents,
      failedAgent: result.failedAgent,
      error: result.error || '',
      reports: {
        market: result.state.marketReport,
        sentiment: result.state.sentimentReport,
        news: result.state.newsReport,
        fundamentals: result.state.fundamentalsReport,
      },
    })
    // B2：中途失敗屬技術性失敗，退還本次扣除的配額（呼叫端以 refundOnce 防重複退）。
    if (ctx.onFailure) {
      try {
        await ctx.onFailure()
      } catch (e) {
        console.error('[API/Analyze] onFailure refund failed:', e)
      }
    }
    return
  }

  // ── 成功路徑 ──
  try {
    await updateAnalysisJob(jobId, {
      status: 'completed',
      agentStates: { ...agentStates },
      stateSnapshot: result.state,
    })
  } catch (e) {
    console.error('[API/Analyze] Failed to update analysis job (completed):', e)
  }

  const resultPayload = {
    status: 'completed',
    jobId,
    signal: result.signal,
    decision: result.state.finalDecision,
    tokenUsage: result.tokenUsage,
    modelPlan,
    language,
    enabledAgents,
    assetType: result.state.assetType,
    reports: {
      market: result.state.marketReport,
      sentiment: result.state.sentimentReport,
      news: result.state.newsReport,
      fundamentals: result.state.fundamentalsReport,
    },
  }

  const fallbackCount = result.tokenUsage.agents.reduce((n, a) => n + (a.fallbackCalls ?? 0), 0)

  try {
    const decisionObj = typeof result.state.finalDecision === 'object' ? result.state.finalDecision : {}
    await saveAnalysisRecord({
      ticker,
      recommendation: result.signal || (decisionObj as any)?.rating || (decisionObj as any)?.final_decision || 'Hold',
      summary: (decisionObj as any)?.investmentThesis || (decisionObj as any)?.rationale || (typeof result.state.finalDecision === 'string' ? result.state.finalDecision : ''),
      fullReport: resultPayload,
      modelUsage: JSON.stringify(result.tokenUsage.agents),
      primaryModels: JSON.stringify(modelPlan),
      fallbackUsed: fallbackCount > 0,
      fallbackCount,
    })
  } catch (dbErr) {
    console.error('[API/Analyze] Failed to save analysis record to DB:', dbErr)
  }

  send('result', resultPayload)
}