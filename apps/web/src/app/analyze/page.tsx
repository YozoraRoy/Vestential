'use client'

import { useState, useRef, useCallback, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BarChart3, Brain, Search as SearchIcon, Clock, History, FileText, ChevronRight, Target, RefreshCw, Trash2, Zap, AlertTriangle } from 'lucide-react'
import { AGENT_KEYS, type AnalysisLanguage } from '@stock/core'
import { SearchBar } from '@/components/search-bar'
import { AnalysisCard } from '@/components/analysis-card'
import { ProgressPanel } from '@/components/progress-panel'
import { AnalysisOptions } from '@/components/analysis-options'
import { AgentReportSection, REPORT_FIELD_TO_AGENT } from '@/components/agent-report-section'
import { useI18n } from '@/i18n/LanguageProvider'
import { localizePath } from '@/i18n/paths'
import type { Dict } from '@/i18n/dictionaries'
import { isTaiwanSymbol, normalizeTaiwanSymbol } from '@/lib/taiwan-symbol'

function formatLLMError(raw: string, dict: Dict): string {
  const ui = dict.analyzePage
  if (/rate.?limit|429|tokens per minute|TPM|exhausted/i.test(raw)) {
    return ui.llmRateLimited
  }
  return raw
}

interface AnalysisRecord {
  id: number
  ticker: string
  recommendation: string
  summary: string
  full_report_json: string
  model_usage?: string
  fallback_count?: number
  created_at: string
}

function AnalyzeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const symbolParam = searchParams.get('symbol') || searchParams.get('stock_id') || ''
  const { locale: language, setLocale: setLanguage, dict } = useI18n()
  const ui = dict.analyzePage

  const [authChecking, setAuthChecking] = useState(true)
  const [analysis, setAnalysis] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [progress, setProgress] = useState<{ step: string; detail: string }[]>([])
  const [historyRecords, setHistoryRecords] = useState<AnalysisRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [enabledAgents, setEnabledAgents] = useState<string[]>([...AGENT_KEYS])
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null)
  const [assetType, setAssetType] = useState<string | null>(null)
  const [liveReports, setLiveReports] = useState<Record<string, { agent: string; content: string }>>({})
  const [jobId, setJobId] = useState<number | null>(null)
  const [partialError, setPartialError] = useState<{ agent: string; error: string } | null>(null)

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 驗證登入狀態：未登入者直接導向登入頁面
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled) return
        if (!data?.success || !data?.user) {
          const currentPath = typeof window !== 'undefined'
            ? window.location.pathname + window.location.search
            : '/analyze'
          router.replace(`/login?redirect=${encodeURIComponent(currentPath)}`)
          return
        }
        setIsAdmin(!!data.user.isAdmin)
        setAuthChecking(false)
      })
      .catch(() => {
        if (cancelled) return
        const currentPath = typeof window !== 'undefined'
          ? window.location.pathname + window.location.search
          : '/analyze'
        router.replace(`/login?redirect=${encodeURIComponent(currentPath)}`)
      })
    return () => {
      cancelled = true
    }
  }, [router])

  const getRecordTokens = (record: AnalysisRecord): number | null => {
    if (record.model_usage) {
      try {
        const agents = JSON.parse(record.model_usage) as { totalTokens?: number }[]
        if (Array.isArray(agents)) {
          const total = agents.reduce((sum, a) => sum + (a.totalTokens ?? 0), 0)
          if (total > 0) return total
        }
      } catch {}
    }
    try {
      const report = JSON.parse(record.full_report_json) as {
        tokenUsage?: { total?: { totalTokens?: number } }
      }
      const total = report?.tokenUsage?.total?.totalTokens
      if (typeof total === 'number' && total > 0) return total
    } catch {}
    return null
  }

  /** 判斷歷史分析紀錄是否為部分完成（full_report_json 內含 status: 'partial'）。 */
  const isPartialRecord = (record: AnalysisRecord): boolean => {
    try {
      const report = JSON.parse(record.full_report_json) as { status?: string }
      return report?.status === 'partial'
    } catch { return false }
  }

  // 讀取歷史分析紀錄 (支援傳入 symbol)
  const fetchHistory = useCallback(async (targetSymbol?: string) => {
    setHistoryLoading(true)
    try {
      const querySymbol = targetSymbol !== undefined ? targetSymbol : symbolParam
      const url = querySymbol
        ? `/api/analysis-records?limit=20&symbol=${encodeURIComponent(querySymbol)}`
        : '/api/analysis-records?limit=20'

      const res = await fetch(url)
      const data = await res.json()
      if (data.success && Array.isArray(data.records)) {
        setHistoryRecords(data.records)

        // 若有過濾特定股票且目前尚未設定報告，自動預載最近一筆報告
        if (querySymbol && data.records.length > 0) {
          try {
            const first = data.records[0]
            const parsed = JSON.parse(first.full_report_json)
            setAnalysis(parsed)
            setSelectedRecordId(first.id)
          } catch (_) {}
        }
      }
    } catch (e) {
      console.error('Failed to load analysis history:', e)
    } finally {
      setHistoryLoading(false)
    }
  }, [symbolParam])

  useEffect(() => {
    if (authChecking) return
    fetchHistory(symbolParam)
  }, [fetchHistory, symbolParam, authChecking])

  // 舊深連結防禦：?symbol=AAPL 等非台股格式顯示同款台股格式錯誤，不自動分析。
  useEffect(() => {
    if (authChecking) return
    if (symbolParam && !isTaiwanSymbol(symbolParam)) {
      setError(dict.analyzePage.invalidTaiwanSymbol)
    } else {
      setError(prev => (prev === dict.analyzePage.invalidTaiwanSymbol ? null : prev))
    }
  }, [symbolParam, authChecking, dict])

  // LLM 重試倒數計時器
  useEffect(() => {
    if (retryCountdown === null || retryCountdown <= 0) return
    retryTimerRef.current = setInterval(() => {
      setRetryCountdown(prev => {
        if (prev === null || prev <= 1) return null
        return prev - 1
      })
    }, 1000)
    return () => { if (retryTimerRef.current) clearInterval(retryTimerRef.current) }
  }, [retryCountdown !== null])

  // 共用 SSE 消費者：解析 progress/agent_complete/partial_result/result/error 事件
  const consumeAnalysisStream = useCallback(async (
    res: Response,
    onStateChange: (s: Partial<{
      progress: { step: string; detail: string }
      agentComplete: { agent: string; reportField: string; content: string; jobId: number }
      partialResult: { jobId: number; failedAgent: string; error: string; reports: Record<string, string> }
      result: any
      error: string
    }>) => void,
  ) => {
    if (!res.body) throw new Error('No response body')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() || ''

      for (const block of blocks) {
        const lines = block.split('\n')
        let eventType = 'message'
        let data = ''

        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7)
          else if (line.startsWith('data: ')) data = line.slice(6)
        }

        if (!data) continue
        const parsed = JSON.parse(data)

        switch (eventType) {
          case 'progress':
            onStateChange({ progress: parsed })
            break
          case 'agent_complete':
            onStateChange({ agentComplete: parsed })
            break
          case 'partial_result':
            onStateChange({ partialResult: parsed })
            break
          case 'result':
            onStateChange({ result: parsed })
            break
          case 'error':
            onStateChange({ error: parsed.message })
            break
        }
      }
    }
  }, [])

  const handleAnalyze = useCallback(async (symbol: string) => {
    if (enabledAgents.length === 0) {
      setError(ui.minAgentError)
      return
    }
    // 台股格式 gate（後端亦有同款防禦）：不符即時顯示三語錯誤，不發 API、不扣 quota。
    const normalizedSymbol = normalizeTaiwanSymbol(symbol)
    if (!isTaiwanSymbol(normalizedSymbol)) {
      setError(ui.invalidTaiwanSymbol)
      return
    }
    symbol = normalizedSymbol
    setLoading(true)
    setAnalysis(null)
    setError(null)
    setProgress([])
    setElapsed(0)
    setSelectedRecordId(null)
    setLiveReports({})
    setPartialError(null)
    setJobId(null)
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({
          symbol,
          date: new Date().toISOString().split('T')[0],
          language,
          agents: enabledAgents,
        }),
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        if (res.status === 401) {
          const redirectUrl = `/login?redirect=${encodeURIComponent(`/analyze?symbol=${encodeURIComponent(symbol)}`)}`
          window.location.href = redirectUrl
          return
        }
        if (res.status === 429) {
          setError(body.error || ui.rateLimitError.replace('{used}', String(body.quota?.used ?? 1)).replace('{max}', String(body.quota?.max ?? 1)))
          return
        }
        // 後端台股門禁（格式／權證）：以後端 code 對應三語文案顯示。
        if (body.code === 'ONLY_STOCK_ETF') {
          setError(ui.onlyStockEtf)
          return
        }
        if (body.code === 'INVALID_TAIWAN_SYMBOL') {
          setError(ui.invalidTaiwanSymbol)
          return
        }
        throw new Error(body.error || `HTTP ${res.status}`)
      }

      await consumeAnalysisStream(res, ({ progress, agentComplete, partialResult, result, error }) => {
        if (progress !== undefined) {
          setProgress(prev => [...prev, progress])
          if (progress.step === 'LLM' && typeof progress.detail === 'string') {
            const m = progress.detail.match(/retrying in (\d+)s/)
            if (m) setRetryCountdown(parseInt(m[1], 10))
          }
          if (progress.step === 'Instrument Classifier' && typeof progress.detail === 'string') {
            const cm = progress.detail.match(/\bas (stock|etf|index)\b/i)
            if (cm) setAssetType(cm[1].toLowerCase())
          }
        }
        if (agentComplete !== undefined) {
          // 即時渲染該 agent 報告
          const agentName = REPORT_FIELD_TO_AGENT[agentComplete.reportField] ?? agentComplete.agent
          setLiveReports(prev => ({ ...prev, [agentName]: { agent: agentName, content: agentComplete.content } }))
          if (agentComplete.jobId) setJobId(agentComplete.jobId)
        }
        if (partialResult !== undefined) {
          setPartialError({ agent: partialResult.failedAgent, error: partialResult.error })
          if (partialResult.jobId) setJobId(partialResult.jobId)
          if (partialResult.reports) {
            // fallback：若 agent_complete 已推送就不重複，未收到時從 reports 補齊
            setLiveReports(prev => {
              const next = { ...prev }
              const mapping: Record<string, string> = {
                market: 'Market Analyst',
                sentiment: 'Sentiment Analyst',
                news: 'News Analyst',
                fundamentals: 'Fundamentals Analyst',
              }
              for (const [field, content] of Object.entries(partialResult.reports)) {
                const agentName = mapping[field]
                if (agentName && !next[agentName]) next[agentName] = { agent: agentName, content }
              }
              return next
            })
          }
        }
        if (result !== undefined) {
          setAnalysis(result)
          setRetryCountdown(null)
          setPartialError(null)
          if (result.assetType) setAssetType(String(result.assetType).toLowerCase())
          fetchHistory()
          window.dispatchEvent(new Event('quota-updated'))
        }
        if (error !== undefined) {
          setError(formatLLMError(error, dict))
          setRetryCountdown(null)
        }
      })
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setError(e.message)
      }
    } finally {
      setLoading(false)
      setRetryCountdown(null)
      if (timerRef.current) clearInterval(timerRef.current)
      if (retryTimerRef.current) clearInterval(retryTimerRef.current)
      abortRef.current = null
    }
  }, [fetchHistory, language, enabledAgents, ui, dict, consumeAnalysisStream])

  // 斷點續跑：呼叫 /api/analyze/resume，SSE 推送與首次分析相同
  const handleResume = useCallback(async (id: number) => {
    setLoading(true)
    setError(null)
    setProgress([])
    setElapsed(0)
    setPartialError(null)
    setJobId(id)
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/analyze/resume', {
        method: 'POST',
        body: JSON.stringify({ jobId: id }),
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        if (res.status === 401) {
          const redirectUrl = `/login?redirect=${encodeURIComponent('/analyze')}`
          window.location.href = redirectUrl
          return
        }
        throw new Error(body.error || `HTTP ${res.status}`)
      }

      await consumeAnalysisStream(res, ({ progress, agentComplete, partialResult, result, error }) => {
        if (progress !== undefined) {
          setProgress(prev => [...prev, progress])
        }
        if (agentComplete !== undefined) {
          const agentName = REPORT_FIELD_TO_AGENT[agentComplete.reportField] ?? agentComplete.agent
          setLiveReports(prev => ({ ...prev, [agentName]: { agent: agentName, content: agentComplete.content } }))
          if (agentComplete.jobId) setJobId(agentComplete.jobId)
        }
        if (partialResult !== undefined) {
          setPartialError({ agent: partialResult.failedAgent, error: partialResult.error })
        }
        if (result !== undefined) {
          setAnalysis(result)
          setRetryCountdown(null)
          setPartialError(null)
          if (result.assetType) setAssetType(String(result.assetType).toLowerCase())
          fetchHistory()
          window.dispatchEvent(new Event('quota-updated'))
        }
        if (error !== undefined) {
          setError(formatLLMError(error, dict))
          setRetryCountdown(null)
        }
      })
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setError(e.message)
      }
    } finally {
      setLoading(false)
      setRetryCountdown(null)
      if (timerRef.current) clearInterval(timerRef.current)
      if (retryTimerRef.current) clearInterval(retryTimerRef.current)
      abortRef.current = null
    }
  }, [fetchHistory, dict, consumeAnalysisStream])

  const handleToggleAgent = useCallback((key: string) => {
    setEnabledAgents(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    )
  }, [])

  const handleToggleAll = useCallback((enabled: boolean) => {
    setEnabledAgents(enabled ? [...AGENT_KEYS] : [])
  }, [])

  // 點擊歷史紀錄載入該報告
  const handleSelectHistoryRecord = (record: AnalysisRecord) => {
    try {
      const parsedReport = JSON.parse(record.full_report_json)
      setAnalysis(parsedReport)
      setSelectedRecordId(record.id)
      window.scrollTo({ top: 300, behavior: 'smooth' })
    } catch (e) {
      console.error('Failed to parse historical report JSON:', e)
    }
  }

  // 刪除歷史分析紀錄（僅管理者）
  const handleDeleteRecord = async (record: AnalysisRecord) => {
    if (!window.confirm(`確定要刪除 ${record.ticker} 的分析紀錄 (Record #${record.id}) 嗎？此操作無法復原。`)) {
      return
    }
    try {
      const res = await fetch(`/api/analysis-records/${record.id}`, { method: 'DELETE' })
      if (res.status === 401) {
        const redirectUrl = `/login?redirect=${encodeURIComponent('/analyze')}`
        window.location.href = redirectUrl
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || ui.deleteFailed.replace('{status}', String(res.status)))
        return
      }
      if (selectedRecordId === record.id) {
        setAnalysis(null)
        setSelectedRecordId(null)
      }
      fetchHistory()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60

  const getRecommendationBadge = (rec: string) => {
    const r = (rec || '').toUpperCase()
    if (r.includes('BUY') || r.includes('OVERWEIGHT')) {
      return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    } else if (r.includes('SELL') || r.includes('UNDERWEIGHT')) {
      return 'bg-rose-500/20 text-rose-400 border-rose-500/30'
    }
    return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
  }

  if (authChecking) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-24 text-center">
        <div className="inline-flex flex-col items-center justify-center p-8 rounded-2xl bg-[var(--bg-card)] border border-white/5 shadow-xl">
          <RefreshCw className="w-8 h-8 text-[var(--accent)] animate-spin mb-4" />
          <p className="text-base font-medium text-[var(--text-primary)] mb-1">
            {dict.common?.loading || '載入中...'}
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            驗證會員登入狀態中...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-[var(--bg-card)] rounded-xl p-4 border border-white/5">
          <BarChart3 className="w-5 h-5 text-[var(--accent)] mb-2" />
          <div className="text-sm text-[var(--text-secondary)]">{ui.statMarkets}</div>
          <div className="text-lg font-semibold">{ui.statMarketsValue}</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl p-4 border border-white/5">
          <Brain className="w-5 h-5 text-[var(--accent-green)] mb-2" />
          <div className="text-sm text-[var(--text-secondary)]">{ui.statAiLabel}</div>
          <div className="text-lg font-semibold">{ui.statAiValue.replace('{n}', String(enabledAgents.length))}</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl p-4 border border-white/5">
          <Clock className="w-5 h-5 text-[var(--accent)] mb-2" />
          <div className="text-sm text-[var(--text-secondary)]">{ui.statEstTime}</div>
          <div className="text-lg font-semibold">{ui.statEstTimeValue}</div>
        </div>
      </div>

      <SearchBar onSearch={handleAnalyze} loading={loading} />

      {assetType && (
        <div className="mt-3">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
              assetType === 'etf'
                ? 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30'
                : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            {assetType === 'etf' ? ui.agentClassifiedEtf : assetType === 'index' ? ui.agentClassifiedIndex : ui.agentClassifiedStock}
          </span>
        </div>
      )}

      <AnalysisOptions
        language={language}
        onLanguageChange={setLanguage}
        enabledAgents={enabledAgents}
        onToggleAgent={handleToggleAgent}
        onToggleAll={handleToggleAll}
        disabled={loading}
      />

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {(loading || partialError) && (
          <div className="lg:col-span-1">
            <ProgressPanel
              progress={progress}
              enabledAgents={enabledAgents}
              failedAgentError={partialError?.error ?? null}
            />
            {Object.values(liveReports).length > 0 && (
              <div className="mt-4 space-y-4">
                {Object.values(liveReports).map(({ agent, content }) => (
                  <AgentReportSection key={agent} agent={agent} content={content} />
                ))}
              </div>
            )}
          </div>
        )}

        <div className={(loading || partialError) ? 'lg:col-span-2' : 'lg:col-span-3'}>
          {loading && (
            <div className="bg-[var(--bg-card)] rounded-xl p-4 border border-white/5 mb-6">
              {retryCountdown !== null ? (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                    <span className="text-sm font-medium text-amber-400">
                      {ui.runningRetry.replace('{n}', String(retryCountdown))}
                    </span>
                  </div>
                  <div className="w-full bg-white/5 rounded-full h-1.5 mt-2">
                    <div
                      className="bg-amber-400 h-1.5 rounded-full transition-all duration-1000"
                      style={{ width: `${(retryCountdown / (retryCountdown + 1)) * 100}%` }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 bg-[var(--accent)] rounded-full animate-pulse" />
                    <span className="text-sm font-medium">
                      {ui.runningTitle.replace('{m}', String(minutes)).replace('{s}', String(seconds).padStart(2, '0'))}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {ui.runningSubtitle}
                  </div>
                </>
              )}
            </div>
          )}

          {analysis && (
            <div className="space-y-4">
              {selectedRecordId && (
                <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 rounded-lg text-emerald-400 text-xs">
                  <span>{ui.historyLoaded.replace('{id}', String(selectedRecordId))}</span>
                  <button 
                    onClick={() => setSelectedRecordId(null)}
                    className="hover:underline text-[var(--text-secondary)]"
                  >
                    {ui.historyLoadedClose}
                  </button>
                </div>
              )}
              <AnalysisCard analysis={analysis} />
            </div>
          )}

          {error && (
            <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
              {ui.errorPrefix}{error}
            </div>
          )}

          {!error && partialError && jobId !== null && (
            <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span className="text-sm font-medium text-red-400">
                  {ui.agentFailed}：{partialError.agent}
                </span>
              </div>
              <div className="text-xs text-red-400/80 mb-1">
                {ui.partialComplete}
              </div>
              <div className="text-xs text-[var(--text-secondary)] mb-3 break-all">
                {partialError.error}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => handleResume(jobId)}
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-white font-medium text-xs hover:opacity-90 transition disabled:opacity-50"
                >
                  <RefreshCw className="w-4 h-4" />
                  {ui.continueRunning}
                </button>
                {/* 續跑沿用已完成的報告，不重算不重計費 */}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 📜 歷史 AI 分析報告區塊 */}
      <div className="mt-12 border-t border-white/10 pt-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-[var(--accent)]" />
            <h2 className="text-xl font-bold">
              {symbolParam ? ui.historyTitleSymbol.replace('{symbol}', symbolParam) : ui.historyTitleAll}
            </h2>
          </div>
          
          <div className="flex items-center gap-3">
            {symbolParam && (
              <a
                href={localizePath(language, '/analyze')}
                className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1 bg-[var(--accent)]/10 border border-[var(--accent)]/20 px-2.5 py-1 rounded-lg"
              >
                <span>{ui.clearSymbolView}</span>
              </a>
            )}
            <button
              onClick={() => fetchHistory()}
              disabled={historyLoading}
              className="text-xs text-[var(--text-secondary)] hover:text-white transition-colors flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${historyLoading ? 'animate-spin' : ''}`} />
              <span>{historyLoading ? ui.refreshing : ui.refresh}</span>
            </button>
          </div>
        </div>

        {historyRecords.length === 0 ? (
          <div className="bg-[var(--bg-card)] rounded-xl p-8 border border-white/5 text-center text-sm text-[var(--text-secondary)]">
            {symbolParam ? (
              <div className="space-y-3">
                <p className="font-medium text-white text-base">{ui.noHistoryFor.replace('{symbol}', symbolParam)}</p>
                <p className="text-xs">{ui.noHistoryHint.replace('{symbol}', symbolParam)}</p>
                <button
                  onClick={() => handleAnalyze(symbolParam)}
                  disabled={loading}
                  className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-white font-medium text-xs hover:opacity-90 transition"
                >
                  <Brain className="w-4 h-4" />
                  <span>{ui.analyzeNowFor.replace('{symbol}', symbolParam)}</span>
                </button>
              </div>
            ) : (
              ui.noHistoryTitle
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {historyRecords.map(record => {
              const recordTokens = getRecordTokens(record)
              return (
              <div
                key={record.id}
                onClick={() => handleSelectHistoryRecord(record)}
                className={`bg-[var(--bg-card)] hover:bg-white/5 transition-all cursor-pointer rounded-xl p-4 border ${
                  selectedRecordId === record.id
                    ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]'
                    : 'border-white/5 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[var(--text-secondary)]" />
                    <span className="font-bold text-lg">{record.ticker}</span>
                    {isPartialRecord(record) && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        {ui.jobPartial}
                      </span>
                    )}
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getRecommendationBadge(record.recommendation)}`}>
                    {record.recommendation}
                  </span>
                </div>

                {record.summary && (
                  <p className="text-xs text-[var(--text-secondary)] line-clamp-2 mb-3">
                    {record.summary}
                  </p>
                )}

                <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)] border-t border-white/5 pt-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="whitespace-nowrap">{record.created_at}</span>
                    {recordTokens !== null && (
                      <span
                        className="inline-flex items-center gap-1 whitespace-nowrap text-[var(--accent)]"
                        title={ui.tokenHint}
                      >
                        <Zap className="w-3 h-3" />
                        {ui.tokenCount.replace('{n}', recordTokens.toLocaleString())}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdmin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteRecord(record)
                        }}
                        className="flex items-center gap-1 text-rose-400/80 hover:text-rose-400 transition-colors"
                        title={ui.deleteRecordTitle}
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>{ui.deleteRecord}</span>
                      </button>
                    )}
                    <span className="flex items-center gap-0.5 text-[var(--accent)] hover:underline whitespace-nowrap">
                      {ui.viewFullReport} <ChevronRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AnalyzePage() {
  const { dict } = useI18n()
  return (
    <Suspense fallback={
      <div className="max-w-6xl mx-auto px-4 py-16 text-center text-sm text-[var(--text-secondary)]">
        {dict.analyzePage.loadingAnalyze}
      </div>
    }>
      <AnalyzeContent />
    </Suspense>
  )
}
