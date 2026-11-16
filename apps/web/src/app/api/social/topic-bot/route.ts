import { NextResponse, type NextRequest } from 'next/server'
import { migrate } from '@stock/database'
import { getCurrentUserFromReq, isAdminUser } from '@/lib/auth'
import { authorizeSync } from '@/lib/sync-auth'
import {
  getTopicBotState,
  runTopicBotCycle,
  saveTopicBotConfig,
  searchThreadsTopics,
  type TopicBotPost,
} from '@/lib/threads-topic-bot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function isAuthorized(req: NextRequest): Promise<boolean> {
  if (authorizeSync(req)) return true
  const user = await getCurrentUserFromReq(req)
  return !!(user && (await isAdminUser(user)))
}

export async function GET(req: NextRequest) {
  await migrate()
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const keyword = req.nextUrl.searchParams.get('q')?.trim()
  if (keyword) {
    const searchRes = await searchThreadsTopics(keyword, 8)
    return NextResponse.json({ success: searchRes.ok, ...searchRes })
  }

  const state = await getTopicBotState()
  return NextResponse.json({ success: true, state })
}

export async function PUT(req: NextRequest) {
  await migrate()
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: { enabled?: boolean; dailyLimit?: number; keywords?: string[]; queueUrls?: string[] } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const state = await saveTopicBotConfig(body)
  return NextResponse.json({ success: true, state })
}

export async function POST(req: NextRequest) {
  await migrate()
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    dryRun?: boolean
    maxReplies?: number
    ignoreToggle?: boolean
    manualUrl?: string
    manualText?: string
    manualMediaId?: string
    manualAuthor?: string
    manualPermalink?: string
  } = {}
  try {
    body = await req.json()
  } catch {
    // 允許空 body（排程直接 POST）
  }

  let manualPost: TopicBotPost | undefined
  if (body.manualText?.trim()) {
    manualPost = {
      id: body.manualMediaId?.trim() || `manual-${Date.now()}`,
      username: body.manualAuthor?.trim() || 'threads_user',
      text: body.manualText.trim(),
      permalink: body.manualPermalink?.trim() || 'https://www.threads.net/',
    }
  }

  const cycle = await runTopicBotCycle({
    dryRun: body.dryRun ?? false,
    maxReplies: body.maxReplies ?? 1,
    ignoreToggle: body.ignoreToggle ?? false,
    manualUrl: body.manualUrl,
    manualPost,
  })
  const state = await getTopicBotState()
  return NextResponse.json({ success: cycle.ok, ...cycle, state })
}
