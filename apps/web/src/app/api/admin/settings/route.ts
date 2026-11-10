import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { listAgentSettings, setAgentSetting, getAgentSetting, migrate } from '@stock/database'
import { isAdminUser, getCurrentUserFromReq } from '@/lib/auth'
import { DEFAULT_AGENT_SETTINGS } from '@/lib/agent-settings'
import { DEFAULT_SOCIAL_PROMPT, DEFAULT_MEME_PROMPT } from '@/lib/social'
import { SYSTEM_PROMPT as MARKET_SELECT_PROMPT, SUMMARY_SYSTEM_PROMPT as MARKET_SUMMARY_PROMPT } from '@/lib/market-focus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 提供後台「看內建預設」參考：各 prompt 欄位的內建 system prompt 原文。 */
const BUILTIN_PROMPTS: Record<string, string | undefined> = {
  'market_focus.select_prompt': MARKET_SELECT_PROMPT,
  'market_focus.summary_prompt': MARKET_SUMMARY_PROMPT,
  'social.ig_prompt': DEFAULT_SOCIAL_PROMPT,
  'social.threads_prompt': DEFAULT_SOCIAL_PROMPT,
  'social.fb_prompt': DEFAULT_SOCIAL_PROMPT,
  'social.meme_prompt': DEFAULT_MEME_PROMPT,
}

// 2026-11 起社群只留 Threads：IG／FB 的文案 prompt 與字數設定暫時從後台隱藏
// （程式與 DB 舊值保留；恢復 IG／FB 時把這裡的 key 移除即可）。
const HIDDEN_SETTING_KEYS = new Set([
  'social.ig_prompt',
  'social.ig_max_chars',
  'social.fb_prompt',
  'social.fb_max_chars',
])

export async function GET(req: NextRequest) {
  await migrate()
  const user = await getCurrentUserFromReq(req)
  if (!user || !(await isAdminUser(user))) {
    return NextResponse.json({ error: '未登入或無管理員權限' }, { status: 401 })
  }
  const url = new URL(req.url)
  const category = url.searchParams.get('category') ?? undefined
  let rows = await listAgentSettings(category).catch(() => [] as any[])
  const present = new Set(rows.map((r) => r.key))
  const merged = Object.entries(DEFAULT_AGENT_SETTINGS)
    .filter(([key]) => !HIDDEN_SETTING_KEYS.has(key))
    .map(([key, meta]) => {
      const existing = present.has(key) ? rows.find((r) => r.key === key) : null
      return {
        key,
        category: meta.category,
        label: meta.label,
        value: existing?.value ?? meta.defaultValue,
        updatedAt: existing?.updated_at ?? null,
        editable: meta.editable !== false,
        help: meta.help ?? null,
        builtinPrompt: BUILTIN_PROMPTS[key] ?? null,
      }
    })
  // 加上 DB 中使用者自行新增、不在預設清單內的設定
  for (const row of rows) {
    if (!DEFAULT_AGENT_SETTINGS[row.key] && !HIDDEN_SETTING_KEYS.has(row.key)) {
      merged.push({
        key: row.key,
        category: row.category ?? 'custom',
        label: row.label ?? row.key,
        value: row.value ?? '',
        updatedAt: row.updated_at ?? null,
        editable: true,
        help: null,
        builtinPrompt: null,
      })
    }
  }
  return NextResponse.json({ success: true, settings: merged })
}

export async function POST(req: NextRequest) {
  await migrate()
  const user = await getCurrentUserFromReq(req)
  if (!user || !(await isAdminUser(user))) {
    return NextResponse.json({ error: '未登入或無管理員權限' }, { status: 401 })
  }
  let body: { key?: string; value?: string; category?: string; label?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid json' }, { status: 400 })
  }
  const key = body.key?.trim()
  if (!key) return NextResponse.json({ success: false, error: 'key required' }, { status: 400 })
  const meta = DEFAULT_AGENT_SETTINGS[key]
  if (meta && meta.editable === false) {
    return NextResponse.json({ success: false, error: `${key} 為唯讀設定，不可修改` }, { status: 400 })
  }
  const value = body.value ?? ''
  await setAgentSetting({
    key,
    value,
    category: body.category || meta?.category || 'custom',
    label: body.label || meta?.label || key,
  })
  const saved = await getAgentSetting(key)
  return NextResponse.json({ success: true, key, value: saved })
}
