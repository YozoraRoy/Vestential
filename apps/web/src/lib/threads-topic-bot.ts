import {
  FallbackClient,
  LLMFactory,
  createQuickLLM,
  dataBlock,
  injectionGuardNote,
  sanitizeDataField,
  type LLMClient,
} from '@stock/ai-engine'
import { loadConfig } from '@stock/core'
import { createSocialPost, dbQueryFirst, getAgentSetting, hasSocialPosted, setAgentSetting, updateSocialPost } from '@stock/database'
import { attachLlmUsageRecorder } from './llm-usage'
import { getSocialAccessToken } from './social-tokens'
import { publishThreadsReply, resolveThreadsPost } from './threads-reply'

const THREADS_API = 'https://graph.threads.net/v1.0'
const BRIGHTDATA_ENDPOINT = 'https://api.brightdata.com/request'
const GOOGLE_CSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1'

export const TOPIC_BOT_ENABLED_KEY = 'social.topic_bot_enabled'
export const TOPIC_BOT_DAILY_LIMIT_KEY = 'social.topic_bot_daily_limit'
export const TOPIC_BOT_KEYWORDS_KEY = 'social.topic_bot_keywords'
export const TOPIC_BOT_QUEUE_KEY = 'social.topic_bot_queue'
export const TOPIC_BOT_PROMPT_KEY = 'social.topic_reply_prompt'
export const TOPIC_BOT_LOGS_KEY = 'social.topic_bot_logs'

export const DEFAULT_TOPIC_BOT_KEYWORDS = ['台股', 'ETF', '存股', '薪水', 'AI股', '美股', '小資理財']
export const DEFAULT_TOPIC_BOT_DAILY_LIMIT = 5
export const TOPIC_REPLY_MIN_CHARS = 12
export const TOPIC_REPLY_MAX_CHARS = 35
export const TOPIC_REPLY_TARGET_DESC = '15～30 字'

export const DEFAULT_TOPIC_REPLY_PROMPT = `你是台灣上班族，正在用自己的帳號滑 Threads，看到別人的貼文想順手留一句有共鳴又好笑的話。

【核心原則（說人話 speak-human-tw）】
1. 先看懂貼文在講什麼，只對「貼文裡真的提到的事」做反應，不自顧自講大道理。
2. 絕對去 AI 味：禁止「值得注意的是」「總的來說」「綜上所述」「不僅…更…」「這意味著」「加油！」這類套話、說教腔或完美收尾；允許口語碎片與自嘲。
3. 台灣日常口語＋全形標點：嚴禁中國用語（視頻、質量、信息量、接地氣、博主），不用「筆者」。
4. 風格：幽默、生活化、像朋友在旁邊嘴一句，帶點小資族／上班族面對物價、投資或工作的苦笑與共鳴。
5. 嚴格禁廣告：絕對不提平台名稱、網址或「歡迎追蹤」「來看看」，單靠這句話本身好笑／有感讓人點進主頁。

【輸出限制】
- 長度嚴格控制在 **15～30 個中文字**（含標點）。
- 最多 0～1 個自然 emoji（禁止 🚀💡🔥 轟炸）。
- 只輸出一行最終回覆正文，不要引號、不要編號、不要任何解釋。`

export interface TopicBotPost {
  id: string
  username: string
  text: string
  permalink: string
  timestamp?: string
  keyword?: string
  postType?: 'reply' | 'rss-post'
}

export interface TopicBotLogEntry {
  at: string
  mediaId: string
  author: string
  permalink: string
  postSnippet: string
  replyText: string
  suitable: boolean
  reason: string
  published: boolean
  dryRun: boolean
  postType?: 'reply' | 'rss-post'
  llmMode: 'free-first' | 'paid-only'
  modelUsed: string
  error?: string
}

