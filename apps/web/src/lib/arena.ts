import {
  runArenaRound,
  LightweightStrategist,
  buildDefaultDailyUniverse,
  fetchArenaMarket,
  fetchArenaLivePrices,
  normalizeArenaStrategyParams,
  type ArenaHolding,
  type ArenaStore,
  type ArenaStrategist,
  type ArenaUniverseItem,
  type ArenaIntradayPriceRecord,
  type ArenaDecisionLogRecord,
  type ArenaLedgerEntry,
} from '@stock/ai-engine'
import {
  listActiveArenaAgents,
  getArenaHoldings,
  replaceArenaHoldings,
  insertArenaTrade,
  upsertArenaSnapshot,
  updateArenaAgentLastRound,
  updateArenaAgentCash,
  saveArenaIntradayPrices,
  saveArenaMarketBriefing,
  insertArenaDecisionLog,
  saveArenaDiscussion,
  ensureActiveArenaSeason,
  dbQueryFirst,
  getArenaMarketBriefing,
  getArenaTradesByRound,
  getArenaRoundProgress,
  markArenaRoundProgress,
  clearArenaRoundProgress,
  clearArenaPhaseArtifacts,
  replaceArenaRoundUniverse,
  getArenaRoundUniverse,
  getAgentSetting,
  migrate,
  saveArenaTickJob,
  updateArenaTickJob,
  findRunningArenaTickJob,
  getTwseDividendsInWindow,
  saveArenaDividendCredit,
  hasArenaDividendCredit,
  type ArenaTickJobRow,
} from '@stock/database'
import type { ArenaAgentRecord, ArenaTradeRecord, ArenaSnapshotRecord } from '@stock/ai-engine'

