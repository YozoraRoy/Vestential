import { Newspaper, Sparkles, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { getDict, getLocale } from '@/i18n/server'
import { localizePath } from '@/i18n/paths'
import { buildAlternates } from '@/i18n/metadata'
import { getMarketFocus, getMarketFocusMeta, getMarketFocusWind } from '@stock/database'
import { SectionHeading } from '@/components/section-heading'
import { NewsCard } from '@/components/news-card'
import { MarketFocusSubscribe } from '@/components/market-focus-subscribe'
import { MarketFocusTtsBar } from '@/components/market-focus-tts-bar'

const BASE_URL = 'https://vestential.com'

export async function generateMetadata() {
  const dict = await getDict()
  const locale = await getLocale()
  const alts = buildAlternates(locale, '/market-focus')
  const title = `${dict.marketFocus.title} | Vestential`
  return {
    title,
    description: dict.marketFocus.metaDesc,
    alternates: alts,
    openGraph: {
      title,
      description: dict.marketFocus.metaDesc,
      url: alts.canonical,
      siteName: 'Vestential',
      type: 'website',
      locale: locale === 'zh-TW' ? 'zh_TW' : locale,
    },
    twitter: { card: 'summary_large_image' },
  }
}

function formatDateTime(s: string, locale: string): string {
  const dt = new Date(s)
  if (Number.isNaN(dt.getTime())) return s
  return dt.toLocaleDateString(locale) + ' ' + dt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

export default async function MarketFocusPage() {
  const dict = await getDict()
  const locale = await getLocale()
  // Issue #49：總覽 meta 讀取多帶 wind 欄（同一頁並行讀取，不新增 endpoint）
  const [focus, meta, wind] = await Promise.all([getMarketFocus(20, 2), getMarketFocusMeta(), getMarketFocusWind().catch(() => null)])

  // 風向燈只在 direction != none 時渲染；無新聞的日子頁面零變化
  const showWind = !!wind && wind.direction !== 'none' && !!wind.note
  let windUrls: string[] = []
  if (showWind && wind.related_urls) {
    try {
      const parsed: unknown = JSON.parse(wind.related_urls)
      if (Array.isArray(parsed)) windUrls = parsed.filter((u): u is string => typeof u === 'string').slice(0, 8)
    } catch {
      windUrls = []
    }
  }
  const windLamp =
    wind?.direction === 'bullish'
      ? { dot: 'bg-[var(--accent-green)]', label: dict.marketFocus.windBullish }
      : wind?.direction === 'bearish'
        ? { dot: 'bg-[var(--accent-red)]', label: dict.marketFocus.windBearish }
        : { dot: 'bg-amber-400', label: dict.marketFocus.windNeutral }

  const graph: object[] = [
    {
      '@type': 'WebSite',
      name: 'Vestential',
      url: BASE_URL,
      description: dict.marketFocus.metaDesc,
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
      name: dict.marketFocus.title,
      description: dict.marketFocus.metaDesc,
      url: `${BASE_URL}${localizePath(locale, '/market-focus')}`,
      inLanguage: locale,
      isPartOf: { '@type': 'WebSite', name: 'Vestential', url: BASE_URL },
      dateModified: focus[0]?.published_at ? new Date(focus[0].published_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    },
  ]
  if (focus.length > 0) {
    graph.push({
      '@type': 'ItemList',
      name: dict.marketFocus.title,
      itemListElement: focus.map((item, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: item.title,
        url: item.source_url || item.url,
        ...(item.published_at ? { datePublished: new Date(item.published_at).toISOString() } : {}),
      })),
    })
  }
  const schema = { '@context': 'https://schema.org', '@graph': graph }

  return (
    <div className="max-w-5xl mx-auto w-full px-4 py-8 md:py-10">
      <div className="flex items-center gap-2 mb-3">
        <Newspaper className="w-6 h-6 text-[var(--accent)]" />
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">{dict.marketFocus.aiPickBadge}</span>
      </div>
      <h1 className="text-3xl font-bold mb-3">{dict.marketFocus.title}</h1>
      <div className="mb-6 w-16 h-1 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-green)]" />
      <p className="max-w-2xl text-base text-[var(--text-secondary)] leading-relaxed mb-10">
        {dict.marketFocus.intro}
      </p>

      {/* 當日 AI 總覽 */}
      {meta?.summary ? (
        <section aria-labelledby="market-summary" className="mb-10">
          <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-6 py-5">
            <div className="flex items-center gap-2 mb-2.5">
              <Sparkles className="w-4 h-4 text-[var(--accent)]" />
              <h2 id="market-summary" className="text-base font-semibold text-[var(--text-primary)]">{dict.marketFocus.summaryTitle}</h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]">AI</span>
            </div>
            {/* Issue #49 川普風向燈小卡：只在 direction != none 時渲染，置於總覽文字上方 */}
            {showWind ? (
              <div aria-label={dict.marketFocus.windTitle} className="mb-4 rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className={`inline-block w-2.5 h-2.5 rounded-full ${windLamp.dot}`} />
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{dict.marketFocus.windTitle} · {windLamp.label}</span>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-primary)]">{wind.note}</p>
                {windUrls.length > 0 ? (
                  <p className="mt-2 text-xs text-[var(--text-secondary)]">
                    {dict.marketFocus.windRelatedTitle}：
                    {windUrls.map((u, i) => (
                      <span key={u}>
                        {i > 0 ? '｜' : ''}
                        <a href={u} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
                          {(() => {
                            try {
                              return new URL(u).hostname.replace(/^www\./, '')
                            } catch {
                              return `新聞${i + 1}`
                            }
                          })()}
                        </a>
                      </span>
                    ))}
                  </p>
                ) : null}
                <p className="mt-1.5 text-[11px] text-[var(--text-secondary)]">
                  {wind.generated_at ? `${dict.marketFocus.updatedLabel}${formatDateTime(wind.generated_at, locale)} · ` : ''}{dict.marketFocus.windDisclaimer}
                </p>
              </div>
            ) : null}
            <MarketFocusTtsBar summary={meta.summary} locale={locale} t={dict.marketFocus} />
            <p className="text-sm leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap mt-3">{meta.summary}</p>
            {meta.generated_at && (
              <p className="flex items-center gap-1.5 mt-3 text-xs text-[var(--text-secondary)]">
                <RefreshCw className="w-3.5 h-3.5" />
                {dict.marketFocus.updatedLabel}{formatDateTime(meta.generated_at, locale)}
              </p>
            )}
          </div>
        </section>
      ) : null}

      {/* 電子報訂閱 */}
      <MarketFocusSubscribe
        t={dict.marketFocus}
        socialLinks={{
          instagram: process.env.INSTAGRAM_PROFILE_URL || undefined,
          threads: process.env.THREADS_PROFILE_URL || undefined,
        }}
      />

      {/* 精選新聞 */}
      <section aria-labelledby="market-news" className="mb-10">
        <SectionHeading id="market-news" title={dict.marketFocus.selectedTitle} badge={dict.marketFocus.selectedBadge} />

        {focus.length > 0 ? (
          <ul className="grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-2">
            {focus.map((item) => (
              <NewsCard key={item.id} item={item} variant="full" />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--text-secondary)]">{dict.marketFocus.empty}</p>
        )}
      </section>

      {/* 方法與免責 */}
      <section aria-labelledby="market-method" className="mb-10">
        <SectionHeading id="market-method" title={dict.marketFocus.methodTitle} />
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
          {dict.marketFocus.methodDesc}
        </p>
        <div className="rounded-xl border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/5 px-6 py-5">
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            {dict.marketFocus.riskDesc}
          </p>
          <div className="mt-3 pt-3 border-t border-[var(--accent-red)]/20">
            <Link href={localizePath(locale, '/terms')} className="text-xs text-[var(--accent)] hover:underline inline-flex items-center gap-1 font-medium">
              {dict.marketFocus.termsLink}
            </Link>
          </div>
        </div>
      </section>

      <div>
        <Link href={localizePath(locale, '/')} className="text-sm text-[var(--accent)] hover:underline">
          {dict.marketFocus.backHome}
        </Link>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
    </div>
  )
}