export interface TopicBotConfigState {
  enabled: boolean
  dailyLimit: number
  keywords: string[]
  queueUrls: string[]
  todayCount: number
  brightDataConfigured: boolean
  cseConfigured: boolean
  llmMode: 'free-first' | 'paid-only'
  freeLabel: string | null
  paidLabel: string
  logs: TopicBotLogEntry[]
}

const BANNED_SUBSTRINGS = [
  'http://',
  'https://',
  'www.',
  '.com',
  '歡迎追蹤',
  '來看看',
  '點擊主頁',
  '值得注意的是',
  '總的來說',
  '綜上所述',
  '這意味著',
  '視頻',
  '質量',
  '信息量',
  '接地氣',
  '博主',
  '筆者',
]

/** 建立「免費 AI API 優先 → 付費 AI API 備援」的 LLMClient。 */
export function createTopicBotLLM(opts?: { maxTokens?: number }): {
  llm: LLMClient
  mode: 'free-first' | 'paid-only'
  freeLabel: string | null
  paidLabel: string
} {
  const config = loadConfig()
  const maxTokens = opts?.maxTokens ?? 180
  const { llm: paidLlm } = createQuickLLM(config, { maxTokens })
  const paidLabel = `${config.llmProvider}/${config.quickThinkModel}`

  const freeClients: { client: LLMClient; label: string }[] = []

  // 1. 顯式專用免費變數
  const explicitFreeKey = process.env.TOPIC_BOT_FREE_LLM_API_KEY?.trim()
  if (explicitFreeKey) {
    const provider = process.env.TOPIC_BOT_FREE_LLM_PROVIDER?.trim() || 'openai'
    const model = process.env.TOPIC_BOT_FREE_LLM_MODEL?.trim() || 'llama-3.3-70b-versatile'
    const baseUrl =
      process.env.TOPIC_BOT_FREE_LLM_BACKEND_URL?.trim() ||
      (explicitFreeKey.startsWith('gsk_') ? 'https://api.groq.com/openai/v1' : undefined)
    freeClients.push({
      client: LLMFactory.create({ provider, model, apiKey: explicitFreeKey, baseUrl, temperature: 0.85, maxTokens }),
      label: `${provider}/${model} (free)`,
    })
  }

  // 2. 線上既有的 FALLBACK2（Groq 免費 Key #2，避開主系統優先使用的 #1）
  const fb2Key = process.env.FALLBACK2_QUICK_LLM_API_KEY?.trim() || process.env.FALLBACK2_LLM_API_KEY?.trim()
  if (fb2Key) {
    const provider = process.env.FALLBACK2_LLM_PROVIDER?.trim() || 'openai'
    const model = process.env.FALLBACK2_QUICK_THINK_MODEL?.trim() || 'qwen/qwen3.8-27b'
    const baseUrl =
      process.env.FALLBACK2_QUICK_LLM_BACKEND_URL?.trim() ||
      process.env.FALLBACK2_LLM_BACKEND_URL?.trim() ||
      (fb2Key.startsWith('gsk_') ? 'https://api.groq.com/openai/v1' : undefined)
    freeClients.push({
      client: LLMFactory.create({ provider, model, apiKey: fb2Key, baseUrl, temperature: 0.85, maxTokens }),
      label: `groq2/${model} (free)`,
    })
  }

  // 3. 線上既有的 FALLBACK（Groq 免費 Key #1）或 GROQ_API_KEY
  const fb1Key =
    process.env.GROQ_API_KEY?.trim() ||
    process.env.FALLBACK_QUICK_LLM_API_KEY?.trim() ||
    process.env.FALLBACK_LLM_API_KEY?.trim()
  if (fb1Key && fb1Key !== fb2Key) {
    const provider = process.env.GROQ_API_KEY?.trim() ? 'openai' : process.env.FALLBACK_LLM_PROVIDER?.trim() || 'openai'
    const model = process.env.GROQ_API_KEY?.trim()
      ? process.env.TOPIC_BOT_FREE_LLM_MODEL?.trim() || 'llama-3.3-70b-versatile'
      : process.env.FALLBACK_QUICK_THINK_MODEL?.trim() || 'qwen/qwen3.8-27b'
    const baseUrl =
      process.env.FALLBACK_QUICK_LLM_BACKEND_URL?.trim() ||
      process.env.FALLBACK_LLM_BACKEND_URL?.trim() ||
      (fb1Key.startsWith('gsk_') ? 'https://api.groq.com/openai/v1' : undefined)
    freeClients.push({
      client: LLMFactory.create({ provider, model, apiKey: fb1Key, baseUrl, temperature: 0.85, maxTokens }),
      label: `groq1/${model} (free)`,
    })
  }

  // 4. 額外 Google 免費 Key
  const googleFreeKey = process.env.TOPIC_BOT_FREE_GOOGLE_API_KEY?.trim()
  if (googleFreeKey) {
    const model = process.env.TOPIC_BOT_FREE_LLM_MODEL?.trim() || 'gemini-2.5-flash'
    freeClients.push({
      client: LLMFactory.create({ provider: 'google', model, apiKey: googleFreeKey, temperature: 0.85, maxTokens }),
      label: `google/${model} (free)`,
    })
  }

  if (freeClients.length > 0) {
    const [firstFree, ...restFree] = freeClients
    return {
      llm: new FallbackClient(firstFree!.client, [...restFree.map((f) => f.client), paidLlm]),
      mode: 'free-first',
      freeLabel: freeClients.map((f) => f.label).join(' → '),
      paidLabel,
    }
  }

  return {
    llm: paidLlm,
    mode: 'paid-only',
    freeLabel: null,
    paidLabel,
  }
}

