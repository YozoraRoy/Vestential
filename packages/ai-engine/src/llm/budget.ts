/**
 * LLM output-token budget helpers.
 *
 * Groq qwen (tier2) has OTPM=1000 hard cap. Any request with
 * `max_tokens > 1000` on that tier is guaranteed 429. This module
 * provides the safe ceiling constant and greedy-batching utilities
 * so callers never exceed it.
 */

/** Groq qwen tier2 OTPM hard ceiling — never request more than this. */
export const FALLBACK_SAFE_MAX_TOKENS = 1000

// ─── Issue #32：錯峰＋自適應退避（執行期行為，不動靜態 max_tokens）───
// 以下全部是「執行期」參數：預設寫死在 code，僅能以 env 覆寫；
// 靜態 max_tokens（FALLBACK_SAFE_MAX_TOKENS、各呼叫點傳入值）一律不動。

/** refresh/social 鏈相鄰兩次 LLM 呼叫之間的錯峰間隔預設值（ms）。 */
export const DEFAULT_CHAIN_PACE_MS = 8000
/** 當日總覽（daily summary）前後的錯峰間隔預設值（ms；9/23 事故點，給 OTPM 分鐘窗留出重置空間）。 */
export const DEFAULT_SUMMARY_PACE_MS = 20000
/** 429 自適應縮小 budget 的 token 下限（執行期重試用，不動靜態 max_tokens）。 */
export const RETRY_BUDGET_FLOOR_TOKENS = 200

function parsePaceMs(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  if (raw == null || raw.trim() === '' || !Number.isFinite(n) || n < 0) return fallback
  return Math.round(n)
}

/** 相鄰 LLM 呼叫錯峰間隔（env LLM_CHAIN_PACE_MS 覆寫，預設 8000ms）。 */
export function getChainPaceMs(env: NodeJS.ProcessEnv = process.env): number {
  return parsePaceMs(env.LLM_CHAIN_PACE_MS, DEFAULT_CHAIN_PACE_MS)
}

/** 總覽前後錯峰間隔（env LLM_SUMMARY_PACE_MS 覆寫，預設 20000ms）。 */
export function getSummaryPaceMs(env: NodeJS.ProcessEnv = process.env): number {
  return parsePaceMs(env.LLM_SUMMARY_PACE_MS, DEFAULT_SUMMARY_PACE_MS)
}

/** 可中斷測試的 sleep（呼叫端直接 await）。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Issue #58：Meta Graph API 節流（錯峰＋429 退避）──────────────────
// 與 Issue #32 LLM 鏈錯峰同模式：預設寫死在 code，僅能以 env 覆寫。
// 呼叫端（apps/web social-publish.ts 的 graphFetch）是唯一的節流 choke point：
// 所有打 Meta 的 HTTP 呼叫都經過它，發布語意／去重邏輯一律不動。

/** Meta 連續兩次呼叫之間的最小間隔預設值（ms）。單次日常 edition 約
 *  10 POST＋數次輪詢 GET，5s 間隔 ≈ 單 edition 多耗 60–90s，換取 App 層級
 *  限流窗口不再被突發打爆。 */
export const DEFAULT_META_PACE_MS = 5000
/** 429 退避基底（ms）：第 n 次重試等待 base×2^n（封頂＋jitter，見 getMetaBackoffMs）。 */
export const DEFAULT_META_RETRY_BASE_MS = 15_000
/** 退避等待封頂（ms）：10 分鐘。 */
export const META_RETRY_MAX_MS = 600_000
/** 限流重試總嘗試次數（含首次）：首次＋退避重打×2；非限流錯誤一律不重試。 */
export const META_RETRY_MAX_ATTEMPTS = 3
/** 判定為 Meta 限流的 Graph error code（App／User／Page 層級＋通用 throttle 碼）。 */
export const META_RATE_LIMIT_CODES = [4, 17, 32, 613] as const

/** Meta 呼叫錯峰間隔（env META_PACE_MS 覆寫，預設 5000ms）。 */
export function getMetaPaceMs(env: NodeJS.ProcessEnv = process.env): number {
  return parsePaceMs(env.META_PACE_MS, DEFAULT_META_PACE_MS)
}

/** 429 退避基底（env META_RETRY_BASE_MS 覆寫，預設 15000ms；單測可調小加速）。 */
export function getMetaRetryBaseMs(env: NodeJS.ProcessEnv = process.env): number {
  return parsePaceMs(env.META_RETRY_BASE_MS, DEFAULT_META_RETRY_BASE_MS)
}

export interface MetaRateLimitBody {
  error?: {
    code?: number
    error_subcode?: number
    message?: string
    /** Graph 暫態旗標（Issue #59：is_transient=true 即視為暫態）。 */
    is_transient?: boolean
  }
}

