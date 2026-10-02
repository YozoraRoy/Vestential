import type { ArenaStore } from './store.js'
import type { ArenaStrategist } from './strategist.js'
import { applyArenaDecision, computeArenaEquity, isArenaGuardRejection, type ArenaLedgerEntry } from './ledger.js'
import { buildMarketBriefing } from './market-briefing.js'
import {
  buildPostCloseReflection,
  buildPreMarketPlan,
  buildDiscussionSummary,
  fallbackDiscussion,
  fallbackPlan,
  fallbackReflection,
  type DiscussionParticipant,
} from './narration.js'
import { buildSlotPrices } from './intraday.js'
import type { ArenaDayOhlc, ArenaPrice, ArenaUniverseItem } from './types.js'
import { arenaSlotTimes } from './types.js'
import { arenaReturnPct } from './returns.js'
import { creditArenaDividends } from './dividends.js'
import { ARENA_TONE_DESCRIPTIONS, type ArenaDecisionContext } from './strategist.js'

export interface RunArenaRoundParams {
  store: ArenaStore
  strategist: ArenaStrategist
  /** 決策用參考資料（symbol -> 收盤報價）。 */
  prices: Record<string, ArenaPrice>
  history: Record<string, Array<{ date: string; close: number }>>
  universe: ArenaUniverseItem[]
  roundDate: string
  /** 可選：限制處理的 agent id（重跑某季時使用）。 */
  agentIds?: number[]
  slippage?: number
  /** 盤中決策時點數；預設取 ARENA_INTRADAY_SLOTS env（缺省 = 全部時點）。0 = 停用盤中、退回單次收盤決策。 */
  intradaySlots?: number
  /**
   * 分段執行模式（可省略，省略 = 原有完整流程）。
   * - `premarket`：僅產出盤前簡報與各 agent 盤前計畫。
   * - `slot`：僅執行指定 slotIndex 的盤中決策（使用 liveMark 即時價格）。
   * - `close`：僅做收盤結算（equity snapshot）與圓桌討論。
   */
  phase?: 'premarket' | 'slot' | 'close'
  /** 目標 slot index（phase=slot 時必須）。 */
  slotIndex?: number
  /**
   * phase=slot 時的即時報價（bare symbol → price），作為交易時點的 mark / closes。
   * 缺失 symbol 回退到 prices（日線收盤）。
   */
  liveMark?: Record<string, number>
  /** 全域 custom prompt 覆寫（後台 arena.system_prompt），附加到每個 agent 決策 system prompt 末尾。 */
  customPrompt?: string | null
}

export interface RunArenaRoundResult {
  processed: number
  trades: number
  errors: string[]
  modelCalls: number
  roundDate: string
  /** 本次執行的盤中時點數。 */
  slots: number
  /** 是否產出盤前簡報與各 agent 盤前計畫。 */
  premarket: boolean
  /** 是否產出收後自評與圓桌討論。 */
  discussion: boolean
  /** 實際執行的 phase（undefined 表示完整流程）。 */
  phase?: string
  /** slotPhase 時的 slot index（供上層寫入進度 marker）。 */
  executedSlot?: number
}

interface AgentState {
  cash: number
  holdings: import('./types.js').ArenaHolding[]
  initialCapital: number
  trades: Array<{ slot: number | null; timeLabel: string; log: ArenaLedgerEntry; tradeError?: string | null }>
  refusals: number
  placed: number
}

