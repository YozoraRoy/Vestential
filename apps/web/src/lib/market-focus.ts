import { load } from 'cheerio'
import { createQuickLLM, FALLBACK_SAFE_MAX_TOKENS, chunkByOutputBudget, mergeChunkEntries, sleep, getChainPaceMs, getSummaryPaceMs } from '@stock/ai-engine'
import { loadConfig } from '@stock/core'
import { getAgentSetting } from '@stock/database'
import type { MarketFocusItem } from '@stock/database'
import { saveMarketFocus, saveMarketFocusMeta, getMarketFocus, getMarketFocusMeta, logMarketFocusEvent } from '@stock/database'
import { attachLlmUsageRecorder } from '@/lib/llm-usage'

// ─── 候選新聞來源設定 (多來源聚合池) ─────────────────────────────
// 1. 鉅亨網 (Anue Cnyes)：台股、外匯、頭條
const CNYES_CATS = ['tw_stock', 'forex', 'headline']
const CNYES_SOURCE = '鉅亨網'

// 2. 經濟日報 (UDN Money)：全台最大財經紙媒焦點與重大要聞
const UDN_RSS_URLS = [
  'https://money.udn.com/rssfeed/news/1001/5588', // 焦點頭條
  'https://money.udn.com/rssfeed/news/1001/5589', // 產經重大
]

// 3. Yahoo 奇摩股市：全台最大財經聚合台（涵蓋中央社/非凡/時報/工商等）
const YAHOO_STOCK_RSS = 'https://tw.stock.yahoo.com/rss?category=tw-market'

const USER_AGENT = 'Mozilla/5.0 (Vestential MultiSource MarketFocus/1.0)'
const MAX_CANDIDATES = 60
const RECENT_DAYS = 2
const MAX_CONTENT_CHARS = 4000

// ─── Issue #39：各抓取來源明確 timeout ──────────────────────────────
// 定罪（9/26 Azure docker log）：run mf_1790436657772 在 stage=pipeline 內
// 25 分鐘零輸出後被看門狗中止。LLM 每次呼叫有 180s abort、article 抓取有
// 10s timeout＋失敗 log，皆不可能靜默 25 分鐘；唯一能靜默無限 hang 的是
// fetchCnyesNews 內無 signal 的裸 fetch（TCP 半開即無限等待），且
// Promise.allSettled 會被它拖住整個抓取段。故各來源一律帶明確 timeout。
// UDN 10s／Yahoo 6s 為既有值；cnyes 與 UDN 對齊取 10s（與線上已驗證值一致）。

/** 把 LLM 例外轉成可寫入日誌的結構（個別欄位截斷避免塞爆 detail 欄位）。 */
function formatErrorDetail(e: unknown): Record<string, unknown> {
  const err = (e ?? {}) as { message?: string; code?: string; stack?: string; status?: unknown }
  const part: Record<string, unknown> = {
    type: typeof e === 'object' && e !== null ? (e as { constructor?: { name?: string } }).constructor?.name ?? 'unknown' : typeof e,
  }
  if (typeof err.message === 'string' && err.message) part.message = err.message.slice(0, 800)
  if (typeof err.code === 'string' && err.code) part.code = err.code
  if (err.status != null) part.status = String(err.status)
  if (typeof err.stack === 'string' && err.stack) {
    part.stack = err.stack.split('\n').slice(0, 6).join('\n').slice(0, 1200)
  }
  return part
}

// ─── 候選池解析器 (JSON-LD & RSS) ────────────────────────────────
function parseCnyesJsonLd(html: string): NewsCandidate[] {
  const out: NewsCandidate[] = []
  const scripts = html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)
  for (const m of scripts) {
    try {
      const j = JSON.parse(m[1]) as { mainEntity?: { itemListElement?: unknown[] } }
      const list = j?.mainEntity?.itemListElement
      if (!Array.isArray(list)) continue
      for (const x of list) {
        const it = (x as { item?: Record<string, unknown> }).item ?? (x as Record<string, unknown>)
        const url = typeof it?.url === 'string' ? it.url : ''
        const headline = typeof it?.headline === 'string' ? it.headline : ''
        const publishedAt = typeof it?.datePublished === 'string' ? it.datePublished : ''
        if (!url || !headline) continue
        out.push({
          title: headline.replace(/\s*\|\s*鉅亨網.*$/, '').trim(),
          url,
          source: CNYES_SOURCE,
          publishedAt,
        })
      }
    } catch {
      // 忽略無法解析的 JSON-LD 區塊
    }
  }
  return out
}

function parseRssXml(xml: string, defaultSource: string): NewsCandidate[] {
  const out: NewsCandidate[] = []
  try {
    const $ = load(xml, { xmlMode: true })
    $('item').each((_, el) => {
      const rawTitle = $(el).find('title').text().trim()
      const rawLink = $(el).find('link').text().trim()
      const pubDate = $(el).find('pubDate').text().trim()
      if (!rawTitle || !rawLink) return

      // 清理標題尾端後綴（如 " - Yahoo 奇摩股市"、" | 經濟日報"）
      const cleanTitle = rawTitle
        .replace(/\s*[-–|]\s*(Yahoo.*|經濟日報.*|鉅亨網.*)$/i, '')
        .trim()

      const mediaSource = $(el).find('source').text().trim() || defaultSource

      out.push({
        title: cleanTitle,
        url: rawLink,
        source: mediaSource,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      })
    })
  } catch (err) {
    console.warn(`[MarketFocus] parseRssXml error (${defaultSource}):`, err)
  }
  return out
}

