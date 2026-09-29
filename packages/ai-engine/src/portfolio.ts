import { z } from 'zod'
import { loadConfig } from '@stock/core'
import { createQuickLLM } from './llm/quick.js'
import { FallbackClient } from './llm/fallback-client.js'

export interface InvestmentFramework {
  id: string
  nameZh: string
  nameEn: string
  /** 該投資法則的核心原則，注入給 AI 作為分析框架。 */
  doctrine: string
}

export const INVESTMENT_FRAMEWORKS: InvestmentFramework[] = [
  {
    id: 'buffett',
    nameZh: '巴菲特價值投資',
    nameEn: 'Value Investing (Buffett)',
    doctrine: [
      '以長期持有卓越企業為核心：只買自己能理解、具備持久經濟護城河（品牌、壟斷、轉換成本）的企業。',
      '重視財務品質：高且穩定的 ROE、低負債、強勁自由現金流，而非一時股價表現。',
      '用合理價格買進好公司：自行估算企業內在價值（DCF／預估盈餘折現），出手時要有安全邊際（Margin of Safety）。',
      '評估個人部位時比較「每股成本 vs 內在價值預估」：成本遠低於內在價值 → 繼續持有／加碼；成本已高於內在價值且基本面轉差 → 考慮減碼。',
      '賣出條件僅限：企業護城河永久受損、內在價值大幅下修、或出現遠優於現況的替換標的。',
    ].join('；'),
  },
  {
    id: 'growth',
    nameZh: '成長股投資',
    nameEn: 'Growth Investing',
    doctrine: [
      '聚焦營收與獲利的持續高成長、可擴張的市場規模（TAM）、高再投資報酬率。',
      '容忍較高的本益比，只要成長速度足以支撐估值；重視 PEG 與營收加速跡象。',
      '風險在成長不如預期時的估值修正：評估個人部位時要判斷「買進成本所反應的成長預期」是否仍合理。',
      '成長減速、市占流失或商業模式被顛覆 → 建議減碼；成長動能維持強勁且估值合理 → 續抱或加碼。',
    ].join('；'),
  },
  {
    id: 'dividend',
    nameZh: '股息現金流投資',
    nameEn: 'Dividend / Cash Flow Investing',
    doctrine: [
      '以穩定配息與現金流累積為目標：重視殖利率（含以成本計算的殖利率）、配息的可持續性與成長。',
      '檢查配息發放率（payout ratio）、自由現金流能否覆蓋股息、公司是否長期穩定增發股利。',
      '評估個人部位時，把「以成本計算的股息殖利率」視為重要指標：成本越低、殖利率越高，越有續抱價值。',
      '股息縮減、公司財務轉弱或高負債 → 建議減碼；配息穩定成長且財務健全 → 續抱並可考慮股息再投入（DRIP）。',
    ].join('；'),
  },
  {
    id: 'momentum',
    nameZh: '技術面順勢投資',
    nameEn: 'Momentum / Trend Following',
    doctrine: [
      '順勢而為：只操作均線多頭排列、價格向上突破且成交量配合的標的，不逆勢猜底。',
      '以技術指標（MA、MACD、RSI）判斷多空，重視停損與風險報酬比（至少 1:2）。',
      '評估個人部位時：持股仍處上升趨勢、未跌破關鍵支撐 → 續抱；趨勢破位、空頭排列或 RSI 高檔背離 → 建議減碼或停損。',
      '與個人成本無關，一切以市場趨勢現況為準。',
    ].join('；'),
  },
  {
    id: 'balanced',
    nameZh: '穩健風險控管',
    nameEn: 'Balanced Risk Management',
    doctrine: [
      '以風險控管與組合平衡為核心：重視單一個股集中度、資金配置比例與最大可承受虧損。',
      '訂定明確停損（例如 -15%～-25%）與停利節奏，避免單壓少數標的。',
      '評估個人部位時：檢視「該檔佔總資金／整體曝險的比例」與未實現損益對整體配置的影響。',
      '部位過度集中、波動過大或基本面惡化 → 分批減碼；配置合理且趨勢與基本面無虞 → 持有並紀律化操作。',
    ].join('；'),
  },
]

export function getFramework(id: string): InvestmentFramework {
  return INVESTMENT_FRAMEWORKS.find(f => f.id === id) ?? INVESTMENT_FRAMEWORKS[0]
}

export interface PortfolioAnalysisInput {
  market: 'tw' | 'us'
  symbol: string
  symbolName?: string | null
  shares: number
  /** 每股成本價。 */
  cost: number
  currentPrice: number
  /**
   * #44：已棄用（股息輸入欄移除；呼叫端一律傳 0，DB 欄保留不刪）。
   * prompt 不再列示股息，總報酬採裸價差。
   */
  dividend: number
  costBasis: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  totalReturn: number
  totalReturnPct: number
  /**
   * #44：已棄用（固定 0；殖利率改由 TWSE 真源欄呈現，不由此計算）。
   */
  yieldOnCost: number
  strategyId: string
  /** 由外部取得的基本面／報價補充文字（可選）。 */
  marketContext?: string
  onProgress?: (step: string, detail: string) => void
}

const PortfolioAdviceSchema = z.object({
  rating: z.enum(['BUY', 'HOLD', 'SELL', 'AVOID']),
  confidence: z.number().min(0).max(1),
  fairValue: z.number().optional(),
  marginOfSafety: z.number().optional(),
  upsideDownsidePct: z.number().optional(),
  summary: z.string(),
  keyPoints: z.array(z.string()),
  risks: z.array(z.string()),
  action: z.string(),
})