/** 本地實作 ArenaStore seam：以 @stock/database 的 arena_* 資料層落地。 */
export function dbArenaStore(): ArenaStore {
  return {
    async listActiveAgents(): Promise<ArenaAgentRecord[]> {
      const rows = await listActiveArenaAgents()
      return rows.map((r) => {
        let parsedParams: unknown = null
        if (r.strategy_params) {
          try {
            parsedParams = JSON.parse(r.strategy_params)
          } catch {}
        }
        return {
          id: r.id,
          ownerUserId: String(r.owner_user_id),
          name: r.name,
          division: r.division,
          strategyId: r.strategy_id,
          tone: r.tone,
          initialCapital: r.initial_capital,
          cash: r.cash,
          status: r.status,
          lastRoundDate: r.last_round_date ?? null,
          seasonId: r.season_id > 0 ? r.season_id : null,
          seasonName: null,
          personality: r.personality ?? null,
          strategyParams: normalizeArenaStrategyParams(parsedParams),
        }
      })
    },

    async getHoldings(agentId: number): Promise<ArenaHolding[]> {
      const rows = await getArenaHoldings(agentId)
      return rows.map((h) => ({
        symbol: h.symbol,
        symbolName: h.symbol_name ?? undefined,
        shares: h.shares,
        avgCost: h.avg_cost,
      }))
    },

    async replaceHoldings(agentId: number, holdings: ArenaHolding[], roundDate: string): Promise<void> {
      await replaceArenaHoldings(
        agentId,
        holdings.map((h) => ({
          symbol: h.symbol,
          symbolName: h.symbolName ?? null,
          shares: h.shares,
          avgCost: h.avgCost,
          roundDate,
        })),
      )
    },

    async insertTrade(record: ArenaTradeRecord): Promise<void> {
      await insertArenaTrade({
        agentId: record.agentId,
        roundDate: record.roundDate,
        slot: record.slot ?? null,
        action: record.action,
        symbol: record.symbol ?? null,
        symbolName: record.symbolName ?? null,
        shares: record.shares ?? null,
        price: record.price ?? null,
        fee: record.fee ?? null,
        tax: record.tax ?? null,
        reason: record.reason ?? null,
        model: record.model ?? null,
        fallbackUsed: record.fallbackUsed ?? false,
        error: record.error ?? null,
      })
    },

    async getRoundTrades(agentId: number, roundDate: string) {
      const rows = await getArenaTradesByRound(agentId, roundDate)
      return rows.map((r) => ({
        slot: r.slot ?? null,
        action: String(r.action),
        error: r.error ?? null,
      }))
    },

    async insertSnapshot(snapshot: ArenaSnapshotRecord): Promise<void> {
      await upsertArenaSnapshot({
        agentId: snapshot.agentId,
        seasonId: snapshot.seasonId ?? -1,
        roundDate: snapshot.roundDate,
        cash: snapshot.cash,
        equity: snapshot.equity,
        returnPct: snapshot.returnPct,
      })
    },

    async advanceRound(agentId: number, roundDate: string, cash: number): Promise<void> {
      await updateArenaAgentLastRound(agentId, roundDate)
      await updateArenaAgentCash(agentId, cash)
    },

    async saveIntradayPrices(rows: ArenaIntradayPriceRecord[]): Promise<void> {
      await saveArenaIntradayPrices(rows)
    },

    async saveMarketBriefing(roundDate: string, content: string, model?: string | null, fallbackUsed?: boolean | null): Promise<void> {
      await saveArenaMarketBriefing(roundDate, content, model, fallbackUsed)
    },

    async getMarketBriefing(roundDate: string) {
      const row = await getArenaMarketBriefing(roundDate)
      if (!row) return null
      return { content: row.content, fallbackUsed: !!row.fallback_used }
    },

    async insertDecisionLog(record: ArenaDecisionLogRecord): Promise<void> {
      await insertArenaDecisionLog({
        agentId: record.agentId,
        seasonId: record.seasonId,
        roundDate: record.roundDate,
        phase: record.phase,
        slot: record.slot,
        content: record.content,
        model: record.model,
        fallbackUsed: record.fallbackUsed,
      })
    },

    async saveDiscussion(roundDate: string, content: string, model?: string | null, fallbackUsed?: boolean | null): Promise<void> {
      await saveArenaDiscussion(roundDate, content, model, fallbackUsed)
    },

    // Issue #54：股利入帳 seam（twse_dividends 窗查詢＋arena_dividend_credits 冪等寫入）。
    async getDividendsInWindow(symbols: string[], fromDate: string, toDate: string) {
      const rows = await getTwseDividendsInWindow(symbols, fromDate, toDate)
      return rows.map((r) => ({ symbol: r.symbol, exDate: r.ex_date, cashDividend: r.cash_dividend }))
    },

    async saveDividendCredit(credit: { agentId: number; symbol: string; exDate: string; shares: number; amount: number }): Promise<boolean> {
      return saveArenaDividendCredit({
        agentId: credit.agentId,
        symbol: credit.symbol,
        exDate: credit.exDate,
        shares: credit.shares,
        amount: credit.amount,
      })
    },

    async hasDividendCredit(agentId: number, symbol: string, exDate: string): Promise<boolean> {
      return hasArenaDividendCredit(agentId, symbol, exDate)
    },
  }
}

let strategistInstance: ArenaStrategist | null = null

export function getArenaStrategist(): ArenaStrategist {
  if (!strategistInstance) {
    strategistInstance = new LightweightStrategist()
  }
  return strategistInstance
}

/** 台灣時區當日日期（YYYY-MM-DD）——競技場以台股交易日為輪次。 */
export function arenaTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
}

export interface ArenaTickResult {
  roundDate: string
  alreadyRun: boolean
  universeSize: number
  processed: number
  trades: number
  errors: string[]
  modelCalls: number
  slots?: number
  premarket?: boolean
  discussion?: boolean
  phase?: string
  executedSlot?: number
}

let tickGate: Promise<ArenaTickResult> | null = null

