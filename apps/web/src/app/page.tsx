import {
  Search,
  PieChart,
  Wallet,
  Activity,
  TrendingUp,
  Bot,
  Newspaper,
  Sparkles,
  ArrowRight,
} from 'lucide-react'
import Link from 'next/link'
import { getDict, getLocale } from '@/i18n/server'
import { localizePath } from '@/i18n/paths'
import { buildAlternates } from '@/i18n/metadata'
import { getMarketFocus } from '@stock/database'
import { SectionHeading } from '@/components/section-heading'
import { NewsCard } from '@/components/news-card'

const BASE_URL = 'https://vestential.com'

export async function generateMetadata() {
  const dict = await getDict()
  const locale = await getLocale()
  const alts = buildAlternates(locale, '/')
  return {
    title: dict.home.metaTitle,
    description: dict.home.metaDesc,
    alternates: alts,
    openGraph: {
      title: dict.home.metaTitle,
      description: dict.home.metaDesc,
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

export default async function Home() {
  const dict = await getDict()
  const locale = await getLocale()
  const quotes = dict.home.heroQuotes
  const q = quotes[Math.floor(Math.random() * quotes.length)]
  const main = locale === 'zh-TW' ? q.zh : locale === 'ja' ? q.ja : undefined
  const showEnglish = Boolean(main)
  const focus = await getMarketFocus(6)

  const graph: object[] = [
    {
      '@type': 'WebSite',
      name: 'Vestential',
      url: BASE_URL,
      description: dict.home.metaDesc,
      inLanguage: ['zh-TW', 'en', 'ja'],
    },
    {
      '@type': 'Organization',
      name: 'Vestential',
      url: BASE_URL,
      description: dict.home.metaDesc,
      slogan: 'Vestential = Vest + Essential',
    },
    {
      '@type': 'WebPage',
      name: dict.home.metaTitle,
      description: dict.home.metaDesc,
      url: `${BASE_URL}/`,
      inLanguage: locale,
      isPartOf: { '@type': 'WebSite', name: 'Vestential', url: BASE_URL },
      dateModified: focus[0]?.published_at
        ? new Date(focus[0].published_at).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
    },
  ]
  if (focus.length > 0) {
    graph.push({
      '@type': 'ItemList',
      name: dict.home.marketFocusTitle,
      itemListElement: focus.map((item, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: item.title,
        url: item.url,
        ...(item.published_at ? { datePublished: new Date(item.published_at).toISOString() } : {}),
      })),
    })
  }
  const schema = { '@context': 'https://schema.org', '@graph': graph }

  const cardBase =
    'group bg-[var(--bg-card)] rounded-xl p-5 border border-white/5 transition-all duration-200 flex flex-col relative overflow-hidden'
  const cardHover =
    ' hover:border-[var(--accent)]/60 hover:-translate-y-0.5 hover:shadow-[0_10px_34px_rgba(79,140,255,0.16)]'

  const features = [
    {
      href: '/odd-lot',
      icon: PieChart,
      title: dict.home.oddLotTitle,
      desc: dict.home.oddLotDesc,
      accent: 'green',
      developing: false,
    },
    {
      href: '/backtest',
      icon: Activity,
      title: dict.home.backtestTitle,
      desc: dict.home.backtestDesc,
      cta: dict.home.backtestCta,
      accent: 'green',
      developing: false,
    },
    {
      href: '/cycle-entry',
      icon: TrendingUp,
      title: dict.home.cycleEntryTitle,
      desc: dict.home.cycleEntryDesc,
      cta: dict.home.cycleEntryCta,
      accent: 'green',
      developing: false,
    },
    {
      href: '/portfolio',
      icon: Wallet,
      title: dict.home.portfolioTitle,
      desc: dict.home.portfolioDesc,
      accent: 'green',
      developing: false,
    },
    {
      href: '/analyze',
      icon: Search,
      title: dict.home.aiAnalyzeTitle,
      desc: dict.home.aiAnalyzeDesc,
      accent: 'accent',
      developing: false,
    },
    {
      href: '/agent-arena',
      icon: Bot,
      title: dict.home.agentTitle,
      desc: dict.home.agentDesc,
      accent: 'violet',
      developing: false,
    },
  ] as const

  return (
    <div className="max-w-5xl mx-auto w-full px-4 py-8 md:py-10">
      {/* ① Hero */}
      <section aria-label={dict.home.heroTitle} className="text-center mb-12">
        <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-3">
          {dict.home.heroTitle}
        </h1>
        <div className="mx-auto mb-4 w-16 h-1 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-green)]" />
        <p className="max-w-2xl mx-auto text-base text-[var(--text-secondary)] leading-relaxed">
          {dict.home.heroSubtitle}
        </p>
        <figure
          aria-label="Investment quotes"
          className="mt-7 mx-auto max-w-2xl bg-[var(--bg-secondary)]/60 rounded-2xl px-6 py-5 border border-white/5 text-center"
        >
          <blockquote className="text-[var(--text-primary)] text-base md:text-lg leading-relaxed mb-2">
            <span className="text-[var(--accent)] text-xl leading-none mr-1 align-top" aria-hidden="true">{'\u201C'}</span>
            {main ?? q.en}
            <span className="text-[var(--accent)] text-xl leading-none ml-1 align-bottom" aria-hidden="true">{'\u201D'}</span>
          </blockquote>
          {showEnglish && (
            <p className="text-sm italic text-[var(--text-secondary)] mb-2">{q.en}</p>
          )}
          <figcaption className="text-sm text-[var(--text-secondary)]">— {q.author}</figcaption>
        </figure>
      </section>

      {/* ② Core features */}
      <section aria-labelledby="core-features" className="mb-14">
        <SectionHeading id="core-features" icon={Sparkles} title={dict.home.coreFeaturesTitle} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {features.map((f) => {
            const Icon = f.icon
            const accentCls =
              f.accent === 'accent'
                ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                : f.accent === 'violet'
                  ? 'bg-[var(--accent-violet)]/15 text-[var(--accent-violet)]'
                  : 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]'
            const cardHoverCls =
              f.accent === 'violet'
                ? ' hover:border-[var(--accent-violet)]/60 hover:-translate-y-0.5 hover:shadow-[0_10px_34px_rgba(167,139,250,0.16)]'
                : cardHover
            const inner = (
              <>
                <div className="flex items-start justify-between mb-3">
                  <span className={`w-11 h-11 rounded-xl flex items-center justify-center ${accentCls}`}>
                    <Icon className="w-6 h-6" />
                  </span>
                  {f.developing && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">
                      {dict.home.inDevelopment}
                    </span>
                  )}
                </div>
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1.5">
                  {f.title}
                </h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed flex-1">
                  {f.desc}
                </p>
                {!f.developing && (
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent)]">
                    {'cta' in f ? f.cta : dict.home.ctaUse}
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                )}
              </>
            )
            if (f.developing) {
              return (
                <div key={f.title} className={`${cardBase} opacity-80 select-none`}>
                  {inner}
                </div>
              )
            }
            return (
              <Link key={f.title} href={localizePath(locale, f.href!)} className={`${cardBase}${cardHoverCls}`}>
                {inner}
              </Link>
            )
          })}
        </div>
      </section>

      {/* ③ Market focus */}
      <section aria-label={dict.home.marketFocusTitle} className="mb-12">
        <SectionHeading
          id="market-focus"
          icon={Newspaper}
          title={dict.home.marketFocusTitle}
          badge="AI"
          size="md"
        >
          <Link
            href={localizePath(locale, '/market-focus')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent)] hover:opacity-80 transition"
          >
            {dict.home.marketFocusViewAll}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </SectionHeading>
        <p className="text-sm text-[var(--text-secondary)] mb-4">{dict.home.marketFocusSubtitle}</p>
        {focus.length > 0 ? (
          <ul className="grid grid-cols-1 gap-3">
            {focus.map((item) => (
              <NewsCard key={item.id} item={item} variant="compact" />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--text-secondary)]">{dict.home.marketFocusEmpty}</p>
        )}
      </section>

      {/* ④ Disclaimer */}
      <p className="mb-4 text-center text-xs text-[var(--text-secondary)]">
        {dict.home.disclaimerShort}
      </p>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
    </div>
  )
}