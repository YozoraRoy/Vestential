import { AssetType, type AnalysisState } from '@stock/core'
import type { LLMClient } from '../../llm/client.js'

const SYSTEM_PROMPT = `You are a Market Technical Analyst. Your job is to analyze price action, trends, and technical indicators.

Write a detailed technical analysis report covering:
1. Trend direction and strength
2. Key support/resistance levels
3. Volume patterns
4. Notable technical formations
5. Actionable insights for traders
6. Support/Resistance zone: give explicit price zones (not single points) for near-term support and resistance, with the indicator or swing basis for each (e.g. MA60, prior swing high/low, gap).
7. Invalidation conditions: state 1-3 concrete conditions under which the current technical view is proven wrong (e.g. "a daily close below <price> breaks support", "bias back above <level>"), so the view can be verified and falsified.`

const ETF_SYSTEM_PROMPT = `You are an ETF Technical & Positioning Analyst. Your job is to evaluate price trend, moving-average bias (distance from MA60/MA240), volatility, and liquidity for an ETF.

Write a concise, practical report covering:
1. Primary trend direction and moving-average bias (especially MA60 quarterly and MA240 annual extension vs pullback zones)
2. Key support/resistance price zones with concrete technical basis
3. Volume & liquidity stability (flag abnormal spikes or thin-volume risks)
4. Volatility / drawdown context and invalidation levels

STRICT RULES:
- Treat the instrument as an index/basket ETF, NOT an individual speculative stock.
- Do NOT discuss single-company chip distribution, major-player accumulation, or earnings catalysts.`

export function getMarketSystemPrompt(assetType: AssetType): string {
  return assetType === AssetType.ETF ? ETF_SYSTEM_PROMPT : SYSTEM_PROMPT
}

export function createMarketAnalyst(llm: LLMClient) {
  return async (state: AnalysisState): Promise<Partial<AnalysisState>> => {
    const systemPrompt = getMarketSystemPrompt(state.assetType)
    const prompt = `Analyze ${state.ticker} as of ${state.tradeDate}. ${state.instrumentContext}

${state.outputInstruction}`
    const report = await llm.generate(systemPrompt, prompt)
    return { marketReport: report }
  }
}
