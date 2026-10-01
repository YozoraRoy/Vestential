import { useMemo } from 'react'
import {
  TrendingUp, AlertTriangle, Newspaper, BarChart3,
  ThumbsUp, ThumbsDown, ClipboardList, ShoppingCart, Briefcase,
  Zap, Shield, Scale,
  LucideIcon,
} from 'lucide-react'
import { useI18n } from '@/i18n/LanguageProvider'

const STEPS = [
  { key: 'Market Analyst', icon: TrendingUp },
  { key: 'Sentiment Analyst', icon: AlertTriangle },
  { key: 'News Analyst', icon: Newspaper },
  { key: 'Fundamentals Analyst', icon: BarChart3 },
  { key: 'Bull Researcher', icon: ThumbsUp },
  { key: 'Bear Researcher', icon: ThumbsDown },
  { key: 'Research Manager', icon: ClipboardList },
  { key: 'Trader', icon: ShoppingCart },
  { key: 'Aggressive Analyst', icon: Zap },
  { key: 'Conservative Analyst', icon: Shield },
  { key: 'Neutral Analyst', icon: Scale },
  { key: 'Portfolio Manager', icon: Briefcase },
] as const

interface ProgressPanelProps {
  progress: { step: string; detail: string }[]
  enabledAgents?: string[]
  /** 失敗 agent 的錯誤訊息（顯示在紅色 X 的 tooltip）。 */
  failedAgentError?: string | null
}

export function ProgressPanel({ progress, enabledAgents, failedAgentError }: ProgressPanelProps) {
  const { dict } = useI18n()
  const ui = dict.progressPanel
  const lastEvent = progress[progress.length - 1]
  const currentStep = lastEvent?.detail === 'running...' ? lastEvent.step : null

  const completed = new Set(
    progress.filter(e => e.detail === 'done').map(e => e.step),
  )

  const failed = new Set(
    progress.filter(e => e.detail === 'failed').map(e => e.step),
  )

  const visible = useMemo(() => {
    const currentIdx = currentStep
      ? STEPS.findIndex(s => s.key === currentStep)
      : STEPS.length - 1
    const start = Math.max(0, currentIdx - 4)
    return STEPS.slice(start, currentIdx + 1)
  }, [currentStep])

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-white/5 p-5 space-y-3">
      <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
        {ui.title}
      </h3>
      <div className="space-y-2">
        {STEPS.map(({ key, icon: Icon }) => {
          const label = ui.eachAgent[key] ?? key
          const isEnabled = !enabledAgents || enabledAgents.includes(key)
          const isDone = completed.has(key)
          const isFailed = failed.has(key)
          const isCurrent = key === currentStep

          if (!isEnabled) {
            return (
              <div
                key={key}
                className="flex items-center gap-3 px-3 py-2 rounded-lg opacity-30"
                title={ui.disabledTooltip}
              >
                <div className="w-5 h-5 flex items-center justify-center">
                  <span className="text-[10px] text-[var(--text-secondary)]">–</span>
                </div>
                <Icon className="w-4 h-4" />
                <span className="text-sm">{label}</span>
                <span className="text-[10px] text-[var(--text-secondary)] ml-auto">
                  {ui.disabled}
                </span>
              </div>
            )
          }

          if (!isDone && !isFailed && !isCurrent && completed.size === 0 && failed.size === 0) {
            return null
          }

          return (
            <div
              key={key}
              title={isFailed && failedAgentError ? failedAgentError : undefined}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-300 ${
                isFailed
                  ? 'bg-red-900/10 border border-red-500/30'
                  : isCurrent
                    ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/20'
                    : isDone
                      ? 'opacity-80'
                      : 'opacity-40'
              }`}
            >
              <div className="relative w-5 h-5 flex items-center justify-center">
                {isCurrent ? (
                  <div className="w-2 h-2 bg-[var(--accent)] rounded-full animate-pulse" />
                ) : isFailed ? (
                  <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : isDone ? (
                  <svg className="w-4 h-4 text-[var(--accent-green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <div className="w-1.5 h-1.5 bg-[var(--text-secondary)] rounded-full" />
                )}
              </div>
              <Icon className={`w-4 h-4 ${isCurrent ? 'text-[var(--accent)]' : isFailed ? 'text-red-400' : ''}`} />
              <span className={`text-sm ${isCurrent ? 'font-semibold text-[var(--accent)]' : ''}`}>
                {label}
              </span>
              {isCurrent && (
                <span className="text-xs text-[var(--accent)] ml-auto animate-pulse">
                  {ui.analyzing}
                </span>
              )}
              {isFailed && (
                <span className="text-xs text-red-400 ml-auto">
                  {ui.failed}
                </span>
              )}
              {isDone && (
                <span className="text-xs text-[var(--accent-green)] ml-auto">
                  {ui.done}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
