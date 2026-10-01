'use client'

import { useState } from 'react'
import { Settings2, HelpCircle, Languages, Check } from 'lucide-react'
import {
  AGENT_KEYS,
  ANALYSIS_LANGUAGE_OPTIONS,
  type AnalysisLanguage,
} from '@stock/core'
import { useI18n } from '@/i18n/LanguageProvider'

interface AgentMeta {
  key: string
  name: { zh: string; en: string; ja: string }
  role: { zh: string; en: string; ja: string }
  detail: { zh: string; en: string; ja: string }
  model: 'deep' | 'quick'
}

const AGENT_META: AgentMeta[] = [
  {
    key: 'Market Analyst',
    name: { zh: '技術分析', en: 'Market Analyst', ja: 'テクニカル分析' },
    role: { zh: '分析價格走勢、趨勢與技術指標', en: 'Analyzes price action, trends, and technical indicators', ja: '価格変動・トレンド・テクニカル指標を分析' },
    detail: {
      zh: '產出 K 線型態、支撐/壓力位、成交量變化與技術指標報告，給交易者具體進出場參考。',
      en: 'Produces a technical report covering formations, support/resistance, volume patterns, and actionable insights for traders.',
      ja: 'ローソク足のパターン、サポート/レジスタンス、出来高の変化、テクニカル指標をまとめ、トレーダー向けの具体的な売買判断を提示します。',
    },
    model: 'quick',
  },
  {
    key: 'Sentiment Analyst',
    name: { zh: '市場情緒', en: 'Sentiment Analyst', ja: 'センチメント分析' },
    role: { zh: '分析市場情緒方向與熱度', en: 'Analyzes market sentiment direction and heat', ja: '市場のセンチメントの方向性と熱量を分析' },
    detail: {
      zh: '從社群與新聞輿論判斷 Bullish/Bearish/Neutral，給予 0-10 情緒分數、信心度與主導敘事主題。',
      en: 'Judges Bullish/Bearish/Neutral direction from social media and news, with a 0-10 sentiment score, confidence level, and narrative themes.',
      ja: 'SNS とニュースから Bullish/Bearish/Neutral を判断。0-10 のセンチメントスコア、確信度、主要な物語テーマを提示します。',
    },
    model: 'quick',
  },
  {
    key: 'News Analyst',
    name: { zh: '新聞與總經', en: 'News Analyst', ja: 'ニュース・マクロ分析' },
    role: { zh: '掃描公司新聞與總體經濟', en: 'Scans company news and macroeconomics', ja: '企業ニュースとマクロ経済をスキャン' },
    detail: {
      zh: '涵蓋公司消息、產業動態、總體經濟指標、地緣政治與內部人交易，找出關鍵催化劑與風險。',
      en: 'Covers company news, sector developments, macro indicators, geopolitics, and insider transactions to surface catalysts and risks.',
      ja: '企業ニュース、セクター動向、マクロ指標、地政学、インサイダー取引をカバーし、主要なカタリストとリスクを抽出します。',
    },
    model: 'quick',
  },
  {
    key: 'Fundamentals Analyst',
    name: { zh: '基本面', en: 'Fundamentals Analyst', ja: 'ファンダメンタル分析' },
    role: { zh: '檢視財報與估值指標', en: 'Reviews financials and valuation metrics', ja: '財務諸表とバリュエーション指標をレビュー' },
    detail: {
      zh: '分析營收成長、獲利能力、資產負債表健康度、現金流與 PE/PB/PEG/EV/EBITDA 估值，並評估護城河與財務風險。',
      en: 'Analyzes revenue growth, profitability, balance-sheet health, cash flow, valuation metrics (PE/PB/PEG/EV/EBITDA), moat, and financial risks.',
      ja: '売上成長、収益性、バランスシートの健全性、キャッシュフロー、バリュエーション指標（PE/PB/PEG/EV/EBITDA）を分析し、モートと財務リスクを評価します。',
    },
    model: 'quick',
  },
  {
    key: 'Bull Researcher',
    name: { zh: '多方研究', en: 'Bull Researcher', ja: '強気派リサーチ' },
    role: { zh: '從多方角度提出看多論述', en: 'Builds the bull case for the stock', ja: '強気の論拠を構築' },
    detail: {
      zh: '站在多方立場，針對空方擔憂逐一回應，聚焦成長潛力、競爭優勢與正面催化劑。',
      en: 'Advocates for investment, addressing bear concerns with growth potential, competitive advantages, and positive catalysts.',
      ja: '強気の立場から投資を推奨し、弱気の懸念に応答しつつ、成長性・競争優位・ポジティブなカタリストに注目します。',
    },
    model: 'quick',
  },
  {
    key: 'Bear Researcher',
    name: { zh: '空方研究', en: 'Bear Researcher', ja: '弱気派リサーチ' },
    role: { zh: '從空方角度提出看空論述', en: 'Builds the bear case for the stock', ja: '弱気の論拠を構築' },
    detail: {
      zh: '站在空方立場，回應多方論點，聚焦估值過高、競爭威脅與負面催化劑，與多方形成實質辯論。',
      en: 'Argues against investment, rebutting bull points with overvaluation, competitive threats, and negative catalysts.',
      ja: '弱気の立場から強気の論点に反論し、割高感・競争リスク・ネガティブなカタリストに注目します。',
    },
    model: 'quick',
  },
  {
    key: 'Research Manager',
    name: { zh: '研究總結', en: 'Research Manager', ja: 'リサーチマネージャー' },
    role: { zh: '綜整多空辯論產出評級', en: 'Synthesizes the debate into a rating', ja: '多様な論点を統合して評価を生成' },
    detail: {
      zh: '綜合各分析師報告與多空辯論，產出 Buy / Overweight / Hold / Underweight / Sell 評級、投資理由與策略行動清單。',
      en: 'Synthesizes analyst reports and the bull/bear debate into a rating, rationale, and strategic action list.',
      ja: '各アナリストのレポートと強気/弱気の議論を統合し、Buy/Overweight/Hold/Underweight/Sell の評価、投資理由、戦略的アクションリストを生成します。',
    },
    model: 'deep',
  },
  {
    key: 'Trader',
    name: { zh: '交易計畫', en: 'Trader', ja: 'トレーダー' },
    role: { zh: '轉成具體交易提案', en: 'Converts plans into trade orders', ja: '計画を具体的な取引提案に変換' },
    detail: {
      zh: '把研究結論轉為具體動作：Buy/Hold/Sell、進場價、停損價、區分階段建倉與風險佔比。',
      en: 'Turns the plan into specific actions: Buy/Hold/Sell, entry price, stop loss, phased entry, and position sizing.',
      ja: '研究結果を具体的なアクション（Buy/Hold/Sell）、エントリー価格、ストップロス、段階的建て玉、ポジションサイズに変換します。',
    },
    model: 'quick',
  },
  {
    key: 'Aggressive Analyst',
    name: { zh: '積極風險', en: 'Aggressive Risk', ja: 'アグレッシブリスク' },
    role: { zh: '主張積極承擔風險換取更高報酬', en: 'Argues for aggressive risk-taking', ja: '積極的なリスクテイクを主張' },
    detail: {
      zh: '針對交易提案主張放大部位、放寬風險容忍，點出過度保守錯失的機會。',
      en: 'Pushes for larger position sizing and higher risk tolerance, flagging missed opportunities from being too conservative.',
      ja: '取引提案に対し大きめのポジションと高いリスク許容を主張し、慎重すぎて逃す機会を指摘します。',
    },
    model: 'quick',
  },
  {
    key: 'Conservative Analyst',
    name: { zh: '保守風險', en: 'Conservative Risk', ja: 'コンサバティブリスク' },
    role: { zh: '主張保本優先、收緊風險控制', en: 'Argues for capital preservation', ja: '資本保全を優先する立場で主張' },
    detail: {
      zh: '主張縮小部位、收緊停損與風險控制，凸顯下檔風險與潛在虧損。',
      en: 'Pushes for smaller positions and tighter risk controls, highlighting downside risks and potential losses.',
      ja: '小さめのポジションと厳格なリスク管理を主張し、下落リスクと潜在損失を指摘します。',
    },
    model: 'quick',
  },
  {
    key: 'Neutral Analyst',
    name: { zh: '中性風險', en: 'Neutral Risk', ja: 'ニュートラルリスク' },
    role: { zh: '在積極與保守間取平衡', en: 'Balances aggressive and conservative views', ja: '積極と保守の中庸を取る' },
    detail: {
      zh: '在積極與保守間找中庸，提出適度部位與平衡的風險方案。',
      en: 'Finds middle ground between aggressive and conservative stances with moderate position sizing.',
      ja: '積極と保守の中間として、適度なポジションサイズのバランス案を提示します。',
    },
    model: 'quick',
  },
  {
    key: 'Portfolio Manager',
    name: { zh: '最終決策', en: 'Portfolio Manager', ja: 'ポートフォリオマネージャー' },
    role: { zh: '做成最終投資決策', en: 'Makes the final investment decision', ja: '最終的な投資判断を下す' },
    detail: {
      zh: '綜合風險辯論與過去交易教訓，產出最終評級、投資論述、目標價與時間跨度。',
      en: 'Combines the risk debate and past lessons into the final rating, investment thesis, price target, and time horizon.',
      ja: 'リスクの議論と過去の教訓を統合し、最終評価、投資テーゼ、目標価格、時間軸を導き出します。',
    },
    model: 'deep',
  },
]

