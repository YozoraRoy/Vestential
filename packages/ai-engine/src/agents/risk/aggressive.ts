import type { AnalysisState } from '@stock/core'
import type { LLMClient } from '../../llm/client.js'
import { truncateField } from '../../context.js'

export function createAggressiveDebator(llm: LLMClient) {
  return async (state: AnalysisState): Promise<Partial<AnalysisState>> => {
    const { riskDebate, traderProposal } = state
    const history = riskDebate.history

    const prompt = [
      `You are an AGGRESSIVE risk analyst. You believe in taking calculated risks for higher returns.`,
      '',
      truncateField(state.instrumentContext, 'Resources:', undefined, state.outputLanguage),
      truncateField(traderProposal, `Trader Proposal:`, undefined, state.outputLanguage),
      truncateField(history, `Debate history:`, undefined, state.outputLanguage),
      '',
      'Argue for a more aggressive position sizing and risk tolerance. Point out missed opportunities from being too conservative.',
      '',
      state.outputInstruction,
    ].join('\n')

    const response = `Aggressive Analyst: ${await llm.generate('You are an aggressive risk-taker who pushes for larger positions.', prompt)}`

    return {
      riskDebate: {
        ...riskDebate,
        history: history + '\n' + response,
        aggressiveHistory: riskDebate.aggressiveHistory + '\n' + response,
        latestSpeaker: 'Aggressive',
      },
    }
  }
}
