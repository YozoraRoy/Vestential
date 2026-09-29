import { NextResponse } from 'next/server'
import { createQuickLLM } from '@stock/ai-engine'
import { loadConfig } from '@stock/core'
import { consumeAnalysisQuota, listTradeJournalEntries } from '@stock/database'
import { getDailyAnalysisLimit, getCurrentUserFromCookies, getTaiwanDateStr, isAdminUser } from '../../../../lib/auth'
import {
  JOURNAL_MIN_REVIEW_COUNT,
  JOURNAL_REVIEW_SYSTEM_PROMPT,
  computeJournalPnl,
  computeJournalStats,
} from '../../../../lib/journal'

/**
 * POST /api/journal/review — AI 交易覆盤（紀律/勝率歸因）。
 * - 需登入；與既有 analyze 共用分級 quota（#44：一般每日 1 次／管理員每日 3 次，
 *   consumeAnalysisQuota，不另開額度）。
 * - <5 筆擋下，提示先記帳（不扣 quota）。
 * - prompt 硬性約束：只准引用日誌原文筆次、禁推論未寫資訊、不輸出未來買賣點。
 * - LLM 失敗 → 回 fallback:true（quota 已扣，與 analyze 行為一致）。
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUserFromCookies()
    if (!user) {
      return NextResponse.json({ error: 'login required' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const month = typeof body?.month === 'string' && body.month.trim() ? body.month.trim() : undefined
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: '月份格式錯誤（請用 YYYY-MM）' }, { status: 400 })
    }

    const entries = await listTradeJournalEntries(user.id, { limit: 500, month })
    if (entries.length < JOURNAL_MIN_REVIEW_COUNT) {
      return NextResponse.json(
        {
          error: `目前僅 ${entries.length} 筆，先記滿 ${JOURNAL_MIN_REVIEW_COUNT} 筆再來覆盤（記帳與統計免費，只有覆盤會扣 AI 額度）`,
          code: 'TOO_FEW_ENTRIES',
          count: entries.length,
          minRequired: JOURNAL_MIN_REVIEW_COUNT,
        },
        { status: 400 },
      )
    }

    // #44：分級額度（一般每日 1 次／管理員每日 3 次；客訴文案寫清分級）。
    const quota = await consumeAnalysisQuota(user.id, getTaiwanDateStr(), getDailyAnalysisLimit(await isAdminUser(user)))
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: `今日 AI 分析額度已用完（一般用戶每日 1 次／管理員每日 3 次；已用 ${quota.used}/${quota.max}），請明天再試`,
          quota,
        },
        { status: 429 },
      )
    }

    const stats = computeJournalStats(entries)
    const entryLines = entries.map((e) => {
      const pnl = computeJournalPnl(e)
      const dir = e.direction === 'short' ? '做空' : '做多'
      const stop = Number(e.stop_loss_obeyed) === 1 ? '有遵守停損' : '未遵守停損'
      return `#${e.id}｜${e.trade_date}｜${e.symbol}｜${dir}｜進場 ${e.entry_price}／出場 ${e.exit_price}｜${e.shares} 股｜損益 ${pnl.toFixed(2)}｜${stop}｜理由原文：「${e.reason}」`
    })

    const userPrompt = [
      `以下為使用者交易日誌共 ${entries.length} 筆${month ? `（${month}）` : ''}：`,
      ...entryLines,
      `統計：勝率 ${stats.winRate?.toFixed(1)}%（${stats.wins} 勝／${stats.losses} 負／共 ${stats.count} 筆），平均每筆損益 ${stats.avgPnl?.toFixed(2)}，停損遵守 ${stats.stopLossObeyedCount} 筆、違反 ${stats.stopLossViolatedCount} 筆。`,
      '請輸出紀律覆盤（含紀律問題 Top-3，每項附筆次引用）。',
    ].join('\n')

    try {
      const config = loadConfig()
      const { llm } = createQuickLLM(config, { maxTokens: 1200 })
      const review = await llm.generate(JOURNAL_REVIEW_SYSTEM_PROMPT, userPrompt)
      return NextResponse.json({
        success: true,
        review: review.trim(),
        stats,
        count: entries.length,
        month: month ?? null,
        quota,
      })
    } catch (llmErr: unknown) {
      const message = llmErr instanceof Error ? llmErr.message : 'AI 覆盤失敗'
      console.error('[API/Journal/Review] LLM failed:', message)
      return NextResponse.json(
        { error: message, fallback: true, stats, count: entries.length, quota },
        { status: 502 },
      )
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'AI 覆盤失敗'
    return NextResponse.json({ error: message, fallback: true }, { status: 500 })
  }
}
