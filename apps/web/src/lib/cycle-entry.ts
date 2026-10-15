import { registry } from '@stock/market-data'
import type { BatchQuote, OHLCV } from '@stock/market-data'
import {
  evaluateLastBar,
  passesGate,
  runSignalBacktest,
  MAX_CANDIDATES,
  MIN_SAMPLE_SIGNALS,
  TW_LARGE_CAP_UNIVERSE,
  resolveStockName,
} from '@stock/cycle-entry'
import type { CycleCandidate } from '@stock/cycle-entry'
import { saveCycleEntrySignals, saveCycleEntryMeta } from '@stock/database'
import type { CycleEntrySignalRow } from '@stock/database'
import { loadConfig } from '@stock/core'
import { createQuickLLM } from '@stock/ai-engine'

// ─── 週期進場模型預估（盤後掃描）─────────────────────────────────
// 1) 大型股宇宙（TWSE 約 120 檔）→ 批量報價 → 依市值取前 100 大
// 2) 逐檔抓 1Y 日線 → 規則初篩（門檻 score≥3 且含 R1/R2）→ 上限 10 檔
// 3) 進場後擬合回測（歷史訊號日次一交易日進場 +8%/-5%/40日）
// 4) LLM 逐檔評述＋當日總覽（失敗個別為 null，不整批失敗）

const UNIVERSE_TOP_COUNT = 100

/** 歷史窗口年數：需涵蓋多空循環，才有統計意義（不含近 5 年者自動被長度/樣本門檻排除）。 */
export const BACKTEST_WINDOW_YEARS = 5

/** 歷史 K 棒長度下限（5 年約 1200 根交易日；600 為保守下限，未達標不入候選）。 */
export const MIN_HISTORY_LENGTH = 600

