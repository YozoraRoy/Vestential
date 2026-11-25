'use client'

import { useState, useEffect, type FormEvent } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { useI18n } from '@/i18n/LanguageProvider'
import { isTaiwanSymbol, normalizeTaiwanSymbol } from '@/lib/taiwan-symbol'

interface SearchBarProps {
  onSearch: (symbol: string) => void
  loading: boolean
  initialSymbol?: string
}

/** `/analyze` 專用搜尋框：僅接受台股代號（4~6 碼數字，可附 .TW / .TWO）。 */
export function SearchBar({ onSearch, loading, initialSymbol = '' }: SearchBarProps) {
  const [symbol, setSymbol] = useState(initialSymbol)
  const [formatError, setFormatError] = useState<string | null>(null)
  const { dict } = useI18n()

  useEffect(() => {
    if (initialSymbol) {
      setSymbol(initialSymbol)
    }
  }, [initialSymbol])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const normalized = normalizeTaiwanSymbol(symbol)
    if (!normalized) return
    // 台股格式 gate：不符即時顯示三語錯誤，不發 API。
    if (!isTaiwanSymbol(normalized)) {
      setFormatError(dict.analyzePage.invalidTaiwanSymbol)
      return
    }
    setFormatError(null)
    onSearch(normalized)
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)]" />
          <input
            type="text"
            value={symbol}
            onChange={e => {
              setSymbol(e.target.value)
              if (formatError && isTaiwanSymbol(e.target.value)) setFormatError(null)
            }}
            placeholder={dict.analyzePage.searchPlaceholder}
            className="w-full bg-[var(--bg-card)] border border-white/10 rounded-xl py-3 pl-10 pr-4
                       text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]
                       focus:outline-none focus:border-[var(--accent)] transition"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !symbol.trim()}
          className="bg-[var(--accent)] text-white px-6 rounded-xl font-medium
                     hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed
                     flex items-center gap-2 transition"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Analyze'}
        </button>
      </div>
      {formatError && (
        <p className="mt-2 text-xs text-red-400">{formatError}</p>
      )}
    </form>
  )
}
