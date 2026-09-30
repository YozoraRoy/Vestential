import Link from 'next/link'
import { Search, PieChart, Wallet, Activity, TrendingUp, Clock } from 'lucide-react'
import { getDict, getLocale } from '@/i18n/server'
import { localizePath } from '@/i18n/paths'
import { buildAlternates } from '@/i18n/metadata'

export async function generateMetadata() {
  const dict = await getDict()
  const locale = await getLocale()
  const { metaTitle, metaDesc } = dict.about
  return {
    title: metaTitle,
    description: metaDesc,
    alternates: buildAlternates(locale, '/about'),
  }
}

export default async function AboutPage() {
  const dict = await getDict()
  const locale = await getLocale()
  const d = dict.about

  const steps = [
    { icon: PieChart, title: d.step1Title, desc: d.step1Desc, href: '/odd-lot', cta: d.step1Cta },
    { icon: Activity, title: d.step2Title, desc: d.step2Desc, href: '/backtest', cta: d.step2Cta },
    { icon: Wallet, title: d.step3Title, desc: d.step3Desc, href: '/portfolio', cta: d.step3Cta },
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <h1 className="text-3xl font-bold mb-8">{d.title}</h1>
      <div className="prose prose-invert max-w-none space-y-8 text-base text-[var(--text-secondary)] leading-relaxed">
        <section>
          <p>{d.hero1}</p>
          <p>{d.hero2}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-3">{d.nameTitle}</h2>
          <p>{d.nameDesc}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-3">{d.visionTitle}</h2>
          <p className="mb-4">{d.visionP1}</p>
          <p className="mb-4">{d.visionP2}</p>
          <p>{d.visionP3}</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-3">{d.methodTitle}</h2>
          <p className="mb-4">{d.methodIntro}</p>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong className="text-[var(--text-primary)]">{dict.about.methodBiasLabel}</strong> — {dict.about.methodBias}<span>（<Link href={localizePath(locale, '/backtest')} className="text-[var(--accent)] hover:underline">{dict.about.methodBiasLink}</Link>）。</span></li>
            <li><strong className="text-[var(--text-primary)]">{dict.about.methodOddLotLabel}</strong> — {dict.about.methodOddLot}<span>（<Link href={localizePath(locale, '/odd-lot')} className="text-[var(--accent)] hover:underline">{dict.about.methodOddLotLink}</Link>）。</span></li>
            <li><strong className="text-[var(--text-primary)]">{dict.about.methodPortfolioLabel}</strong> — {dict.about.methodPortfolio}<span>（<Link href={localizePath(locale, '/portfolio')} className="text-[var(--accent)] hover:underline">{dict.about.methodPortfolioLink}</Link>）。</span></li>
            <li><strong className="text-[var(--text-primary)]">{dict.about.methodAiLabel}</strong> — {dict.about.methodAi}<span>（<Link href={localizePath(locale, '/analyze')} className="text-[var(--accent)] hover:underline">{dict.about.methodAiLink}</Link>）。</span></li>
            <li><strong className="text-[var(--text-primary)]">{dict.about.methodMarketFocusLabel}</strong> — {dict.about.methodMarketFocus}<span>（<Link href={localizePath(locale, '/market-focus')} className="text-[var(--accent)] hover:underline">{dict.about.methodMarketFocusLink}</Link>）。</span></li>
            <li><strong className="text-[var(--text-primary)]">{dict.about.methodArenaLabel}</strong> — {dict.about.methodArena}<span>（<Link href={localizePath(locale, '/agent-arena')} className="text-[var(--accent)] hover:underline">{dict.about.methodArenaLink}</Link>）。</span></li>
            <li><strong className="text-[var(--text-primary)]">{dict.about.methodNewsletterLabel}</strong> — {dict.about.methodNewsletter}<span>（<Link href={localizePath(locale, '/market-focus#subscribe')} className="text-[var(--accent)] hover:underline">{dict.about.methodNewsletterLink}</Link>）。</span></li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">{d.startTitle}</h2>
          <div className="not-prose grid grid-cols-1 md:grid-cols-3 gap-4">
            {steps.map((s, i) => (
              <div key={s.title} className="relative flex flex-col bg-[var(--bg-card)] rounded-xl p-5 border border-white/5">
                <div className="flex items-center gap-2 mb-3">
                  <s.icon className="w-6 h-6 text-[var(--accent)]" />
                  <span className="text-xs font-bold text-[var(--accent)]">STEP {i + 1}</span>
                </div>
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1.5">{s.title}</h3>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4 flex-1">{s.desc}</p>
                <Link
                  href={s.href}
                  className="inline-flex items-center justify-center text-center rounded-lg bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 border border-[var(--accent)]/30 text-[var(--accent)] text-sm font-medium px-3 py-2 transition"
                >
                  {s.cta}
                </Link>
                {i < steps.length - 1 && (
                  <div className="hidden md:flex absolute top-1/2 -right-4 -translate-y-1/2 text-[var(--text-secondary)] z-10">
                    <span className="text-lg font-bold">→</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-5 flex items-center gap-2 text-[var(--text-primary)] text-base">
            <TrendingUp className="w-4 h-4 text-[var(--accent)]" />
            {d.closing}
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-3">{d.contactTitle}</h2>
          <p>
            {d.contactDesc}{' '}
            <a href="mailto:service@vestential.com" className="text-[var(--accent)] hover:underline">service@vestential.com</a>
            {d.contactSuffix}
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-3">{d.disclaimerTitle}</h2>
          <div className="rounded-xl border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/5 px-6 py-5">
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{d.disclaimerDesc}</p>
            <div className="mt-3 pt-3 border-t border-[var(--accent-red)]/20">
              <Link href={localizePath(locale, '/terms')} className="text-xs text-[var(--accent)] hover:underline inline-flex items-center gap-1 font-medium">
                {d.disclaimerLink} &rarr;
              </Link>
            </div>
          </div>
        </section>
      </div>
      <div className="mt-8">
        <Link href={localizePath(locale, '/')} className="text-sm text-[var(--accent)] hover:underline">
          {dict.common.backToHome}
        </Link>
      </div>
    </div>
  )
}