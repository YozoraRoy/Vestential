import { AssetType, type AnalysisState } from '@stock/core'
import type { LLMClient } from '../../llm/client.js'

const SYSTEM_PROMPT = `You are a Fundamentals Analyst. Analyze financial statements and valuation.

Cover:
1. Revenue growth and profitability trends
2. Balance sheet health
3. Cash flow analysis
4. Key valuation metrics (PE, PB, PEG, EV/EBITDA)
5. Competitive moat assessment
6. Financial risks`

const ETF_SYSTEM_PROMPT = `You are an ETF Analyst. Analyze the exchange-traded fund (ETF) as a basket of underlying securities using a concise, decision-focused framework.

Cover ONLY ETF-relevant dimensions:
1. Underlying index/benchmark, asset class, and investment positioning (broad market / high-dividend / bond)
2. Trend & valuation position: distance from 60-day (quarterly) and 240-day (annual) moving averages, MACD/momentum, and whether it is overextended or in a pullback zone
3. Risk profile: volatility and maximum drawdown (MDD) expectations, concentration risk, and liquidity
4. Distribution/yield characteristics (for dividend/bond ETFs: yield sustainability and payout consistency; skip if non-distributing)
5. Practical allocation & entry considerations for long-term investors

STRICT RULES FOR ETF ANALYSIS:
- Do NOT apply or mention single-company financial metrics such as EPS, gross margin, operating margin, ROE, accounts receivable, PE, PB, PEG, EV/EBITDA, or corporate competitive moat.
- Do NOT apply single-stock institutional chip/accumulation narratives.
- If specific external ETF figures (such as exact expense ratio / TER or live NAV premium/discount) are not present in the provided context, explicitly state that live figures are not provided rather than fabricating numbers.`

export function getFundamentalsSystemPrompt(assetType: AssetType): string {
  return assetType === AssetType.ETF ? ETF_SYSTEM_PROMPT : SYSTEM_PROMPT
}

export function createFundamentalsAnalyst(llm: LLMClient) {
  return async (state: AnalysisState): Promise<Partial<AnalysisState>> => {
    const systemPrompt = getFundamentalsSystemPrompt(state.assetType)
    const prompt = `Analyze ${state.assetType === AssetType.ETF ? 'ETF' : 'fundamentals for'} ${state.ticker} as of ${state.tradeDate}. ${state.instrumentContext}

${state.outputInstruction}`
    const report = await llm.generate(systemPrompt, prompt)
    return { fundamentalsReport: report }
  }
}
