import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TrendingUp, AlertTriangle, Newspaper, BarChart3, Target, Gauge, Languages, Settings2, HelpCircle } from 'lucide-react'
import { AGENT_KEYS } from '@stock/core'
import { useI18n } from '@/i18n/LanguageProvider'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'

/** 綜合評級旁的「？」說明 tooltip：解釋每種評級代表的意思與建議動作。 */
function RatingHelp() {
  const { dict } = useI18n()
  const ui = dict.analysisCard
  return (
    <span className="relative inline-flex items-center ml-1.5 group/help">
      <HelpCircle className="w-3.5 h-3.5 text-[var(--text-secondary)] cursor-help" />
      <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 z-30 w-64 hidden group-hover/help:block p-3 rounded-lg bg-[var(--bg-card)] border border-white/10 shadow-xl text-[11px] leading-relaxed text-[var(--text-primary)] font-normal text-left">
        <div className="font-semibold mb-1.5 text-[var(--text-secondary)]">{ui.ratingHelpTitle}</div>
        <ul className="space-y-1.5">
          {Object.keys(ui.rating).map(key => (
            <li key={key} className="flex items-start gap-1.5">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <span className={`font-semibold ${RATING_COLORS[key] ?? ''}`}>{key}</span>
                <span className="text-[var(--text-secondary)]">({ui.rating[key]})</span>
              </span>
              <span className="opacity-90">— {ui.ratingHelp[key]}</span>
            </li>
          ))}
        </ul>
      </span>
    </span>
  )
}

