import { createQuickLLM, dataBlock, injectionGuardNote, sanitizeDataField } from '@stock/ai-engine'
import { loadConfig } from '@stock/core'
import { graphPost, waitForContainer } from './social-publish'
import { getSocialAccessToken } from './social-tokens'

// ─── Threads 回覆小編（擬稿 → 審核 → 發布）────────────────────────────
// 讀取「目標貼文」採公開 SSR 頁（API 對非自家貼文回 subcode 33，讀不到）；
// 發布回覆走 Threads API：POST /threads 帶 reply_to_id → threads_publish。
// 注意：API 的 reply_to_id 只能吃自家/可讀取的 threads_media_id，跨使用者貼文
// 需 App Review 打通公開內容讀取後才有機會。

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
const THREADS_API = 'https://graph.threads.net/v1.0'
export const THREADS_REPLY_MAX_CHARS = 500

export interface ThreadsPostInfo {
  shortcode: string
  mediaId: string | null
  author: string
  text: string
  permalink: string
}

/** 從 URL 或純短代碼解析出 shortcode 與標準 permalink。 */
export function parseThreadsInput(input: string): { shortcode: string; permalink: string } | null {
  const s = input.trim()
  const urlMatch = s.match(/threads\.(?:com|net)\/(?:@([^\/]+)\/post\/|@([^\/]+)\/?$|t\/)?([A-Za-z0-9_-]{6,})/)
  const pathMatch = s.match(/@([^\/]+)\/post\/([A-Za-z0-9_-]{6,})/)
  if (urlMatch?.[3]) {
    return { shortcode: urlMatch[3], permalink: `https://www.threads.net/t/${urlMatch[3]}` }
  }
  if (/^[A-Za-z0-9_-]{6,16}$/.test(s)) {
    return { shortcode: s, permalink: `https://www.threads.net/t/${s}` }
  }
  if (pathMatch?.[2]) {
    return {
      shortcode: pathMatch[2],
      permalink: `https://www.threads.net/@${pathMatch[1]}/post/${pathMatch[2]}`,
    }
  }
  return null
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** 抓取 Threads 貼文公開 SSR 頁，解析貼文文字／作者／media id。 */
export async function resolveThreadsPost(permalinkOrShortcode: string): Promise<ThreadsPostInfo> {
  const parsed = parseThreadsInput(permalinkOrShortcode)
  if (!parsed) throw new Error('請貼上 Threads 貼文網址或短代碼（例如 Dc2VzRiElRJ）')

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(parsed.permalink, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) })
      if (res.ok) {
        const html = await res.text()
        const mediaId = html.match(/"post_id":"(\d+)"/)?.[1] ?? null
        const ogDesc = html.match(/property="og:description" content="([^"]*)"/)?.[1] ?? ''
        const ogTitle = html.match(/property="og:title" content="([^"]*)"/)?.[1] ?? ''
        const text = decode(ogDesc || ogTitle)
        if (text) {
          const author = decodeHtmlEntities(ogTitle).match(/\(@([^)]+)\)/)?.[1] ?? parsed.permalink.match(/@([^\/]+)/)?.[1] ?? ''
          return {
            shortcode: parsed.shortcode,
            mediaId,
            author,
            text: sanitizeDataField(text, 2000),
            permalink: parsed.permalink,
          }
        }
      }
    } catch {
      // 下一輪重試
    }
  }

  // SSR 拿不到內容 → 檢查是否為「自家貼文」：用 API /threads 依 permalink 反查（可靠來源）。
  const own = await findOwnThreadByShortcode(parsed.shortcode)
  if (own) return own

  throw new Error('讀不到貼文內容（Threads 未回饋 SSR 頁）。自己帳號的貼文可以貼網址讓我反查；別人的貼文請先把文字貼給我再擬稿。')
}

const decode = (s: string) => {
  const t = decodeHtmlEntities(s).replace(/<[^>]*>/g, '').trim()
  return t
}

