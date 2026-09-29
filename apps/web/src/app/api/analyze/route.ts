import { TradingEngine } from '@stock/ai-engine'
import { saveAnalysisJob, consumeAnalysisQuota } from '@stock/database'
import { yahooFinanceProvider } from '@stock/market-data'
import {
  DEFAULT_ANALYSIS_LANGUAGE,
  AGENT_KEYS,
  AGENT_KEY_SET,
  type AnalysisLanguage,
} from '@stock/core'
import { getDailyAnalysisLimit, getCurrentUserFromCookies, getTaiwanDateStr, isAdminUser } from '../../../lib/auth'
import { isTaiwanSymbol, normalizeTaiwanSymbol } from '../../../lib/taiwan-symbol'
import { runAnalysisStream } from './run-analysis'

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

/** 三語併陳（前台另以 code 對應當地語系文案；此原文保底亦含三語關鍵字）。 */
const INVALID_TAIWAN_SYMBOL_MSG =
  '請輸入台股代號（4~6 碼數字，可附 .TW / .TWO），例如 2330 或 2330.TW｜Taiwan stock code only (4–6 digits, optional .TW / .TWO), e.g. 2330｜台湾株コードのみ（4〜6 桁、.TW / .TWO 可、例 2330）'
const ONLY_STOCK_ETF_MSG =
  '僅支援上市櫃股票與 ETF｜Taiwan-listed stocks and ETFs only｜台湾上場株式と ETF のみ対応'

/**
 * 權證／牛熊證門禁：以後端 Yahoo `quoteType` 為準（`EQUITY`／`ETF` 放行，其餘擋）。
 * 查無 quoteType（搜尋 miss／逾時／錯誤）時 fail-open，讓 engine 的 Early-Exit Guard 接手，
 * 避免 Yahoo 短暫異常誤擋合法台股。
 */
async function isBlockedNonEquityEtf(normalized: string): Promise<boolean> {
  const candidates = /^\d{4,6}$/.test(normalized)
    ? [`${normalized}.TW`, `${normalized}.TWO`]
    : [normalized]
  let sawKnown = false
  for (const candidate of candidates) {
    try {
      const profile = await withTimeout(
        yahooFinanceProvider.getProfile(candidate, 'TW'),
        8000,
      )
      const quoteType = (profile?.quoteType ?? '').toUpperCase()
      if (!quoteType) continue
      sawKnown = true
      if (quoteType === 'EQUITY' || quoteType === 'ETF') return false
    } catch {
      // 單一候選查詢失敗 → 試下一個候選
    }
  }
  return sawKnown
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('quoteType lookup timeout')), ms)
    p.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

export async function POST(req: Request) {
  try {
    const { symbol, date, language, agents } = await req.json()

    // `/analyze` 僅限台股：格式 gate（quota 扣除前，不建 job）。
    const normalized = typeof symbol === 'string' ? normalizeTaiwanSymbol(symbol) : ''
    if (!normalized || !isTaiwanSymbol(normalized)) {
      return new Response(
        JSON.stringify({ error: INVALID_TAIWAN_SYMBOL_MSG, code: 'INVALID_TAIWAN_SYMBOL' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const outputLanguage: AnalysisLanguage =
      language === 'en' || language === 'ja' || language === 'zh-TW' ? language : DEFAULT_ANALYSIS_LANGUAGE

    const enabledAgents = Array.isArray(agents)
      ? agents.filter((a: unknown): a is string => typeof a === 'string' && AGENT_KEY_SET.has(a))
      : [...AGENT_KEYS]

    if (enabledAgents.length === 0) {
      return new Response(JSON.stringify({ error: '至少需要啟用一個 Agent 才能進行 AI 分析。' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const user = await getCurrentUserFromCookies()
    if (!user) {
      return new Response(JSON.stringify({ error: 'login required' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }

    // 權證／牛熊證 gate（quota 扣除前，不建 job、不寫 records）。
    if (await isBlockedNonEquityEtf(normalized)) {
      return new Response(
        JSON.stringify({ error: ONLY_STOCK_ETF_MSG, code: 'ONLY_STOCK_ETF' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Quota 扣除時機：僅首次執行扣額度（續跑走 /api/analyze/resume，不重扣）。
    // #44：分級額度（一般每日 1 次／管理員每日 3 次；客訴文案寫清分級）。
    const quota = await consumeAnalysisQuota(user.id, getTaiwanDateStr(), getDailyAnalysisLimit(await isAdminUser(user)))
    if (!quota.allowed) {
      return new Response(
        JSON.stringify({
          error: `今日 AI 分析額度已用完（一般用戶每日 1 次／管理員每日 3 次；已用 ${quota.used}/${quota.max}），請明天再試`,
          quota,
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const encoder = new TextEncoder()
    let engine: TradingEngine

    try {
      engine = getEngine()
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    // 先建 job 再開始串流：失敗/中斷時可從 analysis_jobs 續跑
    const jobId = await saveAnalysisJob({
      userId: user.id,
      ticker: normalized,
      date: date ?? new Date().toISOString().split('T')[0],
      enabledAgents,
    })

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        }

        try {
          const tradeDate = date ?? new Date().toISOString().split('T')[0]
          await runAnalysisStream({
            engine,
            ticker: normalized,
            date: tradeDate,
            language: outputLanguage,
            enabledAgents,
            jobId,
            send,
            run: (onProgress, onAgentComplete) =>
              engine.analyze(
                normalized,
                tradeDate,
                onProgress,
                { language: outputLanguage, enabledAgents, onAgentComplete },
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
