import type { AnalysisState } from '@stock/core'
import type { LLMClient } from '../../llm/client.js'
import { truncateField } from '../../context.js'

export function createNeutralDebator(llm: LLMClient) {
  return async (state: AnalysisState): Promise<Partial<AnalysisState>> => {
    const { riskDebate, traderProposal } = state
    const history = riskDebate.history

    const prompt = [
      `You are a NEUTRAL risk analyst. You seek balance between risk and reward.`,
      '',
      truncateField(state.instrumentContext, 'Resources:', undefined, state.outputLanguage),
      truncateField(traderProposal, `Trader Proposal:`, undefined, state.outputLanguage),
      truncateField(history, `Debate history:`, undefined, state.outputLanguage),
      '',
      'Find middle ground between aggressive and conservative positions. Suggest a balanced approach with moderate position sizing.',
      '',
      state.outputInstruction,
    ].join('\n')

    const response = `Neutral Analyst: ${await llm.generate('You are a balanced, neutral risk analyst seeking middle ground.', prompt)}`

    return {
      riskDebate: {
        ...riskDebate,
        history: history + '\n' + response,
        neutralHistory: riskDebate.neutralHistory + '\n' + response,
        latestSpeaker: 'Neutral',
      },
    }
  }
}
