import type { AnalysisState } from '@stock/core'
import type { LLMClient } from '../../llm/client.js'
import { buildSynthesizedReports } from '../../context.js'

export function createBearResearcher(llm: LLMClient) {
  return async (state: AnalysisState): Promise<Partial<AnalysisState>> => {
    const { investDebate, marketReport, sentimentReport, newsReport, fundamentalsReport } = state
    const history = investDebate.history
    const lastBull = investDebate.currentResponse

    const prompt = [
      `You are a Bear Analyst advocating AGAINST investing in ${state.ticker}.`,
      '',
      `Resources:`,
      buildSynthesizedReports({
        instrumentContext: state.instrumentContext,
        marketReport,
        sentimentReport,
        newsReport,
        fundamentalsReport,
      }),
      `Debate history: ${history}`,
      `Last bull argument: ${lastBull}`,
      '',
      `Build a strong bear case addressing the bull's points. Focus on risks, overvaluation, competitive threats, and negative catalysts.`,
      '',
      state.outputInstruction,
    ].join('\n')

    const argument = `Bear Analyst: ${await llm.generate('You are a bearish stock analyst arguing against investment.', prompt)}`

    return {
      investDebate: {
        ...investDebate,
        history: history + '\n' + argument,
        bearHistory: investDebate.bearHistory + '\n' + argument,
        currentResponse: argument,
        round: investDebate.round + 1,
      },
    }
  }
}