const SLOT_MAP: Record<number, string> = { 0: 'slot0', 1: 'slot1', 2: 'slot2', 3: 'slot3', 4: 'slot4', 5: 'slot5' }

/** 執行單日競技場 tick（支援分段 phase 與完整流程）。 */
export async function runArenaTick(
  roundDate: string,
  opts?: { phase?: 'premarket' | 'slot' | 'close'; slot?: number; force?: boolean },
): Promise<ArenaTickResult> {
  const phase = opts?.phase
  const slot = opts?.slot
  const force = opts?.force ?? false

  // ── 冪等檢查 ─────────────────────────────────────────────────
  if (phase) {
    const phaseKey = phase === 'slot' ? SLOT_MAP[slot ?? 0] : phase
    if (!phaseKey) return { roundDate, alreadyRun: true, universeSize: 0, processed: 0, trades: 0, errors: ['slot index missing'], modelCalls: 0 }
    const done = await getArenaRoundProgress(roundDate, phaseKey)
    if (done && !force) return { roundDate, alreadyRun: true, universeSize: 0, processed: 0, trades: 0, errors: [], modelCalls: 0, phase }
    if (force) {
      await clearArenaPhaseArtifacts(roundDate, phase, slot)
      await clearArenaRoundProgress(roundDate, phaseKey)
    }
  } else {
    const cached = await dbQueryFirst<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM arena_equity_snapshots WHERE round_date = @roundDate',
      { roundDate },
    )
    if ((cached?.cnt ?? 0) > 0 && !force) return { roundDate, alreadyRun: true, universeSize: 0, processed: 0, trades: 0, errors: [], modelCalls: 0 }
  }

  if (tickGate) return tickGate
  tickGate = (async (): Promise<ArenaTickResult> => {
    await ensureActiveArenaSeason()

    // ── 股票池：premarket 寫入，其餘讀取；fallback 動態抓取 ─────
    let universe: ArenaUniverseItem[]
    if (phase === 'premarket' || (!phase)) {
      try {
        universe = await buildDefaultDailyUniverse(roundDate)
        await replaceArenaRoundUniverse(roundDate, universe)
      } catch (err) {
        universe = await buildDefaultDailyUniverse(roundDate)
      }
    } else {
      const persisted = await getArenaRoundUniverse(roundDate)
      universe = persisted.length > 0
        ? persisted.map((r) => ({ symbol: r.symbol, name: r.name ?? r.symbol }))
        : await buildDefaultDailyUniverse(roundDate)
    }

    const { prices, history } = await fetchArenaMarket(universe, roundDate)

    let liveMark: Record<string, number> | undefined
    if (phase === 'slot') {
      try {
        const live = await fetchArenaLivePrices(universe)
        liveMark = live.bySymbol
      } catch (err) {
        console.warn('[ArenaTick] fetchArenaLivePrices failed, fallback closes:', (err as Error).message)
      }
    }

    const result = await runArenaRound({
      store: dbArenaStore(),
      strategist: getArenaStrategist(),
      prices,
      history,
      universe,
      roundDate,
      slippage: Number(process.env.ARENA_SLIPPAGE) || undefined,
      phase,
      slotIndex: slot,
      liveMark,
      customPrompt: ((await getAgentSetting('arena.system_prompt').catch(() => null)) ?? '') || null,
    })

    // ── 標記進度（僅分段模式）──────────────────────────────────
    if (phase) {
      const phaseKey = phase === 'slot' ? SLOT_MAP[slot ?? 0] : phase
      if (phaseKey && result.errors.length === 0) {
        await markArenaRoundProgress(roundDate, phaseKey, `processed=${result.processed} trades=${result.trades}`)
      }
    }

    return {
      alreadyRun: false,
      universeSize: universe.length,
      ...result,
      roundDate,
    }
  })().finally(() => {
    tickGate = null
  })
  return tickGate
}

// ─── Arena tick 背景 job（非同步三態：running / done / failed）────────

