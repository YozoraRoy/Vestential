/**
 * Issue #105：`getProfile` 的資料來源由 `v11/finance/quoteSummary`（已下架：v11→HTTP 404、
 * v10→HTTP 401 Invalid Crumb）改為 `v1/finance/search`（免 crumb，與原 detectQuoteType 同一支端點）。
 *
 * 本檔只放「與網路無關」的純函式（sector zh-TW 對照、search 回應解析），獨立成模組以便單元測試
 * （測試不需載入 fetch 相關模組）。實際請求與快取見 `yahoo-finance.ts`。
 *
 * 風險備註：`v1/finance/search` 是搜尋端點、非正式 profile API，日後可能再變 ⇒ 呼叫端必須
 * 「失敗即降級」（回空值，不拋錯），快取與降級策略見 `yahoo-finance.ts` 的 `getProfile`。
 */
import type { CompanyProfile } from '../types.js'

/**
 * Yahoo sector（英文）→ zh-TW 對照（11 大類）。
 * 對照不到一律原樣回傳英文，不得硬湊。
 *
 * 顆粒度差異（issue 風險項）：Yahoo 只給 11 大類（Technology…），比 apps/web 的
 * `FALLBACK_SECTOR_MAP`（半導體／塑化／鋼鐵等 industry 級）粗。本單不改用 `industry`
 * 做第二層對照，粗細差異由「Yahoo 優先 → fallback 補」的優先序吸收。
 */
export const SECTOR_ZH_MAP: Record<string, string> = {
  Technology: '科技',
  'Financial Services': '金融',
  Healthcare: '醫療保健',
  'Consumer Cyclical': '消費循環',
  'Consumer Defensive': '民生消費',
  Industrials: '工業',
  Energy: '能源',
  Utilities: '公用事業',
  'Real Estate': '房地產',
  'Basic Materials': '原物料',
  'Communication Services': '通訊',
}

/** Yahoo sector 原文 → 中文；空值回 undefined，未知值原樣回傳英文。 */
export function toZhSector(raw: unknown): string | undefined {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (!v) return undefined
  return SECTOR_ZH_MAP[v] ?? v
}

/** `v1/finance/search` 回傳的 quote 物件中本單會用到的欄位（其餘忽略）。 */
export interface YahooSearchQuote {
  symbol?: string
  quoteType?: string
  sector?: string
  industry?: string
  longname?: string
  shortname?: string
  exchange?: string
}

function pickString(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : undefined
}

/**
 * 從 search 回應取出「symbol 完全比對（大小寫不敏感）」的那一筆。
 * search 是搜尋端點，會回名稱相近的他檔（例如查 `00878.TW` 可能回 `00878B`），
 * 因此一律精確比對；查無精確比對回 undefined（不得拿第一筆頂替）。
 */
export function pickSearchQuote(symbol: string, payload: unknown): YahooSearchQuote | undefined {
  const target = (symbol ?? '').trim().toUpperCase()
  if (!target) return undefined
  const quotes = (payload as { quotes?: unknown } | null | undefined)?.quotes
  if (!Array.isArray(quotes)) return undefined
  return (quotes as YahooSearchQuote[]).find(
    (q) => pickString(q?.symbol)?.toUpperCase() === target,
  )
}

/**
 * search 那筆 → `CompanyProfile`。
 * - `name`：`longname` → `shortname` → `symbol`（皆為空時退回代號，維持舊行為）。
 * - `sector`：經 zh-TW 對照（`Technology`→`科技`）；ETF 無 sector ⇒ undefined。
 * - `industry`：維持 Yahoo 原文（本單只要求 sector 中文化；風險層已不再以 industry 當產業來源）。
 */
export function buildProfileFromSearch(symbol: string, quote: YahooSearchQuote | undefined): CompanyProfile {
  return {
    symbol,
    name: pickString(quote?.longname) ?? pickString(quote?.shortname) ?? symbol,
    sector: toZhSector(quote?.sector),
    industry: pickString(quote?.industry),
    exchange: pickString(quote?.exchange),
    quoteType: pickString(quote?.quoteType),
  }
}

/** 查無資料時的 profile（name 退回代號；不得拋錯）。 */
export function emptyProfile(symbol: string): CompanyProfile {
  return { symbol, name: symbol }
}