/** 驗證回覆是否符合 15~30 字（寬容 12~35 字）與去 AI 味／禁廣告規則。 */
export function validateTopicReplyText(rawText: string): { ok: boolean; cleaned: string; reason?: string } {
  const cleaned = rawText
    .trim()
    .split(/\r?\n/)[0]
    .trim()
    .replace(/^["'“「『]|["'”」』]$/g, '')
    .trim()

  const len = Array.from(cleaned).length
  if (len < TOPIC_REPLY_MIN_CHARS) {
    return { ok: false, cleaned, reason: `字數過短（${len} 字，需至少 ${TOPIC_REPLY_MIN_CHARS} 字）` }
  }
  if (len > TOPIC_REPLY_MAX_CHARS) {
    return { ok: false, cleaned, reason: `字數過長（${len} 字，上限 ${TOPIC_REPLY_MAX_CHARS} 字）` }
  }
  for (const bad of BANNED_SUBSTRINGS) {
    if (cleaned.toLowerCase().includes(bad.toLowerCase())) {
      return { ok: false, cleaned, reason: `包含禁用詞或廣告樣式：${bad}` }
    }
  }
  return { ok: true, cleaned }
}

/** 讀取第 2 小編目前設定與今日已發數量。 */
export async function getTopicBotState(): Promise<TopicBotConfigState> {
  const [rawEnabled, rawLimit, rawKeywords, rawQueue, rawLogs] = await Promise.all([
    getAgentSetting(TOPIC_BOT_ENABLED_KEY).catch(() => null),
    getAgentSetting(TOPIC_BOT_DAILY_LIMIT_KEY).catch(() => null),
    getAgentSetting(TOPIC_BOT_KEYWORDS_KEY).catch(() => null),
    getAgentSetting(TOPIC_BOT_QUEUE_KEY).catch(() => null),
    getAgentSetting(TOPIC_BOT_LOGS_KEY).catch(() => null),
  ])

  const enabled = rawEnabled?.trim().toLowerCase() === 'on'
  const parsedLimit = Number.parseInt(rawLimit ?? '', 10)
  const dailyLimit = Number.isFinite(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 30 ? parsedLimit : DEFAULT_TOPIC_BOT_DAILY_LIMIT
  const keywords = rawKeywords
    ? rawKeywords
        .split(/[,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_TOPIC_BOT_KEYWORDS
  const queueUrls = rawQueue
    ? rawQueue
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  const todayCount = await countTodayTopicBotReplies()
  const { mode, freeLabel, paidLabel } = createTopicBotLLM()
  const logs = parseTopicBotLogs(rawLogs)
  const brightDataConfigured = Boolean(process.env.BRIGHTDATA_API_KEY?.trim() && process.env.BRIGHTDATA_ZONE?.trim())
  const cseConfigured = Boolean(process.env.GOOGLE_CSE_API_KEY?.trim() && process.env.GOOGLE_CSE_ID?.trim())

  return {
    enabled,
    dailyLimit,
    keywords: keywords.length > 0 ? keywords : DEFAULT_TOPIC_BOT_KEYWORDS,
    queueUrls,
    todayCount,
    brightDataConfigured,
    cseConfigured,
    llmMode: mode,
    freeLabel,
    paidLabel,
    logs,
  }
}

export async function saveTopicBotConfig(input: {
  enabled?: boolean
  dailyLimit?: number
  keywords?: string[]
  queueUrls?: string[]
}): Promise<TopicBotConfigState> {
  if (typeof input.enabled === 'boolean') {
    await setAgentSetting({
      key: TOPIC_BOT_ENABLED_KEY,
      value: input.enabled ? 'on' : 'off',
      category: 'social',
      label: '第 2 小編（海巡互動）自動開關',
    })
  }
  if (typeof input.dailyLimit === 'number' && Number.isFinite(input.dailyLimit)) {
    const clamped = Math.max(1, Math.min(30, Math.round(input.dailyLimit)))
    await setAgentSetting({
      key: TOPIC_BOT_DAILY_LIMIT_KEY,
      value: String(clamped),
      category: 'social',
      label: '第 2 小編每日回覆上限',
    })
  }
  if (Array.isArray(input.keywords)) {
    const cleaned = input.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 20)
    if (cleaned.length > 0) {
      await setAgentSetting({
        key: TOPIC_BOT_KEYWORDS_KEY,
        value: cleaned.join(','),
        category: 'social',
        label: '第 2 小編海巡關鍵字',
      })
    }
  }
  if (Array.isArray(input.queueUrls)) {
    const cleanedUrls = Array.from(new Set(input.queueUrls.map((u) => u.trim()).filter(Boolean))).slice(0, 50)
    await setAgentSetting({
      key: TOPIC_BOT_QUEUE_KEY,
      value: cleanedUrls.join('\n'),
      category: 'social',
      label: '第 2 小編免驗證話題佇列',
    })
  }
  return getTopicBotState()
}

function parseTopicBotLogs(raw: string | null | undefined): TopicBotLogEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, 20) : []
  } catch {
    return []
  }
}

async function appendTopicBotLog(entry: TopicBotLogEntry): Promise<void> {
  const existing = parseTopicBotLogs(await getAgentSetting(TOPIC_BOT_LOGS_KEY).catch(() => null))
  const next = [entry, ...existing].slice(0, 20)
  await setAgentSetting({
    key: TOPIC_BOT_LOGS_KEY,
    value: JSON.stringify(next),
    category: 'social',
    label: '第 2 小編最近自動留言紀錄',
  })
}

/** 計算今天（UTC wall-clock 日曆日）已發布的海巡留言數。 */
async function countTodayTopicBotReplies(): Promise<number> {
  const todayWall = `${new Date().toISOString().slice(0, 10)} 00:00:00`
  const row = await dbQueryFirst<{ n: number }>(
    `SELECT COUNT(*) AS n FROM social_posts
     WHERE platform = 'threads'
       AND edition_key LIKE 'topic-reply:%'
       AND status = 'published'
       AND COALESCE(published_at, created_at) >= @since`,
    { since: todayWall },
  ).catch(() => undefined)
  return row?.n ?? 0
}

/** 過濾出外部他人帳號的 Threads /post/ 網址（排除自家帳號與非貼文頁）。 */
export function filterExternalThreadsUrls(urls: string[], ownUsername = 'vestential'): string[] {
  const own = ownUsername.trim().toLowerCase()
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    const u = String(raw || '').trim()
    const m = u.match(/^https?:\/\/(?:www\.)?threads\.(?:net|com)\/@([^/]+)\/post\/([A-Za-z0-9_-]+)/i)
    if (!m) continue
    const author = (m[1] || '').toLowerCase()
    if (!author || author === own) continue
    const normalized = `https://www.threads.net/@${m[1]}/post/${m[2]}`
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

/** 透過 Google Custom Search JSON API（每日免費 100 次）搜尋近 7 天他人公開 Threads 貼文。 */
export async function discoverExternalThreadsUrlsViaGoogleCse(
  keyword: string,
  ownUsername = 'vestential',
): Promise<{ ok: boolean; urls: string[]; cseMissing?: boolean; error?: string }> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY?.trim()
  const cseId = process.env.GOOGLE_CSE_ID?.trim()
  if (!apiKey || !cseId) {
    return {
      ok: false,
      urls: [],
      cseMissing: true,
      error: '尚未設定 GOOGLE_CSE_API_KEY 或 GOOGLE_CSE_ID（請於 Azure App Settings 設定後即可自動搜尋他人 Threads 貼文）',
    }
  }

  const query = `(site:threads.net OR site:threads.com) "${keyword}" "/post/"`
  const url = `${GOOGLE_CSE_ENDPOINT}?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cseId)}&q=${encodeURIComponent(query)}&dateRestrict=d7&num=10`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, urls: [], error: String(json?.error?.message || `Google CSE HTTP ${res.status}`) }
    }
    const rawLinks = Array.isArray(json?.items) ? json.items.map((it: any) => String(it?.link ?? '')) : []
    return { ok: true, urls: filterExternalThreadsUrls(rawLinks, ownUsername) }
  } catch (err: any) {
    return { ok: false, urls: [], error: err?.message || 'Google Custom Search 連線逾時或失敗' }
  }
}

