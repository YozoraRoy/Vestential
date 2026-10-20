'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { defaultLocale, isLocale, storeLocale, type Locale } from './config'
import { dictionaries, type Dict } from './dictionaries'

interface I18nContextValue {
  locale: Locale
  dict: Dict
  setLocale: (locale: Locale) => void
}

const I18nContext = createContext<I18nContextValue>({
  locale: defaultLocale,
  dict: dictionaries[defaultLocale],
  setLocale: () => {},
})

/**
 * 語系的唯一來源是 server（`layout.tsx` 的 `getLocale()`：x-locale > cookie > Accept-Language > zh-TW）。
 * `initialLocale` 由 server 傳入、直接當成 useState 初始值 ⇒ 首屏（SSR HTML）即為該語系，
 * 且 server／client 首次 render 的初始值相同，不會產生 hydration mismatch。
 *
 * 刻意不在 client 端重新推導語系（localStorage／navigator.language／location.pathname）：
 * `/en/...`、`/ja/...` 已被 middleware rewrite 成無前綴路徑，client 讀不到路徑語系；
 * 重新推導只會覆寫 server 的結果，造成「先 zh-TW 再切換」的語系閃換。
 */
export function LanguageProvider({
  children,
  initialLocale,
}: {
  children: ReactNode
  initialLocale: Locale
}) {
  const [locale, setLocaleState] = useState<Locale>(
    isLocale(initialLocale) ? initialLocale : defaultLocale,
  )

  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return
    setLocaleState(next)
    storeLocale(next)
    if (typeof document !== 'undefined') {
      document.documentElement.lang = next
    }
  }, [])

  const dict = dictionaries[locale]

  return (
    <I18nContext.Provider value={{ locale, dict, setLocale }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