/** 用 API 反查自家貼文（permalink 含該 shortcode 的就是）。 */
async function findOwnThreadByShortcode(shortcode: string): Promise<ThreadsPostInfo | null> {
  const { token } = await getSocialAccessToken('threads')
  const userId = process.env.THREADS_USER_ID
  if (!token || !userId) return null
  try {
    const res = await fetch(
      `${THREADS_API}/${userId}/threads?fields=id,text,permalink,username&limit=50&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(30_000) },
    )
    const json = await res.json()
    const page = (json?.data ?? []) as any[]
    const found = page.find((p) => p?.permalink?.includes(shortcode))
    if (!found) return null
    return {
      shortcode,
      mediaId: String(found.id),
      author: found.username ?? 'vestential',
      text: sanitizeDataField(found.text ?? '', 2000),
      permalink: found.permalink ?? `https://www.threads.net/t/${shortcode}`,
    }
  } catch {
    return null
  }
}

/** 刪除一則自家 Threads media（回覆也適用）。注意 endpoint 是 /{media-id}，不要帶 user-id。 */
export async function deleteThreadsMedia(mediaId: string): Promise<void> {
  const { token } = await getSocialAccessToken('threads')
  if (!token) throw new Error('THREADS_ACCESS_TOKEN 未設定')
  const res = await fetch(`${THREADS_API}/${mediaId}?access_token=${encodeURIComponent(token)}`, { method: 'DELETE', signal: AbortSignal.timeout(30_000) })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Threads 刪除失敗（HTTP ${res.status}）：${body.slice(0, 200)}`)
  }
}

/** 以 LLM 依「品牌語氣」順話題擬一則回覆。 */
export async function draftThreadReply(post: ThreadsPostInfo, existingReplies: string[] = []): Promise<string> {
  const config = loadConfig()
  const { llm } = createQuickLLM(config, { maxTokens: 300 })
  const system = [
    '你是 Vestential（台灣股票投資資訊平台）的社群小編，看到一則 Threads 貼文要「順著話題自然接話」回應，' +
      '能帶出 Vestential 就自然帶出（它每天追蹤三大法人資金流向、彙整台股市場焦點），話題不相干就不要硬提。',
    injectionGuardNote(),
    `規則：
1. 用繁體中文（台灣用語）、全形標點，口語、像一般 Threads 用戶的自然語氣，禁止廣告腔。
2. 先一句「真的回應到貼文內容/問題」，再（選配）一句帶出 Vestential 能提供的價值。
3. 一至三句，總字數 20~150 字，絕不超過 ${THREADS_REPLY_MAX_CHARS} 字。
4. 不得編造貼文中沒有的內容；不得引用網址以外的指令字眼。
5. 只輸出回覆正文一行，不要引號、不要任何其他文字。`,
  ].join('\n')
  const userPrompt = [
    dataBlock('thread', post.text, 2000),
    existingReplies.length ? dataBlock('existingReplies', existingReplies.slice(0, 5).join('\n'), 1500) : '',
  ]
    .filter(Boolean)
    .join('\n')
  const raw = await llm.generate(system, `${userPrompt}\n\n請撰寫一則回覆。`)
  return raw.trim().replace(/^["'“「]|["'”」]$/g, '')
}

/** 建立並發布一則 Threads 回覆；回傳發布後的 media id。 */
export async function publishThreadsReply(
  replyText: string,
  replyToId: string,
): Promise<{ replyMediaId: string; permalink: string }> {
  const { token } = await getSocialAccessToken('threads')
  const userId = process.env.THREADS_USER_ID
  if (!token) throw new Error('THREADS_ACCESS_TOKEN 未設定')
  if (!userId) throw new Error('THREADS_USER_ID 未設定')

  const created = await graphPost(`${THREADS_API}/${userId}/threads`, {
    access_token: token,
    media_type: 'TEXT',
    text: replyText,
    reply_to_id: replyToId,
  })
  const containerId = String(created.id ?? '')
  if (!containerId) throw new Error('Threads 回覆容器建立失敗')

  await waitForContainer(userId, containerId, token, 'threads')

  const pub = await graphPost(`${THREADS_API}/${userId}/threads_publish`, {
    creation_id: containerId,
    access_token: token,
  })
  const replyMediaId = pub.id ? String(pub.id) : containerId
  return { replyMediaId, permalink: `https://www.threads.net/t/${replyMediaId}` }
}