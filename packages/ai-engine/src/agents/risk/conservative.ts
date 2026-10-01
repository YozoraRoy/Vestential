import type { AnalysisState } from '@stock/core'
import type { LLMClient } from '../../llm/client.js'
import { truncateField } from '../../context.js'

export function createConservativeDebator(llm: LLMClient) {
  return async (state: AnalysisState): Promise<Partial<AnalysisState>> => {
    const { riskDebate, traderProposal } = state
    const history = riskDebate.history

    const prompt = [
      `You are a CONSERVATIVE risk analyst. You prioritize capital preservation.`,
      '',
      truncateField(state.instrumentContext, 'Resources:', undefined, state.outputLanguage),
      truncateField(traderProposal, `Trader Proposal:`, undefined, state.outputLanguage),
      truncateField(history, `Debate history:`, undefined, state.outputLanguage),
      '',
      'Argue for smaller positions and tighter risk controls. Highlight downside risks and potential losses.',
      '',
      state.outputInstruction,
    ].join('\n')

    const response = `Conservative Analyst: ${await llm.generate('You are a conservative risk manager focused on capital preservation.', prompt)}`

    return {
      riskDebate: {
        ...riskDebate,
        history: history + '\n' + response,
        conservativeHistory: riskDebate.conservativeHistory + '\n' + response,
        latestSpeaker: 'Conservative',
      },
    }
  }
}