async function fetchCnyesNews(): Promise<NewsCandidate[]> {
  const seen = new Set<string>()
  const out: NewsCandidate[] = []
  for (const cat of CNYES_CATS) {
    try {
      const res = await fetch(`https://news.cnyes.com/news/cat/${cat}`, {
        headers: { 'user-agent': USER_AGENT },
        cache: 'no-store',
        // 與 UDN/Yahoo 對齊：無超時會在對方 TCP hang 時卡死整條 pipeline（2026-09-26 job 卡 running 滿 25 分鐘）
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        console.warn(`[MarketFocus] cnyes cat=${cat} failed (${res.status})`)
        continue
      }
      for (const c of parseCnyesJsonLd(await res.text())) {
        if (seen.has(c.url)) continue
        seen.add(c.url)
        out.push(c)
        if (out.length >= 25) return out
      }
    } catch (e) {
      console.warn(`[MarketFocus] cnyes cat=${cat} fetch error:`, e)
    }
  }
  return out
}

async function fetchUdnNews(): Promise<NewsCandidate[]> {
  const out: NewsCandidate[] = []
  for (const url of UDN_RSS_URLS) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
      })
      if (!res.ok) continue
      const candidates = parseRssXml(await res.text(), '經濟日報')
      out.push(...candidates)
    } catch (e) {
      console.warn(`[MarketFocus] UDN fetch error (${url}):`, e)
    }
  }
  return out
}

async function fetchYahooStockNews(): Promise<NewsCandidate[]> {
  try {
    const res = await fetch(YAHOO_STOCK_RSS, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    })
    if (!res.ok) return []
    return parseRssXml(await res.text(), 'Yahoo股市')
  } catch (e) {
    console.warn('[MarketFocus] Yahoo Stock RSS fetch error:', e)
    return []
  }
}

/** 多來源新聞聚合候選池：聚合 鉅亨網 + 經濟日報 + Yahoo 股市 (含中央社/非凡等)，並去重與清洗。 */
export async function fetchMultiSourceCandidates(): Promise<NewsCandidate[]> {
  const [cnyes, udn, yahoo] = await Promise.allSettled([
    fetchCnyesNews(),
    fetchUdnNews(),
    fetchYahooStockNews(),
  ])

  const all: NewsCandidate[] = [
    ...(cnyes.status === 'fulfilled' ? cnyes.value : []),
    ...(udn.status === 'fulfilled' ? udn.value : []),
    ...(yahoo.status === 'fulfilled' ? yahoo.value : []),
  ]

  const seenUrls = new Set<string>()
  const seenTitles = new Set<string>()
  const unique: NewsCandidate[] = []

  for (const item of all) {
    if (!item.url || !item.title) continue
    const cleanUrl = item.url.split('?')[0].split('#')[0]
    const titleKey = item.title.replace(/\s+/g, '').slice(0, 16)

    if (seenUrls.has(cleanUrl) || seenTitles.has(titleKey)) continue
    seenUrls.add(cleanUrl)
    seenTitles.add(titleKey)
    unique.push(item)
    if (unique.length >= MAX_CANDIDATES) break
  }

  return unique
}

// ─── 全文抓取(robots 檢查 + cheerio 抽正文) ─────────────────────
const robotsCache = new Map<string, { rules: string[]; fetchedAt: number }>()

function parseRobotsTxt(text: string): string[] {
  const disallows: string[] = []
  let agent = ''
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const m = /^([^:]+):\s*(.*)$/.exec(s)
    if (!m) continue
    const field = m[1].trim().toLowerCase()
    const value = m[2].trim()
    if (field === 'user-agent') {
      agent = value.toLowerCase()
    } else if (field === 'disallow' && agent === '*' && value) {
      disallows.push(value)
    }
  }
  return disallows
}

/** 依 robots.txt 判斷指定網址是否允許抓取;紀錄使用 User-Agent: *。 */
async function isAllowedByRobots(target: string): Promise<boolean> {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return true
  }
  if (url.origin.startsWith('https://www.google.com') || url.origin.startsWith('https://news.google.com')) return true
  const now = Date.now()
  const cached = robotsCache.get(url.origin)
  let rules: string[]
  if (cached && now - cached.fetchedAt < 10 * 60 * 1000) {
    rules = cached.rules
  } else {
    try {
      const res = await fetch(url.origin + '/robots.txt', {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(5000),
      })
      rules = res.ok ? parseRobotsTxt(await res.text()) : []
    } catch {
      rules = []
    }
    robotsCache.set(url.origin, { rules, fetchedAt: now })
  }
  const path = url.pathname + url.search
  return !rules.some((d) => path.startsWith(d))
}

function extractLongestParagraph($: ReturnType<typeof load>): string {
  let best = ''
  $('p').each((_, el) => {
    const t = $(el).text().trim()
    if (t.length > best.length) best = t
  })
  return best
}

const ARTICLE_FETCH_RETRIES = 2
const ARTICLE_FETCH_BASE_DELAY_MS = 800

