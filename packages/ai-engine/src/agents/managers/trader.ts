import { z } from 'zod'
import type { AnalysisState } from '@stock/core'
import type { LLMClient } from '../../llm/client.js'
import { truncateField } from '../../context.js'

const PositionSizingSchema = z.union([
  z.string(),
  z.object({
    total_allocation_pct: z.number().optional(),
    total_allocation: z.number().optional(),
    phased_entry: z.array(
      z.object({
        tranche: z.number().optional(),
        percentage_of_total: z.number().optional(),
        trigger: z.string().optional(),
        price: z.number().optional(),
      }),
    ).optional(),
    risk_per_trade_pct: z.number().optional(),
  }).passthrough(),
])

function formatPositionSizing(value: string | object | undefined): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  const obj = value as Record<string, any>
  const lines: string[] = []
  const allocation =
    obj.total_allocation_pct ??
    obj.total_allocation ??
    obj.allocation_pct ??
    obj.percent
  if (allocation != null) lines.push(`Total allocation: ${allocation}%`)
  if (obj.risk_per_trade_pct != null) lines.push(`Risk per trade: ${obj.risk_per_trade_pct}%`)
  if (Array.isArray(obj.phased_entry) && obj.phased_entry.length > 0) {
    const tranches = obj.phased_entry
      .map((t: Record<string, any>) => {
        const pct = t.percentage_of_total ?? t.percent ?? t.weight
        const trigger = t.trigger ?? t.condition
        const price = t.price ?? t.target_price
        return [
          t.tranche != null ? `Tranche ${t.tranche}` : 'Tranche',
          pct != null ? `(${pct}%)` : null,
          trigger ? `: ${trigger}` : null,
          price != null ? ` @ ${price}` : null,
        ].filter(Boolean).join(' ')
      })
      .join('; ')
    lines.push(`Phased entry: ${tranches}`)
  }
  return lines.length > 0 ? lines.join(', ') : JSON.stringify(obj)
}

/** Issue #53 續作：invalidation／tranches 接受 string｜(string｜object)[]。模型偶爾回傳
 *  物件陣列（如 {trigger,sizePct}／{percentage,triggerPrice,description}），
 *  以可讀字串拼接存（下游 traderProposal 維持字串）；其餘型別（number／boolean／null／
 *  純 object 非陣列／含非字串非物件元素的陣列）照樣拒絕（拋錯＋partial），不做無條件 String() 兜底。 */
function formatStringList(items: string[]): string | undefined {
  const cleaned = items.map((s) => s.trim()).filter(Boolean)
  if (cleaned.length === 0) return undefined
  if (cleaned.length === 1) return cleaned[0]
  return cleaned.map((s, i) => `${i + 1}. ${s}`).join('\n')
}

/** 物件元素轉可讀字串：優先取人類可讀欄位拼接，缺欄位時 JSON.stringify 兜底。 */
function formatObjectItem(obj: Record<string, any>): string {
  const textKeys = [
    'description',
    'trigger',
    'reasoning',
    'reason',
    'text',
    'content',
    'condition',
    'detail',
    'label',
    'title',
    'name',
  ]
  const pctKeys = [
    'sizePct',
    'size_pct',
    'percentage',
    'percentage_of_total',
    'percent',
    'weight',
    'size',
    'allocation',
    'allocation_pct',
  ]
  const priceKeys = ['triggerPrice', 'trigger_price', 'target_price', 'price', 'level', 'target']
  const scalar = (v: unknown): string | undefined => {
    if (v == null) return undefined
    if (typeof v === 'string') {
      const t = v.trim()
      return t || undefined
    }
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    return undefined
  }
  const texts: string[] = []
  for (const k of textKeys) {
    const s = scalar(obj[k])
    if (s != null && !texts.includes(s)) texts.push(s)
  }
  let pct: string | undefined
  for (const k of pctKeys) {
    const s = scalar(obj[k])
    if (s != null) {
      pct = typeof obj[k] === 'number' ? `${s}%` : s.includes('%') ? s : `${s}%`
      break
    }
  }
  // 數量欄位若本身就是可讀文字（如 "50% 現價進場"），scalar 已取到；pct 僅作前綴補強
  let price: string | undefined
  for (const k of priceKeys) {
    const s = scalar(obj[k])
    if (s != null && !texts.some((t) => t.includes(s))) {
      price = s
      break
    }
  }
  const parts: string[] = []
  if (pct != null && !texts.some((t) => t.includes(pct as string))) parts.push(pct)
  parts.push(...texts)
  if (price != null) parts.push(`@ ${price}`)
  if (parts.length > 0) return parts.join(' ').trim()
  try {
    return JSON.stringify(obj)
  } catch {
    return String(obj)
  }
}

const ListItemObject = z.object({}).passthrough()

const StringOrStringArray = z
  .union([z.string(), z.array(z.union([z.string(), ListItemObject]))])
  .optional()
  .transform((value): string | undefined => {
    if (value == null) return undefined
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed || undefined
    }
    const stringified = value.map((item) =>
      typeof item === 'string' ? item : formatObjectItem(item as Record<string, any>),
    )
    return formatStringList(stringified)
  })