/**
 * 判定一次 Meta 回應是否為「限流」：
 * - HTTP 429；或
 * - Graph error code ∈ META_RATE_LIMIT_CODES；或
 * - 錯誤訊息命中限流關鍵字（防 Meta 新增碼／訊息改寫）。
 * 純函數，方便單測斷言。
 */
export function isMetaRateLimit(status: number, body?: MetaRateLimitBody | null): boolean {
  if (status === 429) return true
  const code = body?.error?.code
  if (typeof code === 'number' && (META_RATE_LIMIT_CODES as readonly number[]).includes(code)) {
    return true
  }
  const msg = body?.error?.message ?? ''
  return /request limit|rate limit|throttl|too many|temporarily blocked|error\s*4\b/i.test(msg)
}

/**
 * 判定一次 Meta 回應是否為「暫態錯誤」（Issue #59）：
 * - HTTP 5xx；或
 * - Graph error code === -1；或
 * - 錯誤訊息命中 /fatal/i；或
 * - Graph error.is_transient === true。
 * 命中者與限流共用同一退避序列重打；真 4xx（190／100／2207040 等）一律回 false。
 * 純函數，方便單測斷言。
 */
export function isMetaTransient(status: number, body?: MetaRateLimitBody | null): boolean {
  if (Number.isFinite(status) && status >= 500 && status <= 599) return true
  const code = body?.error?.code
  if (code === -1) return true
  if (body?.error?.is_transient === true) return true
  const msg = body?.error?.message ?? ''
  return /fatal/i.test(msg)
}

// ─── Issue #62：IG 2207051 冷卻延後（疑似洗版，不走熱重試）─────────────
// 2207051 = The publishing action is suspected to be spam（Graph code=4 系列，
// 但語義是「洗版嫌疑」而非額度型限流）：命中即停手、記 deferred、下一個
// 00 UTC edition 才重打。2207085 維持 #59 行為（isMetaTransient → 熱重試），
// #58 錯峰／#59 分類一律不動。

/** IG 疑似洗版 subcode（code=4＋此 subcode 才走冷卻，其餘 code=4 維持 #58 限流）。 */
export const META_SPAM_SUBCODE_2207051 = 2207051

/** 命中 2207051 即拋此錯（呼叫端記 deferred＋排冷卻，不進 15s→30s→60s 熱重試）。 */
export class MetaSpamSuspectedError extends Error {
  readonly subcode = META_SPAM_SUBCODE_2207051
  constructor(message: string) {
    super(message)
    this.name = 'MetaSpamSuspectedError'
  }
}

interface MetaErrorNode {
  code?: number
  error_subcode?: number
  message?: string
  error?: unknown
}

/**
 * 拆出 Graph 錯誤節點（含 wrapped／雙層 error.error 逐層下鑽，最多 4 層）。
 * 純函數，方便單測斷言。
 */
export function extractMetaError(body?: MetaRateLimitBody | null): {
  code: number | null
  subcode: number | null
  message: string
} {
  let node: MetaErrorNode | null | undefined = (body as { error?: unknown } | null | undefined)?.error as
    | MetaErrorNode
    | null
    | undefined
  for (let depth = 0; depth < 4 && node && typeof node === 'object'; depth++) {
    const inner = node.error
    if (inner && typeof inner === 'object') {
      node = inner as MetaErrorNode
    } else {
      break
    }
  }
  const code = typeof node?.code === 'number' ? node.code : null
  const subcode = typeof node?.error_subcode === 'number' ? node.error_subcode : null
  const message = typeof node?.message === 'string' ? node.message : ''
  return { code, subcode, message }
}

/**
 * 判定是否為 IG 疑似洗版（code=4＋subcode=2207051，含 wrapped 形狀）。
 * status 僅保留參數對稱性（code＋subcode 即定案，不依 HTTP status）。
 * 純函數，方便單測斷言。
 */
export function isMetaSpamSuspected(_status: number, body?: MetaRateLimitBody | null): boolean {
  const { code, subcode } = extractMetaError(body)
  return code === 4 && subcode === META_SPAM_SUBCODE_2207051
}

// ─── Issue #62：社群降頻一天一次（僅 00 UTC 發社群）────────────────────
// cron 一天跑 4 個 edition（00／06／12／18 UTC），社群只在 00 UTC 發布＋
// 重打 deferred；06／12／18 UTC 跳過（不發文、不記 failed、不發告警）。
// Issue #79：時刻 gate 已退役，改以 social_posts 當日 published 紀錄判斷
//（DB gate，見 @stock/database `hasAnySocialPublishedSince`）。時刻 gate 會因
// schedule 延遲造成整日零發文（2026-10-14），以下僅保留匯出不斷引用鏈。

