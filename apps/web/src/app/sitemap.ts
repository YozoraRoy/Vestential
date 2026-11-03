import type { MetadataRoute } from 'next'
import { locales, defaultLocale, type Locale } from '@/i18n/config'

const BASE_URL = 'https://vestential.com'

const publicPaths = ['', '/about', '/privacy', '/terms', '/odd-lot', '/backtest', '/portfolio', '/analyze', '/market-focus', '/cycle-entry', '/agent-arena', '/login', '/workspace', '/market-level', '/ex-dividend']

function urlFor(locale: Locale, path: string): string {
  if (locale === defaultLocale) return `${BASE_URL}${path || ''}`
  return `${BASE_URL}/${locale}${path || ''}`
}

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = []
  for (const locale of locales) {
    for (const path of publicPaths) {
      entries.push({
        url: urlFor(locale, path),
        lastModified: new Date(),
        changeFrequency: path === '/' ? 'weekly' : 'monthly',
        priority: path === '' ? 1 : 0.7,
      })
    }
  }
  return entries
}