/** 對短暫性失敗(網路錯誤、429/408/5xx)做重試;4xx 其他狀態不重試直接回傳。 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= ARTICLE_FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, init)
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)) {
        return res
      }
      lastErr = new Error(`HTTP ${res.status}`)
    } catch (e) {
      lastErr = e
    }
    if (attempt < ARTICLE_FETCH_RETRIES) {
      const delay = ARTICLE_FETCH_BASE_DELAY_MS * attempt
      console.warn(`[MarketFocus] article fetch attempt ${attempt} failed, retrying in ${delay}ms: ${url}`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('article fetch failed')
}

/** 抓取文章全文並解析原始來源 URL;失敗或 robots 拒絕時各自回傳 null。 */
export async function fetchArticleContent(url: string): Promise<{ content: string | null; sourceUrl: string | null }> {
  try {
    const res = await fetchWithRetry(url, {
      headers: { 'user-agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { content: null, sourceUrl: url }
    const finalUrl = res.url || url
    // 立即 buffer body，避免 Node.js undici 在 redirect 追蹤時消費 body stream
    // 導致後續 res.text() 拋出 "Body has already been read"
    const html = await res.text()
    if (!(await isAllowedByRobots(finalUrl))) {
      console.log(`[MarketFocus] robots.txt disallows crawling: ${finalUrl}`)
      return { content: null, sourceUrl: finalUrl }
    }
    const $ = load(html)
    $('script, style, noscript, nav, footer, aside, form, iframe, svg, .ad, .ads, .advert, [class*="ad-"], [class*="advertisement"], [id*="ad-"]').remove()

    let text = ''
    $('article').first().find('p, h2, h3, li').each((_, el) => {
      const t = $(el).text().trim()
      if (t.length > 10) text += t + '\n'
    })
    if (text.length < 200) {
      text = ''
      $('main p, .article-content p, .story-content p, .post-content p, .caas-body p, .article-body__editor p').each((_, el) => {
        const t = $(el).text().trim()
        if (t.length > 10) text += t + '\n'
      })
    }
    if (text.length < 200) text = extractLongestParagraph($)

    const clean = text.replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CONTENT_CHARS)
    return { content: clean || null, sourceUrl: finalUrl }
  } catch (e) {
    console.error('[MarketFocus] article fetch failed after retries:', url, e)
    // 保留原始新聞網址,讓清單仍能呈現有效直連連結,而不是存入 NULL
    return { content: null, sourceUrl: url }
  }
}

// ─── 當日 AI 總覽 ────────────────────────────────────────────────
export const SUMMARY_SYSTEM_PROMPT = `你是 Vestential 的市場焦點主筆。請根據今日精選新聞，為投資人撰寫一份精簡、客觀、說人話的「當日市場總覽」（約 250~400 字）。

核心原則（參考 speak-human-tw 去 AI 味規範，嚴格執行）：
1. 開門見山：第一句直接切入今日市場發生的核心事實或關鍵數據，嚴禁「今天的市場氛圍有點...的味道」、「在瞬息萬變的市場中」等公式化開場。
2. 禁絕說教與身分腔：嚴禁出現「不過，作為價值投資者，我們必須保持冷靜」、「我們要學會...」等人生導師式說教；只客觀陳述事實、產業變化與數據關聯。
3. 剔除贅詞與 AI 慣用語：
   - 嚴禁使用「值得注意的是」、「不可否認的是」、「這意味著」、「相反地」、「說到底」。
   - 避免「不是 A 而是 B」的刻意對比句式。
   - 避免假坦白鉤子（「說真的」、「老實說」）。
4. 自然收尾，禁止罐頭總結：分析寫完即可自然結束，嚴禁在文末使用「總結來說」、「總的來說」、「綜上所述」、「機會在於...風險在於...」等套版公式。
5. 在地化與專業性：使用繁體中文台灣金融語境，全形標點（，。！？），數字及英文代碼前後保留半形空格，不用中國用語（如接地氣、質素、打法等）。
6. 聚焦價值核心：關注基本面動能、實質營收獲利、總經數據（就業/通膨/利率）與資金流向，精準傳達重點。
7. 只輸出 JSON，不要任何其他文字：{"summary":"..."}`

/** 每日總覽安全預算上限（總覽約 200~300 字，450 token 即可容納，避免佔滿 Groq OTPM=1000 限額）。 */
const DAILY_SUMMARY_SAFE_MAX_TOKENS = 450

/** 依精選新聞生成當日市場總覽;失敗時以新聞標題兜底。 */
export async function generateDailySummary(items: MarketFocusItem[]): Promise<string> {
  let threw = false
  try {
    const config = loadConfig()
    // 透過 createQuickLLM 帶上 fallback chain:primary(OpenAI)被配額 429 封鎖時自動切換備援模型
    const rawToken = (await getAgentSetting('market_focus.summary_max_tokens')) ?? ''
    const maxTokens =
      Number(rawToken) > 0 ? Math.min(Number(rawToken), FALLBACK_SAFE_MAX_TOKENS) : DAILY_SUMMARY_SAFE_MAX_TOKENS
    const { llm } = createQuickLLM(config, { maxTokens })
    attachLlmUsageRecorder(llm, 'market-focus.summary')
    const promptOverride = (await getAgentSetting('market_focus.summary_prompt')) ?? ''
    const system = promptOverride ? `${SUMMARY_SYSTEM_PROMPT}\n\n【後台覆寫指示】\n${promptOverride}` : SUMMARY_SYSTEM_PROMPT
    const list = items.map((it, i) => `${i + 1}. [${it.source}] ${it.title}${it.reason ? `（選取理由：${it.reason}）` : ''}`).join('\n')
    const raw = await llm.generate(system, `以下是今日精選新聞：\n${list}\n\n請撰寫當日市場總覽。`)
    let rawText = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    // Gemini 等模型常在 JSON 物件後附加說明文字：只取 { ... } 本體再 parse
    const first = rawText.indexOf('{')
    const last = rawText.lastIndexOf('}')
    if (first !== -1 && last > first) rawText = rawText.slice(first, last + 1)
    const parsed = JSON.parse(rawText) as { summary?: string }
    const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : ''
    if (summary) return summary
  } catch (e) {
    threw = true
    console.error('[MarketFocus] daily summary failed, falling back to headlines:', e)
    await logMarketFocusEvent({
      source: 'daily_summary',
      level: 'error',
      code: 'LLM_FALLBACK',
      message: '每日總覽 LLM 主模型與備援皆失敗，以新聞標題拼接呈現（isSummaryFallback 會為 true）',
      detail: formatErrorDetail(e),
    })
  }
  if (!threw) {
    await logMarketFocusEvent({
      source: 'daily_summary',
      level: 'warn',
      code: 'LLM_EMPTY_RESULT',
      message: '每日總覽 LLM 回傳空值或 JSON 缺 summary 欄位，以新聞標題拼接呈現',
    })
  }
  return `當日市場焦點：${items.map((it) => it.title).join('；')}`
}

export interface NewsCandidate {
  title: string
  url: string
  source: string
  publishedAt: string
}

/** 轉成可排序的 ISO 字串;無法解析時回傳空字串。 */
function toIsoDate(publishedAt: string): string {
  const dt = new Date(publishedAt)
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString()
}

export const SYSTEM_PROMPT = `你是 Vestential(台灣股票投資資訊平台)的總編輯。Vestential 的精神是「價值投資」:重視基本面、長期累積、投資紀律、以及用簡單指標(如季線乖離)判斷市場位置。你負責為市場焦點挑選新聞。

規則:
1. 從候選清單中挑選「最符合價值投資精神」的 10 則。
2. 領域平衡偏好：盡量兼顧「半導體/科技硬體」、「傳產/金融/綠能重電」、「總體經濟/利率政策」等不同面向，避免單一族群過度集中。
3. 排除:短線明牌、個股炒作、小道消息、未證實的利多利空、娛樂/八卦,或與台灣投資無關的新聞。
4. 每則給一句 30 字以內的繁體中文理由，說明它為何值得看。說人話，直陳核心基本面或實質影響，嚴禁「值得注意的是」、「不可否認」等空泛廢話。
5. 同時為每則輸出新聞影響結構化欄位（Issue #19：供新聞卡呈現，同一 LLM 呼叫內完成，不新增 quota 消耗）：
   - impact_direction：三選一 positive（偏多）/ negative（偏空）/ neutral（中性）
   - scope：影響範圍，20 字內（如「台股大盤」「半導體族群」「個股」）
   - horizon：影響時程，15 字內（如「短線數日」「中期數季」）
   - affected_sectors：受影響族群或產業，30 字內、逗號分隔
   - action：投資人可做的關注行動，30 字內、非投資建議（如「追蹤下季法說營收指引」）
   - related_symbols：標題提及的台股代號，4~6 碼數字、逗號分隔（如「2330,2317」）；無則空字串
6. 只輸出 JSON，不要任何其他文字:
{"selected":[{"index":0,"reason":"...","impact_direction":"neutral","scope":"...","horizon":"...","affected_sectors":"...","action":"...","related_symbols":""}]}`

function buildUserPrompt(candidates: NewsCandidate[]): string {
  const list = candidates
    .map((c, i) => `${i}. [${c.source}] ${c.title}`)
    .join('\n')
  return `以下是候選新聞(共 ${candidates.length} 則):\n${list}\n\n請選出符合原則的 10 則。`
}

interface SelectEntry {
  index: number
  reason: string
  impact_direction?: unknown
  scope?: unknown
  horizon?: unknown
  affected_sectors?: unknown
  action?: unknown
  related_symbols?: unknown
}

/** Issue #19 新聞影響結構化欄位（filterNewsByAI 與 generateArticleSummaries 共用輸出）。 */
export interface NewsImpact {
  impact_direction: 'positive' | 'negative' | 'neutral' | null
  scope: string | null
  horizon: string | null
  affected_sectors: string | null
  action: string | null
  related_symbols: string | null
}

export const EMPTY_IMPACT: NewsImpact = {
  impact_direction: null,
  scope: null,
  horizon: null,
  affected_sectors: null,
  action: null,
  related_symbols: null,
}

const IMPACT_DIRECTIONS = new Set(['positive', 'negative', 'neutral'])

function asShortText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

/** 將 LLM 回傳的影響欄位清洗為可存 DB 的結構；方向非三選一律視為 null。 */
export function sanitizeImpact(raw: {
  impact_direction?: unknown
  scope?: unknown
  horizon?: unknown
  affected_sectors?: unknown
  action?: unknown
  related_symbols?: unknown
}): NewsImpact {
  const dir = typeof raw.impact_direction === 'string' ? raw.impact_direction.trim().toLowerCase() : ''
  let related: string | null = null
  if (typeof raw.related_symbols === 'string' && raw.related_symbols.trim()) {
    const codes = raw.related_symbols.match(/\b\d{4,6}\b/g) ?? []
    if (codes.length > 0) related = [...new Set(codes)].join(',').slice(0, 200)
  }
  return {
    impact_direction: IMPACT_DIRECTIONS.has(dir) ? (dir as NewsImpact['impact_direction']) : null,
    scope: asShortText(raw.scope, 200),
    horizon: asShortText(raw.horizon, 200),
    affected_sectors: asShortText(raw.affected_sectors, 500),
    action: asShortText(raw.action, 500),
    related_symbols: related,
  }
}

/** 依「價值投資」精神用 LLM 過濾候選新聞;失敗時回傳原始前 N 則(理由為空)當兜底。 */
export async function filterNewsByAI(candidates: NewsCandidate[]): Promise<MarketFocusItem[]> {
  if (candidates.length === 0) return []
  let threw = false
  try {
    const config = loadConfig()
    const { llm } = createQuickLLM(config, { maxTokens: FALLBACK_SAFE_MAX_TOKENS })
    attachLlmUsageRecorder(llm, 'market-focus.filter')
    const rawCount = (await getAgentSetting('market_focus.select_count')) ?? ''
    const selectCount = (rawCount && Number(rawCount) > 0 && Number(rawCount)) || 10
    const promptOverride = (await getAgentSetting('market_focus.select_prompt')) ?? ''
    const system = promptOverride ? `${SYSTEM_PROMPT}\n\n【後台覆寫指示】\n${promptOverride}` : SYSTEM_PROMPT
    const prompt = buildUserPrompt(candidates).replace(`\n\n請選出符合原則的 10 則。`, `\n\n請選出符合原則的 ${selectCount} 則。`)
    const raw = await llm.generate(system, prompt)
    const parsed = JSON.parse(raw.replace(/```json[\s\S]*?```/g, (m) => m.slice(7, -3)).trim()) as {
      selected: SelectEntry[]
    }
    const selected = Array.isArray(parsed?.selected) ? parsed.selected : []
    const items: MarketFocusItem[] = []
    for (const s of selected) {
      const c = candidates[s.index]
      if (!c) continue
      items.push({
        title: c.title,
        url: c.url,
        source: c.source,
        published_at: c.publishedAt,
        reason: typeof s.reason === 'string' ? s.reason.trim() : null,
        // Issue #19：影響欄位與遴選同一次 LLM 呼叫產出，不新增 quota 消耗
        ...sanitizeImpact(s),
      })
      if (items.length >= selectCount) break
    }
    if (items.length > 0) return items
  } catch (e) {
    threw = true
    console.error('[MarketFocus] LLM filter failed, falling back to raw headlines:', e)
    await logMarketFocusEvent({
      source: 'filter',
      level: 'error',
      code: 'LLM_FALLBACK',
      message: 'LLM 精選新聞過濾失敗，退回原始新聞前 N 則（無遴選原因）',
      detail: formatErrorDetail(e),
    })
  }
  if (!threw) {
    await logMarketFocusEvent({
      source: 'filter',
      level: 'warn',
      code: 'LLM_EMPTY_RESULT',
      message: 'LLM 未回傳有效選取結果，退回原始新聞前 N 則（無遴選原因）',
    })
  }
  const rawCount2 = (await getAgentSetting('market_focus.select_count').catch(() => null)) ?? ''
  const fallbackCount = (rawCount2 && Number(rawCount2) > 0 && Number(rawCount2)) || 10
  return candidates.slice(0, fallbackCount).map((c) => ({
    title: c.title,
    url: c.url,
    source: c.source,
    published_at: c.publishedAt,
    reason: null,
    ...EMPTY_IMPACT,
  }))
}

// ─── 每則新聞 AI 說人話重點摘要 ──────────────────────────────────
const ARTICLE_SUMMARIES_SYSTEM_PROMPT = `你是 Vestential 的資深台股主筆。請為以下精選新聞，逐則撰寫一份 100~180 字的繁體中文「說人話重點摘要」，並附上新聞影響結構化欄位。

核心原則（嚴格遵守 speak-human-tw 去 AI 味規範）：
1. 開門見山：首句直接點出核心事件與關鍵數據（如營收增減幅、毛利率、簽約金額、資本支出、政策決議）。嚴禁「在...背景下」、「隨著...發展」等套話開場。
2. 直陳實質影響：點明對該產業鏈、上下游供應商或台股投資人的實質影響（受惠題材、獲利能見度或潛在估值壓力），不說空話。
3. 嚴禁說教與心靈雞湯：不寫「投資人應保持理性」、「面對波動要耐心」等自我感動或道德勸說。
4. 剔除解說導引贅詞：嚴禁使用「值得注意的是」、「不可否認的是」、「顯而易見的是」、「這意味著」、「不是 A 而是 B」。直接陳述客觀事實。
5. 自然收尾，禁罐頭總結：直接停在關鍵數字或結論，嚴禁「總結來說」、「綜上所述」。
6. 台灣金融語境：使用繁體中文（台灣習慣詞彙），全形標點符號（，、。！？）。
7. 影響欄位（Issue #19，供新聞卡呈現；無法從正文判斷時填空字串，related_symbols 只填正文明確提及的台股 4~6 碼代號）：
   impact_direction（positive 偏多 / negative 偏空 / neutral 中性三選一）、scope（影響範圍 20 字內）、horizon（影響時程 15 字內）、affected_sectors（受影響族群 30 字內）、action（關注行動 30 字內、非投資建議）、related_symbols（逗號分隔）。
8. 只輸出純 JSON，不要任何其他文字：
{"summaries":[{"index":0,"summary":"...","impact_direction":"neutral","scope":"...","horizon":"...","affected_sectors":"...","action":"...","related_symbols":""}]}`

/** 逐則摘要結果：說人話摘要＋新聞影響結構化欄位（Issue #19）。 */
export interface ArticleSummaryResult extends NewsImpact {
  summary: string
}

/** 依據每則新聞的標題與正文內容，由 LLM 生成說人話重點摘要（含影響欄位；同一次 LLM 呼叫，不新增 quota）。 */
export async function generateArticleSummaries(
  items: { title: string; source: string | null; content?: string | null; reason?: string | null }[],
): Promise<ArticleSummaryResult[]> {
  if (items.length === 0) return []
  const toFallback = (it: { reason?: string | null }): ArticleSummaryResult => ({
    summary: it.reason ? `核心重點：${it.reason}` : '',
    ...EMPTY_IMPACT,
  })
  try {
    const config = loadConfig()
    const { llm } = createQuickLLM(config, { maxTokens: FALLBACK_SAFE_MAX_TOKENS })
    attachLlmUsageRecorder(llm, 'market-focus.article-summaries')

    const summaryMap = new Map<number, ArticleSummaryResult>()
    // 每批輸出估算：180 字摘要 ≈270 token ＋ 影響 6 欄位 ≈70 token ⇒ 340/則；
    // budget=850、baseOverhead=40 ⇒ 每批最多 2 則（340×2+40=720 ≤850，遠低於 1000 硬上限）。
    const chunks = chunkByOutputBudget(
      items,
      850,
      () => 340,
      40,
    )
    let chunkStartIndex = 0
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci]!
      // Issue #32：摘要批次間錯峰（序列＋間隔），避免多批連打落在同一 OTPM 分鐘窗
      if (ci > 0) await sleep(getChainPaceMs())
      const promptList = chunk
        .map((it, idx) => {
          const textSnippet = it.content ? it.content.slice(0, 350).replace(/\s+/g, ' ').trim() : '（無正文）'
          return `[新聞 ${idx}] 標題：${it.title}\n來源：${it.source ?? '未知'}\n選取理由：${it.reason ?? '無'}\n正文摘錄：${textSnippet}`
        })
        .join('\n\n')
      try {
        const raw = await llm.generate(
          ARTICLE_SUMMARIES_SYSTEM_PROMPT,
          `請為以下 ${chunk.length} 則新聞分別產出說人話重點摘要（含影響欄位）：\n\n${promptList}`,
        )
        const cleaned = raw.replace(/```json[\s\S]*?```/g, (m) => m.slice(7, -3)).trim()
        const parsed = JSON.parse(cleaned) as {
          summaries?: {
            index: number
            summary: string
            impact_direction?: unknown
            scope?: unknown
            horizon?: unknown
            affected_sectors?: unknown
            action?: unknown
            related_symbols?: unknown
          }[]
        }
        const entries: { index: number; value: ArticleSummaryResult }[] = []
        if (Array.isArray(parsed?.summaries)) {
          for (const entry of parsed.summaries) {
            if (typeof entry.index === 'number' && typeof entry.summary === 'string') {
              entries.push({ index: entry.index, value: { summary: entry.summary, ...sanitizeImpact(entry) } })
            }
          }
        }
        // Issue #19：值為物件故不用字串專用的 mergeChunkEntries；沿用相同 offset 合併語意
        for (const e of entries) {
          if (e.value.summary.trim()) summaryMap.set(e.index + chunkStartIndex, e.value)
        }
      } catch (e) {
        // 單批失敗只退該批（空白 → 下方既有 `核心重點：reason` 兜底），其餘批次照常合併
        console.error(`[MarketFocus] article summary chunk failed (batch start=${chunkStartIndex}, size=${chunk.length}), skipping batch:`, e)
        await logMarketFocusEvent({
          source: 'article_summary',
          level: 'error',
          code: 'LLM_FALLBACK',
          message: `逐則新聞摘要批次失敗（第 ${chunkStartIndex + 1} 起 ${chunk.length} 則），僅退回該批精選理由短述`,
          detail: formatErrorDetail(e),
        })
      }
      chunkStartIndex += chunk.length
    }

    return items.map((it, idx) => {
      const s = summaryMap.get(idx)
      if (s) return s
      return toFallback(it)
    })
  } catch (err) {
    console.error('[MarketFocus] generateArticleSummaries failed, falling back:', err)
    await logMarketFocusEvent({
      source: 'article_summary',
      level: 'error',
      code: 'LLM_FALLBACK',
      message: '逐則新聞摘要 LLM 失敗，退回精選理由短述',
      detail: formatErrorDetail(err),
    })
    return items.map((it) => toFallback(it))
  }
}