export const TraderProposalSchema = z.object({
  action: z.enum(['Buy', 'Hold', 'Sell']),
  reasoning: z.string(),
  entryPrice: z.number().optional(),
  entry_price: z.number().optional(),
  /** Issue #19 Trader 結構化：進場區間（上限／下限；未知時可為文字描述）。 */
  entryRangeLow: z.number().optional(),
  entry_range_low: z.number().optional(),
  entryRangeHigh: z.number().optional(),
  entry_range_high: z.number().optional(),
  stopLoss: z.number().optional(),
  stop_loss: z.number().optional(),
  /** 失效條件：哪些情況出現即代表本次交易假設被推翻、應出場或重新評估。 */
  invalidation: StringOrStringArray,
  /** 分批進場計畫（文字描述，如「分兩批：首批 50% 現價，第二批 50% 回測支撐」）。 */
  tranches: StringOrStringArray,
  /** 單一標的部位上限（佔總資金 %，數字）。 */
  maxPositionPct: z.number().optional(),
  max_position_pct: z.number().optional(),
  positionSizing: z.union([z.string(), PositionSizingSchema]).optional(),
  position_sizing: z.union([z.string(), PositionSizingSchema]).optional(),
}).transform((data) => ({
  action: data.action,
  reasoning: data.reasoning,
  entryPrice: data.entryPrice ?? data.entry_price,
  entryRangeLow: data.entryRangeLow ?? data.entry_range_low,
  entryRangeHigh: data.entryRangeHigh ?? data.entry_range_high,
  stopLoss: data.stopLoss ?? data.stop_loss,
  invalidation: data.invalidation,
  tranches: data.tranches,
  maxPositionPct: data.maxPositionPct ?? data.max_position_pct,
  positionSizing: formatPositionSizing(data.positionSizing ?? data.position_sizing),
}))

/** Issue #19：Trader 報告固定結尾免責句（隨報告語言輸出；此為繁中版本，英文／日文由 outputInstruction 在地化同義句）。 */
export const TRADER_DISCLAIMER_ZH =
  '免責聲明：本交易計畫僅供資訊參考，不構成任何投資建議。投資一定有風險，請審慎評估後自行決策。'

export function createTrader(llm: LLMClient) {
  return async (state: AnalysisState): Promise<Partial<AnalysisState>> => {
    const prompt = [
      `You are the Trader. Convert the Research Manager's plan into a concrete trade proposal.`,
      '',
      truncateField(state.instrumentContext, 'Resources:', undefined, state.outputLanguage),
      truncateField(state.investmentPlan, `Investment Plan:`, undefined, state.outputLanguage),
      '',
      `Specify ALL of the following structured fields (use null only when truly unknowable):`,
      `- action (Buy/Hold/Sell)`,
      `- reasoning`,
      `- entry range (entryRangeLow / entryRangeHigh): a price zone to scale in, not a single point; fall back to entryPrice when only one level is known`,
      `- stop loss (stopLoss): the hard exit price`,
      `- invalidation: 1-3 concrete conditions that prove this trade thesis wrong (e.g. daily close below support, thesis catalyst fails to materialize)`,
      `- tranches: phased entry plan (e.g. batch sizes with triggers)`,
      `- maxPositionPct: max position size for this single ticker as % of total capital`,
      `- position sizing`,
      '',
      state.outputInstruction,
    ].join('\n')

    const proposal = await llm.generateObject<z.infer<typeof TraderProposalSchema>>(
      'You convert investment plans into concrete trade orders with specific prices and sizing.',
      prompt,
      TraderProposalSchema,
    )

    const entryRange =
      proposal.entryRangeLow != null && proposal.entryRangeHigh != null
        ? `${proposal.entryRangeLow} ~ ${proposal.entryRangeHigh}`
        : proposal.entryRangeLow != null
          ? `≥ ${proposal.entryRangeLow}`
          : proposal.entryRangeHigh != null
            ? `≤ ${proposal.entryRangeHigh}`
            : undefined
    const disclaimer =
      state.outputLanguage === 'en'
        ? 'Disclaimer: This trading plan is for informational purposes only and does not constitute investment advice. All investments involve risk; please evaluate carefully and decide on your own.'
        : state.outputLanguage === 'ja'
          ? '免責事項：本取引計画は情報提供のみを目的としており、投資助言ではありません。投資にはリスクが伴いますので、ご自身で慎重にご判断ください。'
          : TRADER_DISCLAIMER_ZH

    const traderPlan = [
      `**Action**: ${proposal.action}`,
      `**Reasoning**: ${proposal.reasoning}`,
      entryRange ? `**Entry Range**: ${entryRange}` : '',
      proposal.entryPrice ? `**Entry Price**: ${proposal.entryPrice}` : '',
      proposal.stopLoss ? `**Stop Loss**: ${proposal.stopLoss}` : '',
      proposal.invalidation ? `**Invalidation**: ${proposal.invalidation}` : '',
      proposal.tranches ? `**Phased Entry**: ${proposal.tranches}` : '',
      proposal.maxPositionPct != null ? `**Max Position**: ${proposal.maxPositionPct}%` : '',
      proposal.positionSizing ? `**Position Sizing**: ${proposal.positionSizing}` : '',
      `FINAL TRANSACTION PROPOSAL: **${proposal.action.toUpperCase()}**`,
      '',
      disclaimer,
    ].filter(Boolean).join('\n')

    return { traderProposal: traderPlan }
  }
}