/**
 * @deprecated Issue #79 起社群發布 gate 改走 DB
 *（`hasAnySocialPublishedSince`，當日 UTC 有 published 即跳過）；時刻判斷會因
 * schedule 延遲整日零發文，僅保留匯出不斷引用鏈，新程式碼請勿使用。
 * 是否為社群發布 edition（UTC 小時 == 0）。純函數（now 可注入，方便單測）。
 */
export function isSocialEditionTime(now: Date = new Date()): boolean {
  return now.getUTCHours() === 0
}

/**
 * 下一個 00 UTC 到期時刻（嚴格大於 from；冷卻 deferred 到此才重打）。
 * 例：from=10-12T05:00Z → 10-13T00:00Z；from=10-12T00:00:05Z → 10-13T00:00Z。
 * 純函數（from 可注入，方便單測）。
 */
export function getNextSocialEditionAt(from: Date = new Date()): Date {
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0, 0))
  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next
}

/**
 * 第 attempt 次限流重試的等待時間（attempt 從 0 起算：首次重試等 base，
 * 之後每次 ×2，封頂 META_RETRY_MAX_MS 再加 jitter 防對齊）。
 * 純函數（random 可注入，方便單測斷言退避序列）。
 */
export function getMetaBackoffMs(
  attempt: number,
  env: NodeJS.ProcessEnv = process.env,
  random: () => number = Math.random,
): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0
  const capped = Math.min(META_RETRY_MAX_MS, getMetaRetryBaseMs(env) * 2 ** n)
  return jitterDelay(capped, random)
}

/**
 * 對退避等待加 jitter（±25%），避免整鏈多個呼叫在同一分鐘窗邊界「對齊」重試、
 * 集體再打爆 OTPM。純函數（random 可注入，方便單測）。
 */
export function jitterDelay(baseMs: number, random: () => number = Math.random): number {
  if (!Number.isFinite(baseMs) || baseMs <= 0) return 0
  return Math.max(0, Math.round(baseMs * (0.75 + random() * 0.5)))
}

/**
 * 429 後執行期自適應縮小本次重試的 max_tokens（靜態設定不動，只影響當次重試的
 * request body）。每次 ×0.6， floor 200（低於 floor 不再縮）。
 */
export function shrinkBudgetForRetry(
  currentMaxTokens: number,
  floor: number = RETRY_BUDGET_FLOOR_TOKENS,
): number {
  if (!Number.isFinite(currentMaxTokens) || currentMaxTokens <= floor) return currentMaxTokens
  return Math.max(floor, Math.floor(currentMaxTokens * 0.6))
}

/**
 * Greedy fixed-budget chunker.
 *
 * Splits `items` into consecutive batches such that for every batch:
 *   Σ estimate(item) + baseOverhead ≤ budget
 *
 * Special cases:
 * - Empty input → `[]`
 * - Single item whose estimate already exceeds budget → sole-element batch
 *   (caller must handle oversized single items; the chunker never drops them)
 *
 * @param items       - Source array (order preserved across chunks).
 * @param budget      - Token ceiling per batch (typically 850 for summaries,
 *                      leaving headroom below FALLBACK_SAFE_MAX_TOKENS).
 * @param estimate    - Per-item output-token estimate function.
 * @param baseOverhead - Fixed per-batch overhead (system prompt, JSON wrapper, etc.).
 * @returns Array of consecutive slices of `items`.
 */
export function chunkByOutputBudget<T>(
  items: T[],
  budget: number,
  estimate: (item: T) => number,
  baseOverhead: number,
): T[][] {
  if (items.length === 0) return []

  const chunks: T[][] = []
  let current: T[] = []
  let cost = baseOverhead

  for (const item of items) {
    const itemCost = estimate(item)

    if (current.length > 0 && cost + itemCost > budget) {
      chunks.push(current)
      current = []
      cost = baseOverhead
    }

    current.push(item)
    cost += itemCost
  }

  if (current.length > 0) {
    chunks.push(current)
  }

  return chunks
}

/**
 * Merge one chunk's LLM result entries into a shared destination map,
 * adjusting indices by `offset` so local 0-based indices map back to the
 * original item positions.
 *
 * Rules:
 * - `offset` is added to every entry's `index` before writing.
 * - Existing keys in `dst` ARE overwritten by the batch value.
 * - Indices present in `dst` but absent from `entries` are NOT removed
 *   (model may skip some items; previous values are preserved).
 *
 * @param dst     - Mutable `Map<number, string>` that accumulates results across chunks.
 * @param entries - Parsed LLM output entries (`{ index: local, value: "..." }[]`).
 * @param offset  - Chunk's starting index in the original item array.
 */
export function mergeChunkEntries(
  dst: Map<number, string>,
  entries: { index: number; value: string }[],
  offset: number,
): void {
  for (const e of entries) {
    const key = e.index + offset
    if (typeof e.value === 'string' && e.value.trim()) {
      dst.set(key, e.value.trim())
    }
  }
}
