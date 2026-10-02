'use client'

import Link from 'next/link'
import { AtSign, Facebook, Instagram } from 'lucide-react'
import { useI18n } from '@/i18n/LanguageProvider'
import { localizePath } from '@/i18n/paths'
import type { Dict } from '@/i18n/dictionaries'
import { SITE_SOCIAL_LINKS, type SiteSocialKey } from '@/lib/site-social'

const footerLinks: { key: keyof Dict['footer']; href: string }[] = [
  { key: 'privacy', href: '/privacy' },
  { key: 'terms', href: '/terms' },
  { key: 'about', href: '/about' },
]

// lucide 無 Threads 品牌 icon：Threads 用 AtSign（@ 概念），FB／IG 用品牌 icon；
// 三者皆為 icon＋文字並陳（文字為主、icon 為輔），不自繪 logo。
const socialIcons: Record<SiteSocialKey, typeof AtSign> = {
  threads: AtSign,
  instagram: Instagram,
  facebook: Facebook,
}

export function Footer() {
  const { dict, locale } = useI18n()
  return (
    <footer className="border-t border-white/5 mt-auto">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand-logo.png" alt="" className="w-4 h-4 object-contain opacity-70" />
            <span>© {new Date().getFullYear()} Vestential</span>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-5">
            <nav className="flex items-center gap-4 text-sm text-[var(--text-secondary)]">
              {footerLinks.map((link) => (
                <Link
                  key={link.href}
                  href={localizePath(locale, link.href)}
                  className="hover:text-[var(--text-primary)] transition"
                >
                  {dict.footer[link.key]}
                </Link>
              ))}
            </nav>
            <nav className="flex items-center gap-4 text-sm text-[var(--text-secondary)]">
              {SITE_SOCIAL_LINKS.map((social) => {
                const Icon = socialIcons[social.key]
                return (
                  <a
                    key={social.key}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 hover:text-[var(--text-primary)] transition"
                  >
                    <Icon className="w-4 h-4" aria-hidden="true" />
                    <span>{social.label}</span>
                  </a>
                )
              })}
            </nav>
          </div>
        </div>
      </div>
    </footer>
  )
}