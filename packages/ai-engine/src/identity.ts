/**
 * 標的身分鎖定（Issue #114）。
 *
 * 背景：`/analyze` 過去只把 Yahoo Profile 的英文名帶進 prompt，公司中文名全靠模型記憶。
 * 實測 2327（Profile: Yageo Corporation）被寫成「台達電（2327）」，fallback 小模型甚至在
 * 報告裡爭辯「2327.TW 是台達電」。因此以本地 DB 的台股正名＋Profile 英文名組成 identity
 * 區塊，明令模型不得以記憶替換；查無正名時也不得亂猜。
 */

/** DB 名稱可能帶註記（例：`國巨*`）；只去尾端星號，不動其他字元。 */
export function sanitizeStockName(raw: unknown): string | null {
  const t = typeof raw === 'string' ? raw.trim() : ''
  if (!t) return null
  const cleaned = t.replace(/\*+$/u, '').trim()
  return cleaned || null
}

export interface IdentityInput {
  /** 已解析的標的代號（例：`2327.TW`）。 */
  ticker: string
  /** 系統查得的台股中文正名（可空）。 */
  nameZh?: string | null
  /** Yahoo Profile 的英文名（可空）。 */
  nameEn?: string | null
}

/**
 * 產生 `instrumentContext` 的 identity 區塊（純函式，可單測）。
 * - 中英皆有且不同：`Company: 國巨（Yageo Corporation）`
 * - 只有其一：只列該名稱
 * - 都沒有：明確要求以代號稱呼，不得憑代號猜公司
 */
export function buildIdentityContext(input: IdentityInput): string {
  const ticker = (input.ticker ?? '').trim()
  const zh = sanitizeStockName(input.nameZh)
  const en = sanitizeStockName(input.nameEn)
  const company =
    zh && en && zh.toUpperCase() !== en.toUpperCase() ? `${zh}（${en}）` : zh ?? en ?? null

  if (!company) {
    return [
      'Identity (authoritative):',
      `- Ticker: ${ticker}`,
      '- No verified company name was provided. Do not guess a company name from the ticker; if the name is unknown, refer to the instrument by ticker only.',
    ].join('\n')
  }

  return [
    'Identity (authoritative, do not override):',
    `- Company: ${company}`,
    `- Ticker: ${ticker}`,
    'Rules:',
    '1. Use this company for every statement in every report.',
    '2. Do not rename it, and do not substitute another company from memory. Memorized ticker-to-company mappings are frequently wrong.',
    '3. If recalled knowledge conflicts with this block, this block wins — drop the conflicting claim instead of debating it.',
  ].join('\n')
}