/**
 * Watchdog 逾時（分鐘）依 phase 分設（QA 量測定案）：
 * premarket 含股票池建立＋逐檔決策、close 含多 slot 結算 → 20 min；
 * slot 單一時點決策較快 → 12 min；full（不分段）比照 premarket/close → 20 min。
 */
export const ARENA_TICK_WATCHDOG_MIN: Record<string, number> = {
  premarket: 20,
  slot: 12,
  close: 20,
  full: 20,
}

/** 依 phase 回傳 watchdog 分鐘數（未知名/undefined 一律 20）。 */
export function arenaTickWatchdogMinutes(phase?: string | null): number {
  if (phase && phase in ARENA_TICK_WATCHDOG_MIN) return ARENA_TICK_WATCHDOG_MIN[phase]
  return ARENA_TICK_WATCHDOG_MIN.full
}

/** 背景 job 的 result/error 寫入上限（防爆 DB 欄位與 log）。 */
export const ARENA_TICK_ERROR_MAX_CHARS = 2000
export const ARENA_TICK_RESULT_MAX_CHARS = 200_000
export const ARENA_TICK_ERRORS_MAX = 50
export const ARENA_TICK_ERROR_ITEM_MAX_CHARS = 500

/** 收斂 ArenaTickResult 再序列化：errors 陣列截斷＋每筆截短＋總長度保險（保證 ≤ 上限）。 */
export function sanitizeArenaTickResult(result: ArenaTickResult): string {
  const errors = Array.isArray(result.errors)
    ? result.errors.slice(0, ARENA_TICK_ERRORS_MAX).map((e) => String(e).slice(0, ARENA_TICK_ERROR_ITEM_MAX_CHARS))
    : result.errors
  const base = { ...result, errors }
  if (JSON.stringify(base).length <= ARENA_TICK_RESULT_MAX_CHARS) return JSON.stringify(base)

  // 保險：仍超上限 → 遞迴截短所有字串/陣列，並標 truncated
  const cut = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.length > ARENA_TICK_ERROR_ITEM_MAX_CHARS ? value.slice(0, ARENA_TICK_ERROR_ITEM_MAX_CHARS) : value
    }
    if (Array.isArray(value)) return value.slice(0, ARENA_TICK_ERRORS_MAX).map(cut)
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cut(v)
      return out
    }
    return value
  }
  const trimmed = JSON.stringify({ ...(cut(base) as ArenaTickResult), truncated: true })
  if (trimmed.length <= ARENA_TICK_RESULT_MAX_CHARS) return trimmed

  // 再保險：仍超（理論上不會，除非欄位爆炸多）→ 只留摘要欄位
  return JSON.stringify({
    processed: result.processed,
    trades: result.trades,
    errors,
    modelCalls: result.modelCalls,
    roundDate: result.roundDate,
    truncated: true,
    _oversized: true,
  })
}

/**
 * staleness 判定：running 且 updated_at 超過該 phase watchdog → 視為逾時/實例回收。
 * 用於 status 端點（讓 workflow 快速失敗可重觸發）。
 */
function parseArenaTickTimestamp(value: string): Date {
  return new Date(value.replace(' ', 'T') + (value.length === 19 ? 'Z' : ''))
}

export function isArenaTickJobStale(job: ArenaTickJobRow, now: Date = new Date()): boolean {
  if (job.status !== 'running') return false
  const updatedAt = job.updated_at && !Number.isNaN(Date.parse(job.updated_at))
    ? parseArenaTickTimestamp(job.updated_at)
    : job.created_at && !Number.isNaN(Date.parse(job.created_at))
      ? parseArenaTickTimestamp(job.created_at)
      : null
  if (!updatedAt) return true // 無時間戳（不應發生）一律視為 stale，交由重觸發
  const watchdogMs = arenaTickWatchdogMinutes(job.phase) * 60 * 1000
  return now.getTime() - updatedAt.getTime() > watchdogMs
}

