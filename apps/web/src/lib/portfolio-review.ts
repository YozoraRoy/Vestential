/**
 * Issue #43 portfolio 整體覆盤：統計純計算＋覆盤 prompt（單一實作）。
 * - 月／全部統計（筆數／勝率／平均賺賠／最大回撤筆）與 AI 覆盤皆由此函式重算，
 *   保證數字與歷史明細加總一致（沿用 journal.ts computeJournalStats 模式）。
 * - 純函式，前後端共用（/portfolio 頁顯示、review route）。
 * - 讀取來源表：portfolio_records（經 getPortfolioRecords），不寫表。
 *
 * 與 journal 覆盤的差異（規格要求於 prompt 註明）：
 * - 歷史紀錄無 方向／理由／停損 欄位，故不做停損遵守統計、不引用交易理由；
 * - 只准引用歷史紀錄既有欄位：市場／代號／股數／成本／現價／策略／
 *   AI 評級＋摘要／稅費淨損益（含稅費淨損益由既有欄位以通用費率重算）。
 *   （#44：配息欄已移除，不再引用；總報酬採裸價差。）
 */

export type PortfolioReviewMarket = 'tw' | 'us'

export interface PortfolioReviewEntryLike {
  id?: number
  market: string
  symbol: string
  shares: number
  cost: number
  current_price: number
  /** #44：已棄用（配息欄移除；保留相容，計算一律忽略）。 */
  dividend?: number
  /** 總報酬（裸價差；#44 起不再含配息）；缺值時以 unrealized_pnl 還原。 */
  total_return?: number | null
  unrealized_pnl?: number | null
  strategy?: string | null
  recommendation?: string | null
  summary?: string | null
  created_at?: string | null
}

/** 覆盤最低筆數門檻：<5 筆擋下，提示先補足筆數（與 journal 同值，不扣 quota）。 */
export const PORTFOLIO_MIN_REVIEW_COUNT = 5

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** 單筆賺賠：明細 total_return（#44 起為裸價差）；舊資料缺值時以未實現損益還原（不再加配息）。 */
export function computePortfolioReviewPnl(e: PortfolioReviewEntryLike): number {
  const total = toNum(e.total_return)
  if (total != null) return total
  return toNum(e.unrealized_pnl) ?? 0
}

export interface PortfolioReviewStats {
  count: number
  wins: number
  losses: number
  winRate: number | null
  totalPnl: number
  avgPnl: number | null
  /** 最大回撤筆：單筆虧損最大者（全勝時為 null）。 */
  maxLossEntry: { id?: number; symbol: string; createdAt: string; pnl: number } | null
}

/** 純計算：由歷史明細重算筆數／勝率／平均賺賠／最大回撤筆。 */
export function computePortfolioReviewStats(entries: PortfolioReviewEntryLike[]): PortfolioReviewStats {
  const count = entries.length
  if (count === 0) {
    return {
      count: 0, wins: 0, losses: 0, winRate: null, totalPnl: 0, avgPnl: null,
      maxLossEntry: null,
    }
  }
  const pnls = entries.map((e) => ({ e, pnl: computePortfolioReviewPnl(e) }))
  const wins = pnls.filter((p) => p.pnl > 0).length
  const losses = pnls.filter((p) => p.pnl < 0).length
  const totalPnl = pnls.reduce((s, p) => s + p.pnl, 0)
  const worst = pnls.reduce((a, b) => (b.pnl < a.pnl ? b : a))
  return {
    count,
    wins,
    losses,
    winRate: (wins / count) * 100,
    totalPnl,
    avgPnl: totalPnl / count,
    maxLossEntry: worst.pnl < 0
      ? { id: worst.e.id, symbol: worst.e.symbol, createdAt: worst.e.created_at ?? '', pnl: worst.pnl }
      : null,
  }
}

/**
 * 月篩選：created_at 前綴 YYYY-MM 比對（沿用 journal month LIKE 前綴模式）。
 * month 為空／'all' 時回全部。
 */
export function filterPortfolioReviewByMonth<T extends { created_at?: string | null }>(
  entries: T[],
  month?: string | null,
): T[] {
  const m = (month ?? '').trim()
  if (!m || m === 'all') return entries
  if (!/^\d{4}-\d{2}$/.test(m)) return entries
  return entries.filter((e) => (e.created_at ?? '').startsWith(m))
}

/**
 * AI 覆盤 system prompt（沿用 journal JOURNAL_REVIEW_SYSTEM_PROMPT 風格）：
 * - 只准引用歷史紀錄筆次與既有欄位，不臆測未寫資訊；
 * - 不輸出未來買賣點，只做紀律／勝率歸因（含紀律 Top-3，每項附筆次引用）。
 * - 差異註明（規格要求）：歷史紀錄無 方向／理由／停損 欄位，
 *   故不做停損遵守統計、不引用交易理由原文，不推測進出場動機。
 */
export const PORTFOLIO_REVIEW_SYSTEM_PROMPT = [
  '你是持倉歷史整體覆盤員，只能依據使用者提供的 portfolio 歷史紀錄做紀律／勝率歸因。',
  '與交易日誌覆盤的差異（注意）：歷史紀錄沒有「方向／理由／停損」欄位，',
  '因此不做停損遵守統計、不引用交易理由原文、不推測任何進出場動機。',
  '硬性規則（違反即不合格）：',
  '1. 只准引用歷史紀錄既有欄位：市場／代號／股數／成本／現價／策略／AI 評級＋摘要／稅費淨損益，',
  '   以 #id 指稱筆次（如 #12、#15），嚴禁臆測、推論紀錄未寫的動機、情緒或盤勢原因。',
  '2. 不輸出任何未來買賣點：嚴禁出現「建議買進／賣出／加碼／停損價／目標價」等前瞻交易指示。',
  '3. 只做紀律與勝率歸因：輸出「紀律問題 Top-3」（每項附具體筆次引用，如 #12、#15）＋勝率／平均賺賠統計解讀。',
  '以繁體中文（台灣習慣用語）輸出，直陳事實，禁用贅詞與心靈雞湯。',
].join('\n')
