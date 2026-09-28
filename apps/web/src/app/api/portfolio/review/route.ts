import { NextResponse } from 'next/server'
import { createQuickLLM } from '@stock/ai-engine'
import { loadConfig } from '@stock/core'
import { consumeAnalysisQuota, getAgentSetting, getPortfolioRecords } from '@stock/database'
import { DAILY_ANALYSIS_LIMIT, getCurrentUserFromCookies, getTaiwanDateStr } from '../../../../lib/auth'
import { DEFAULT_FEE_DISCOUNT, computeNetPnL } from '../../../../lib/portfolio-net'
import {
  PORTFOLIO_MIN_REVIEW_COUNT,
  PORTFOLIO_REVIEW_SYSTEM_PROMPT,
  computePortfolioReviewStats,
  filterPortfolioReviewByMonth,
} from '../../../../lib/portfolio-review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/portfolio/review — 持倉歷史整體覆盤（Issue #43）。
 *
 * 選邊：新建 portfolio 專用 route（不沿用 app/api/journal/review/route.ts）。
 * 理由：
 * 1. 資料來源不同表：此處讀 portfolio_records（getPortfolioRecords），
 *    journal review 讀 trade_journal（listTradeJournalEntries），欄位完全不同
 *    （歷史紀錄無 方向／理由／停損 欄位），沿用會污染 journal 語意與錯誤碼；
 * 2. 篩選維度不同：此處支援 month／all 兩檔（created_at 前綴），journal 只吃 month；
 * 3. /journal 本次不碰（out-of-scope），新建 route 可獨立演進且不影響 journal。
 *
 * - 需登入（未登入 401）；與 journal 覆盤共用每日 3 次 quota
 *  （consumeAnalysisQuota，不另開額度；純統計走前端純算，不打此 API、不扣 quota）。
 * - <5 筆擋下（code TOO_FEW_ENTRIES，不扣 quota）。
 * - prompt 硬性約束：只准引用歷史紀錄既有欄位、禁臆測未寫資訊、不輸出未來買賣點。
 * - LLM 失敗 → 回 fallback:true（quota 已扣，與 journal review 行為一致）。
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUserFromCookies()
    if (!user) {
      return NextResponse.json({ error: 'login required' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const rawMonth = typeof body?.month === 'string' ? body.month.trim() : ''
    const month = rawMonth === '' || rawMonth === 'all' ? undefined : rawMonth
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: '月份格式錯誤（請用 YYYY-MM）' }, { status: 400 })
    }

    const allRecords = await getPortfolioRecords(user.id, 500)
    const records = filterPortfolioReviewByMonth(allRecords, month ?? 'all')
    if (records.length < PORTFOLIO_MIN_REVIEW_COUNT) {
      return NextResponse.json(
        {
          error: `目前僅 ${records.length} 筆，先記滿 ${PORTFOLIO_MIN_REVIEW_COUNT} 筆再來覆盤（記帳與統計免費，只有覆盤會扣 AI 額度）`,
          code: 'TOO_FEW_ENTRIES',
          count: records.length,
          minRequired: PORTFOLIO_MIN_REVIEW_COUNT,
        },
        { status: 400 },
      )
    }

    const quota = await consumeAnalysisQuota(user.id, getTaiwanDateStr(), DAILY_ANALYSIS_LIMIT)
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: `今日 AI 分析額度已用完（${quota.used}/${quota.max}），請明天再試`,
          code: 'QUOTA_EXCEEDED',
          quota,
        },
        { status: 429 },
      )
    }

    // 稅費淨損益試算折讓：沿用後台 portfolio.fee_discount（同 fee-discount route 讀法）。
    let discount = DEFAULT_FEE_DISCOUNT
    try {
      const raw = await getAgentSetting('portfolio.fee_discount').catch(() => null)
      const n = raw == null || raw === '' ? NaN : Number(raw)
      if (Number.isFinite(n) && n >= 0 && n <= 1) discount = n
    } catch {
      // DB 失敗兜底預設值，不炸版
    }

    const stats = computePortfolioReviewStats(records)
    const entryLines = records.map((r) => {
      const pnl = typeof r.total_return === 'number' && Number.isFinite(r.total_return)
        ? r.total_return
        : (r.unrealized_pnl ?? 0) + (r.dividend ?? 0)
      const net = computeNetPnL({
        market: r.market, symbol: r.symbol, shares: r.shares,
        cost: r.cost, currentPrice: r.current_price, discount,
      }).netPnl
      const strategy = r.strategy ?? '未標註策略'
      const rating = r.recommendation ? `AI 評級 ${r.recommendation}` : '無 AI 評級'
      const summary = r.summary ? `摘要「${r.summary}」` : '無摘要'
      return `#${r.id}｜${r.market === 'us' ? '美股' : '台股'}｜${r.symbol}｜${r.shares} 股｜成本 ${r.cost}／現價 ${r.current_price}｜配息 ${r.dividend}｜含息賺賠 ${pnl.toFixed(2)}｜稅費淨 ${net.toFixed(2)}｜策略 ${strategy}｜${rating}｜${summary}`
    })

    const userPrompt = [
      `以下為使用者 portfolio 歷史紀錄共 ${records.length} 筆${month ? `（${month}）` : '（全部）'}：`,
      ...entryLines,
      `統計：共 ${stats.count} 筆，勝率 ${stats.winRate?.toFixed(1)}%（${stats.wins} 勝／${stats.losses} 負），平均每筆賺賠 ${stats.avgPnl?.toFixed(2)}，總賺賠 ${stats.totalPnl.toFixed(2)}。`,
      '請輸出持倉歷史整體覆盤（含紀律問題 Top-3，每項附筆次引用）。',
    ].join('\n')

    try {
      const config = loadConfig()
      const { llm } = createQuickLLM(config, { maxTokens: 1200 })
      const review = await llm.generate(PORTFOLIO_REVIEW_SYSTEM_PROMPT, userPrompt)
      return NextResponse.json({
        success: true,
        review: review.trim(),
        stats,
        count: records.length,
        month: month ?? null,
        quota,
      })
    } catch (llmErr: unknown) {
      const message = llmErr instanceof Error ? llmErr.message : 'AI 覆盤失敗'
      console.error('[API/Portfolio/Review] LLM failed:', message)
      return NextResponse.json(
        { error: message, fallback: true, stats, count: records.length, quota },
        { status: 502 },
      )
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'AI 覆盤失敗'
    return NextResponse.json({ error: message, fallback: true }, { status: 500 })
  }
}