interface AnalysisOptionsProps {
  language: AnalysisLanguage
  onLanguageChange: (language: AnalysisLanguage) => void
  enabledAgents: string[]
  onToggleAgent: (key: string) => void
  onToggleAll: (enabled: boolean) => void
  disabled?: boolean
}

function AgentTooltip({ meta, language }: { meta: AgentMeta; language: AnalysisLanguage }) {
  const lang = language === 'zh-TW' ? 'zh' : language === 'ja' ? 'ja' : 'en'
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Agent 說明"
        className="w-5 h-5 rounded-full bg-white/10 hover:bg-[var(--accent)]/30 text-[var(--text-secondary)] hover:text-white
                   flex items-center justify-center text-xs font-semibold transition-colors"
      >
        ?
      </button>
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 z-30 opacity-0 group-hover/agent:opacity-100 transition-opacity duration-150">
        <div className="bg-[#1a1d24] border border-white/10 rounded-xl px-4 py-3 shadow-2xl">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-sm font-semibold text-white">
              {meta.name[lang]}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${
              meta.model === 'deep'
                ? 'bg-purple-500/15 text-purple-300 border border-purple-500/20'
                : 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20'
            }`}>
              {meta.model}
            </span>
          </div>
          <p className="text-xs font-medium text-[var(--accent)] mb-1">
            {meta.role[lang]}
          </p>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            {meta.detail[lang]}
          </p>
        </div>
      </div>
    </div>
  )
}

export function AnalysisOptions({
  language,
  onLanguageChange,
  enabledAgents,
  onToggleAgent,
  onToggleAll,
  disabled,
}: AnalysisOptionsProps) {
  const [expanded, setExpanded] = useState(true)
  const { dict } = useI18n()
  const ui = dict.ai
  const enabledSet = new Set(enabledAgents)
  const allEnabled = AGENT_KEYS.every(k => enabledSet.has(k))

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-white/10 mt-4">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-[var(--accent)]" />
          <span className="text-sm font-semibold">
            {ui.settingsTitle}
          </span>
          {!allEnabled && !disabled && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
              {ui.agentsEnabled.replace('{n}', String(enabledAgents.length)).replace('{total}', String(AGENT_KEYS.length))}
            </span>
          )}
        </div>
        <span className={`text-[var(--text-secondary)] text-xs transition-transform ${expanded ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-white/5 pt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <Languages className="w-3.5 h-3.5" />
              <span>{ui.reportLanguage}</span>
            </div>
            <div className="flex rounded-lg border border-white/10 overflow-hidden">
              {ANALYSIS_LANGUAGE_OPTIONS.map(opt => {
                const active = language === opt.id
                const langLabel = opt.id === 'ja' ? ui.ja : opt.id === 'en' ? ui.en : ui.zhTW
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onLanguageChange(opt.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-[var(--accent)] text-white'
                        : 'text-[var(--text-secondary)] hover:text-white hover:bg-white/5'
                    } disabled:opacity-50`}
                  >
                    {active && <Check className="w-3 h-3" />}
                    {langLabel}
                  </button>
                )
              })}
            </div>
            {language === 'zh-TW' && (
              <span className="text-[10px] text-[var(--text-secondary)]">
                {ui.currencyNote}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>{ui.enableAgents}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={disabled || allEnabled}
                onClick={() => onToggleAll(true)}
                className="text-[11px] px-2.5 py-1 rounded-lg border border-white/10 text-[var(--text-secondary)] hover:text-white hover:bg-white/5 transition disabled:opacity-40"
              >
                {ui.enableAll}
              </button>
              <button
                type="button"
                disabled={disabled || !allEnabled}
                onClick={() => onToggleAll(false)}
                className="text-[11px] px-2.5 py-1 rounded-lg border border-white/10 text-[var(--text-secondary)] hover:text-white hover:bg-white/5 transition disabled:opacity-40"
              >
                {ui.disableAll}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {AGENT_META.map(meta => {
              const enabled = enabledSet.has(meta.key)
              const lang = language === 'zh-TW' ? 'zh' : language === 'ja' ? 'ja' : 'en'
              return (
                <div
                  key={meta.key}
                  className={`group/agent flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors ${
                    enabled
                      ? 'border-[var(--accent)]/30 bg-[var(--accent)]/5'
                      : 'border-white/10 bg-transparent opacity-60'
                  }`}
                >
                  <button
                    type="button"
                    disabled={disabled}
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => onToggleAgent(meta.key)}
                    className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                      enabled ? 'bg-[var(--accent)]' : 'bg-white/15'
                    } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        enabled ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                  <span className="text-xs font-medium flex-1 min-w-0 truncate">
                    {meta.name[lang]}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono shrink-0 ${
                    meta.model === 'deep'
                      ? 'bg-purple-500/15 text-purple-300 border border-purple-500/20'
                      : 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20'
                  }`}>
                    {meta.model}
                  </span>
                  <AgentTooltip meta={meta} language={language} />
                </div>
              )
            })}
          </div>

          {enabledAgents.length === 0 && (
            <p className="text-[11px] text-amber-400">
              {ui.minAgentWarning}
            </p>
          )}
        </div>
      )}
    </div>
  )
}