/** status 端點對外的三態視圖（running / done(result) / failed(error)，含 staleness 轉 failed）。 */
export interface ArenaTickStatusView {
  status: 'running' | 'done' | 'failed'
  jobId: number
  roundDate: string
  phase: string
  startedAt: string | null
  updatedAt: string | null
  result?: unknown
  error?: string | null
}

export function interpretArenaTickJobStatus(job: ArenaTickJobRow, now: Date = new Date()): ArenaTickStatusView {
  const base = {
    jobId: job.id,
    roundDate: job.round_date,
    phase: job.phase,
    startedAt: job.created_at ?? null,
    updatedAt: job.updated_at ?? null,
  }
  if (job.status === 'done') {
    let result: unknown = null
    if (job.result) {
      try {
        result = JSON.parse(job.result)
      } catch {
        result = null
      }
    }
    return { ...base, status: 'done', result }
  }
  if (job.status === 'failed') {
    return { ...base, status: 'failed', error: job.error ?? '執行失敗' }
  }
  if (isArenaTickJobStale(job, now)) {
    return { ...base, status: 'failed', error: 'job 逾時/實例回收（updated_at 超過 watchdog），請重新觸發' }
  }
  return { ...base, status: 'running' }
}

export interface StartArenaTickJobOptions {
  phase?: 'premarket' | 'slot' | 'close'
  slot?: number
  force?: boolean
}

export interface StartedArenaTickJob {
  jobId: number
  roundDate: string
  phaseKey: string
  deduplicated: boolean
}

/** 建 job（status=running）→ 背景跑 runArenaTick → 完成寫 result+done／例外寫 error+failed；watchdog 逾時標 failed。 */
export async function startArenaTickJob(
  roundDate: string,
  opts: StartArenaTickJobOptions = {},
): Promise<StartedArenaTickJob> {
  // job 路徑確保表存在（migrate 冪等；避免 prod DB 缺 020 表時整段失敗）。
  await migrate()

  const phase = opts.phase
  const slot = opts.slot ?? null
  const phaseKey = phase ? (phase === 'slot' ? (SLOT_MAP[slot ?? 0] ?? 'slot') : phase) : 'full'

  // 去重（M3）：同 (round_date, phase, slot) 已有 running job → 回傳既有 jobId，不重疊執行。
  const existing = await findRunningArenaTickJob(roundDate, phase ?? 'full', slot)
  if (existing) {
    return { jobId: existing.id, roundDate, phaseKey, deduplicated: true }
  }

  const jobId = await saveArenaTickJob({ roundDate, phase: phase ?? 'full', slot })
  if (jobId <= 0) {
    throw new Error('建立 tick job 失敗（DB 不可用）')
  }

  const watchdogMs = arenaTickWatchdogMinutes(phase ?? 'full') * 60 * 1000

  // 背景執行（fire-and-forget）：route 不等待 LLM，只回 jobId。
  void (async () => {
    let settled = false
    const finish = async (patch: { status: 'done' | 'failed'; result?: string; error?: string }) => {
      if (settled) return
      settled = true
      await updateArenaTickJob(jobId, patch)
    }

    const timer = setTimeout(() => {
      void finish({ status: 'failed', error: `執行逾時（watchdog ${arenaTickWatchdogMinutes(phase ?? 'full')} min）` })
    }, watchdogMs)
    timer.unref?.()

    try {
      const result = await runArenaTick(roundDate, { phase, slot: slot ?? undefined, force: opts.force })
      await finish({ status: 'done', result: sanitizeArenaTickResult(result) })
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, ARENA_TICK_ERROR_MAX_CHARS)
      await finish({ status: 'failed', error: msg || '執行失敗' })
    } finally {
      clearTimeout(timer)
    }
  })()

  return { jobId, roundDate, phaseKey, deduplicated: false }
}