export interface MarketFocusPipelineResult {
  enriched: MarketFocusItem[]
  summary: string
  hasNewEdition: boolean
  newCount: number
}

// ─── Issue #39：pipeline 分段上限＋stage 細化＋心跳 ──────────────────
// 背景：9/26 run 36252199092 跑 25m15s 死在籠統的 stage=pipeline（count=null），
// 下次卡住必須能直接指出段名。每段取「正常耗時 3~6 倍 headroom」為上限：
// 正常 run pipeline 全程約 3~4 分鐘（9/26 三筆成功 run 實測：05:47→05:51、
// 10:37→10:40、20:29→20:32）；五段上限總和 90+240+180+480+240=1230s=20.5min，
// 仍低於 25 分鐘總看門狗（JOB_TIMEOUT_MS 不動），留 4.5min 給 email/社群/回填。
export type MarketFocusStage = 'fetch' | 'filter' | 'crawl' | 'summaries' | 'summary'

/** 各段上限（ms）：fetch 90s（3 來源並行、各 ≤15s，正常 <20s）／filter 240s
 *  （1 次 LLM 含 180s abort＋429 退避，正常 60~150s）／crawl 180s（≤12 篇並行、
 *  各 ≤~30s＝10s×2＋robots 5s，正常 <60s）／summaries 480s（≤6 批序列、各 ~60s
 *  ＋8s 錯峰，正常 60~180s）／summary 240s（1 次 LLM＋前後 20s 錯峰，正常 60~120s）。 */