/** 透過 Bright Data SERP API（第一順位）搜尋近 7 天他人公開 Threads 貼文。 */
export async function discoverExternalThreadsUrlsViaBrightData(
  keyword: string,
  ownUsername = 'vestential',
): Promise<{ ok: boolean; urls: string[]; missing?: boolean; error?: string }> {
  const apiKey = process.env.BRIGHTDATA_API_KEY?.trim()
  const zone = process.env.BRIGHTDATA_ZONE?.trim()
  if (!apiKey || !zone) {
    return {
      ok: false,
      urls: [],
      missing: true,
      error: '尚未設定 BRIGHTDATA_API_KEY 或 BRIGHTDATA_ZONE',
    }
  }

  const query = `(site:threads.net OR site:threads.com) "${keyword}" "/post/"`
  const targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbs=qdr:w&hl=zh-TW&gl=tw&brd_json=1`
  try {
    const res = await fetch(BRIGHTDATA_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ zone, url: targetUrl, format: 'raw' }),
      signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, urls: [], error: `Bright Data HTTP ${res.status}: ${text.slice(0, 160)}` }
    }
    const json = JSON.parse(text)
    const organic = Array.isArray(json?.organic) ? json.organic : Array.isArray(json?.results) ? json.results : []
    const rawLinks = organic.map((it: any) => String(it?.link ?? it?.url ?? ''))
    return { ok: true, urls: filterExternalThreadsUrls(rawLinks, ownUsername) }
  } catch (err: any) {
    return { ok: false, urls: [], error: err?.message || 'Bright Data SERP 連線逾時或失敗' }
  }
}

/** 雙層搜尋：Bright Data SERP（優先）→ Google Custom Search API（備選）。 */
export async function discoverExternalThreadsUrls(
  keyword: string,
  ownUsername = 'vestential',
): Promise<{ ok: boolean; urls: string[]; provider?: 'brightdata' | 'google-cse'; error?: string }> {
  const bd = await discoverExternalThreadsUrlsViaBrightData(keyword, ownUsername)
  if (bd.ok && bd.urls.length > 0) {
    return { ok: true, urls: bd.urls, provider: 'brightdata' }
  }

  const cse = await discoverExternalThreadsUrlsViaGoogleCse(keyword, ownUsername)
  if (cse.ok) {
    return { ok: true, urls: cse.urls, provider: 'google-cse' }
  }

  if (bd.missing && cse.cseMissing) {
    return {
      ok: false,
      urls: [],
      error: '尚未設定 BRIGHTDATA_ZONE / BRIGHTDATA_API_KEY 或備選 GOOGLE_CSE_API_KEY / GOOGLE_CSE_ID，請至少完成一組設定（或改用話題佇列貼入網址）',
    }
  }
  return {
    ok: false,
    urls: [],
    error: [bd.missing ? '' : bd.error, cse.cseMissing ? '' : cse.error].filter(Boolean).join(' | ') || '搜尋失敗',
  }
}

/** 透過 Threads Graph API 搜尋公開貼文（需具備 threads_keyword_search 權限）。 */
export async function searchThreadsTopics(
  keyword: string,
  limit = 8,
): Promise<{ ok: boolean; posts: TopicBotPost[]; permissionMissing?: boolean; error?: string }> {
  const { token } = await getSocialAccessToken('threads')
  if (!token) {
    return { ok: false, posts: [], error: 'THREADS_ACCESS_TOKEN 未設定' }
  }

  const url = `${THREADS_API}/keyword_search?q=${encodeURIComponent(keyword)}&search_type=RECENT&fields=id,text,username,permalink,timestamp&limit=${limit}&access_token=${encodeURIComponent(token)}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = String(json?.error?.message || `HTTP ${res.status}`)
      const permissionMissing =
        res.status === 400 || res.status === 403 || /permission|capability|threads_keyword_search|(#10)|(#200)/i.test(msg)
      return { ok: false, posts: [], permissionMissing, error: msg }
    }

    const posts: TopicBotPost[] = (Array.isArray(json?.data) ? json.data : [])
      .filter((p: any) => p?.id && typeof p?.text === 'string' && p.text.trim().length >= 10)
      .map((p: any) => ({
        id: String(p.id),
        username: String(p.username ?? ''),
        text: sanitizeDataField(p.text, 1500),
        permalink: String(p.permalink ?? `https://www.threads.net/t/${p.id}`),
        timestamp: p.timestamp ? String(p.timestamp) : undefined,
        keyword,
      }))

    return { ok: true, posts }
  } catch (err: any) {
    return { ok: false, posts: [], error: err?.message || 'Threads 關鍵字搜尋逾時或失敗' }
  }
}

