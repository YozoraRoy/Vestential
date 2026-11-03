import {
  Activity,
  ArrowRight,
  Coins,
  Gauge,
  Search,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { getDict, getLocale } from '@/i18n/server'
import { localizePath } from '@/i18n/paths'
import { buildAlternates } from '@/i18n/metadata'
import { SectionHeading } from '@/components/section-heading'

const BASE_URL = 'https://vestential.com'

export async function generateMetadata() {
  const dict = await getDict()
  const locale = await getLocale()
  const alts = buildAlternates(locale, '/workspace')
  return {
    title: dict.workspace.metaTitle,
    description: dict.workspace.metaDesc,
    alternates: alts,
    openGraph: {
      title: dict.workspace.metaTitle,
      description: dict.workspace.metaDesc,
      url: alts.canonical,
      siteName: 'Vestential',
      type: 'website',
      locale: locale === 'zh-TW' ? 'zh_TW' : locale,
    },
    twitter: {
      card: 'summary_large_image',
    },
  }
}

interface WorkspaceTool {
  href: string
  icon: LucideIcon
  title: string
  desc: string
  accent: 'accent' | 'green'
}

interface WorkspaceGroup {
  id: string
  icon: LucideIcon
  title: string
  items: WorkspaceTool[]
}

export default async function WorkspacePage() {
  const dict = await getDict()
  const locale = await getLocale()
  const w = dict.workspace

  // 三組分組 → 共 6 張卡（#126 P0 裁示：6 張卡／6 項 ItemList）。
  const groups: WorkspaceGroup[] = [
    {
      id: 'workspace-entry',
      icon: TrendingUp,
      title: w.groupSelectTitle,
      items: [
        {
          href: '/cycle-entry',
          icon: TrendingUp,
          title: w.cycleEntryTitle,
          desc: w.cycleEntryDesc,
          accent: 'green',
        },
        {
          href: '/market-level',
          icon: Gauge,
          title: w.marketLevelTitle,
          desc: w.marketLevelDesc,
          accent: 'green',
        },
        {
          href: '/backtest',
          icon: Activity,
          title: w.backtestTitle,
          desc: w.backtestDesc,
          accent: 'green',
        },
      ],
    },
    {
      id: 'workspace-portfolio',
      icon: Wallet,
      title: w.groupPortfolioTitle,
      items: [
        {
          href: '/portfolio',
          icon: Wallet,
          title: w.portfolioTitle,
          desc: w.portfolioDesc,
          accent: 'green',
        },
      ],
    },
    {
      id: 'workspace-research',
      icon: Sparkles,
      title: w.groupResearchTitle,
      items: [
        {
          href: '/analyze',
          icon: Search,
          title: w.analyzeTitle,
          desc: w.analyzeDesc,
          accent: 'accent',
        },
        {
          href: '/ex-dividend',
          icon: Coins,
          title: w.exDividendTitle,
          desc: w.exDividendDesc,
          accent: 'accent',
        },
      ],
    },
  ]

  const tools = groups.flatMap(group => group.items)

  const graph: object[] = [
    {
      '@type': 'WebSite',
      name: 'Vestential',
      url: BASE_URL,
      description: w.metaDesc,
      inLanguage: ['zh-TW', 'en', 'ja'],
    },
    {
      '@type': 'Organization',
      name: 'Vestential',
      url: BASE_URL,
      slogan: 'Vestential = Vest + Essential',
    },
    {
      '@type': 'WebPage',
      name: w.metaTitle,
      description: w.metaDesc,
      url: `${BASE_URL}${localizePath(locale, '/workspace')}`,
      inLanguage: locale,
      isPartOf: { '@type': 'WebSite', name: 'Vestential', url: BASE_URL },
    },
    {
      '@type': 'ItemList',
      name: w.title,
      itemListElement: tools.map((tool, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: tool.title,
        url: `${BASE_URL}${localizePath(locale, tool.href)}`,
      })),
    },
  ]
  const schema = { '@context': 'https://schema.org', '@graph': graph }

  const cardBase =
    'group bg-[var(--bg-card)] rounded-xl p-5 border border-white/5 transition-all duration-200 flex flex-col relative overflow-hidden'
  const cardHover =
    ' hover:border-[var(--accent)]/60 hover:-translate-y-0.5 hover:shadow-[0_10px_34px_rgba(79,140,255,0.16)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2'

  return (
    <div className="max-w-5xl mx-auto w-full px-4 py-8 md:py-10">
      <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-3">{w.title}</h1>
      <div className="mb-4 w-16 h-1 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-green)]" />
      <p className="max-w-2xl text-base text-[var(--text-secondary)] leading-relaxed mb-10">
        {w.subtitle}
      </p>

      {groups.map(group => (
        <section key={group.id} aria-labelledby={group.id} className="mb-10 last:mb-0">
          <SectionHeading id={group.id} icon={group.icon} title={group.title} size="md" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
            {group.items.map(tool => {
              const Icon = tool.icon
              const accentCls =
                tool.accent === 'accent'
                  ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                  : 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]'
              return (
                <Link
                  key={tool.href}
                  href={localizePath(locale, tool.href)}
                  className={`${cardBase}${cardHover}`}
                >
                  <span className={`w-11 h-11 rounded-xl flex items-center justify-center ${accentCls}`}>
                    <Icon className="w-6 h-6" />
                  </span>
                  <h3 className="mt-3 text-base font-semibold text-[var(--text-primary)] mb-1.5">
                    {tool.title}
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed flex-1">
                    {tool.desc}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent)]">
                    {dict.home.ctaUse}
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      ))}

      <p className="mt-10 text-center text-xs text-[var(--text-secondary)]">{w.disclaimer}</p>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
    </div>
  )
}
