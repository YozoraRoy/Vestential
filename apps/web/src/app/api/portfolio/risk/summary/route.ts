import { NextResponse } from 'next/server'
import { createQuickLLM } from '@stock/ai-engine'
import { loadConfig } from '@stock/core'
import { consumeAnalysisQuota, getPortfolioRecords } from '@stock/database'
import { getDailyAnalysisLimit, getCurrentUserFromCookies, getTaiwanDateStr, isAdminUser } from '../../../../../lib/auth'
import { loadRiskSnapshot } from '../../../../../lib/portfolio-risk-server'
import { RISK_DISCLAIMER } from '../../../../../lib/portfolio-risk'
import { reportServerError } from '../../../../../lib/server-alert'

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—'
}

/**
 * POST /api/portfolio/risk/summary — AI 風險描述性總結。
 * - 需登入；與既有 analyze 共用分級 quota（#44：一般每日 1 次／管理員每日 3 次，
 *   consumeAnalysisQuota，不新增額度）。
 * - 情境試算本身零 LLM；此 route 只對已算好的數字做描述性總結。
 * - LLM 失敗 → 回 fallback:true，前端降級只顯示數字表。
 */
export async function POST() {
  try {
    const user = await getCurrentUserFromCookies()
    if (!user) {
      return NextResponse.json({ error: 'login required' }, { status: 401 })
    }

    // #44：分級額度（一般每日 1 次／管理員每日 3 次；客訴文案寫清分級）。
    const quota = await consumeAnalysisQuota(user.id, getTaiwanDateStr(), getDailyAnalysisLimit(await isAdminUser(user)))
    if (!quota.allowed) {
      return NextResponse.json(
        { error: `今日 AI 分析額度已用完（一般用戶每日 1 次／管理員每日 3 次；已用 ${quota.used}/${quota.max}），請明天再試`, quota },
        { status: 429 },
      )
    }

    const snapshot = await loadRiskSnapshot((limit) => getPortfolioRecords(user.id, limit))
    if (snapshot.holdingsCount === 0) {
      return NextResponse.json({ error: '尚無持倉可總結', quota }, { status: 400 })
    }

    const lines: string[] = [`組合風險數據（資料時間 ${snapshot.asOf}）：`]
    for (const g of snapshot.groups) {
      if (g.includedCount === 0) continue
      const ccy = g.market === 'tw' ? 'NTD' : 'USD'
      lines.push(`【${g.market === 'tw' ? '台股' : '美股'}組】持倉 ${g.includedCount} 檔，市值 ${fmt(g.totalMarketValue)} ${ccy}；`)
      lines.push(`權重：${g.weights.map((w) => `${w.symbol} ${fmt(w.weightPct)}%`).join('、')}；Top-1 ${fmt(g.top1Pct)}%、Top-3 ${fmt(g.top3Pct)}%。`)
      lines.push(`產業：${g.sectors.map((s) => `${s.sector} ${fmt(s.weightPct)}%`).join('、')}。`)
      for (const sc of g.scenarios) {
        const name = sc.id === 'market-10' ? '大盤跌10%' : sc.id === 'market-20' ? '大盤跌20%' : `最大產業${sc.targetSector ? `（${sc.targetSector}）` : ''}重挫30%`
        lines.push(`${name}：虧損 ${fmt(sc.lossAmount)} ${ccy}（${fmt(sc.lossPct)}%）。`)
      }
    }

    const systemPrompt = [
      '你是組合風險數據的描述員。只能對提供的數字做描述性總結，嚴禁誇大因果、嚴禁預測、嚴禁給出買賣建議。',
      '以繁體中文（台灣習慣用語）輸出 3~6 句，點出集中度最高的事實與壓力情境下虧損最大的事實即可。',
      '【說人話／去 AI 味】：直陳數字，禁用「值得注意的是」「總結來說」等贅詞，禁用心靈雞湯。',
    ].join('\n')

    try {
      const config = loadConfig()
      const { llm } = createQuickLLM(config, { maxTokens: 500 })
      const summary = await llm.generate(systemPrompt, `${lines.join('\n')}\n\n請輸出描述性總結（純文字，不要 JSON）。`)
      return NextResponse.json({
        success: true,
        summary: summary.trim(),
        disclaimer: RISK_DISCLAIMER,
        dataAsOf: snapshot.asOf,
        quota,
      })
    } catch (llmErr: unknown) {
      const message = llmErr instanceof Error ? llmErr.message : 'AI 摘要失敗'
      console.error('[API/Portfolio/Risk/Summary] LLM failed, degrading to numeric table:', message)
      return NextResponse.json(
        { error: message, fallback: true, disclaimer: RISK_DISCLAIMER, dataAsOf: snapshot.asOf, quota },
        { status: 502 },
      )
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'AI 風險總結失敗'
    // #24：通用位置（第三條驗證 route）→ 後端告警（去重 30min，不含個資）。
    void reportServerError({ route: 'POST /api/portfolio/risk/summary', status: 500, error: message })
    return NextResponse.json({ error: message, fallback: true }, { status: 500 })
  }
}