interface AgentUsage {
  agent: string
  model?: string | null
  fallbackCalls?: number
  usedFallback?: boolean
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

interface TokenUsage {
  agents: AgentUsage[]
  total: { promptTokens: number; completionTokens: number; totalTokens: number }
}

interface ModelPlan {
  deep: string
  quick: string
  fallback: {
    provider: string
    deep: string
    quick: string
    deep2?: string
    quick2?: string
  } | null
}

interface AnalysisCardProps {
  analysis: {
    signal: string
    decision: string
    language?: string
    enabledAgents?: string[]
    tokenUsage?: TokenUsage
    modelPlan?: ModelPlan
    reports: {
      market: string
      sentiment: string
      news: string
      fundamentals: string
    }
  }
}

const RATING_COLORS: Record<string, string> = {
  Buy: 'text-[var(--accent-green)]',
  Overweight: 'text-[var(--accent-green)]',
  Hold: 'text-yellow-400',
  Underweight: 'text-[var(--accent-red)]',
  Sell: 'text-[var(--accent-red)]',
}

const RATING_BG: Record<string, string> = {
  Buy: 'bg-[var(--accent-green)]/10 border-[var(--accent-green)]/20',
  Overweight: 'bg-[var(--accent-green)]/10 border-[var(--accent-green)]/20',
  Hold: 'bg-yellow-400/10 border-yellow-400/20',
  Underweight: 'bg-[var(--accent-red)]/10 border-[var(--accent-red)]/20',
  Sell: 'bg-[var(--accent-red)]/10 border-[var(--accent-red)]/20',
}

const sections = [
  { key: 'market' as const, icon: TrendingUp, color: 'text-[var(--accent)]' },
  { key: 'sentiment' as const, icon: AlertTriangle, color: 'text-yellow-400' },
  { key: 'news' as const, icon: Newspaper, color: 'text-[var(--accent)]' },
  { key: 'fundamentals' as const, icon: BarChart3, color: 'text-[var(--accent-green)]' },
]

const SECTION_LABELS: Record<'market' | 'sentiment' | 'news' | 'fundamentals', 'sectionMarket' | 'sectionSentiment' | 'sectionNews' | 'sectionFundamentals'> = {
  market: 'sectionMarket',
  sentiment: 'sectionSentiment',
  news: 'sectionNews',
  fundamentals: 'sectionFundamentals',
}

export function AnalysisCard({ analysis }: AnalysisCardProps) {
  const { dict } = useI18n()
  const ui = dict.analysisCard
  const typo = useTableTypography()
  const color = RATING_COLORS[analysis.signal] ?? 'text-[var(--text-primary)]'
  const bg = RATING_BG[analysis.signal] ?? 'bg-[var(--bg-card)]'
  const reportLang = analysis.language === 'en' ? dict.ai.en : analysis.language === 'ja' ? dict.ai.ja : dict.ai.zhTW
  const enabledCount = analysis.enabledAgents?.length ?? 0

  return (
    <div className="mt-8 space-y-6">
      {(analysis.language || analysis.enabledAgents) && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-secondary)]">
          {analysis.language && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10">
              <Languages className="w-3 h-3" />
              {ui.languageBadge.replace('{lang}', reportLang)}
            </span>
          )}
          {analysis.enabledAgents && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10">
              <Settings2 className="w-3 h-3" />
              {ui.agentsBadge.replace('{n}', String(enabledCount)).replace('{total}', String(AGENT_KEYS.length))}
            </span>
          )}
        </div>
      )}
      <div className={`${bg} rounded-xl p-6 border`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            <h2 className="text-lg font-semibold">{ui.headline}<RatingHelp /></h2>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-bold ${color}`}>{analysis.signal}</span>
            {analysis.signal && ui.rating[analysis.signal] && (
              <span className={`text-sm font-medium ${color}`}>({ui.rating[analysis.signal]})</span>
            )}
          </div>
        </div>
        <div className="prose prose-invert max-w-none text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {analysis.decision}
          </ReactMarkdown>
        </div>
      </div>

      {sections.map(({ key, icon: Icon, color: iconColor }) => {
        const content = analysis.reports?.[key]
        if (!content) return null

        return (
          <section key={key} className="bg-[var(--bg-card)] rounded-xl border border-white/5 overflow-hidden">
            <div className="flex items-center gap-3 px-6 pt-5 pb-3 border-b border-white/5">
              <Icon className={`w-5 h-5 ${iconColor}`} />
              <h3 className="text-base font-semibold">{ui[SECTION_LABELS[key]]}</h3>
            </div>
            <div className="px-6 py-4 prose prose-invert max-w-none text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          </section>
        )
      })}

      {analysis.tokenUsage && (
        <section className="bg-[var(--bg-card)] rounded-xl border border-white/5 overflow-hidden">
            <div className="flex items-center gap-3 px-6 pt-5 pb-3 border-b border-white/5">
              <Gauge className="w-5 h-5 text-[var(--accent)]" />
              <h3 className="text-base font-semibold">{ui.tokenTitle}</h3>
              {analysis.modelPlan && (
                <span className="ml-auto text-xs text-[var(--text-secondary)]">
                  deep={analysis.modelPlan.deep} · quick={analysis.modelPlan.quick}
                  {analysis.modelPlan.fallback && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 text-yellow-400">
                      fallback: {analysis.modelPlan.fallback.deep}
                      {analysis.modelPlan.fallback.deep2 ? ` → ${analysis.modelPlan.fallback.deep2}` : ''}
                    </span>
                  )}
                </span>
              )}
            </div>
          <div className="px-6 py-4">
            <div className="grid grid-cols-3 gap-4 mb-5">
              <div className="bg-white/5 rounded-lg p-3 text-center">
                <div className="text-xs text-[var(--text-secondary)] mb-1">{ui.tokenPrompt}</div>
                <div className="text-lg font-semibold">{analysis.tokenUsage.total.promptTokens.toLocaleString()}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-3 text-center">
                <div className="text-xs text-[var(--text-secondary)] mb-1">{ui.tokenCompletion}</div>
                <div className="text-lg font-semibold">{analysis.tokenUsage.total.completionTokens.toLocaleString()}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-3 text-center">
                <div className="text-xs text-[var(--text-secondary)] mb-1">{ui.tokenTotal}</div>
                <div className="text-lg font-semibold text-[var(--accent)]">{analysis.tokenUsage.total.totalTokens.toLocaleString()}</div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className={tableClass(typo, 'w-full')}>
                <thead>
                  <tr className={headTrClass(typo, 'text-left text-[var(--text-secondary)] border-b border-white/5')}>
                    <th className="py-2 pr-4 font-medium">{ui.colAgent}</th>
                    <th className="py-2 pr-4 font-medium">{ui.colModel}</th>
                    <th className="py-2 pr-4 font-medium text-right">{ui.colPrompt}</th>
                    <th className="py-2 pr-4 font-medium text-right">{ui.colCompletion}</th>
                    <th className="py-2 font-medium text-right">{ui.colTotal}</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.tokenUsage.agents.map(agent => (
                    <tr key={agent.agent} className="border-b border-white/5 last:border-0">
                      <td className="py-2 pr-4">{agent.agent}</td>
                      <td className="py-2 pr-4">
                        <span className="text-xs text-[var(--text-secondary)]">{agent.model || 'n/a'}</span>
                        {agent.fallbackCalls ? (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-xs text-red-400">
                            fallback ×{agent.fallbackCalls}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4 text-right text-[var(--text-secondary)]">{agent.promptTokens.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right text-[var(--text-secondary)]">{agent.completionTokens.toLocaleString()}</td>
                      <td className="py-2 text-right font-medium">{agent.totalTokens.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