function envBool(key: string, defaultValue = false): boolean {
  const v = process.env[key]?.trim().toLowerCase()
  if (v === undefined || v === '') return defaultValue
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function entryText(e: ArenaLedgerEntry): string {
  const sym = `${e.symbol ?? ''}${e.symbolName ? ' ' + e.symbolName : ''}`
  const qty = e.shares ? ` ${e.shares}股` : ''
  const px = e.price ? `@${e.price}` : ''
  const reason = e.reason ? `（${e.reason}）` : ''
  return `${e.action} ${sym}${qty}${px}${reason}`
}

export async function runArenaRound(params: RunArenaRoundParams): Promise<RunArenaRoundResult> {
  const { store, strategist, prices, history, universe, roundDate, agentIds, slippage, phase, slotIndex, liveMark, customPrompt } = params
  const errors: string[] = []
  let trades = 0
  let modelCalls = 0

  const slotTimes = arenaSlotTimes()
  const slotsOverride = params.intradaySlots ?? Number(process.env.ARENA_INTRADAY_SLOTS)
  const numSlots =
    Number.isFinite(slotsOverride) && slotsOverride >= 0
      ? Math.min(Math.max(0, Math.floor(slotsOverride)), slotTimes.length)
      : slotTimes.length
  const premarketEnabled = envBool('ARENA_ENABLE_PREMARKET', true)
  const discussionEnabled = envBool('ARENA_ENABLE_DISCUSSION', true)

  // closes: fallback mark（日線收盤），供 stop-loss / missing-symbol 使用
  const closes: Record<string, number> = {}
  const symbolNames: Record<string, string> = {}
  const days: Record<string, ArenaDayOhlc> = {}
  for (const u of universe) {
    const px = prices[u.symbol]
    if (px && px.price > 0) {
      closes[u.symbol] = px.price
      symbolNames[u.symbol] = px.symbolName ?? u.name
    }
    if ((px as (ArenaPrice & { day?: ArenaDayOhlc }))?.day) {
      days[u.symbol] = (px as (ArenaPrice & { day?: ArenaDayOhlc })).day!
    }
  }

  // 決定性合成盤中路徑（slot -> symbol -> price），可重播、冪等。
  const slotPrices: Array<Record<string, number>> = Array.from({ length: numSlots }, () => ({}))
  const dayPaths: Record<string, import('./types.js').ArenaSlotPrice[]> = {}
  for (const u of universe) {
    const day = (prices[u.symbol] as (ArenaPrice & { day?: ArenaDayOhlc }))?.day
    if (!day) continue
    const path = buildSlotPrices(u.symbol, day, slotTimes.slice(0, numSlots))
    if (path.length > 0) {
      dayPaths[u.symbol] = path
      for (const p of path) slotPrices[p.slot][u.symbol] = p.price
    }
  }
  if (numSlots > 0 && Object.keys(dayPaths).length > 0) {
    const rows = universe.flatMap((u) =>
      (dayPaths[u.symbol] ?? []).map((p) => ({
        roundDate,
        symbol: u.symbol,
        slot: p.slot,
        timeLabel: p.timeLabel,
        price: p.price,
        changePct: p.changePct ?? null,
      })),
    )
    try {
      await store.saveIntradayPrices(rows)
    } catch (err) {
      errors.push(`saveIntradayPrices failed: ${(err as Error).message}`)
    }
  }

  const agents = (await store.listActiveAgents()).filter(
    (a) => a.status === 'active' && (!agentIds || agentIds.includes(a.id)),
  )

  const states = new Map<number, AgentState>()
  for (const agent of agents) {
    states.set(agent.id, {
      cash: agent.cash,
      holdings: await store.getHoldings(agent.id),
      initialCapital: agent.initialCapital,
      trades: [],
      refusals: 0,
      placed: 0,
    })
  }

  // ── 簡報：premarket 段落產生；其餘段落從 DB 讀取 ──────────────
  let briefingText: string | null = null
  if (premarketEnabled && phase !== 'close') {
    if (phase === 'premarket' || !phase) {
      const briefing = await buildMarketBriefing({ roundDate, universe, prices, history, days, maxTokens: 900 })
      modelCalls++
      briefingText = briefing.content
      try {
        await store.saveMarketBriefing(roundDate, briefing.content, briefing.model ?? null, briefing.fallbackUsed)
      } catch (err) {
        errors.push(`saveMarketBriefing failed: ${(err as Error).message}`)
      }
      for (const agent of agents) {
        const res = await buildPreMarketPlan({
          agentName: agent.name,
          roundDate,
          briefing: briefingText,
          cash: states.get(agent.id)!.cash,
          holdings: states.get(agent.id)!.holdings,
          personality: agent.personality,
          strategyParams: agent.strategyParams,
          initialCapital: agent.initialCapital,
        })
        modelCalls++
        const content = res.content || fallbackPlan(agent.name)
        if (res.error) errors.push(`agent#${agent.id} premarket plan failed: ${res.error}`)
        try {
          await store.insertDecisionLog({
            agentId: agent.id,
            seasonId: agent.seasonId,
            roundDate,
            phase: 'premarket',
            content,
            model: res.model ?? null,
            fallbackUsed: res.fallbackUsed ?? false,
          })
        } catch (err) {
          errors.push(`insertDecisionLog(premarket, agent#${agent.id}) failed: ${(err as Error).message}`)
        }
      }
      return {
        processed: agents.length,
        trades: 0,
        errors,
        modelCalls,
        roundDate,
        slots: 0,
        premarket: true,
        discussion: false,
        phase: 'premarket',
      }
    } else {
      try {
        const cached = await store.getMarketBriefing(roundDate)
        briefingText = cached?.content ?? null
      } catch {}
    }
  }

  // ── 即時盤中決策（phase=slot）────────────────────────────────
  if (phase === 'slot') {
    if (slotIndex === undefined || slotIndex < 0 || slotIndex >= slotTimes.length) {
      errors.push(`slotIndex ${slotIndex} invalid (0..${slotTimes.length - 1})`)
      return { processed: 0, trades: 0, errors, modelCalls, roundDate, slots: 0, premarket: false, discussion: false, phase: 'slot', executedSlot: slotIndex }
    }
    const mark = { ...liveMark }
    for (const u of universe) if (mark[u.symbol] === undefined) mark[u.symbol] = closes[u.symbol]

    // 記錄盤中時點價格（即時）
    try {
      await store.saveIntradayPrices(
        universe
          .filter((u) => mark[u.symbol] > 0)
          .map((u) => ({
            roundDate,
            symbol: u.symbol,
            slot: slotIndex,
            timeLabel: slotTimes[slotIndex] ?? `${slotIndex + 1}`,
            price: mark[u.symbol],
            changePct: null,
          })),
      )
    } catch (err) {
      errors.push(`saveIntradayPrices(slot${slotIndex}) failed: ${(err as Error).message}`)
    }

    for (const agent of agents) {
      const ctx: ArenaDecisionContext = {
        agent: { id: agent.id, name: agent.name, strategyId: agent.strategyId, tone: agent.tone },
        strategyName: agent.strategyId,
        toneDescription: ARENA_TONE_DESCRIPTIONS[agent.tone],
        roundDate,
        cash: states.get(agent.id)!.cash,
        initialCapital: agent.initialCapital,
        holdings: states.get(agent.id)!.holdings,
        prices,
        history,
        universe,
        phase: 'trade',
        slot: slotIndex,
        slotTimeLabel: slotTimes[slotIndex],
        slotPrices: mark,
        briefing: briefingText ?? undefined,
        personality: agent.personality,
        strategyParams: agent.strategyParams,
        customPrompt,
      }
      let decision: import('./types.js').ArenaDecision
      let model: string | undefined
      let fallbackUsed = false
      let decisionError: string | undefined
      try {
        const res = await strategist.decide(ctx)
        model = res.model
        fallbackUsed = res.fallbackUsed ?? false
        decisionError = res.error
        decision = res.decision
        modelCalls++
      } catch (err) {
        errors.push(`agent#${agent.id} slot${slotIndex} decide failed: ${(err as Error).message}`)
        decision = { actions: [] }
      }
      await persistSlot(agent, slotIndex, slotTimes[slotIndex] ?? `${slotIndex + 1}`, decision, model, fallbackUsed, decisionError, mark)
    }

    return {
      processed: agents.length,
      trades,
      errors,
      modelCalls,
      roundDate,
      slots: 1,
      premarket: false,
      discussion: false,
      phase: 'slot',
      executedSlot: slotIndex,
    }
  }

  // ── 收盤結算（phase=close 或完整流程的收盤）────────────────
  if (phase === 'close') {
    // 從 DB 回填各 agent 當日交易紀錄
    for (const agent of agents) {
      const st = states.get(agent.id)!
      const dbTrades = await store.getRoundTrades(agent.id, roundDate)
      for (const t of dbTrades) {
        const timeLabel = t.slot !== null && t.slot !== undefined ? (slotTimes[t.slot] ?? `slot${t.slot}`) : '收盤'
        st.trades.push({
          slot: t.slot,
          timeLabel,
          log: { action: t.action as ArenaLedgerEntry['action'] },
          tradeError: t.error,
        })
      }
      st.placed = dbTrades.filter((t) => t.error !== 'REJECTED').length
      st.refusals = dbTrades.filter((t) => t.error === 'REJECTED').length
    }
  }

  // 舊有完整模式中的 slot 決策（phase 未指定時）
  if (!phase && numSlots > 0) {
    const baseCtx = (agent: (typeof agents)[number], slot: number | null, pricesAt: Record<string, number>): ArenaDecisionContext => ({
      agent: { id: agent.id, name: agent.name, strategyId: agent.strategyId, tone: agent.tone },
      strategyName: agent.strategyId,
      toneDescription: ARENA_TONE_DESCRIPTIONS[agent.tone],
      roundDate,
      cash: states.get(agent.id)!.cash,
      initialCapital: agent.initialCapital,
      holdings: states.get(agent.id)!.holdings,
      prices,
      history,
      universe,
      phase: 'trade' as const,
      slot: slot ?? undefined,
      slotTimeLabel: slot != null ? slotTimes[slot] : undefined,
      slotPrices: pricesAt,
      heldDayPaths: undefined,
      briefing: briefingText ?? undefined,
      personality: agent.personality,
      strategyParams: agent.strategyParams,
      customPrompt,
    })

    for (let slot = 0; slot < numSlots; slot++) {
      const mark = slotPrices[slot] ?? {}
      const markWithFallback = { ...mark }
      for (const u of universe) if (markWithFallback[u.symbol] === undefined) markWithFallback[u.symbol] = closes[u.symbol]

      for (const agent of agents) {
        const st = states.get(agent.id)!
        const heldDayPaths: Record<string, import('./types.js').ArenaSlotPrice[]> = {}
        for (const s of st.holdings.map((h) => h.symbol)) {
          const p = dayPaths[s]
          if (p && p.length > 0) heldDayPaths[s] = p
        }
        const ctx = baseCtx(agent, slot, markWithFallback)
        ctx.heldDayPaths = heldDayPaths

        let decision: import('./types.js').ArenaDecision
        let model: string | undefined
        let fallbackUsed = false
        let decisionError: string | undefined
        try {
          const res = await strategist.decide(ctx)
          model = res.model
          fallbackUsed = res.fallbackUsed ?? false
          decisionError = res.error
          decision = res.decision
          modelCalls++
        } catch (err) {
          errors.push(`agent#${agent.id} slot ${slot} decide failed: ${(err as Error).message}`)
          decision = { actions: [] }
        }
        await persistSlot(agent, slot, slotTimes[slot] ?? `${slot + 1}`, decision, model, fallbackUsed, decisionError, markWithFallback)
      }
    }
  } else if (!phase) {
    // 完整模式、停用盤中：收盤一次決策
    for (const agent of agents) {
      const ctx: ArenaDecisionContext = {
        agent: { id: agent.id, name: agent.name, strategyId: agent.strategyId, tone: agent.tone },
        strategyName: agent.strategyId,
        toneDescription: ARENA_TONE_DESCRIPTIONS[agent.tone],
        roundDate,
        cash: states.get(agent.id)!.cash,
        initialCapital: agent.initialCapital,
        holdings: states.get(agent.id)!.holdings,
        prices,
        history,
        universe,
        phase: 'trade' as const,
        slotPrices: closes,
        briefing: briefingText ?? undefined,
        personality: agent.personality,
        strategyParams: agent.strategyParams,
        customPrompt,
      }
      let decision: import('./types.js').ArenaDecision
      let model: string | undefined
      let fallbackUsed = false
      let decisionError: string | undefined
      try {
        const res = await strategist.decide(ctx)
        model = res.model
        fallbackUsed = res.fallbackUsed ?? false
        decisionError = res.error
        decision = res.decision
        modelCalls++
      } catch (err) {
        errors.push(`agent#${agent.id} decide failed: ${(err as Error).message}`)
        decision = { actions: [] }
      }
      await persistSlot(agent, null, '收盤', decision, model, fallbackUsed, decisionError, closes)
    }
  }

  // ── 收盤 equity snapshot（close / full 模式）──────────────────
  if (!phase || phase === 'close') {
    // Issue #54：現金股利自動入帳（結算時持有即發；冪等；缺快取跳過；歷史快照不追溯）。
    for (const agent of agents) {
      const st = states.get(agent.id)!
      try {
        const credited = await creditArenaDividends(store, agent.id, roundDate, st.holdings)
        if (credited > 0) {
          st.cash = Math.round((st.cash + credited) * 100) / 100
          await store.advanceRound(agent.id, roundDate, st.cash)
        }
      } catch (err) {
        errors.push(`agent#${agent.id} dividend credit failed: ${(err as Error).message}`)
      }
    }
    for (const agent of agents) {
      const st = states.get(agent.id)!
      const equity = computeArenaEquity(st.cash, st.holdings, closes)
      await store.insertSnapshot({
        agentId: agent.id,
        seasonId: agent.seasonId,
        roundDate,
        cash: st.cash,
        equity,
        returnPct: arenaReturnPct(equity, st.initialCapital),
      })
    }
  }

  // ── 收後總結 + 圓桌討論（close / full 模式）─────────────────
  let discussionDone = false
  if (discussionEnabled && states.size > 0 && (!phase || phase === 'close')) {
    const participants: DiscussionParticipant[] = []
    for (const agent of agents) {
      const st = states.get(agent.id)!
      const equity = computeArenaEquity(st.cash, st.holdings, closes)
      const returnPct = arenaReturnPct(equity, st.initialCapital)
      const res = await buildPostCloseReflection({
        agentName: agent.name,
        roundDate,
        trades: st.trades.map((t) => ({
          slot: t.slot,
          timeLabel: t.timeLabel,
          action: t.log.action,
          symbol: t.log.symbol ?? null,
          symbolName: t.log.symbolName ?? null,
          shares: t.log.shares ?? null,
          price: t.log.price ?? null,
          reason: t.log.reason ?? null,
        })),
        cash: st.cash,
        equity,
        returnPct,
        holdings: st.holdings,
        initialCapital: agent.initialCapital,
        personality: agent.personality,
      })
      modelCalls++
      const content = res.content || fallbackReflection(agent.name, roundDate)
      if (res.error) errors.push(`agent#${agent.id} reflection failed: ${res.error}`)
      try {
        await store.insertDecisionLog({
          agentId: agent.id,
          seasonId: agent.seasonId,
          roundDate,
          phase: 'postclose',
          content,
          model: res.model ?? null,
          fallbackUsed: res.fallbackUsed ?? false,
        })
      } catch (err) {
        errors.push(`insertDecisionLog(postclose, agent#${agent.id}) failed: ${(err as Error).message}`)
      }
      participants.push({ agentName: agent.name, recovery: { placed: st.placed, rejected: st.refusals }, equity, returnPct, reflection: content })
    }

    const sum = await buildDiscussionSummary({
      roundDate,
      participants: [...participants].sort((a, b) => b.returnPct - a.returnPct),
    })
    modelCalls++
    const content = sum.content || fallbackDiscussion(roundDate, participants.length)
    if (sum.error) errors.push(`discussion failed: ${sum.error}`)
    try {
      await store.saveDiscussion(roundDate, content, sum.model ?? null, sum.fallbackUsed ?? false)
      discussionDone = true
    } catch (err) {
      errors.push(`saveDiscussion failed: ${(err as Error).message}`)
    }
  }

  return {
    processed: agents.length,
    trades,
    errors,
    modelCalls,
    roundDate,
    slots: phase === 'close' ? 0 : numSlots,
    premarket: false,
    discussion: discussionDone,
    phase,
  }

  async function persistSlot(
    agent: (typeof agents)[number],
    slot: number | null,
    timeLabel: string,
    decision: import('./types.js').ArenaDecision,
    model: string | undefined,
    fallbackUsed: boolean,
    decisionError: string | undefined,
    mark: Record<string, number>,
  ): Promise<void> {
    const st = states.get(agent.id)!
    const ledger = applyArenaDecision({
      cash: st.cash,
      holdings: st.holdings,
      closes: mark,
      symbolNames,
      decision,
      slippage,
      strategyParams: agent.strategyParams,
      // #40：守衛觸發 log 帶 agent＋round＋slot，方便週一對帳
      guardContext: { agentId: agent.id, roundDate, slot },
    })

    // #40：總量守衛擋單落盤（rejected 原因已寫入 trade 表＋decision log，此處再記 server log 供週一對帳）
    const guardRejected = ledger.rejected.filter((r) => isArenaGuardRejection(r.reason))
    if (guardRejected.length > 0) {
      const detail = guardRejected
        .map((r) => `${r.action} ${r.symbol ?? ''}${r.shares ? ` x${r.shares}` : ''}（${r.reason}）`)
        .join('；')
      console.warn(
        `[ArenaLedger#40] agent#${agent.id} round=${roundDate} slot=${slot ?? timeLabel} 總量守衛擋下 ${guardRejected.length} 筆：${detail}`,
      )
    }

    const execTexts: string[] = []
    for (const e of ledger.entries) {
      st.trades.push({ slot, timeLabel, log: e })
      execTexts.push(entryText(e))
      await store.insertTrade({
        agentId: agent.id,
        seasonId: agent.seasonId,
        roundDate,
        slot,
        action: e.action,
        symbol: e.symbol,
        symbolName: e.symbolName,
        shares: e.shares,
        price: e.price,
        fee: e.fee,
        tax: e.tax,
        reason: e.reason,
        model,
        fallbackUsed: fallbackUsed || undefined,
        error: decisionError,
      })
    }
    for (const r of ledger.rejected) {
      st.refusals++
      await store.insertTrade({
        agentId: agent.id,
        seasonId: agent.seasonId,
        roundDate,
        slot,
        action: r.action,
        symbol: r.symbol,
        shares: r.shares,
        reason: r.reason,
        model,
        fallbackUsed: fallbackUsed || undefined,
        error: 'REJECTED',
      })
    }
    trades += ledger.entries.filter((e) => e.action === 'BUY' || e.action === 'SELL').length

    // #40：成交對帳最終防線（ledger 已保證 cash ≥ 0，此處僅防禦＋log，不回填歷史）
    let settledCash = ledger.cash
    if (settledCash < 0) {
      console.warn(
        `[ArenaLedger#40] agent#${agent.id} round=${roundDate} slot=${slot ?? timeLabel} 對帳異常：cash=${settledCash}（已箝制為 0，請對帳）`,
      )
      settledCash = 0
    }
    st.cash = settledCash
    st.holdings = ledger.holdings
    await store.replaceHoldings(agent.id, ledger.holdings, roundDate)
    await store.advanceRound(agent.id, roundDate, settledCash)

    const logContent = [execTexts.join('\n'), ...ledger.rejected.map((r) => `☓ ${entryText(r)}`)].filter(Boolean).join('\n')
    await store.insertDecisionLog({
      agentId: agent.id,
      seasonId: agent.seasonId,
      roundDate,
      phase: 'trade',
      slot: slot ?? undefined,
      content: logContent || '維持現狀',
      model: model ?? null,
      fallbackUsed: fallbackUsed || null,
    })
  }
}
