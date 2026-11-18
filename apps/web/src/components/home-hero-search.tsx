'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, RefreshCw, Search } from 'lucide-react'
import type { Locale } from '@/i18n/config'
import { localizePath } from '@/i18n/paths'
import { searchStocks, type StockCandidate } from '@/components/stock-search'

const SEARCH_COPY: Record<
  Locale,
  {
    placeholder: string
    submitBtn: string
    searching: string
    noMatch: string
    analyzeTag: string
    chip2330: string
    chip0050: string
    chipCycle: string
    chipOcr: string
  }
> = {
  'zh-TW': {
    placeholder: '輸入台股代號或名稱（如 2330、0050），啟動 12 個 AI 智能體分析…',
    submitBtn: '立即分析',
    searching: '搜尋台股標的中…',
    noMatch: '按 Enter 直接分析此代號',
    analyzeTag: '啟動 12 AI 分析 →',
    chip2330: '🔥 2330 台積電',
    chip0050: '📈 0050 元大台灣50',
    chipCycle: '📊 查看今日進場候選',
    chipOcr: '📸 匯入券商截圖算損益',
  },
  en: {
    placeholder: 'Enter TWSE ticker or name (e.g. 2330, 0050) to launch 12-Agent AI Analysis…',
    submitBtn: 'Analyze',
    searching: 'Searching TWSE symbols…',
    noMatch: 'Press Enter to analyze this ticker',
    analyzeTag: 'Run 12-AI Analysis →',
    chip2330: '🔥 2330 TSMC',
    chip0050: '📈 0050 Yuanta Taiwan 50',
    chipCycle: '📊 Today’s Cycle Entry Picks',
    chipOcr: '📸 Import Broker Screenshot P&L',
  },
  ja: {
    placeholder: '台湾株コードまたは銘柄名（例：2330、0050）を入力して 12 AI エージェント分析を起動…',
    submitBtn: 'AI 分析',
    searching: '銘柄を検索中…',
    noMatch: 'Enterキーでこの銘柄を分析',
    analyzeTag: '12 AI 分析を起動 →',
    chip2330: '🔥 2330 TSMC',
    chip0050: '📈 0050 元大台湾50',
    chipCycle: '📊 本日のエントリー候補',
    chipOcr: '📸 スクショから損益計算',
  },
}

export function HomeHeroSearch({ locale }: { locale: Locale }) {
  const router = useRouter()
  const t = SEARCH_COPY[locale] ?? SEARCH_COPY['zh-TW']
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<StockCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setCandidates([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      const list = await searchStocks(q, 'tw')
      if (!cancelled) {
        setCandidates(list.slice(0, 6))
        setActiveIndex(list.length > 0 ? 0 : -1)
        setLoading(false)
      }
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const goAnalyze = (rawSymbol: string) => {
    const clean = rawSymbol.trim().toUpperCase().replace(/\.(TW|TWO)$/i, '')
    if (!clean) return
    setOpen(false)
    router.push(localizePath(locale, `/analyze?ticker=${encodeURIComponent(clean)}`))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (activeIndex >= 0 && candidates[activeIndex]) {
      goAnalyze(candidates[activeIndex]!.symbol)
      return
    }
    if (candidates.length > 0) {
      goAnalyze(candidates[0]!.symbol)
      return
    }
    const token = query.trim().split(/\s+/)[0] ?? ''
    if (token) {
      goAnalyze(token)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown' && candidates.length > 0) {
      e.preventDefault()
      setOpen(true)
      setActiveIndex((prev) => (prev + 1) % candidates.length)
    } else if (e.key === 'ArrowUp' && candidates.length > 0) {
      e.preventDefault()
      setOpen(true)
      setActiveIndex((prev) => (prev <= 0 ? candidates.length - 1 : prev - 1))
    }
  }

  return (
    <div ref={containerRef} className="w-full">
      <form onSubmit={handleSubmit} className="relative">
        <div className="flex items-center rounded-2xl border-2 border-[var(--accent)]/50 bg-[var(--bg-secondary)]/90 focus-within:border-[var(--accent)] focus-within:shadow-[0_0_28px_rgba(79,140,255,0.28)] transition-all p-1.5">
          <Search className="w-5 h-5 text-[var(--accent)] ml-3 mr-2.5 shrink-0" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onKeyDown={handleKeyDown}
            placeholder={t.placeholder}
            aria-label={t.placeholder}
            className="w-full bg-transparent text-sm md:text-base text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/75 focus:outline-none py-2 pr-2"
          />
          <button
            type="submit"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] hover:opacity-95 text-white font-semibold text-xs md:text-sm px-4 py-2.5 transition shadow-sm cursor-pointer"
          >
            <span>{t.submitBtn}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {open && query.trim().length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-2 z-40 rounded-2xl border border-white/15 bg-[var(--bg-card)] shadow-2xl overflow-hidden">
            {loading ? (
              <div className="flex items-center gap-2 px-4 py-3 text-xs text-[var(--text-secondary)]">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
                <span>{t.searching}</span>
              </div>
            ) : candidates.length > 0 ? (
              <ul role="listbox" className="divide-y divide-white/5">
                {candidates.map((c, idx) => (
                  <li key={`${c.symbol}-${idx}`}>
                    <button
                      type="button"
                      onClick={() => goAnalyze(c.symbol)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm transition ${
                        idx === activeIndex ? 'bg-[var(--accent)]/15 text-[var(--text-primary)]' : 'hover:bg-white/5'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[var(--accent)]">{c.symbol}</span>
                        <span className="text-[var(--text-primary)] font-medium">{c.name}</span>
                      </span>
                      <span className="text-xs text-[var(--text-secondary)]">{t.analyzeTag}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <button
                type="button"
                onClick={() => goAnalyze(query)}
                className="w-full flex items-center justify-between px-4 py-3 text-left text-xs text-[var(--text-secondary)] hover:bg-white/5"
              >
                <span>
                  <strong className="font-mono text-[var(--accent)] mr-1.5">{query.trim().toUpperCase()}</strong>
                  {t.noMatch}
                </span>
                <span className="text-[var(--accent)]">{t.analyzeTag}</span>
              </button>
            )}
          </div>
        )}
      </form>

      {/* 熱門捷徑（Quick Chips） */}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <Link
          href={localizePath(locale, '/analyze?ticker=2330')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-[var(--text-primary)] transition"
        >
          {t.chip2330}
        </Link>
        <Link
          href={localizePath(locale, '/analyze?ticker=0050')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-[var(--text-primary)] transition"
        >
          {t.chip0050}
        </Link>
        <Link
          href={localizePath(locale, '/cycle-entry')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 border border-[var(--accent)]/30 text-xs font-medium text-[var(--accent)] transition"
        >
          {t.chipCycle}
        </Link>
        <Link
          href={localizePath(locale, '/portfolio')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-xs font-semibold text-emerald-300 transition"
        >
          {t.chipOcr}
        </Link>
      </div>
    </div>
  )
}