/** 先以免費 AI 讀文判斷適合度，適合才套用 speak-human-tw 產出 15~30 字回覆。 */
export async function evaluateAndDraftTopicReply(
  post: TopicBotPost,
): Promise<{
  suitable: boolean
  reason: string
  replyText: string
  llmMode: 'free-first' | 'paid-only'
  modelUsed: string
}> {
  const { llm, mode, freeLabel, paidLabel } = createTopicBotLLM({ maxTokens: 200 })
  attachLlmUsageRecorder(llm, 'social.topic-bot')
  const modelHint = mode === 'free-first' ? (freeLabel ?? paidLabel) : paidLabel

  // 第 1 步：讀取貼文判斷是否適合幽默接話
  const evalSystem = [
    '你是台灣社群編輯，要判斷一篇 Threads 貼文是否適合用「15～30字幽默生活化口吻」留言互動。',
    injectionGuardNote(),
    '排除條件（以下一律回 NO）：政治立場爭吵、重大災難或悲傷新聞、純賣貨／直銷／詐騙廣告、無實質內容的抽獎文。',
    '只輸出 JSON：{"suitable": true/false, "reason": "簡短原因"}，不要其他文字。',
  ].join('\n')

  const evalRaw = await llm.generate(evalSystem, dataBlock('thread', post.text, 1200))
  let suitable = false
  let reason = '無法判讀'
  try {
    const match = evalRaw.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match ? match[0] : evalRaw)
    suitable = Boolean(parsed?.suitable)
    reason = String(parsed?.reason ?? (suitable ? '適合互動' : '不適合'))
  } catch {
    suitable = !/NO|不適合|政治|廣告|災難/i.test(evalRaw)
    reason = evalRaw.slice(0, 80)
  }

  if (!suitable) {
    return { suitable: false, reason, replyText: '', llmMode: mode, modelUsed: modelHint }
  }

  // 第 2 步：載入動態託管的 speak-human-tw Prompt 擬稿
  const customPrompt = (await getAgentSetting(TOPIC_BOT_PROMPT_KEY).catch(() => null))?.trim()
  const systemPrompt = [customPrompt || DEFAULT_TOPIC_REPLY_PROMPT, injectionGuardNote()].join('\n\n')

  for (let attempt = 1; attempt <= 2; attempt++) {
    const rawReply = await llm.generate(
      systemPrompt,
      `${dataBlock('thread', post.text, 1200)}\n\n請直接輸出 1 則 15～30 個中文字的幽默人話回覆：`,
    )
    const check = validateTopicReplyText(rawReply)
    if (check.ok) {
      return { suitable: true, reason, replyText: check.cleaned, llmMode: mode, modelUsed: modelHint }
    }
    if (attempt === 2) {
      return {
        suitable: false,
        reason: `回覆未通過品質守門：${check.reason}`,
        replyText: check.cleaned,
        llmMode: mode,
        modelUsed: modelHint,
      }
    }
  }

  return { suitable: false, reason: '擬稿失敗', replyText: '', llmMode: mode, modelUsed: modelHint }
}