export const MARKET_FOCUS_STAGE_TIMEOUTS_MS: Record<MarketFocusStage, number> = {
  fetch: 90_000,
  filter: 240_000,
  crawl: 180_000,
  summaries: 480_000,
  summary: 240_000,
}

/** 單段超時錯誤：message 必帶段名，供 job error／告警直接指出卡住段。 */
export class MarketFocusStageTimeoutError extends Error {
  readonly stage: MarketFocusStage
  readonly timeoutMs: number
  constructor(stage: MarketFocusStage, timeoutMs: number) {
    super(`[MarketFocus][stage=${stage}] timeout after ${Math.round(timeoutMs / 1000)}s（超過該段上限）`)
    this.name = 'MarketFocusStageTimeoutError'
    this.stage = stage
    this.timeoutMs = timeoutMs
  }
}

/** 段切換監聽：runMarketFocusPipeline 每進一段即回報，供 job 更新 job.stage。 */
export type MarketFocusStageListener = (stage: MarketFocusStage) => void

/**
 * 包一段 pipeline 執行：進段即印心跳（含上限秒數）＋通知 listener；
 * 完成印耗時；超時拋 MarketFocusStageTimeoutError（帶段名）。
 * 任一段 hanging 都會在該段上限內失敗，絕不等到 25 分鐘總看門狗。
 */
