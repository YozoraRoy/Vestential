import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  getLlmUsageReport,
  getLlmUsageDailyReport,
  getLlmUsageMinuteReport,
  taipeiTodayStr,
  LLM_USAGE_DAILY_MAX_DAYS,
  migrate,
} from '@stock/database'
import { isAdminUser, getCurrentUserFromReq } from '@/lib/auth'
import { reportServerError } from '@/lib/server-alert'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function addDays(dateStr: string, days: number): string {
  // 台北午夜瞬時＋整日遞進，再還原台北日曆日（直接取 UTC 分量會差一天）。
  const ms = new Date(`${dateStr}T00:00:00+08:00`).getTime() + days * 86_400_000
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  await migrate()
  const user = await getCurrentUserFromReq(req)
  if (!user || !(await isAdminUser(user))) {
    return NextResponse.json({ error: '未登入或無管理員權限' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const view = searchParams.get('view') ?? 'summary'
  const fromParam = searchParams.get('from') ?? undefined
  const toParam = searchParams.get('to') ?? undefined

  // from/to/day 需為 YYYY-MM-DD（台灣時區日期）；格式不合法直接 400。
  const badDate =
    (fromParam && !DATE_RE.test(fromParam)) ||
    (toParam && !DATE_RE.test(toParam)) ||
    (searchParams.get('day') && !DATE_RE.test(searchParams.get('day')!))
  if (badDate) {
    return NextResponse.json({ success: false, error: 'from/to/day 需為 YYYY-MM-DD 格式' }, { status: 400 })
  }

  try {
    // #45 分鐘級 OTPM 估算：單日每分鐘用量 vs 上限（UI 需註明估算值）。
    if (view === 'minute') {
      const day = searchParams.get('day') ?? taipeiTodayStr()
      const report = await getLlmUsageMinuteReport({ day })
      // 單分鐘＞800：沿用 #24 reportServerError 通道告警（30 分鐘同 key 去重）。
      // 無 cron 排程，告警於後台用量頁載入分鐘視角時觸發（fire-and-forget）。
      if (report.overMinutes.length > 0 && report.peak) {
        void reportServerError({
          route: 'GET /api/admin/llm-usage (OTPM near-limit)',
          status: 429,
          error: `OTPM near limit on ${report.day}: peak ${report.peak.totalTokens} tokens/min at ${report.peak.minute} (limit ${report.otpmLimit}, threshold ${report.alertThreshold}); over-threshold minutes: ${report.overMinutes.join(', ')}`,
        })
      }
      return NextResponse.json({ success: true, view: 'minute', ...report })
    }

    // #45 per-agent 每日 in/out 日報表（台北日界；預設近 7 天供趨勢用）。
    if (view === 'daily') {
      const today = taipeiTodayStr()
      const to = toParam ?? today
      const from = fromParam ?? addDays(today, -6)
      const report = await getLlmUsageDailyReport({ from, to })
      return NextResponse.json({ success: true, view: 'daily', ...report })
    }

    if (view !== 'summary') {
      return NextResponse.json({ success: false, error: `未知的 view（summary/daily/minute）：${view}` }, { status: 400 })
    }

    const report = await getLlmUsageReport({ from: fromParam, to: toParam })
    return NextResponse.json({ success: true, ...report })
  } catch (e: any) {
    const message = e?.message ?? 'llm-usage 失敗'
    // 區間上限等用法錯誤 → 400（註明日上限值）。
    const status = /上限|格式|不可晚於|合法日期/.test(message) ? 400 : 500
    return NextResponse.json(
      { success: false, error: `${message}（日報區間上限 ${LLM_USAGE_DAILY_MAX_DAYS} 天）` },
      { status },
    )
  }
}