/** 執行一輪第 2 小編全自動海巡（或 dryRun / 單篇網址與文字測試）。 */
export async function runTopicBotCycle(options?: {
  dryRun?: boolean
  maxReplies?: number
  manualPost?: TopicBotPost
  manualUrl?: string
  ignoreToggle?: boolean
}): Promise<{
  ok: boolean
  skipped?: string
  searchSelfOnly?: boolean
  permissionMissing?: boolean
  error?: string
  results: TopicBotLogEntry[]
}> {
  const dryRun = options?.dryRun ?? false
  const maxReplies = Math.max(1, Math.min(5, options?.maxReplies ?? 1))
  const state = await getTopicBotState()

  if (!dryRun && !options?.ignoreToggle && !state.enabled) {
    return { ok: true, skipped: '第 2 小編全自動開關目前為關閉 (off)', results: [] }
  }
  if (!dryRun && state.todayCount >= state.dailyLimit) {
    return { ok: true, skipped: `已達今日回覆上限 (${state.todayCount}/${state.dailyLimit})`, results: [] }
  }

  const ownUsername = (process.env.THREADS_USERNAME || 'vestential').toLowerCase()
  let candidates: TopicBotPost[] = []
  let consumedQueueUrl: string | null = null

  if (options?.manualPost) {
    candidates = [options.manualPost]
  } else if (options?.manualUrl?.trim()) {
    const info = await resolveThreadsPost(options.manualUrl.trim())
    if (!info.mediaId && !dryRun) {
      return { ok: false, error: '無法從該網址解析出 Threads mediaId，無法發布回覆。', results: [] }
    }
    candidates = [
      {
        id: info.mediaId || `url-${info.shortcode}`,
        username: info.author || 'threads_user',
        text: info.text,
        permalink: info.permalink,
      },
    ]
  } else if (state.queueUrls.length > 0) {
    // 免 threads_keyword_search 方案：優先消化話題佇列中的公開貼文網址
    for (const url of state.queueUrls) {
      try {
        const info = await resolveThreadsPost(url)
        if (info.mediaId && info.text) {
          candidates = [
            {
              id: info.mediaId,
              username: info.author || 'threads_user',
              text: info.text,
              permalink: info.permalink,
            },
          ]
          consumedQueueUrl = url
          break
        }
      } catch {
        // 單筆解析失敗則跳下一筆
      }
    }
    if (candidates.length === 0) {
      return { ok: false, error: '話題佇列中的網址皆無法解析出 mediaId / 內文', results: [] }
    }
  } else {
    // 雙層搜尋：Bright Data SERP（優先）→ Google CSE（備選）
    const startIdx = new Date().getHours() % state.keywords.length
    const kw = state.keywords[startIdx] ?? DEFAULT_TOPIC_BOT_KEYWORDS[0]!
    const searchRes = await discoverExternalThreadsUrls(kw, ownUsername)
    if (!searchRes.ok) {
      return { ok: false, error: searchRes.error, results: [] }
    }
    for (const url of searchRes.urls) {
      try {
        const info = await resolveThreadsPost(url)
        if (info.mediaId && info.text && info.author.toLowerCase() !== ownUsername) {
          candidates.push({
            id: info.mediaId,
            username: info.author || 'threads_user',
            text: info.text,
            permalink: info.permalink,
            postType: 'reply',
          })
          if (candidates.length >= 3) break
        }
      } catch {
        // 單篇解析失敗則換下一篇
      }
    }
    if (candidates.length === 0) {
      return { ok: false, error: `Google CSE 搜尋「${kw}」未取得可解析出 mediaId 的他人貼文`, results: [] }
    }
  }

  const results: TopicBotLogEntry[] = []
  let publishedCount = 0

  for (const post of candidates) {
    if (publishedCount >= maxReplies) break
    if (!dryRun && state.todayCount + publishedCount >= state.dailyLimit) break
    if (!options?.manualPost && !options?.manualUrl && post.username.toLowerCase() === ownUsername) continue

    const editionKey = `topic-reply:${post.id}`
    if (!dryRun && (await hasSocialPosted('threads', editionKey))) {
      if (consumedQueueUrl) {
        await saveTopicBotConfig({ queueUrls: state.queueUrls.filter((u) => u !== consumedQueueUrl) })
      }
      continue
    }

    const evalRes = await evaluateAndDraftTopicReply(post)
    const entry: TopicBotLogEntry = {
      at: new Date().toISOString(),
      mediaId: post.id,
      author: post.username,
      permalink: post.permalink,
      postSnippet: post.text.slice(0, 80),
      replyText: evalRes.replyText,
      suitable: evalRes.suitable,
      reason: evalRes.reason,
      published: false,
      dryRun,
      postType: 'reply',
      llmMode: evalRes.llmMode,
      modelUsed: evalRes.modelUsed,
    }

    if (evalRes.suitable && evalRes.replyText && !dryRun) {
      try {
        const pub = await publishThreadsReply(evalRes.replyText, post.id)
        const row = await createSocialPost({
          platform: 'threads',
          editionKey,
          content: evalRes.replyText,
          imageUrl: null,
        })
        await updateSocialPost(row.id, {
          status: 'published',
          external_id: pub.replyMediaId,
          published_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        })
        entry.published = true
        entry.permalink = pub.permalink
        publishedCount += 1
        if (consumedQueueUrl) {
          await saveTopicBotConfig({ queueUrls: state.queueUrls.filter((u) => u !== consumedQueueUrl) })
        }
      } catch (err: any) {
        entry.error = err?.message || 'Threads 發布回覆失敗'
      }
    }

    results.push(entry)
    await appendTopicBotLog(entry)
  }

  return { ok: true, results }
}
