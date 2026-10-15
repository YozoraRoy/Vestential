import { TrendingUp, Sparkles, RefreshCw, LineChart, Info } from 'lucide-react'
import Link from 'next/link'
import { getLocale, getDict } from '@/i18n/server'
import { localizePath } from '@/i18n/paths'
import { buildAlternates } from '@/i18n/metadata'
import { getLatestCycleEntryMeta, getCycleEntrySignalsByEdition } from '@stock/database'
import { SectionHeading } from '@/components/section-heading'
import { CycleEntrySection } from '@/components/cycle-entry-section'
import type { CycleEntryDict } from '@/components/cycle-entry-view'
import { resolveStockName, MIN_SAMPLE_SIGNALS } from '@stock/cycle-entry'

const BASE_URL = 'https://vestential.com'

export async function generateMetadata() {
  const locale = await getLocale()
  const dict = await getDict()
  const alts = buildAlternates(locale, '/cycle-entry')
  const title = dict.cycleEntry.metaTitle
  const description = dict.cycleEntry.metaDesc
  return {
    title,
    description,
    alternates: alts,
    openGraph: {
      title,
      description,
      url: alts.canonical,
      siteName: 'Vestential',
      type: 'website',
      locale: locale === 'zh-TW' ? 'zh_TW' : locale,
    },
    twitter: { card: 'summary_large_image' },
  }
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

function formatDateTime(s: string | Date, locale: string): string {
  const dt = typeof s === 'string' ? new Date(s) : s
  if (!dt || Number.isNaN(dt.getTime())) return String(s ?? '')
  return dt.toLocaleDateString(locale === 'zh-TW' ? 'zh-TW' : locale) + ' ' + dt.toLocaleTimeString(locale === 'zh-TW' ? 'zh-TW' : locale, { hour: '2-digit', minute: '2-digit' })
}

export default async function CycleEntryPage() {
  const locale = await getLocale()
  const dict = await getDict()
  const ce = dict.cycleEntry

  const meta = await getLatestCycleEntryMeta()
  // 讀取端防護：樣本不足的標的（含舊版次在管線重跑前）不列入公開名單
  const signals = meta
    ? (await getCycleEntrySignalsByEdition(meta.editionDate)).filter((s) => (s.btTotalSignals ?? 0) >= MIN_SAMPLE_SIGNALS)
    : []

  const viewDict: CycleEntryDict = {
    viewModeList: ce.viewModeList,
    viewModeCard: ce.viewModeCard,
    colRank: ce.colRank,
    colName: ce.colName,
    colStage: ce.colStage,
    colRules: ce.colRules,
    colPrice: ce.colPrice,
    colScore: ce.colScore,
    colBacktest: ce.colBacktest,
    aiNoteTitle: ce.aiNoteTitle,
    btSignals: ce.btSignals,
    btWinRate: ce.btWinRate,
    btAvgDays: ce.btAvgDays,
    stageNearHigh: ce.stageNearHigh,
    stageMildPullback: ce.stageMildPullback,
    stagePullback: ce.stagePullback,
    stageDeepPullback: ce.stageDeepPullback,
    ruleR1: ce.ruleR1,
    ruleR2: ce.ruleR2,
    ruleR3: ce.ruleR3,
    ruleR4: ce.ruleR4,
    ruleR5: ce.ruleR5,
    viewBacktestChart: ce.viewBacktestChart,
    exploreBacktestLab: ce.exploreBacktestLab,
    winRateLegend: ce.winRateLegend,
    colBacktestTooltip: ce.colBacktestTooltip,
    openBacktestLab: ce.openBacktestLab,
    openYahooQuote: ce.openYahooQuote,
    detailTitle: ce.detailTitle,
    detailSubtitle: ce.detailSubtitle,
    detailClose: ce.detailClose,
    detailLoading: ce.detailLoading,
    detailError: ce.detailError,
    detailTabChart: ce.detailTabChart,
    detailTabTrades: ce.detailTabTrades,
    detailTabRules: ce.detailTabRules,
    chartPriceTitle: ce.chartPriceTitle,
    chartEquityTitle: ce.chartEquityTitle,
    chartDate: ce.chartDate,
    chartClose: ce.chartClose,
    chartMA20: ce.chartMA20,
    chartMA60: ce.chartMA60,
    chartEntryDot: ce.chartEntryDot,
    chartEquityValue: ce.chartEquityValue,
    colSignalDate: ce.colSignalDate,
    colEntryDate: ce.colEntryDate,
    colExitDate: ce.colExitDate,
    colExitPrice: ce.colExitPrice,
    colReturn: ce.colReturn,
    colHoldingDays: ce.colHoldingDays,
    colExitReason: ce.colExitReason,
    exitReasonTarget: ce.exitReasonTarget,
    exitReasonStop: ce.exitReasonStop,
    exitReasonTimeout: ce.exitReasonTimeout,
    exitReasonOpen: ce.exitReasonOpen,
    openBadge: ce.openBadge,
    ciLabel: ce.ciLabel,
    sampleBadge: ce.sampleBadge,
    netReturnNote: ce.netReturnNote,
    tradesEmpty: ce.tradesEmpty,
    winRateFormulaTitle: ce.winRateFormulaTitle,
    winRateFormulaText: ce.winRateFormulaText,
    ruleCheckTitle: ce.ruleCheckTitle,
    ruleHit: ce.ruleHit,
    ruleMiss: ce.ruleMiss,
    ruleThreshold: ce.ruleThreshold,
  }

  const pageTitle = ce.pageTitle
  const pageDesc = ce.pageDesc

  const graph: object[] = [
    {
      '@type': 'WebSite',
      name: 'Vestential',
      url: BASE_URL,
      description: pageDesc,
      inLanguage: ['zh-TW', 'en', 'ja'],
    },
    {
      '@type': 'WebPage',
      name: pageTitle,
      description: pageDesc,
      url: `${BASE_URL}/cycle-entry`,
      inLanguage: locale,
      isPartOf: { '@type': 'WebSite', name: 'Vestential', url: BASE_URL },
      dateModified: meta?.generatedAt ? new Date(meta.generatedAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    },
  ]
  if (signals.length > 0) {
    graph.push({
      '@type': 'ItemList',
      name: pageTitle,
      itemListElement: signals.map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: resolveStockName(s.symbol, s.name),
        description: s.llmNote || undefined,
      })),
    })
  }
  const schema = { '@context': 'https://schema.org', '@graph': graph }

  return (
    <div className="max-w-6xl mx-auto px-4 py-16">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-6 h-6 text-[var(--accent-green)]" />
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">{ce.badge}</span>
      </div>
      <h1 className="text-3xl font-bold mb-3">{ce.pageTitle}</h1>
      <div className="mb-6 w-16 h-1 rounded-full bg-gradient-to-r from-[var(--accent-green)] to-[var(--accent)]" />
      <p className="text-base text-[var(--text-secondary)] leading-relaxed mb-10">{ce.pageDesc}</p>

      {/* 當日 AI 總覽 */}
      {meta?.summary ? (
        <section aria-labelledby="cycle-summary" className="mb-10">
          <div className="rounded-xl border border-[var(--accent-green)]/30 bg-[var(--accent-green)]/5 px-6 py-5">
            <div className="flex items-center gap-2 mb-2.5">
              <Sparkles className="w-4 h-4 text-[var(--accent-green)]" />
              <h2 id="cycle-summary" className="text-base font-semibold text-[var(--text-primary)]">{ce.summaryTitle}</h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">AI</span>
            </div>
            <p className="text-sm leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">{meta.summary}</p>
            {meta.generatedAt && (
              <p className="flex items-center gap-1.5 mt-3 text-xs text-[var(--text-secondary)]">
                <RefreshCw className="w-3.5 h-3.5" />
                {ce.updatedAt}：{formatDateTime(meta.generatedAt, locale)}
              </p>
            )}
          </div>
        </section>
      ) : null}

      {/* 已現進場點標的 */}
      <section aria-labelledby="entry-targets" className="mb-10">
        <SectionHeading id="entry-targets" title={ce.pageTitle} />

        {signals.length > 0 ? (
          <CycleEntrySection signals={signals} dict={viewDict} />
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-6 py-10 text-center">
            <TrendingUp className="w-8 h-8 mx-auto text-[var(--accent)]/40 mb-3" />
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">{ce.emptyTitle}</h3>
            <p className="text-sm text-[var(--text-secondary)]">{ce.emptyDesc}</p>
          </div>
        )}
      </section>

      {/* 方法與免責 */}
      <section aria-labelledby="cycle-method" className="mb-10">
        <SectionHeading id="cycle-method" title={ce.methodTitle} />
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">{ce.methodIntro}</p>
        <ul className="text-sm text-[var(--text-secondary)] leading-relaxed list-disc list-inside space-y-1.5 mb-4">
          <li>{ce.methodR1}</li>
          <li>{ce.methodR2}</li>
          <li>{ce.methodR3}</li>
          <li>{ce.methodR4}</li>
          <li>{ce.methodR5}</li>
        </ul>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">{ce.methodGate}</p>
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs leading-relaxed text-[var(--text-secondary)] space-y-2">
          <div className="font-semibold text-sm text-[var(--text-primary)] flex items-center gap-1.5">
            <Info className="w-4 h-4 text-[var(--accent)] shrink-0" />
            <span>{ce.btDiffNoticeTitle}</span>
          </div>
          <p className="whitespace-pre-line text-xs text-[var(--text-secondary)] leading-relaxed">
            {ce.btDiffNoticeDesc}
          </p>
        </div>
        <div className="mb-6 rounded-xl border border-[var(--accent)]/20 bg-[var(--accent)]/5 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <LineChart className="w-5 h-5 text-[var(--accent)] shrink-0" />
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {dict.backtest.pageTitle}
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {ce.exploreBacktestLab}
              </p>
            </div>
          </div>
          <Link
            href={localizePath(locale, '/backtest')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 text-[var(--accent)] text-xs font-semibold whitespace-nowrap transition"
          >
            {ce.openBacktestLab} →
          </Link>
        </div>
        <div className="rounded-xl border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/5 px-6 py-5">
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{ce.disclaimer}</p>
        </div>
      </section>

      <div>
        <Link href={localizePath(locale, '/')} className="text-sm text-[var(--accent)] hover:underline">
          {ce.backHome}
        </Link>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
    </div>
  )
}