export type PortfolioAdvice = z.infer<typeof PortfolioAdviceSchema>

export interface PortfolioAnalysisResult {
  advice: PortfolioAdvice
  modelPlan: { primary: string; fallback: string | null }
  usedFallback: boolean
}

function formatMoney(n: number, market: 'tw' | 'us'): string {
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${market === 'tw' ? 'NTD' : 'USD'}`
}

function buildPositionSummary(input: PortfolioAnalysisInput, framework: InvestmentFramework): string {
  const currencyLine = input.market === 'tw' ? '台股（新台幣）' : '美股（美元）'
  return [
    `個人部位資料（${currencyLine}）`,
    `股票：${input.symbolName || input.symbol}`,
    `市場代號：${input.symbol}  市場：${input.market.toUpperCase()}`,
    `持有股數：${input.shares} 股`,
    `每股成本：${formatMoney(input.cost, input.market)}`,
    `每股現價：${formatMoney(input.currentPrice, input.market)}`,
    `總成本：${formatMoney(input.costBasis, input.market)}`,
    `目前市值：${formatMoney(input.marketValue, input.market)}`,
    `未實現損益：${formatMoney(input.unrealizedPnl, input.market)}（${input.unrealizedPnlPct.toFixed(2)}%）`,
    // #44：總報酬改裸價差（＝市值−成本，不含股息；股息欄已移除，不再列示）。
    `總報酬（裸價差）：${formatMoney(input.totalReturn, input.market)}（${input.totalReturnPct.toFixed(2)}%）`,
    '',
    `套用投資法則：${framework.nameZh}（${framework.nameEn}）`,
    `法則原則：${framework.doctrine}`,
  ].join('\n')
}

/** 對個人股票部位套用指定投資法則，產出建議（BUY/HOLD/SELL/AVOID）。 */
export async function runPortfolioAnalysis(
  input: PortfolioAnalysisInput,
): Promise<PortfolioAnalysisResult> {
  const config = loadConfig()
  const { llm, fallbackModel } = createQuickLLM(config)
  const framework = getFramework(input.strategyId)

  // 讓 LLM 重試等待時能通知前端顯示倒數
  llm.onRetry = (retryAfterMs: number) => input.onProgress?.('LLM', `retrying in ${Math.round(retryAfterMs / 1000)}s`)

  input.onProgress?.('組合分析師', '整理部位與法則')
  const systemPrompt = [
    '你是專業的個人投資組合分析師。',
    '你會收到「個人股票部位資料」與「指定投資法則」，請以繁體中文（台灣習慣用語）輸出，數字以原始貨幣呈現。',
    '先試算個人的損益狀況，再用指定的投資法則判斷該部位該「買進／持有／賣出／觀望」，並給出明確、可執行的建議。',
    '【說人話／去 AI 味規範】：',
    '1. 直奔事實與數字：首重損益幅度、成本位階與法則核心標準，禁止抒情修辭。',
    '2. 禁絕心靈雞湯與道德說教：嚴禁「投資需要耐心」、「面對波動保持冷靜」等空泛廢話，請給出具體價格錨點（如目標停損價、分批加碼點、持倉上限比例）。',
    '3. 消除贅詞導引：嚴禁使用「值得注意的是」、「不可否認的是」、「這意味著」等無意義填空詞。',
    '4. summary（一句話結論）：直陳核心判斷與核心原因，嚴禁用「總結來說」、「綜上所述」開頭。',
    '5. keyPoints 與 risks：條列精準，每點都必須包含具體數據、位階或清晰的因果邏輯，避免空泛描述。',
    '若資訊不足無法判斷，請誠實說明，而不是模糊帶過。所有輸出必須是純 JSON。',
  ].join('\n')

  const prompt = [
    buildPositionSummary(input, framework),
    input.marketContext ? `\n市場與基本面補充資料：\n${input.marketContext}` : '',
    '',
    '請依據上述資料輸出建議，欄位說明：',
    '- rating: BUY(建議買進/加碼) | HOLD(繼續持有) | SELL(賣出/減碼) | AVOID(觀望，不建議承作)',
    '- confidence: 0~1 的信心度',
    '- fairValue: 若你認為能估算該股內在價值，給合理價估值（同貨幣單位）；若不適用請省略',
    '- marginOfSafety: 安全邊際（%），成本或現價相對 fairValue 的折價幅度；不適用請省略',
    '- upsideDownsidePct: 相對現價的預期上漲/下跌空間（%），可為負值',
    '- summary: 一句話結論（繁體中文，直指核心決策與依據，禁罐頭句）',
    '- keyPoints: 3~6 條關鍵判斷理由（繁體中文，條列精簡有力，帶具體數字/指標）',
    '- risks: 2~5 條主要風險（繁體中文，具體風險因子，禁空話）',
    '- action: 具體行動建議，包含清晰價格錨點或停損/減碼條件（例如「續抱，若跌破 xxx 元則停損」「回檔至 xxx 元分批加碼」「現價賣出 1/3」等）',
  ].join('\n')

  input.onProgress?.('組合分析師', '依法則生成建議（AI 分析中）...')
  const advice = await llm.generateObject<PortfolioAdvice>(
    systemPrompt,
    prompt,
    PortfolioAdviceSchema,
  )
  input.onProgress?.('組合分析師', '完成')

  const usedFallback = llm instanceof FallbackClient ? llm.fallbackCalls > 0 : false

  return {
    advice,
    modelPlan: {
      primary: config.quickThinkModel,
      fallback: fallbackModel,
    },
    usedFallback,
  }
}