/** 台灣日期（Asia/Taipei）ISO；用 UTC+8 偏移計算避免本機時區雙重偏移。 */
export function twTodayIso(t = Date.now()): string {
  return new Date(t + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** 依市值排序的 TOP N 大型股（僅保留 EQUITY 且有市值者）。 */
export function pickTopByMarketCap(quotes: BatchQuote[], topN: number): BatchQuote[] {
  return quotes
    .filter((q) => q.marketCap && q.marketCap > 0 && (!q.quoteType || q.quoteType === 'EQUITY'))
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    .slice(0, topN)
}

/** 有限並行度執行器：避免一次打爆 Yahoo / LLM 限流。 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor
      cursor += 1
      results[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

/** 依規則初篩與擬合回測產出候選清單（未寫 DB）。 */
export async function collectCycleCandidates(quotes: BatchQuote[]): Promise<CycleCandidate[]> {
  const provider = registry.get('yahoo-finance')
  const top = pickTopByMarketCap(quotes, UNIVERSE_TOP_COUNT)
  const end = new Date()
  const start = new Date(end)
  start.setFullYear(start.getFullYear() - BACKTEST_WINDOW_YEARS)

  const histories = await mapLimit<BatchQuote, OHLCV[] | null>(
    top,
    6,
    async (q) => {
      try {
        const h = await provider.getHistory(q.symbol, 'TW', start.toISOString().slice(0, 10), end.toISOString().slice(0, 10))
        return h.length >= MIN_HISTORY_LENGTH ? h : null
      } catch (e) {
        console.warn(`[CycleEntry] history fetch failed: ${q.symbol}`, e)
        return null
      }
    },
  )

  const candidates: CycleCandidate[] = []
  for (let i = 0; i < top.length; i++) {
    const history = histories[i]
    if (!history) continue
    const last = evaluateLastBar(history)
    if (!last) continue
    if (!passesGate(last.score, last.matchedRules)) continue
    const stats = runSignalBacktest(history)
    if (stats.totalSignals < MIN_SAMPLE_SIGNALS) continue

    candidates.push({
      symbol: top[i].symbol,
      name: resolveStockName(top[i].symbol, top[i].name),
      marketCap: top[i].marketCap ?? 0,
      rank: 0,
      score: last.score,
      matchedRules: last.matchedRules,
      cycleStage: last.cycleStage,
      price: last.close,
      entryPriceHint: last.close,
      pctOff52wHigh: last.pctOff52wHigh,
      pctOff52wLow: last.pctOff52wLow,
      rsi: last.rsi,
      ma20: last.ma20,
      ma60: last.ma60,
      macdHist: last.macdHist,
      stats,
    })
  }

  // 排序：score 高 → 市值高 → 代號小
  candidates.sort(
    (a, b) => b.score - a.score || b.marketCap - a.marketCap || a.symbol.localeCompare(b.symbol),
  )
  return candidates.slice(0, MAX_CANDIDATES)
}

export function toSignalRow(c: CycleCandidate): Omit<CycleEntrySignalRow, 'editionDate'> {
  return {
    symbol: c.symbol,
    name: c.name,
    marketCap: c.marketCap,
    signalRank: null,
    price: c.price,
    entryPriceHint: c.entryPriceHint,
    score: c.score,
    matchedRules: c.matchedRules.join(','),
    cycleStage: c.cycleStage,
    pctOff52wHigh: c.pctOff52wHigh,
    pctOff52wLow: c.pctOff52wLow,
    rsi: c.rsi,
    ma20: c.ma20,
    ma60: c.ma60,
    macdHist: c.macdHist,
    llmNote: null,
    btTotalSignals: c.stats.totalSignals,
    btWins: c.stats.wins,
    btLosses: c.stats.losses,
    btNeutral: c.stats.neutral,
    btWinRate: c.stats.winRate,
    btAvgDays: c.stats.avgDaysToTarget,
  }
}

export const RULE_LABELS: Record<string, string> = {
  R1: '回檔到位',
  R2: '站上均線',
  R3: '超賣反轉',
  R4: '量能收斂',
  R5: '動能翻正',
}

const NOTE_SYSTEM_PROMPT = `你是 Vestential 的資深台股分析師。以下是某檔股票的技術面快照（訊號日）。請用一句話（繁體中文，40 字以內）說明它為何適合列入「已現進場點」名單。
原則：
1. 開門見山，直接陳述觸發的訊號事實（如「回檔 25% 後站回 20 日線、量能收斂」），不要寫「此檔股票……是一檔值得關注的標的」這類空話。
2. 嚴禁說教、嚴禁風險提醒或投資建議句（免責由平台統一呈現）、嚴禁出現「值得注意的是」等贅詞。
3. 只輸出純文字一句話，不要 JSON、不要引號、不要標點以外的多餘符號。`

export const SUMMARY_SYSTEM_PROMPT = `你是 Vestential 的週期進場模型主筆。今天是台灣交易日盤後，模型掃描市值前 100 大台股後，篩出通過進場門檻的標的。請撰寫一段「今日進場點總覽」（繁體中文，150~250 字）。
原則：
1. 開門見山，第一句直接點出今日通過門檻的標的數量與大方向（例如「今日共 X 檔……」）。
2. 觀察標的分佈：user 訊息末尾附有程式算好的「規則覆蓋率」，直接引用、嚴禁重算。「共同特徵」一詞僅限覆蓋率 100%（N/N）的規則；其餘一律寫「N 檔中有 M 檔…」；禁用「一致」「全體」「都」「共同交集」描述非 100% 規則。舉例 1~2 檔時，被舉例者必須確實觸發所描述的規則。
3. 禁絕說教與投資建議（風險與免責由平台統一呈現）；說人話，直陳事實。
4. 自然收尾，禁止「總結來說」「賺錢機會」等套版。
5. 只輸出 JSON：{"summary":"..."}`

/**
 * Issue #86 防幻覺：規則覆蓋率由程式先算好（R1..R5 各幾檔觸發／共幾檔），
 * 餵給 LLM 直接引用，LLM 不再心算交集。純函式，可單測。
 */
export function ruleCoverage(matchedList: string[][], order: string[] = ['R1', 'R2', 'R3', 'R4', 'R5']): string {
  const total = matchedList.length
  return order.map((r) => `${r} ${matchedList.filter((m) => m.includes(r)).length}/${total}`).join('、')
}

/** 為候選標的生成 LLM 評述；失敗回 null（不整批失敗）。 */
export async function generateLlmNotes(candidates: CycleCandidate[]): Promise<(string | null)[]> {
  if (candidates.length === 0) return []
  const config = loadConfig()
  try {
    const { llm } = createQuickLLM(config, { maxTokens: 200 })
    const notes = await mapLimit(
      candidates,
      2,
      async (c) => {
        try {
          const ruleText = c.matchedRules.map((r) => `${r}(${RULE_LABELS[r]})`).join('、')
          const stats = c.stats
          const statsText = stats.totalSignals > 0
            ? `歷史同規則訊號 ${stats.totalSignals} 次、勝率 ${stats.winRate != null ? stats.winRate.toFixed(1) + '%' : '—'}、平均 ${stats.avgDaysToTarget != null ? stats.avgDaysToTarget.toFixed(0) + ' 日' : '—'}`
            : '尚無歷史同規則訊號'
          const prompt = `標的：${c.name ?? c.symbol}（${c.symbol}）\n價格 ${c.price}，距 52 週高 ${(c.pctOff52wHigh * 100).toFixed(1)}%，距低 ${(c.pctOff52wLow * 100).toFixed(1)}%\n觸發規則：${ruleText}（score ${c.score}）\n技術面：RSI ${c.rsi.toFixed(1)} / MA20 ${c.ma20.toFixed(1)} / MA60 ${c.ma60.toFixed(1)} / MACD柱 ${c.macdHist.toFixed(3)}\n近 5 年回測：${statsText}`
          const note = (await llm.generate(NOTE_SYSTEM_PROMPT, prompt)).trim()
          return note ? note.slice(0, 200) : null
        } catch (e) {
          console.warn(`[CycleEntry] llm note failed: ${c.symbol}`, e)
          return null
        }
      },
    )
    return notes
  } catch (e) {
    console.error('[CycleEntry] llm client init failed:', e)
    return candidates.map(() => null)
  }
}

/** 生成當日進場點總覽（meta.summary）；失敗回 null。 */
export async function generateEditionSummary(candidates: CycleCandidate[]): Promise<string | null> {
  if (candidates.length === 0) return null
  try {
    const config = loadConfig()
    const { llm } = createQuickLLM(config, { maxTokens: 512 })
    const list = candidates
      .map((c, i) => {
        const rules = c.matchedRules.join('+')
        return `${i + 1}. ${c.name ?? c.symbol}（${c.symbol}）距高 ${(c.pctOff52wHigh * 100).toFixed(0)}%，規則 ${rules}`
      })
      .join('\n')
    const coverage = ruleCoverage(candidates.map((c) => c.matchedRules))
    const raw = await llm.generate(
      SUMMARY_SYSTEM_PROMPT,
      `今日通過門檻標的（共 ${candidates.length} 檔）：\n${list}\n規則覆蓋率（已算好，直接引用勿重算）：${coverage}`,
    )
    const cleaned = raw.replace(/```json[\s\S]*?```/g, (m) => m.slice(7, -3)).trim()
    const parsed = JSON.parse(cleaned) as { summary?: string }
    const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : ''
    return summary ? summary.slice(0, 20000) : null
  } catch (e) {
    console.error('[CycleEntry] edition summary failed:', e)
    return null
  }
}

export interface CycleEntryPipelineResult {
  editionDate: string
  signalCount: number
  signals: Omit<CycleEntrySignalRow, 'editionDate'>[]
  summary: string | null
}

/**
 * 執行完整盤後掃描管線。
 * @param dryRun true 時僅回傳結果、不寫 DB（後台預覽用）。
 */
export async function computeCycleEntryEdition(dryRun: boolean): Promise<CycleEntryPipelineResult> {
  const provider = registry.get('yahoo-finance')
  if (!provider.getBatchQuotes) throw new Error('yahoo-finance provider lacks getBatchQuotes')
  const quotes = await provider.getBatchQuotes(TW_LARGE_CAP_UNIVERSE.map((u) => u.symbol))
  const candidates = await collectCycleCandidates(quotes)

  const notes = await generateLlmNotes(candidates)
  const signals = candidates.map((c, i) => ({ ...toSignalRow(c), signalRank: i + 1, llmNote: notes[i] }))
  const summary = await generateEditionSummary(candidates)

  const editionDate = twTodayIso()
  const result: CycleEntryPipelineResult = {
    editionDate,
    signalCount: signals.length,
    signals,
    summary,
  }

  if (!dryRun && signals.length > 0) {
    await saveCycleEntrySignals(editionDate, signals)
    await saveCycleEntryMeta({
      editionDate,
      summary,
      signalCount: signals.length,
      generatedAt: new Date().toISOString(),
    })
  } else if (!dryRun && signals.length === 0) {
    // 當日無任何標的通過：仍記錄版次，但清掉舊內容避免誤導
    await saveCycleEntrySignals(editionDate, [])
    await saveCycleEntryMeta({
      editionDate,
      summary: summary ?? '今日無任何標的通過進場門檻。',
      signalCount: 0,
      generatedAt: new Date().toISOString(),
    })
  }

  return result
}