import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { cookies } from 'next/headers'
import './globals.css'
import { Header } from '@/components/header'
import { Footer } from '@/components/footer'
import { FestivalBanner } from '@/components/festival-banner'
import { getCurrentFestival, pickFestivalMessage } from '@/lib/festival-calendar'
import { dictionaries } from '@/i18n/dictionaries'
import { getCurrentUserFromCookies, isAdminUser } from '@/lib/auth'
import { LanguageProvider } from '@/i18n/LanguageProvider'
import { getLocale } from '@/i18n/server'

const GA_MEASUREMENT_ID = 'G-1L1W07PGXY'

export const metadata: Metadata = {
  metadataBase: new URL('https://vestential.com'),
  title: 'Vestential',
  description: 'AI-powered stock analysis platform for working professionals: quarterly-line deviation, odd-lot accumulation, P&L tracking, and AI analysis.',
}

export const viewport: Viewport = {
  themeColor: '#0f1118',
}

// 節慶橫幅跨日快取：必須每請求以 Asia/Taipei 取日判斷，禁止靜態化殘留到隔日。
export const dynamic = 'force-dynamic'

/** 當日是否有橫幅關閉 cookie（無 cookie／讀取失敗一律回 false，照常顯示不炸）。 */
async function isFestivalBannerDismissed(dateStr: string): Promise<boolean> {
  try {
    const store = await cookies()
    return store.get(`festival-banner-dismissed:${dateStr}`)?.value === '1'
  } catch {
    return false
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserFromCookies()
  const isAdmin = user ? await isAdminUser(user) : false
  const initialUser = user
    ? {
        id: user.id,
        displayName: user.display_name,
        email: user.email,
        avatarUrl: user.avatar_url,
        isAdmin,
      }
    : null
  const locale = await getLocale()
  const festival = getCurrentFestival()
  const festivalText = dictionaries[locale].festival.midAutumn
  // 橫幅關閉閘門：當日 cookie（festival-banner-dismissed:YYYY-MM-DD=1）命中即
  // server 直出不渲染，關閉後重整零閃爍。註：本 layout 已 force-dynamic，
  // 直接 await cookies() 即可，無需額外改動（無靜態快取殘留疑慮）。

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="antialiased min-h-screen flex flex-col">
        {GA_MEASUREMENT_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_MEASUREMENT_ID}');
              `}
            </Script>
          </>
        )}
        <LanguageProvider initialLocale={locale}>
          <Header initialUser={initialUser} />
          {festival?.id === 'mid-autumn' && !(await isFestivalBannerDismissed(festival.dateStr)) && (
            <FestivalBanner
              message={pickFestivalMessage(festivalText.messages, festival.dateStr)}
              dismissLabel={festivalText.dismiss}
              dateStr={festival.dateStr}
            />
          )}
          <main className="flex-1">{children}</main>
          <Footer />
        </LanguageProvider>
      </body>
    </html>
  )
}