export async function runPipelineStage<T>(
  stage: MarketFocusStage,
  fn: () => Promise<T>,
  opts?: { timeoutMs?: number; onStage?: MarketFocusStageListener },
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? MARKET_FOCUS_STAGE_TIMEOUTS_MS[stage]
  opts?.onStage?.(stage)
  const started = Date.now()
  console.log(`[MarketFocus][stage=${stage}] start（上限 ${Math.round(timeoutMs / 1000)}s）`)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new MarketFocusStageTimeoutError(stage, timeoutMs)), timeoutMs)
      }),
    ])
    console.log(`[MarketFocus][stage=${stage}] done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
    return result
  } catch (e) {
    if (e instanceof MarketFocusStageTimeoutError) {
      console.error(`[MarketFocus][stage=${stage}] FAILED after ${((Date.now() - started) / 1000).toFixed(1)}s: ${e.message}`)
    }
    throw e
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 抓取候選新聞 (多來源聚合池) → 保留近 2 天且依發布時間新到舊排序 → AI 過濾 → 並行爬全文 → AI 逐則摘要與當日總覽 → 寫入 DB。回傳儲存後的清單。 */
export async function refreshMarketFocus(): Promise<MarketFocusItem[]> {
  const { enriched } = await runMarketFocusPipeline(false)
  return enriched
}

const MAX_BACKFILL_ITEMS = 20

/** 回填近 4 天內缺少 AI 摘要的新聞（排程偶發 LLM 失敗留下的空摘要），於每次 job 收尾自動治癒，每次最多回補 20 則避免超時。 */
export async function backfillMissingSummaries(): Promise<number> {
  try {
    const recent = await getMarketFocus(MAX_BACKFILL_ITEMS, 4)
    const gaps = recent.filter((it) => !it.summary).slice(0, MAX_BACKFILL_ITEMS)
    if (gaps.length === 0) return 0
    const results = await generateArticleSummaries(gaps)
    const filled = gaps
      .map((it, i) => {
        const r = results[i]
        const next: MarketFocusItem = { ...it, summary: r?.summary || null }
        // 摘要階段的影響欄位一併回填（僅補空缺，不覆蓋既有值）
        for (const k of ['impact_direction', 'scope', 'horizon', 'affected_sectors', 'action', 'related_symbols'] as const) {
          if (!next[k] && r?.[k]) next[k] = r[k]
        }
        return next
      })
      .filter((it) => !!it.summary)
    if (filled.length > 0) await saveMarketFocus(filled)
    return filled.length
  } catch (e) {
    console.error('[MarketFocus] backfillMissingSummaries failed:', e)
    await logMarketFocusEvent({
      source: 'backfill_summary',
      level: 'error',
      code: 'LLM_FAILED',
      message: '回填缺失新聞摘要（backfillMissingSummaries）失敗',
      detail: formatErrorDetail(e),
    })
    return 0
  }
}

const BACKFILL_REASON_SYSTEM_PROMPT = `你是 Vestential 的台股主筆。以下新聞已收錄進「市場焦點」，請逐則補上它入選的價值投資理由：聚焦基本面、財報、股利、總體經濟或市場週期其一，每則 30 字以內、說人話、直陳實質影響。
只輸出純 JSON，不要任何其他文字：
{"reasons":[{"index":0,"reason":"..."},{"index":1,"reason":"..."}]}`

/** 回填近 4 天內缺少「價值投資遴選原因」的新聞（排程偶發 LLM 失敗留下的空理由），每次最多回補 20 則。 */
export async function backfillMissingReasons(): Promise<number> {
  try {
    const recent = await getMarketFocus(MAX_BACKFILL_ITEMS, 4)
    const gaps = recent.filter((it) => !it.reason).slice(0, MAX_BACKFILL_ITEMS)
    if (gaps.length === 0) return 0
    const config = loadConfig()
    const { llm } = createQuickLLM(config, { maxTokens: FALLBACK_SAFE_MAX_TOKENS })
    attachLlmUsageRecorder(llm, 'market-focus.backfill-reasons')

    // 每批輸出估算：30 字 × 1.5 + JSON ≈67/則，budget 850 下 ~12 則/批 → 40 則 ≥3 批
    const chunks = chunkByOutputBudget(
      gaps,
      850,
      () => 67,
      40,
    )
    const reasonMap = new Map<number, string>()
    let chunkStartIndex = 0
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci]!
      // Issue #32：回填批次間同樣錯峰（與主鏈共用同一 OTPM 池）
      if (ci > 0) await sleep(getChainPaceMs())
      const list = chunk
        .map(
          (it, idx) =>
            `[${idx}] 標題：${it.title}\n來源：${it.source ?? '未知'}${it.summary ? `\n摘要：${it.summary.slice(0, 200)}` : ''}`,
        )
        .join('\n\n')
      try {
        const raw = await llm.generate(
          BACKFILL_REASON_SYSTEM_PROMPT,
          `請為以下 ${chunk.length} 則新聞補上價值投資遴選原因：\n\n${list}`,
        )
        const cleaned = raw.replace(/```json[\s\S]*?```/g, (m) => m.slice(7, -3)).trim()
        const parsed = JSON.parse(cleaned) as { reasons?: { index: number; reason: string }[] }
        const entries: { index: number; value: string }[] = []
        if (Array.isArray(parsed?.reasons)) {
          for (const e of parsed.reasons) {
            if (typeof e.index === 'number' && typeof e.reason === 'string') {
              entries.push({ index: e.index, value: e.reason })
            }
          }
        }
        mergeChunkEntries(reasonMap, entries, chunkStartIndex)
      } catch (e) {
        // 單批失敗：該批 reason=null 不寫入，其餘批次照常 saveMarketFocus
        console.error(`[MarketFocus] backfill reason chunk failed (batch start=${chunkStartIndex}, size=${chunk.length}), skipping batch:`, e)
        await logMarketFocusEvent({
          source: 'backfill_reason',
          level: 'error',
          code: 'LLM_FALLBACK',
          message: `回填遴選原因批次失敗（第 ${chunkStartIndex + 1} 起 ${chunk.length} 則），該批 reason=null 不寫入`,
          detail: formatErrorDetail(e),
        })
      }
      chunkStartIndex += chunk.length
    }

    const filled = gaps
      .map((it, idx) => ({ ...it, reason: reasonMap.get(idx) || null }))
      .filter((it) => !!it.reason)
    if (filled.length > 0) await saveMarketFocus(filled)
    return filled.length
  } catch (e) {
    console.error('[MarketFocus] backfillMissingReasons failed:', e)
    await logMarketFocusEvent({
      source: 'backfill_reason',
      level: 'error',
      code: 'LLM_FAILED',
      message: '回填缺失「價值投資遴選原因」（backfillMissingReasons）失敗',
      detail: formatErrorDetail(e),
    })
    return 0
  }
}

/** 完整版市場焦點刷新：回傳新聞清單、總覽與是否真正產生新版版次 (hasNewEdition)。
 *  onStage：每進一段（fetch/filter/crawl/summaries/summary）即回報，供 job 更新 stage。 */
export async function refreshMarketFocusDetailed(onStage?: MarketFocusStageListener): Promise<MarketFocusPipelineResult> {
  return runMarketFocusPipeline(false, onStage)
}

/**
 * 市場焦點乾跑（後台預覽用）：跑完整生成流程但不寫 DB。
 * 回傳精選新聞清單＋每日總覽，供 /admin 預覽後再決定是否發布。
 */
export async function previewMarketFocus(onStage?: MarketFocusStageListener): Promise<{
  items: MarketFocusItem[]
  summary: string
}> {
  const { enriched, summary } = await runMarketFocusPipeline(true, onStage)
  return { items: enriched, summary }
}

async function runMarketFocusPipeline(dryRun: boolean, onStage?: MarketFocusStageListener): Promise<MarketFocusPipelineResult> {
  // Issue #39 抓取段：上限 90s。曾因此段內無 signal 的 cnyes 裸 fetch
  // 靜默 hang 住 25 分鐘（9/26 定罪），現已補 15s timeout＋本段上限雙保險。
  const candidates = await runPipelineStage('fetch', () => fetchMultiSourceCandidates(), { onStage })

  const now = Date.now()
  const cutoff = now - RECENT_DAYS * 24 * 60 * 60 * 1000
  const recent = candidates
    .map((c) => ({ c, t: Date.parse(c.publishedAt) }))
    .filter((x) => !Number.isNaN(x.t) && x.t >= cutoff)
    .sort((a, b) => b.t - a.t)
    .map((x) => x.c)

  const items = await runPipelineStage(
    'filter',
    () =>
      filterNewsByAI(recent).then((filtered) =>
        filtered
          .map((it) => ({ ...it, published_at: it.published_at ? toIsoDate(it.published_at) : '' }))
          .sort((a, b) => b.published_at.localeCompare(a.published_at))
          .slice(0, 12),
      ),
    { onStage },
  )

  // 檢查資料庫中現存的焦點新聞（近 3 天）
  const existing = await getMarketFocus(20, 3).catch(() => [])
  const existingUrls = new Set(existing.map((x) => (x.url || '').trim().toLowerCase()))
  const existingTitles = new Set(existing.map((x) => (x.title || '').trim().toLowerCase()))

  // 計算篩選出的新聞中有幾則是未曾收錄過的新重大新聞
  const newSignificantItems = items.filter(
    (it) => !existingUrls.has(it.url.trim().toLowerCase()) && !existingTitles.has(it.title.trim().toLowerCase()),
  )

  // 門檻：若完全沒有新聞通過 AI 門檻，或者通過的新聞全為舊新聞（且非首次運行），代表市場無新重大事件
  const hasNewEdition = items.length > 0 && (existing.length === 0 || newSignificantItems.length > 0)

  // 若無新重大新聞且非乾跑預覽：保留現有總覽，不產生新版次（不覆蓋 meta、不寄信、不發文）
  if (!hasNewEdition && !dryRun) {
    console.log(
      `[MarketFocus] 通過門檻的新聞皆已收錄過（新重大新聞: 0 則），保留上一版總覽，不產生新版次`,
    )
    const existingMeta = await getMarketFocusMeta()
    return {
      enriched: existing.length > 0 ? existing : items,
      summary: existingMeta?.summary || '',
      hasNewEdition: false,
      newCount: 0,
    }
  }

  // Issue #39 爬文段：上限 180s。單篇 10s timeout×2 次重試＋robots 5s，
  // 12 篇並行最壞 ~60s；任一篇 hanging 都在此段上限內失敗並指出段名。
  const crawled = await runPipelineStage(
    'crawl',
    () => Promise.allSettled(items.map((it) => fetchArticleContent(it.url))),
    { onStage },
  )
  const enriched: MarketFocusItem[] = items.map((it, i) => ({
    ...it,
    content: crawled[i].status === 'fulfilled' ? crawled[i].value.content : null,
    source_url: crawled[i].status === 'fulfilled' ? crawled[i].value.sourceUrl : null,
  }))
  for (const it of enriched) {
    if (!it.content) console.warn(`[MarketFocus] no article content saved for: ${it.title} (${it.source_url ?? it.url})`)
  }

  // 為每則新聞生成說人話 AI 重點摘要（含影響欄位；摘要見全文後可修正篩選階段的初判）
  // Issue #32：摘要前與 filter 呼叫錯峰（序列＋間隔；爬全文 HTTP 已自然墊時間，仍補一次間隔）
  // Issue #39 摘要段：上限 480s。≤6 批序列、各約 60s＋8s 錯峰；錯峰 sleep 計入本段內。
  const articleResults = await runPipelineStage(
    'summaries',
    async () => {
      if (enriched.length > 0) await sleep(getChainPaceMs())
      return generateArticleSummaries(enriched)
    },
    { onStage },
  )
  for (let i = 0; i < enriched.length; i++) {
    const r = articleResults[i]
    if (r?.summary) enriched[i].summary = r.summary
    else if (!enriched[i].summary) enriched[i].summary = null
    // 影響欄位：摘要階段（見全文）優先；缺失時保留篩選階段（見標題）的值
    for (const k of ['impact_direction', 'scope', 'horizon', 'affected_sectors', 'action', 'related_symbols'] as const) {
      if (r?.[k]) enriched[i][k] = r[k]
    }
  }

  // Issue #32：總覽前後錯峰（9/23 事故點：summary max_tokens=1000 撞 OTPM 分鐘窗；
  // 前間隔把總覽推離摘要尾批，後間隔把接續的社群鏈讓進下一個分鐘窗）
  // Issue #39 總覽段：上限 240s。前後 20s 錯峰計入本段內。
  const summary = await runPipelineStage(
    'summary',
    async () => {
      await sleep(getSummaryPaceMs())
      const s = await generateDailySummary(enriched)
      await sleep(getSummaryPaceMs())
      return s
    },
    { onStage },
  )
  if (!dryRun) {
    await saveMarketFocus(enriched)
    await saveMarketFocusMeta({ summary, generatedAt: new Date().toISOString() })
  }
  return { enriched, summary, hasNewEdition: true, newCount: newSignificantItems.length }
}