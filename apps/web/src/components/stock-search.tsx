'use client'

import { RefreshCw } from 'lucide-react'
import { useI18n } from '@/i18n/LanguageProvider'
import type { Market } from '@/lib/portfolio'
import { displayStockName, type StockMultilingualName } from '@/lib/stock-display'

export interface StockCandidate {
  symbol: string
  name: string
  names?: StockMultilingualName
  market?: string
}

/**
 * 共用股票搜尋：統一打 `GET /api/stocks/search?q=&market=`（台股 local DB＋fuzzy＋Yahoo fallback，美股 Yahoo）。
 * 回傳前已過濾掉缺代號/名稱的雜訊候選。
 */
export async function searchStocks(q: string, market: Market): Promise<StockCandidate[]> {
  const query = q.trim()
  if (!query) return []
  try {
    const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(query)}&market=${market}`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.results ?? [])
      .filter((r: any) => r?.symbol && r?.name)
      .map((r: any) => ({ symbol: r.symbol, name: r.name, names: r.names, market: r.market ?? market }))
  } catch {
    return []
  }
}

interface StockCandidateListProps {
  candidates: StockCandidate[]
  loading?: boolean
  onPick: (c: StockCandidate) => void
  /** stack：整列按鈕（Backtest 下拉）；chips：可換行標籤（Portfolio 同步行）。 */
  layout?: 'stack' | 'chips'
  loadingText?: string
  emptyText?: string
  className?: string
}

/** 共用候選清單：顯示搜尋結果，點選後交由呼叫端處理（填入欄位/觸發回測）。 */
export function StockCandidateList({
  candidates,
  loading,
  onPick,
  layout = 'stack',
  loadingText = '搜尋中...',
  emptyText = '查無相符股票',
  className = '',
}: StockCandidateListProps) {
  const { locale } = useI18n()
  if (loading) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2.5 text-xs text-[var(--text-secondary)] ${className}`}>
        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {loadingText}
      </div>
    )
  }
  if (candidates.length === 0) {
    return <div className={`px-3 py-2.5 text-xs text-[var(--text-secondary)] ${className}`}>{emptyText}</div>
  }
  if (layout === 'chips') {
    return (
      <div className={`flex flex-wrap gap-2 ${className}`}>
        {candidates.map((c, j) => (
          <button
            key={`${c.symbol}-${j}`}
            type="button"
            onClick={() => onPick(c)}
            className="px-2.5 py-1 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-xs hover:border-[var(--accent)] transition text-left"
          >
            <span className="font-mono text-[var(--accent)]">{c.symbol}</span>
            <span className="text-[var(--text-primary)] ml-1.5">
              {displayStockName(c.symbol, locale, { fallbackName: c.name, names: c.names, market: c.market })}
            </span>
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className={className}>
      {candidates.map((c, i) => (
        <button
          key={`${c.symbol}-${i}`}
          type="button"
          onClick={() => onPick(c)}
          className="w-full text-left px-3 py-2.5 text-sm hover:bg-white/5 transition flex items-center gap-2"
        >
          <span className="font-mono text-[var(--accent)] w-20 shrink-0">{c.symbol}</span>
          <span className="text-[var(--text-primary)] truncate">
            {displayStockName(c.symbol, locale, { fallbackName: c.name, names: c.names, market: c.market })}
          </span>
        </button>
      ))}
    </div>
  )
}