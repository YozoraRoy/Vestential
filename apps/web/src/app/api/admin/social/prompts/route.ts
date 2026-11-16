import { NextResponse, type NextRequest } from 'next/server'
import { getAgentSetting, listAgentSettings, migrate, setAgentSetting } from '@stock/database'
import { getCurrentUserFromReq, isAdminUser } from '@/lib/auth'
import { authorizeSync } from '@/lib/sync-auth'
import { DEFAULT_SOCIAL_PROMPT, DEFAULT_MEME_PROMPT } from '@/lib/social'
import { DEFAULT_FIRST_REPLY_PROMPT } from '@/lib/social-first-reply'
import { DEFAULT_TOPIC_REPLY_PROMPT } from '@/lib/threads-topic-bot'
import { SUMMARY_SYSTEM_PROMPT } from '@/lib/market-focus'
import {
  findSocialPromptDef,
  parsePromptHistory,
  pushPromptHistory,
  SOCIAL_PROMPT_DEFS,
  type SocialPromptId,
} from '@/lib/social-prompts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUILTIN_MAP: Record<SocialPromptId, string> = {
  'news-summary': SUMMARY_SYSTEM_PROMPT,
  'tech-meme': DEFAULT_MEME_PROMPT,
  'first-reply': DEFAULT_FIRST_REPLY_PROMPT,
  'platform-styles': DEFAULT_SOCIAL_PROMPT,
  'topic-reply': DEFAULT_TOPIC_REPLY_PROMPT,
}

async function isAuthorized(req: NextRequest): Promise<{ ok: boolean; actor: string }> {
  if (authorizeSync(req)) {
    return { ok: true, actor: 'ai-control-center' }
  }
  const user = await getCurrentUserFromReq(req)
  if (user && (await isAdminUser(user))) {
    return { ok: true, actor: user.email || `admin#${user.id}` }
  }
  return { ok: false, actor: '' }
}

async function buildPromptPayloads() {
  const allSettings = await listAgentSettings().catch(() => [])
  const byKey = new Map(allSettings.map((r) => [r.key, r]))

  return SOCIAL_PROMPT_DEFS.map((def) => {
    const row = byKey.get(def.settingKey)
    const customValue = row?.value?.trim() ?? ''
    const defaultValue = BUILTIN_MAP[def.id]
    const historyRow = byKey.get(def.historyKey)
    const history = parsePromptHistory(historyRow?.value)

    return {
      id: def.id,
      settingKey: def.settingKey,
      category: def.category,
      label: def.label,
      promptText: customValue || defaultValue,
      defaultPromptText: defaultValue,
      isCustomized: customValue.length > 0,
      updatedAt: row?.updated_at ?? null,
      history,
    }
  })
}

export async function GET(req: NextRequest) {
  await migrate()
  const auth = await isAuthorized(req)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const prompts = await buildPromptPayloads()
  return NextResponse.json({ success: true, prompts })
}

export async function PUT(req: NextRequest) {
  await migrate()
  const auth = await isAuthorized(req)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: { id?: string; promptText?: string; updatedBy?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const def = findSocialPromptDef(String(body.id ?? ''))
  if (!def) {
    return NextResponse.json({ success: false, error: 'Unknown prompt id' }, { status: 400 })
  }

  const nextText = typeof body.promptText === 'string' ? body.promptText.trim() : ''
  const defaultValue = BUILTIN_MAP[def.id]
  // 若傳入與內建預設完全相同的文字，視同重設為預設（清空覆寫值）
  const storedValue = nextText === defaultValue.trim() ? '' : nextText
  const actor = (body.updatedBy ?? auth.actor).slice(0, 64)

  const prevStored = ((await getAgentSetting(def.settingKey).catch(() => null)) ?? '').trim()
  const prevEffective = prevStored || defaultValue.trim()
  const nextEffective = storedValue || defaultValue.trim()

  if (prevEffective !== nextEffective) {
    const rawHist = await getAgentSetting(def.historyKey).catch(() => null)
    const nextHist = pushPromptHistory(parsePromptHistory(rawHist), prevEffective, actor)
    await setAgentSetting({
      key: def.historyKey,
      value: JSON.stringify(nextHist),
      category: 'social',
      label: `${def.label} 歷史`,
    })
  }

  await setAgentSetting({
    key: def.settingKey,
    value: storedValue,
    category: def.category === 'summary' ? 'market-focus' : 'social',
    label: def.label,
  })

  const prompts = await buildPromptPayloads()
  const updated = prompts.find((p) => p.id === def.id)
  return NextResponse.json({ success: true, prompt: updated, prompts })
}

export async function DELETE(req: NextRequest) {
  await migrate()
  const auth = await isAuthorized(req)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const id = new URL(req.url).searchParams.get('id') ?? ''
  const def = findSocialPromptDef(id)
  if (!def) {
    return NextResponse.json({ success: false, error: 'Unknown prompt id' }, { status: 400 })
  }

  const defaultValue = BUILTIN_MAP[def.id]
  const prevStored = ((await getAgentSetting(def.settingKey).catch(() => null)) ?? '').trim()
  if (prevStored) {
    const rawHist = await getAgentSetting(def.historyKey).catch(() => null)
    const nextHist = pushPromptHistory(parsePromptHistory(rawHist), prevStored, auth.actor)
    await setAgentSetting({
      key: def.historyKey,
      value: JSON.stringify(nextHist),
      category: 'social',
      label: `${def.label} 歷史`,
    })
  }

  await setAgentSetting({
    key: def.settingKey,
    value: '',
    category: def.category === 'summary' ? 'market-focus' : 'social',
    label: def.label,
  })
  const prompts = await buildPromptPayloads()
  const updated = prompts.find((p) => p.id === def.id)
  return NextResponse.json({ success: true, prompt: updated, prompts })
}
