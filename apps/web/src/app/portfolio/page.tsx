'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { TrendingUp, Zap, RefreshCw, Sparkles, History, ChevronDown, ChevronUp, Upload, Trash2, CheckCircle2, Plus, X, Search, Pencil } from 'lucide-react'
import { searchStocks, StockCandidateList } from '@/components/stock-search'
import PortfolioRiskPanel, { type RiskQuotaValue, type RiskSummaryValue } from '@/components/portfolio-risk-panel'
import { computeNetPnL, DEFAULT_FEE_DISCOUNT } from '@/lib/portfolio-net'
import { computePortfolioReviewStats, filterPortfolioReviewByMonth, PORTFOLIO_MIN_REVIEW_COUNT } from '@/lib/portfolio-review'
import type { DividendYieldReason } from '@/lib/portfolio'
import { estimateDividendYtd, type DividendYtdEntry } from '@/lib/portfolio-dividends'
import { buildHoldingsHash, findRiskSummariesByDate, getTaiwanDateStrClient, pruneOldRiskSummaries, saveRiskSummary } from '@/lib/risk-summary-cache'
import { useI18n } from '@/i18n/LanguageProvider'
import { parseJsonSafe, parseSseJson } from '@/lib/safe-parse'

function formatLLMError(raw: string, llmRateLimited: string): string {
  if (/rate.?limit|429|tokens per minute|TPM|exhausted/i.test(raw)) {
    return llmRateLimited
  }
  return raw
}

type Market = 'tw' | 'us'

function buildStrategies(ui: {
  strategyBuffett: string; strategyBuffettEn: string;
  strategyGrowth: string; strategyGrowthEn: string;
  strategyDividend: string; strategyDividendEn: string;
  strategyMomentum: string; strategyMomentumEn: string;
  strategyBalanced: string; strategyBalancedEn: string;
}) {
  return [
    { id: 'buffett', nameZh: ui.strategyBuffett, nameEn: ui.strategyBuffettEn },
    { id: 'growth', nameZh: ui.strategyGrowth, nameEn: ui.strategyGrowthEn },
    { id: 'dividend', nameZh: ui.strategyDividend, nameEn: ui.strategyDividendEn },
    { id: 'momentum', nameZh: ui.strategyMomentum, nameEn: ui.strategyMomentumEn },
    { id: 'balanced', nameZh: ui.strategyBalanced, nameEn: ui.strategyBalancedEn },
  ]
}

interface PnL {
  costBasis: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  totalReturn: number
  totalReturnPct: number
  yieldOnCost: number
}

interface Advice {
  rating: 'BUY' | 'HOLD' | 'SELL' | 'AVOID'
  confidence: number
  fairValue?: number
  marginOfSafety?: number
  upsideDownsidePct?: number
  summary: string
  keyPoints: string[]
  risks: string[]
  action: string
}

interface HistoryItem {
  id: number
  market: Market
  symbol: string
  symbol_name: string | null
  shares: number
  cost: number
  current_price: number
  dividend: number
  price_synced_at: string | null
  cost_basis: number
  market_value: number
  unrealized_pnl: number
  unrealized_pnl_pct: number
  total_return: number
  total_return_pct: number
  yield_on_cost: number
  strategy: string | null
  recommendation: string | null
  summary: string | null
  report_json: string | null
  created_at: string
}

interface RecognizedPosition {
  market: Market
  symbol: string
  symbolName?: string
  shares: number
  cost: number
  currentPrice: number
  dividend: number
}

const RATING_STYLE: Record<string, { text: string; bg: string }> = {
  BUY: { text: 'text-[var(--accent-green)]', bg: 'var(--accent-green)' },
  HOLD: { text: 'text-[var(--accent)]', bg: 'var(--accent)' },
  SELL: { text: 'text-[var(--accent-red)]', bg: 'var(--accent-red)' },
  AVOID: { text: 'text-[var(--text-secondary)]', bg: 'var(--text-secondary)' },
}

function formatMoney(n: number, market: Market): string {
  const symbol = market === 'tw' ? 'NT$' : '$'
  return `${symbol}${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function formatPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

// #34：表格欄位自定義（15 欄；操作欄常顯不參與）。
// 偏好鍵 portfolio-table-columns；評等預設關、其餘預設開；localStorage 讀寫皆 try/catch。
const TABLE_COLUMNS_STORAGE_KEY = 'portfolio-table-columns'
type TableColumnId =
  | 'rating' | 'name' | 'symbol' | 'shares' | 'cost' | 'price' | 'totalCost'
  | 'marketValue' | 'unrealized' | 'return' | 'dividend' | 'yield' | 'refYield'
  | 'net' | 'created'
const TABLE_COLUMN_IDS: TableColumnId[] = [
  'rating', 'name', 'symbol', 'shares', 'cost', 'price', 'totalCost',
  'marketValue', 'unrealized', 'return', 'dividend', 'yield', 'refYield',
  'net', 'created',
]
const DEFAULT_TABLE_COLUMNS: Record<TableColumnId, boolean> = {
  rating: false,
  name: true, symbol: true, shares: true, cost: true, price: true, totalCost: true,
  marketValue: true, unrealized: true, return: true, dividend: true, yield: true,
  refYield: true, net: true, created: true,
}
function loadTableColumns(): Record<TableColumnId, boolean> {
  try {
    if (typeof window === 'undefined') return { ...DEFAULT_TABLE_COLUMNS }
    const raw = window.localStorage.getItem(TABLE_COLUMNS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_TABLE_COLUMNS }
    const parsed = JSON.parse(raw) as Partial<Record<TableColumnId, boolean>>
    return { ...DEFAULT_TABLE_COLUMNS, ...Object.fromEntries(TABLE_COLUMN_IDS.filter((k) => typeof parsed[k] === 'boolean').map((k) => [k, parsed[k]])) }
  } catch {
    return { ...DEFAULT_TABLE_COLUMNS }
  }
}
// #34：排序鍵→欄位對照（隱藏欄排序自動失效用；評等/操作不參與排序）。
type RecordsSortKey =
  | 'name' | 'shares' | 'cost' | 'price' | 'totalCost' | 'marketValue'
  | 'unrealized' | 'returnRate' | 'dividend' | 'yield' | 'refYield' | 'net' | 'created'
const SORT_KEY_TO_COLUMN: Record<RecordsSortKey, TableColumnId> = {
  name: 'name', shares: 'shares', cost: 'cost', price: 'price', totalCost: 'totalCost',
  marketValue: 'marketValue', unrealized: 'unrealized', returnRate: 'return',
  dividend: 'dividend', yield: 'yield', refYield: 'refYield', net: 'net', created: 'created',
}

function num(s: string): number | null {
  if (!s.trim()) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export default function PortfolioPage() {
  const router = useRouter()
  const { dict } = useI18n()
  const ui = dict.portfolio
  const STRATEGIES = useMemo(() => buildStrategies(ui), [ui])
  // #23：safe-parse 友善文案（i18n 三語），傳給 parseJsonSafe。
  const safeMsg = useMemo(
    () => ({ connectionInterrupted: ui.errConnectionInterrupted, serverBusy: ui.errServerBusy }),
    [ui],
  )

  const [market, setMarket] = useState<Market>('tw')
  const [symbol, setSymbol] = useState('')
  const [symbolName, setSymbolName] = useState<string>('')
  const [shares, setShares] = useState('')
  const [cost, setCost] = useState('')
  const [currentPrice, setCurrentPrice] = useState('')
  const [dividend, setDividend] = useState('')
  const [strategyId, setStrategyId] = useState('buffett')

  const [quoteLoading, setQuoteLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [savedResult, setSavedResult] = useState<(PnL & { id: number; market: Market; symbol: string; symbolName?: string; shares: number; cost: number; currentPrice: number; dividend: number }) | null>(null)
  const [aiResult, setAiResult] = useState<{ advice: Advice; strategy: { nameZh: string; nameEn: string }; usedFallback?: boolean } | null>(null)
  // #27：後台 portfolio.fee_discount（預設 0.6），試算頁／紀錄詳情淨損益即時生效。
  const [feeDiscount, setFeeDiscount] = useState<number>(DEFAULT_FEE_DISCOUNT)
  const [progress, setProgress] = useState<{ step: string; detail: string }[]>([])
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null)

  const [history, setHistory] = useState<HistoryItem[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [listTab, setListTab] = useState<'positions' | 'risk'>('positions')
  // #30：風險總結 page 層 state（切持倉/風險頁籤不卸載清空）。
  // 有效定義：暫存日期＝今日（台灣日）且持倉快照 hash＝當前持倉；跨日／持倉變動即失效。
  const [riskSummary, setRiskSummary] = useState<(RiskSummaryValue & { dateStr: string; hash: string }) | null>(null)
  const [riskQuota, setRiskQuota] = useState<RiskQuotaValue | null>(null)
  const [historyReady, setHistoryReady] = useState(false)
  // #28：紀錄區檢視切換（卡片｜表格，沿用持倉/風險 segmented 風格）。
  // 偏好存 localStorage（key portfolio-records-view）；首次依 matchMedia(md) 決定預設。
  // 手機（md 以下）不渲染切換器與表格本體，一律顯示卡片。
  const [recordsView, setRecordsView] = useState<'cards' | 'table'>(() => {
    try {
      if (typeof window === 'undefined') return 'cards'
      const stored = window.localStorage.getItem('portfolio-records-view')
      if (stored === 'cards' || stored === 'table') return stored
      return window.matchMedia('(min-width: 768px)').matches ? 'table' : 'cards'
    } catch {
      return 'cards'
    }
  })
  const [isDesktop, setIsDesktop] = useState(() => {
    try {
      if (typeof window === 'undefined') return false
      return window.matchMedia('(min-width: 768px)').matches
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      const mq = window.matchMedia('(min-width: 768px)')
      const onChange = () => setIsDesktop(mq.matches)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    } catch {
      return
    }
  }, [])
  const handleRecordsViewChange = (v: 'cards' | 'table') => {
    setRecordsView(v)
    try {
      window.localStorage.setItem('portfolio-records-view', v)
    } catch {}
  }
  // #34：欄位可見性（下拉勾選即時生效＋localStorage 記住；評等預設關）。
  const [visibleColumns, setVisibleColumns] = useState<Record<TableColumnId, boolean>>(loadTableColumns)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const columnsRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    try {
      window.localStorage.setItem(TABLE_COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns))
    } catch {}
  }, [visibleColumns])
  // 下拉面板：點外面關閉。
  useEffect(() => {
    if (!columnsOpen) return
    const onDown = (e: MouseEvent) => {
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) setColumnsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [columnsOpen])
  const toggleColumn = (c: TableColumnId) => {
    setVisibleColumns((prev) => ({ ...prev, [c]: !prev[c] }))
  }
  // 欄位標籤（沿用既有表頭三語鍵，不新增單欄鍵）。
  const columnLabels: Record<TableColumnId, string> = useMemo(() => ({
    rating: ui.colRating, name: ui.colName, symbol: ui.colSymbol, shares: ui.detailShares,
    cost: ui.detailCost, price: ui.detailPrice, totalCost: ui.detailTotalCost,
    marketValue: ui.detailMarketValue, unrealized: ui.detailUnrealizedPnl,
    return: ui.resultTotalReturn, dividend: ui.detailDividend, yield: ui.detailYield,
    refYield: ui.colRefYield, net: ui.netTitle, created: ui.detailCreatedAt,
  }), [ui])
  const visibleColumnCount = useMemo(
    () => TABLE_COLUMN_IDS.filter((c) => visibleColumns[c]).length,
    [visibleColumns],
  )
  // #28＋#34：表格欄頭排序（名稱/數字欄全可排/建立時間，純前端 useMemo 排序，不打 API）。
  // 評等/操作欄不參與排序；隱藏中欄位的排序自動失效（回到無排序＋註明，不報錯）。
  const [sortKey, setSortKey] = useState<RecordsSortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [sortReset, setSortReset] = useState(false)
  const toggleSort = (k: RecordsSortKey) => {
    // 隱藏中的欄位不可排序：點擊無效（不報錯）。
    if (!visibleColumns[SORT_KEY_TO_COLUMN[k]]) return
    setSortReset(false)
    if (sortKey !== k) {
      setSortKey(k)
      setSortDir(k === 'name' ? 'asc' : 'desc')
    } else {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    }
  }
  useEffect(() => {
    if (sortKey && !visibleColumns[SORT_KEY_TO_COLUMN[sortKey]]) {
      setSortKey(null)
      setSortReset(true)
    }
  }, [visibleColumns, sortKey])
  // #33/#34：同步殖利率參考值（recordId→小數）＋缺值原因（recordId→三態）。
  const [syncYields, setSyncYields] = useState<Record<number, number | null>>({})
  const [syncYieldReasons, setSyncYieldReasons] = useState<Record<number, DividendYieldReason>>({})
  // #35：TWSE 除息快取（當年）＋無檔原因碼（API reason 原字串，顯示時轉三語）。
  const [divRows, setDivRows] = useState<DividendYtdEntry[]>([])
  const [divReason, setDivReason] = useState<string | null>(null)
  const sortedHistory = useMemo(() => {
    if (!sortKey) return history
    const arr = [...history]
    const dir = sortDir === 'asc' ? 1 : -1
    // #34：缺值（非有限數字）永遠沉底，與升降冪方向無關。
    const sortNums = (get: (r: HistoryItem) => number | null | undefined) => {
      arr.sort((a, b) => {
        const va = get(a)
        const vb = get(b)
        const aMiss = va == null || !Number.isFinite(va)
        const bMiss = vb == null || !Number.isFinite(vb)
        if (aMiss && bMiss) return 0
        if (aMiss) return 1
        if (bMiss) return -1
        return (va - vb) * dir
      })
    }
    switch (sortKey) {
      case 'name':
        arr.sort((a, b) => (a.symbol_name || a.symbol).localeCompare(b.symbol_name || b.symbol, 'zh-Hant') * dir)
        break
      case 'shares':
        sortNums((r) => r.shares)
        break
      case 'cost':
        sortNums((r) => r.cost)
        break
      case 'price':
        sortNums((r) => r.current_price)
        break
      case 'totalCost':
        sortNums((r) => r.cost_basis)
        break
      case 'marketValue':
        sortNums((r) => r.market_value)
        break
      case 'unrealized':
        sortNums((r) => r.unrealized_pnl)
        break
      case 'returnRate':
        sortNums((r) => r.total_return_pct)
        break
      case 'dividend':
        sortNums((r) => r.dividend)
        break
      case 'yield':
        sortNums((r) => r.yield_on_cost)
        break
      case 'refYield':
        sortNums((r) => {
          const y = syncYields[r.id]
          return typeof y === 'number' && Number.isFinite(y) ? y : null
        })
        break
      case 'net':
        sortNums((r) => computeNetPnL({
          market: r.market, symbol: r.symbol, shares: r.shares,
          cost: r.cost, currentPrice: r.current_price, discount: feeDiscount,
        }).netPnl)
        break
      case 'created':
        arr.sort((a, b) => (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir)
        break
    }
    return arr
  }, [history, sortKey, sortDir, syncYields, feeDiscount])
  const effectiveRecordsView: 'cards' | 'table' = isDesktop ? recordsView : 'cards'

  // #30：當前持倉快照 hash（代號＋股數＋現價；去重對齊後端，見 lib/risk-summary-cache）。
  const holdingsHash = useMemo(
    () => buildHoldingsHash(history.map((r) => ({ market: r.market, symbol: r.symbol, shares: r.shares, current_price: r.current_price }))),
    [history],
  )
  // 當日有效總結：日期＝今日（台灣日）且 hash＝當前持倉；維持全手動，不自動產生。
  const riskSummaryValid = riskSummary != null && riskSummary.dateStr === getTaiwanDateStrClient() && riskSummary.hash === holdingsHash
  const riskSummaryStale = riskSummary != null && riskSummary.dateStr === getTaiwanDateStrClient() && riskSummary.hash !== holdingsHash
  const riskSummaryForPanel: RiskSummaryValue | null = riskSummaryValid && riskSummary
    ? { text: riskSummary.text, dataAsOf: riskSummary.dataAsOf }
    : null
  // #30：摘要列「已含 AI 建議」＝analyze 有建議紀錄數＋當日有效風險總結（0/1）。
  const aiAdviceCount = history.filter((r) => r.recommendation).length + (riskSummaryValid ? 1 : 0)

  // #30：持倉就緒後從 localStorage 恢復當日總結（同 hash 沿用＋顯示資料時間，
  // 異 hash 留作「提示重按」依據；跨日條目由 prune 清掉故不會恢復）。
  useEffect(() => {
    if (!historyReady) return
    const today = getTaiwanDateStrClient()
    pruneOldRiskSummaries(today)
    const entries = findRiskSummariesByDate(today)
    if (entries.length === 0) {
      setRiskSummary(null)
      return
    }
    const picked = entries.find((e) => e.hash === holdingsHash) ?? entries[0]
    setRiskSummary({ text: picked.summary, dataAsOf: picked.dataAsOf, dateStr: picked.dateStr, hash: picked.hash })
  }, [historyReady, holdingsHash])

  const handleRiskSummarySaved = useCallback((s: RiskSummaryValue, quota: RiskQuotaValue | null, hash: string) => {
    const today = getTaiwanDateStrClient()
    saveRiskSummary(today, hash, { summary: s.text, dataAsOf: s.dataAsOf, savedAt: Date.now() })
    setRiskSummary({ text: s.text, dataAsOf: s.dataAsOf, dateStr: today, hash })
    if (quota) {
      setRiskQuota(quota)
      window.dispatchEvent(new Event('quota-updated'))
    }
  }, [])

  const handleRiskQuota = useCallback((q: RiskQuotaValue) => {
    setRiskQuota(q)
    window.dispatchEvent(new Event('quota-updated'))
  }, [])

  // #35：除息快取讀取（唯讀；抓取由同步鈕／排程順帶做，此處不觸發）。
  // 持倉變動時重抓當年台股快取（symbols 去重；美股不估算故不帶）。
  useEffect(() => {
    const twSymbols = [...new Set(history.filter((r) => r.market !== 'us').map((r) => r.symbol.toUpperCase()))]
    if (twSymbols.length === 0) {
      setDivRows([])
      setDivReason(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/portfolio/dividends?symbols=${encodeURIComponent(twSymbols.join(','))}`)
        const data = await parseJsonSafe(res, safeMsg)
        if (!cancelled && data?.success) {
          setDivRows(Array.isArray(data.dividends) ? data.dividends : [])
          setDivReason(typeof data.reason === 'string' ? data.reason : null)
        }
      } catch {}
    })()
    return () => {
      cancelled = true
    }
  }, [history])

  const [authMode, setAuthMode] = useState<'loading' | 'user' | 'guest'>('loading')
  const [claimOpen, setClaimOpen] = useState(false)
  const [claimResult, setClaimResult] = useState<string | null>(null)
  const [claimRedeem, setClaimRedeem] = useState('')
  const [claimError, setClaimError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null)

  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [recognizing, setRecognizing] = useState(false)
  const [recognitionQuota, setRecognitionQuota] = useState<{ used: number; max: number; remaining: number } | null>(null)
  const [recognized, setRecognized] = useState<Array<RecognizedPosition & { saved?: boolean }>>([])
  const [recognitionMethod, setRecognitionMethod] = useState<'vision' | 'ocr' | null>(null)
  const [enrichState, setEnrichState] = useState<{ names: number; symbols: number; prices: number } | null>(null)
  const [searchFor, setSearchFor] = useState<number | null>(null)
  const [searchResults, setSearchResults] = useState<Array<{ symbol: string; name: string }>>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // #25：建立 in-flight 守衛。ref 同步擋重入（連點第二次直接 return）＋ state 驅動按鈕 disabled＋「建立中」文案；
  // finally 釋放避免 throw/early-return 後按鈕永久 disabled 卡死。
  // 逐筆採 per-row 守衛（savingRowRef/savingRows）；saveAll 期間逐筆按鈕另以 savingAll 統一 disabled，避免並行重複 POST。
  const [savingAll, setSavingAll] = useState(false)
  const saveAllRef = useRef(false)
  const [savingRows, setSavingRows] = useState<number[]>([])
  const savingRowRef = useRef<Set<number>>(new Set())
  const [deletingId, setDeletingId] = useState<number | null>(null)
  // #26：紀錄編輯 modal（沿用 journal openEdit 預填風格；驗證沿用 validatePortfolioInput 模型）。
  const [editingItem, setEditingItem] = useState<HistoryItem | null>(null)
  const [editMarket, setEditMarket] = useState<Market>('tw')
  const [editSymbol, setEditSymbol] = useState('')
  const [editSymbolName, setEditSymbolName] = useState('')
  const [editShares, setEditShares] = useState('')
  const [editCost, setEditCost] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editDividend, setEditDividend] = useState('')
  const [editStrategy, setEditStrategy] = useState('buffett')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  // #33：現價同步 in-flight 守衛（沿用 #25 模式：ref 同步擋重入＋state 驅動 disabled＋旋轉；
  // finally 釋放避免失敗後按鈕永久 disabled）。yields 僅參考顯示（recordId→小數），失敗清單逐檔列出。
  const [syncing, setSyncing] = useState(false)
  const syncRef = useRef(false)
  const [syncFailed, setSyncFailed] = useState<Array<{ id: number; symbol: string; reason: string }>>([])

  const buildPayload = () => {
    const nShares = num(shares)
    const nCost = num(cost)
    const nPrice = num(currentPrice)
    const nDiv = num(dividend) ?? 0
    if (!symbol.trim()) {
      setError(ui.errSymbolRequired)
      return null
    }
    if (nShares == null || !(nShares > 0)) {
      setError(ui.errSharesGreaterThanZero)
      return null
    }
    if (nCost == null || nCost < 0) {
      setError(ui.errCostNonNegative)
      return null
    }
    if (nPrice == null || !(nPrice > 0)) {
      setError(ui.errPriceGreaterThanZero)
      return null
    }
    return {
      market,
      symbol: symbol.trim().toUpperCase(),
      shares: nShares,
      cost: nCost,
      currentPrice: nPrice,
      dividend: nDiv,
      symbolName: symbolName || undefined,
    }
  }

  const fetchHistory = async () => {
    try {
      // #43：拉到 200 筆，讓「全部」檔統計與覆盤有完整母體（列表照常全列）。
      const res = await fetch('/api/portfolio/records?limit=200')
      const data = await parseJsonSafe(res, safeMsg)
      if (data.success) setHistory(data.records)
    } catch (e) {
      console.error('Failed to fetch portfolio history:', e)
    }
    setHistoryReady(true)
  }

  const fetchRecognitionQuota = async () => {
    try {
      const res = await fetch('/api/portfolio/recognize')
      const data = await parseJsonSafe(res, safeMsg)
      if (data && typeof data.remaining === 'number') setRecognitionQuota(data)
    } catch {}
  }

  useEffect(() => {
    if (authMode === 'user') fetchRecognitionQuota()
  }, [authMode])

  // #27：載入後台手續費折讓；失敗沿用預設 0.6（不炸版）。
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/portfolio/fee-discount')
        const data = await parseJsonSafe(res, safeMsg)
        const n = Number(data?.discount)
        if (Number.isFinite(n) && n >= 0 && n <= 1) setFeeDiscount(n)
      } catch {}
    })()
  }, [])

  const resizeImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error(ui.errImageReadFailed))
      reader.onload = () => {
        const img = new Image()
        img.onerror = () => reject(new Error(ui.errImageFormatUnknown))
        img.onload = () => {
          const MAX = 1600
          let { width, height } = img
          if (width > MAX || height > MAX) {
            const ratio = Math.min(MAX / width, MAX / height)
            width = Math.round(width * ratio)
            height = Math.round(height * ratio)
          }
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            reject(new Error(ui.errImageCannotProcess))
            return
          }
          ctx.drawImage(img, 0, 0, width, height)
          resolve(canvas.toDataURL('image/jpeg', 0.85))
        }
        img.src = reader.result as string
      }
      reader.readAsDataURL(file)
    })
  }

  const handleRecognize = async (file: File) => {
    if (authMode !== 'user') {
      setError(ui.guestAiLoginRequired)
      return
    }
    if (!file.type.startsWith('image/')) {
      setError(ui.errUploadImage)
      return
    }
    setError(null)
    setRecognizing(true)
    setRecognized([])
    setRecognitionMethod(null)
    setEnrichState(null)
    setSearchFor(null)
    setSearchResults([])
    try {
      const preview = await resizeImage(file)
      setImagePreview(preview)
      const res = await fetch('/api/portfolio/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: preview }),
      })
      const data = await parseJsonSafe(res, safeMsg)
      if (data.error) {
        setError(data.error)
        if (typeof data?.quota?.used === 'number') setRecognitionQuota(data.quota)
        setRecognizing(false)
        return
      }
      const positions = (data.positions ?? []).map((p: RecognizedPosition) => ({
        market: p.market === 'us' ? 'us' : 'tw',
        symbol: p.symbol,
        symbolName: p.symbolName,
        shares: p.shares,
        cost: p.cost,
        currentPrice: p.currentPrice,
        dividend: p.dividend ?? 0,
        saved: false,
      }))
      setRecognized(positions)
      setRecognitionMethod(data.method === 'ocr' ? 'ocr' : data.method === 'vision' ? 'vision' : null)
      if (data.enriched) setEnrichState(data.enriched)
      if (data.quota) setRecognitionQuota(data.quota)
      if (positions.length === 0) setError(ui.errRecognizeNone)
    } catch (e: any) {
      setError(e.message || ui.errRecognizeFailed)
    } finally {
      setRecognizing(false)
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleRecognize(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleRecognize(file)
  }

  const updateRecognized = (index: number, patch: Partial<RecognizedPosition> & { saved?: boolean }) => {
    setRecognized((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch, saved: false } : p)))
  }

  const handleSearchStock = async (i: number) => {
    const p = recognized[i]
    const q = (p.symbolName || p.symbol || '').trim()
    if (!q) {
      setError(ui.errSearchFillNameOrSymbol)
      return
    }
    setError(null)
    setSearchLoading(true)
    try {
      const results = await searchStocks(q, p.market)
      setSearchResults(results)
      setSearchFor(i)
    } catch {
      setError(ui.errSearchFailed)
    } finally {
      setSearchLoading(false)
    }
  }

  const handlePickStock = async (i: number, r: { symbol: string; name: string }) => {
    setSearchFor(null)
    const p = recognized[i]
    updateRecognized(i, { symbol: r.symbol.toUpperCase(), symbolName: r.name || undefined })
    setNotice(ui.noticePickFilled.replace('{symbol}', r.symbol))
    try {
      const res = await fetch(`/api/portfolio/quote?symbol=${encodeURIComponent(r.symbol)}&market=${p.market}`)
      const data = await parseJsonSafe(res, safeMsg)
      if (res.ok && typeof data.price === 'number') {
        updateRecognized(i, { currentPrice: data.price, symbolName: data.name || r.name || undefined })
        setNotice(ui.noticePickPriceFetched.replace('{symbol}', data.symbol).replace('{name}', data.name || r.name).replace('{price}', String(data.price)))
      } else {
        setNotice(ui.noticePickManualPrice.replace('{symbol}', r.symbol))
      }
    } catch {
      setNotice(ui.noticePickManualPrice.replace('{symbol}', r.symbol))
    }
  }

  const saveRecognizedPosition = async (p: RecognizedPosition & { saved?: boolean }, index: number) => {
    // #25 per-row 守衛：同列建立中時重複點擊直接 return false，不產生重複 POST。
    if (savingRowRef.current.has(index)) return false
    savingRowRef.current.add(index)
    setSavingRows((prev) => (prev.includes(index) ? prev : [...prev, index]))
    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: p.market,
          symbol: p.symbol.toUpperCase(),
          shares: p.shares,
          cost: p.cost,
          currentPrice: p.currentPrice,
          dividend: p.dividend ?? 0,
          symbolName: p.symbolName || undefined,
          strategyId,
        }),
      })
      const data = await parseJsonSafe(res, safeMsg)
      if (data.error) {
        setError(ui.errRecordSaveFailed.replace('{symbol}', p.symbol).replace('{error}', data.error))
        return false
      }
      updateRecognized(index, { saved: true })
      await fetchHistory()
      return true
    } catch {
      setError(ui.errRecordSaveError.replace('{symbol}', p.symbol))
      return false
    } finally {
      savingRowRef.current.delete(index)
      setSavingRows((prev) => prev.filter((i) => i !== index))
    }
  }

  const saveAllRecognized = async () => {
    // #25 共用守衛：ref 同步生效，第一次迴圈執行中第二次連點直接 return，不產生重複 POST。
    if (saveAllRef.current) return
    saveAllRef.current = true
    setSavingAll(true)
    try {
      const pending = recognized.map((p, i) => ({ p, i })).filter((x) => !x.p.saved)
      let ok = 0
      for (const { p, i } of pending) {
        const r = await saveRecognizedPosition(p, i)
        if (r) ok++
      }
      if (ok > 0) {
        setNotice(ui.noticeCreatedRecords.replace('{n}', String(ok)))
        setShowAdd(false)
      } else {
        setNotice(null)
      }
    } finally {
      saveAllRef.current = false
      setSavingAll(false)
    }
  }

  // #25：歷史紀錄刪除（二次確認沿用 journal 站內風格 window.confirm；成功後刷新列表）。
  const handleDeleteRecord = async (item: HistoryItem) => {
    if (deletingId != null) return
    const label = item.symbol_name || item.symbol
    if (!window.confirm(ui.confirmDeleteRecord.replace('{symbol}', label))) return
    setDeletingId(item.id)
    setError(null)
    try {
      const res = await fetch(`/api/portfolio/records?id=${item.id}`, { method: 'DELETE' })
      const data = await parseJsonSafe(res, safeMsg)
      if (!res.ok || !data.success) {
        setError(ui.errRecordDeleteFailed.replace('{error}', data.error || `HTTP ${res.status}`))
        return
      }
      setNotice(ui.noticeRecordDeleted.replace('{symbol}', label))
      if (expandedId === item.id) setExpandedId(null)
      await fetchHistory()
    } catch (e: any) {
      setError(ui.errRecordDeleteFailed.replace('{error}', e.message || ''))
    } finally {
      setDeletingId(null)
    }
  }

  // #26：紀錄編輯（modal 欄位預填市場/代號/股數/成本/現價/配息/策略；存檔後刷新列表）。
  const openEditRecord = (item: HistoryItem) => {
    setEditingItem(item)
    setEditMarket(item.market)
    setEditSymbol(item.symbol)
    setEditSymbolName(item.symbol_name || '')
    setEditShares(String(item.shares))
    setEditCost(String(item.cost))
    setEditPrice(String(item.current_price))
    setEditDividend(String(item.dividend ?? 0))
    setEditStrategy(item.strategy || 'buffett')
    setEditError(null)
  }

  const closeEditRecord = () => {
    if (editSaving) return
    setEditingItem(null)
    setEditError(null)
  }

  const handleUpdateRecord = async () => {
    if (!editingItem || editSaving) return
    const nShares = num(editShares)
    const nCost = num(editCost)
    const nPrice = num(editPrice)
    const nDiv = num(editDividend) ?? 0
    if (!editSymbol.trim()) {
      setEditError(ui.errSymbolRequired)
      return
    }
    if (nShares == null || !(nShares > 0)) {
      setEditError(ui.errSharesGreaterThanZero)
      return
    }
    if (nCost == null || nCost < 0) {
      setEditError(ui.errCostNonNegative)
      return
    }
    if (nPrice == null || !(nPrice > 0)) {
      setEditError(ui.errPriceGreaterThanZero)
      return
    }
    setEditSaving(true)
    setEditError(null)
    setError(null)
    try {
      const res = await fetch(`/api/portfolio/records/${editingItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: editMarket,
          symbol: editSymbol.trim().toUpperCase(),
          shares: nShares,
          cost: nCost,
          currentPrice: nPrice,
          dividend: nDiv,
          symbolName: editSymbolName || undefined,
          strategy: editStrategy || undefined,
        }),
      })
      const data = await parseJsonSafe(res, safeMsg)
      if (!res.ok || !data.success) {
        setEditError(ui.errRecordUpdateFailed.replace('{error}', data.error || `HTTP ${res.status}`))
        return
      }
      const label = editSymbolName || editSymbol.trim().toUpperCase()
      setNotice(ui.noticeRecordUpdated.replace('{symbol}', label))
      setEditingItem(null)
      await fetchHistory()
    } catch (e: unknown) {
      setEditError(ui.errRecordUpdateFailed.replace('{error}', e instanceof Error ? e.message : ''))
    } finally {
      setEditSaving(false)
    }
  }

  const clearRecognition = () => {
    if (recognizing) return
    setImagePreview(null)
    setRecognized([])
    setRecognitionMethod(null)
    setEnrichState(null)
    setSearchFor(null)
    setSearchResults([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/auth/me')
        const data = await parseJsonSafe(res, safeMsg)
        setAuthMode(data?.success ? 'user' : 'guest')
      } catch {
        setAuthMode('guest')
      }
      await fetchHistory()
    })()
  }, [router])

  const handleCreateClaim = async () => {
    setClaimError(null)
    setClaimResult(null)
    try {
      const res = await fetch('/api/portfolio/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create' }),
      })
      const data = await parseJsonSafe(res, safeMsg)
      if (!res.ok) {
        setClaimError(data.error || '產生認領碼失敗')
        return
      }
      setClaimResult(data.code)
    } catch (e: any) {
      setClaimError(e.message || '產生認領碼失敗')
    }
  }

  const handleRedeemClaim = async () => {
    setClaimError(null)
    setClaimResult(null)
    if (!claimRedeem.trim()) {
      setClaimError(ui.guestErrCodeRequired)
      return
    }
    try {
      const res = await fetch('/api/portfolio/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'redeem', code: claimRedeem }),
      })
      const data = await parseJsonSafe(res, safeMsg)
      if (!res.ok) {
        setClaimError(data.error || '兌換認領碼失敗')
        return
      }
      setClaimRedeem('')
      setClaimResult(ui.guestRedeemed)
      await fetchHistory()
    } catch (e: any) {
      setClaimError(e.message || '兌換認領碼失敗')
    }
  }

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    if (retryCountdown === null || retryCountdown <= 0) return
    retryTimerRef.current = setInterval(() => {
      setRetryCountdown(prev => {
        if (prev === null || prev <= 1) return null
        return prev - 1
      })
    }, 1000)
    return () => { if (retryTimerRef.current) clearInterval(retryTimerRef.current) }
  }, [retryCountdown !== null])

  const handleFetchQuote = async () => {
    const sym = symbol.trim()
    if (!sym) {
      setError(ui.errQuoteRequired)
      return
    }
    setQuoteLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/portfolio/quote?symbol=${encodeURIComponent(sym)}&market=${market}`)
      const data = await parseJsonSafe(res, safeMsg)
      if (!res.ok) {
        setError(data.error || ui.errQuoteFailed)
        return
      }
      setCurrentPrice(String(data.price))
      if (data.name) setSymbolName(data.name)
      setNotice(ui.noticeFetchedQuote.replace('{symbol}', data.symbol).replace('{price}', String(data.price)))
    } catch (e: any) {
      setError(e.message || ui.errQuoteFailed)
    } finally {
      setQuoteLoading(false)
    }
  }

  const handleSave = async () => {
    const payload = buildPayload()
    if (!payload) return
    setSaving(true)
    setError(null)
    setNotice(null)
    setAiResult(null)
    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await parseJsonSafe(res, safeMsg)
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`)
        return
      }
      setSavedResult(data.record)
      setNotice(ui.noticeSavedPnlRecord)
      await fetchHistory()
      setShowAdd(false)
    } catch (e: any) {
      setError(e.message || ui.noticeSaveFailed)
    } finally {
      setSaving(false)
    }
  }

  const handleAnalyze = async () => {
    if (authMode !== 'user') {
      setError(ui.guestAiLoginRequired)
      return
    }
    const payload = buildPayload()
    if (!payload) return
    setAnalyzing(true)
    setError(null)
    setNotice(null)
    setAiResult(null)
    setProgress([])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/portfolio/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, strategyId }),
        signal: controller.signal,
      })

      if (!res.ok) {
        // #23：非 JSON（閘道 HTML／截斷）轉中文友善錯誤，不讓 V8 原生訊息漏到 UI。
        let body: any = null
        try {
          body = await parseJsonSafe(res, safeMsg)
        } catch (e: any) {
          body = { error: e?.message || ui.errServerBusy }
        }
        if (res.status === 401) {
          router.replace(`/login?redirect=${encodeURIComponent('/portfolio')}`)
          return
        }
        if (res.status === 429) {
          setError(body.error || ui.rateLimitError.replace('{used}', String(body.quota?.used ?? 3)))
          return
        }
        setError(body.error || `HTTP ${res.status}`)
        return
      }

      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let badBlocks = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''
        for (const block of blocks) {
          const lines = block.split('\n')
          let eventType = 'message'
          let data = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7)
            else if (line.startsWith('data: ')) data = line.slice(6)
          }
          if (!data) continue
          // #23：SSE 壞塊（截斷 JSON）跳過、不斷流；壞塊計數僅 console 記錄。
          const parsed = parseSseJson(data)
          if (!parsed) {
            badBlocks += 1
            console.warn(`[Portfolio/SSE] skipped malformed block #${badBlocks}`)
            continue
          }
          if (eventType === 'progress') {
            setProgress(prev => [...prev, parsed])
            if (parsed.step === 'LLM' && typeof parsed.detail === 'string') {
              const m = parsed.detail.match(/retrying in (\d+)s/)
              if (m) setRetryCountdown(parseInt(m[1], 10))
            }
          } else if (eventType === 'result') {
            setAiResult(parsed)
            setRetryCountdown(null)
            window.dispatchEvent(new Event('quota-updated'))
            await fetchHistory()
          } else if (eventType === 'error') {
            setError(formatLLMError(parsed.message, ui.llmRateLimited))
            setRetryCountdown(null)
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setError(e.message)
    } finally {
      setAnalyzing(false)
      setRetryCountdown(null)
      if (retryTimerRef.current) clearInterval(retryTimerRef.current)
      abortRef.current = null
    }
  }

  const handleSyncPrices = async () => {
    // #33：同步中重複點擊直接 return（沿用 #25 守衛模式）。
    if (syncRef.current) return
    syncRef.current = true
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch('/api/portfolio/sync', { method: 'POST' })
      const data = await parseJsonSafe(res, safeMsg)
      if (!res.ok || !data.success) {
        setError(data.error || ui.syncError)
        return
      }
      if (data.yields && typeof data.yields === 'object') setSyncYields(data.yields)
      // #34：缺值原因同步（非三態字串一律丟棄，避免髒資料進 UI）。
      if (data.yieldReasons && typeof data.yieldReasons === 'object') {
        const clean: Record<number, DividendYieldReason> = {}
        for (const [k, v] of Object.entries(data.yieldReasons)) {
          if (v === 'no-data' || v === 'timeout' || v === 'rate-limited') clean[Number(k)] = v
        }
        setSyncYieldReasons(clean)
      } else {
        setSyncYieldReasons({})
      }
      setSyncFailed(Array.isArray(data.failed) ? data.failed : [])
      setNotice(ui.syncDone.replace('{updated}', String(data.updated ?? 0)).replace('{scanned}', String(data.scanned ?? 0)))
      await fetchHistory()
    } catch (e: any) {
      setError(e.message || ui.syncError)
    } finally {
      syncRef.current = false
      setSyncing(false)
    }
  }

  const syncReasonText = (reason: string) =>
    reason === 'resolve' ? ui.syncReasonResolve : reason === 'save' ? ui.syncReasonSave : ui.syncReasonQuote

  // #34：殖利率參考顯示——有值顯示 ％；缺值顯示三態原因（三語），不再空白 —。
  // 尚未同步（無原因）時預設顯示「暫無資料」，同步後以 API 回傳原因為準。
  const yieldReasonText = (reason: DividendYieldReason | undefined): string => {
    if (reason === 'timeout') return ui.yieldTimeout
    if (reason === 'rate-limited') return ui.yieldRateLimited
    return ui.yieldNoData
  }
  const refYieldText = (id: number) => {
    const y = syncYields[id]
    return typeof y === 'number' && Number.isFinite(y) ? `${(y * 100).toFixed(2)}%` : yieldReasonText(syncYieldReasons[id])
  }

  // #33：全持倉最近一次同步時間（price_synced_at 最大值；無則不顯示）。
  const latestSyncAt = useMemo(() => {
    let latest: string | null = null
    for (const r of history) {
      if (r.price_synced_at && (latest == null || r.price_synced_at > latest)) latest = r.price_synced_at
    }
    return latest
  }, [history])

  // #35：YTD 估算（recordId→{total,count}；僅台股且有計入事件才列，手填 dividend 不動）。
  const divToday = getTaiwanDateStrClient()
  const ytdById = useMemo(() => {
    const m = new Map<number, { total: number; count: number }>()
    for (const r of history) {
      if (r.market === 'us') continue
      const est = estimateDividendYtd(r.symbol, r.shares, r.created_at, divRows, divToday)
      if (est.count > 0) m.set(r.id, { total: est.total, count: est.count })
    }
    return m
  }, [history, divRows, divToday])
  // #35：無檔原因（三語；null＝正常不顯示）。
  const divReasonText: string | null =
    divReason === 'non-trading-day' ? ui.divReasonNonTrading
    : divReason === 'cache-pending' ? ui.divReasonPending
    : divReason === 'empty-file' ? ui.divReasonEmpty
    : null
  const ytdEstText = (id: number, market: Market) => {
    const y = ytdById.get(id)
    return y ? ui.divYtdEst.replace('{amount}', formatMoney(y.total, market)) : null
  }

  const ratingColor = (rating?: string | null) => (rating ? RATING_STYLE[rating]?.text || 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')

  const expandHistory = (item: HistoryItem) => {
    setExpandedId(prev => (prev === item.id ? null : item.id))
  }

  const strategyName = (id: string | null) => STRATEGIES.find(s => s.id === id)?.nameZh ?? id ?? ''
  const currency = market === 'tw' ? 'NT$' : '$'

  // #43：歷史區整體覆盤（月／全部兩檔；統計走前端純算免費，覆盤才打 API 扣共用 quota）。
  const thisMonth = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }, [])
  const [reviewScope, setReviewScope] = useState<'month' | 'all'>('all')
  const [reviewText, setReviewText] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  // 統計與覆盤 API 共用同一純函式（lib/portfolio-review），保證與明細加總一致。
  const reviewRecords = useMemo(
    () => filterPortfolioReviewByMonth(history, reviewScope === 'month' ? thisMonth : 'all'),
    [history, reviewScope, thisMonth],
  )
  const reviewStats = useMemo(() => computePortfolioReviewStats(reviewRecords), [reviewRecords])
  const fmtSigned = (n: number | null) =>
    n == null || !Number.isFinite(n)
      ? '—'
      : `${n >= 0 ? '+' : ''}${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  const handleReview = async () => {
    if (reviewing) return
    if (authMode !== 'user') {
      router.replace(`/login?redirect=${encodeURIComponent('/portfolio')}`)
      return
    }
    setReviewing(true)
    setReviewError(null)
    try {
      const res = await fetch('/api/portfolio/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: reviewScope === 'month' ? thisMonth : 'all' }),
      })
      if (res.status === 401) {
        router.replace(`/login?redirect=${encodeURIComponent('/portfolio')}`)
        return
      }
      const data = await parseJsonSafe(res, safeMsg)
      if (!res.ok) {
        // 未滿 5 筆由 code 轉三語提示（server 只回中文，UI 以 i18n 鍵顯示）。
        if (data?.code === 'TOO_FEW_ENTRIES') {
          setReviewError(
            ui.reviewNeedMore
              .replace('{count}', String(data?.count ?? reviewRecords.length))
              .replace('{min}', String(data?.minRequired ?? PORTFOLIO_MIN_REVIEW_COUNT)),
          )
        } else {
          setReviewError(data?.error || ui.reviewFailed)
        }
        return
      }
      setReviewText(data.review ?? null)
      window.dispatchEvent(new Event('quota-updated'))
    } catch (e: unknown) {
      setReviewError(e instanceof Error ? e.message : ui.reviewFailed)
    } finally {
      setReviewing(false)
    }
  }

  const stats = useMemo(() => {
    const byMarket: Record<Market, { count: number; pnl: number }> = {
      tw: { count: 0, pnl: 0 },
      us: { count: 0, pnl: 0 },
    }
    // #29：第四卡改「投資總成本」＝ Σ cost_basis（台＋美合計，可手算重現）。
    let totalCost = 0
    for (const r of history) {
      const m = r.market === 'us' ? 'us' : 'tw'
      byMarket[m].count += 1
      byMarket[m].pnl += r.unrealized_pnl
      totalCost += r.cost_basis
    }
    return { ...byMarket, totalCost }
  }, [history])

  const inputCls =
    'w-full bg-[var(--bg-secondary)] border border-white/10 rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50'

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-8 h-8 text-[var(--accent-green)]" />
          <div>
            <h1 className="text-2xl font-bold">{ui.headerTitle}</h1>
            <p className="text-sm text-[var(--text-secondary)]">{showAdd ? ui.headerSubtitleAdd : ui.headerSubtitleView}</p>
          </div>
        </div>
        {!showAdd && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition"
          >
            <Plus className="w-4 h-4" />
            {ui.headerAdd}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-400 mb-4">{error}</p>}
      {notice && <p className="text-xs text-[var(--accent)] mb-4">{notice}</p>}

      {authMode === 'guest' && (
        <div className="bg-[var(--bg-card)] border border-white/10 rounded-xl p-4 mb-6">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 text-sm">
              <p className="font-medium text-[var(--text-primary)]">{ui.guestBannerTitle}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">{ui.guestBannerDesc}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href="/login?redirect=/portfolio"
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition"
              >
                {ui.guestLogin}
              </a>
              <button
                type="button"
                onClick={() => setClaimOpen(v => !v)}
                className="px-4 py-2 rounded-lg bg-white/10 text-sm hover:bg-white/15 transition"
              >
                {ui.guestClaimBtn}
              </button>
            </div>
          </div>

          {claimOpen && (
            <div className="mt-4 border-t border-white/10 pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-[var(--text-primary)] mb-1">{ui.guestCreateTitle}</p>
                <p className="text-xs text-[var(--text-secondary)] mb-2">{ui.guestCreateHint}</p>
                <button
                  type="button"
                  onClick={handleCreateClaim}
                  className="px-4 py-2 rounded-lg bg-white/10 text-sm hover:bg-white/15 transition"
                >
                  {ui.guestCreate}
                </button>
              </div>
              <div>
                <p className="text-xs font-medium text-[var(--text-primary)] mb-1">{ui.guestRedeemTitle}</p>
                <div className="flex gap-2">
                  <input
                    value={claimRedeem}
                    onChange={e => setClaimRedeem(e.target.value)}
                    placeholder={ui.guestRedeemPlaceholder}
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={handleRedeemClaim}
                    className="shrink-0 px-4 py-2 rounded-lg bg-[var(--accent-green)] text-white text-sm font-medium hover:opacity-90 transition"
                  >
                    {ui.guestRedeem}
                  </button>
                </div>
              </div>
              {claimResult && (
                <div className="md:col-span-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 p-3">
                  <p className="text-xs text-[var(--text-secondary)]">
                    {ui.guestCreateTitle}：
                  </p>
                  <p className="font-mono text-lg tracking-wider text-[var(--accent-green)] break-all select-all mt-1">{claimResult}</p>
                  {claimResult !== ui.guestRedeemed && (
                    <p className="text-[10px] text-amber-400 mt-1">{ui.guestCreateHint}</p>
                  )}
                </div>
              )}
              {claimError && <p className="md:col-span-2 text-xs text-red-400">{claimError}</p>}
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4 text-[var(--accent)]" />
              {ui.addPanelTitle}
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">{ui.addPanelSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdd(false)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-sm text-[var(--text-primary)] hover:bg-white/15 transition"
          >
            <X className="w-4 h-4" />
            {ui.addPanelBack}
          </button>
        </div>

      {authMode === 'user' && (
      <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Upload className="w-4 h-4 text-[var(--accent)]" />
            {ui.aiUploadTitle}
          </h2>
          {recognitionQuota != null && (
            <span className="text-xs text-[var(--text-secondary)]">
              {ui.aiUploadQuotaLabel.replace('{remaining}', String(recognitionQuota.remaining)).replace('{max}', String(recognitionQuota.max))}
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--text-secondary)] mb-4">{ui.aiUploadDesc}</p>

        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} disabled={recognizing} />
        <div
          onDragOver={e => {
            e.preventDefault()
            if (recognizing) return
          }}
          onDrop={recognizing ? undefined : handleDrop}
          onClick={() => {
            if (recognizing) return
            fileInputRef.current?.click()
          }}
          className={`rounded-xl p-8 text-center transition group ${
            recognizing
              ? 'cursor-wait border-2 border-dashed border-white/10 opacity-60 pointer-events-none'
              : 'cursor-pointer border-2 border-dashed border-white/10 hover:border-[var(--accent)]'
          }`}
        >
          <Upload className="w-10 h-10 mx-auto mb-3 text-[var(--text-secondary)] group-hover:text-[var(--accent)] transition" />
          {recognizing ? (
            <p className="text-sm text-[var(--text-secondary)] flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              {ui.uploadRecognizing}
            </p>
          ) : (
            <>
              <p className="text-sm text-[var(--text-primary)]">{ui.uploadHintDrag}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">{ui.uploadHintSupport}</p>
            </>
          )}
        </div>

        {imagePreview && (
          <div className="mt-4">
            <div className="flex items-start gap-4 mb-4">
              <img src={imagePreview} alt={ui.altPreview} className="max-h-40 w-auto rounded-lg border border-white/10" />
              <div className="text-sm">
                <p className="font-medium text-[var(--text-primary)]">
                  {recognized.length > 0
                    ? <>{ui.previewDetected.replace('{n}', String(recognized.length))}</>
                    : ui.previewWaitAi}
                </p>
                {recognized.length > 0 && recognitionMethod === 'ocr' && (
                  <p className="mt-1 text-[11px] text-amber-400">{ui.previewOcrFallback}</p>
                )}
                <button
                  type="button"
                  onClick={clearRecognition}
                  disabled={recognizing}
                  className="mt-2 text-xs text-[var(--text-secondary)] hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-[var(--text-secondary)]"
                >
                  {ui.previewClearResult}
                </button>
              </div>
            </div>

            {recognized.length > 0 && (
              <div className="space-y-3">
                {enrichState && (enrichState.symbols + enrichState.names + enrichState.prices) > 0 && (
                  <p className="text-[11px] text-[var(--accent)]">
                    {ui.enrichAutoFill.replace('{symbols}', String(enrichState.symbols)).replace('{names}', String(enrichState.names)).replace('{prices}', String(enrichState.prices))}
                    <Search className="w-3 h-3 inline" /> {ui.enrichSearch}
                  </p>
                )}
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full text-xs min-w-[720px]">
                    <thead>
                      <tr className="text-left text-[var(--text-secondary)] border-b border-white/10 bg-[var(--bg-secondary)]/50">
                        <th className="px-2 py-2 font-medium">{ui.colIndex}</th>
                        <th className="px-2 py-2 font-medium">{ui.colMarket}</th>
                        <th className="px-2 py-2 font-medium">{ui.colSymbol}</th>
                        <th className="px-2 py-2 font-medium">{ui.colName}</th>
                        <th className="px-2 py-2 font-medium">{ui.colShares}</th>
                        <th className="px-2 py-2 font-medium">{ui.colCostPerShare}</th>
                        <th className="px-2 py-2 font-medium">{ui.colCurrentPrice}</th>
                        <th className="px-2 py-2 font-medium">{ui.colDividend}</th>
                        <th className="px-2 py-2 font-medium">{ui.colStatus}</th>
                        <th className="px-2 py-2 font-medium text-right">{ui.colAction}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recognized.map((p, i) => (
                        <Fragment key={i}>
                        <tr className={`border-b border-white/5 ${p.saved ? 'opacity-60' : ''}`}>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1 min-w-[64px]">
                              <span className="text-[var(--text-secondary)]">{i + 1}</span>
                              {(!p.symbol || !p.currentPrice || p.currentPrice <= 0) && (
                                <button
                                  type="button"
                                  onClick={() => handleSearchStock(i)}
                                  className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/10 bg-[var(--bg-secondary)] text-[var(--accent)] hover:border-[var(--accent)] transition text-[10px]"
                                  title={ui.btnSearchStock}
                                >
                                  <RefreshCw className="w-3 h-3" />
                                  {ui.btnSync}
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <select
                              value={p.market}
                              onChange={e => updateRecognized(i, { market: e.target.value as Market })}
                              className="bg-[var(--bg-secondary)] border border-white/10 rounded px-1 py-1"
                            >
                              <option value="tw">{ui.marketTw}</option>
                              <option value="us">{ui.marketUs}</option>
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <input
                              value={p.symbol}
                              onChange={e => updateRecognized(i, { symbol: e.target.value.toUpperCase() })}
                              className="w-20 bg-[var(--bg-secondary)] border border-white/10 rounded px-2 py-1"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              value={p.symbolName ?? ''}
                              placeholder={ui.placeholderName}
                              onChange={e => updateRecognized(i, { symbolName: e.target.value })}
                              className="w-24 bg-[var(--bg-secondary)] border border-white/10 rounded px-2 py-1"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number" min="0" value={p.shares}
                              onChange={e => updateRecognized(i, { shares: Number(e.target.value) || 0 })}
                              className="w-24 bg-[var(--bg-secondary)] border border-white/10 rounded px-2 py-1"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number" min="0" step="0.01" value={p.cost}
                              onChange={e => updateRecognized(i, { cost: Number(e.target.value) || 0 })}
                              className="w-24 bg-[var(--bg-secondary)] border border-white/10 rounded px-2 py-1"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number" min="0" step="0.01" value={p.currentPrice}
                              onChange={e => updateRecognized(i, { currentPrice: Number(e.target.value) || 0 })}
                              className="w-24 bg-[var(--bg-secondary)] border border-white/10 rounded px-2 py-1"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number" min="0" step="0.01" value={p.dividend}
                              onChange={e => updateRecognized(i, { dividend: Number(e.target.value) || 0 })}
                              className="w-24 bg-[var(--bg-secondary)] border border-white/10 rounded px-2 py-1"
                            />
                          </td>
                          <td className="px-2 py-2">
                            {p.saved ? (
                              <span className="flex items-center gap-1 text-[var(--accent-green)]">
                                <CheckCircle2 className="w-3.5 h-3.5" /> {ui.statusSaved}
                              </span>
                            ) : (
                              <span className="text-[var(--text-secondary)]">{ui.statusUnsaved}</span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleSearchStock(i)}
                                className="text-[var(--text-secondary)] hover:text-[var(--accent)]"
                                title={ui.btnSearchStock}
                              >
                                <Search className="w-3.5 h-3.5" />
                              </button>
                              {p.saved ? (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await fetchHistory()
                                    setNotice(ui.noticeRecordUpdated.replace('{symbol}', p.symbol))
                                    setExpandedId(null)
                                  }}
                                  className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                >
                                  {ui.btnViewRecord}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => saveRecognizedPosition(p, i)}
                                  disabled={savingRows.includes(i) || savingAll}
                                  className="text-[var(--accent)] hover:text-[var(--accent-green)] disabled:opacity-50 disabled:cursor-wait disabled:hover:text-[var(--accent)]"
                                >
                                  {savingRows.includes(i) ? ui.btnCreating : ui.btnCreate}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setRecognized(prev => prev.filter((_, j) => j !== i))}
                                className="text-[var(--text-secondary)] hover:text-red-400"
                                title={ui.btnDeleteRow}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {searchFor === i && (
                          <tr className="bg-[var(--bg-secondary)]/60 border-b border-white/5">
                            <td colSpan={10} className="px-2 py-2">
                              {(searchLoading || searchResults.length === 0) && (
                                <div className="flex items-center justify-between gap-2">
                                  <StockCandidateList
                                    candidates={searchResults}
                                    loading={searchLoading}
                                    onPick={() => {}}
                                    layout="chips"
                                    emptyText={ui.searchEmptyResult}
                                    className="flex-auto"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setSearchFor(null)}
                                    className="ml-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0"
                                  >
                                    <X className="w-3.5 h-3.5 inline" /> {ui.searchClose}
                                  </button>
                                </div>
                              )}
                              {!searchLoading && searchResults.length > 0 && (
                                <div>
                                  <div className="flex items-center justify-between gap-2 mb-1.5">
                                    <p className="text-xs text-[var(--text-secondary)]">{ui.searchPickPrompt}</p>
                                    <button
                                      type="button"
                                      onClick={() => setSearchFor(null)}
                                      className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                    >
                                      <X className="w-3.5 h-3.5 inline" /> {ui.searchCancel}
                                    </button>
                                  </div>
                                  <StockCandidateList
                                    candidates={searchResults}
                                    loading={false}
                                    onPick={(r) => handlePickStock(i, r)}
                                    layout="chips"
                                  />
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <p className="text-xs text-[var(--text-secondary)]">{ui.editHint}</p>
                  <button
                    type="button"
                    onClick={saveAllRecognized}
                    disabled={savingAll}
                    className="shrink-0 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent-green)] text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50 disabled:cursor-wait"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {savingAll ? ui.btnCreating : ui.btnSaveAll}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {authMode !== 'user' && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-6 mb-6 text-center">
          <p className="text-sm text-[var(--text-secondary)] mb-3">{ui.guestAiLoginRequired}</p>
          <a
            href="/login?redirect=/portfolio"
            className="inline-flex px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition"
          >
            {ui.guestLogin}
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{ui.formMarket}</span>
            <div className="flex rounded-lg overflow-hidden border border-white/10">
              {(['tw', 'us'] as Market[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMarket(m); setSymbol(''); setSymbolName(''); setCurrentPrice('') }}
                  className={`px-4 py-1.5 text-sm transition ${market === m ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  {m === 'tw' ? ui.marketTw : ui.marketUs}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-1">{ui.formSymbolLabel.replace('{example}', market === 'tw' ? ui.formSymbolExampleTw : ui.formSymbolExampleUs)}</label>
            <div className="flex gap-2">
              <input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder={market === 'tw' ? '2330' : 'AAPL'} className={inputCls} />
              <button
                type="button"
                onClick={handleFetchQuote}
                disabled={quoteLoading}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 text-sm hover:bg-white/15 transition disabled:opacity-50"
              >
                {quoteLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                {ui.formFetchPrice}
              </button>
            </div>
            {symbolName && <p className="mt-1 text-xs text-[var(--accent)]">{symbolName}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">{ui.formShares}</label>
              <input type="number" min="0" step="1" value={shares} onChange={e => setShares(e.target.value)} placeholder="1000" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">{ui.formCostPerShare.replace('{currency}', currency)}</label>
              <input type="number" min="0" step="0.01" value={cost} onChange={e => setCost(e.target.value)} placeholder="100" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">{ui.formPricePerShare.replace('{currency}', currency)}</label>
              <input type="number" min="0" step="0.01" value={currentPrice} onChange={e => setCurrentPrice(e.target.value)} placeholder="110" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">{ui.formCumDividend.replace('{currency}', currency)}</label>
              <input type="number" min="0" step="0.01" value={dividend} onChange={e => setDividend(e.target.value)} placeholder="0" className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-1">{ui.formStrategy}</label>
            <select value={strategyId} onChange={e => setStrategyId(e.target.value)} className={inputCls}>
              {STRATEGIES.map(s => (
                <option key={s.id} value={s.id}>{s.nameZh}（{s.nameEn}）</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || analyzing}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 text-sm font-medium hover:bg-white/15 transition disabled:opacity-50"
            >
              <History className="w-4 h-4" />
              {saving ? ui.formSaving : ui.formSavePnl}
            </button>
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={analyzing || saving || authMode !== 'user'}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              {analyzing ? ui.formAiAnalyzing : ui.formAiAnalyze}
            </button>
          </div>

          {analyzing && (
            <div className="space-y-1">
              {retryCountdown !== null && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                  <span className="text-xs font-medium text-amber-400">
                    {ui.rateLimitRetrying.replace('{n}', String(retryCountdown))}
                  </span>
                </div>
              )}
              {progress.map((p, i) => (
                <p key={i} className="text-xs text-[var(--text-secondary)]">
                  {p.step}: {p.detail}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {savedResult && (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-6">
              <h2 className="text-sm font-medium mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[var(--accent-green)]" />
                {savedResult.symbolName || savedResult.symbol} — {ui.resultTitle}
              </h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-[var(--text-secondary)] text-xs">{ui.resultTotalCost}</p>
                  <p className="font-medium">{formatMoney(savedResult.costBasis, savedResult.market)}</p>
                </div>
                <div>
                  <p className="text-[var(--text-secondary)] text-xs">{ui.resultMarketValue}</p>
                  <p className="font-medium">{formatMoney(savedResult.marketValue, savedResult.market)}</p>
                </div>
                <div>
                  <p className="text-[var(--text-secondary)] text-xs">{ui.resultUnrealizedPnl}</p>
                  <p className={`font-bold ${savedResult.unrealizedPnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                    {formatMoney(savedResult.unrealizedPnl, savedResult.market)}{' '}
                    <span className="text-xs">{formatPct(savedResult.unrealizedPnlPct)}</span>
                  </p>
                </div>
                <div>
                  <p className="text-[var(--text-secondary)] text-xs">{ui.resultTotalReturn}</p>
                  <p className={`font-bold ${savedResult.totalReturn >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                    {formatMoney(savedResult.totalReturn, savedResult.market)}{' '}
                    <span className="text-xs">{formatPct(savedResult.totalReturnPct)}</span>
                  </p>
                </div>
                <div>
                  <p className="text-[var(--text-secondary)] text-xs">{ui.resultYieldOnCost}</p>
                  <p className="font-medium">{savedResult.yieldOnCost.toFixed(2)}%</p>
                </div>
                {/* #27：淨損益並列（保留裸損益，稅費明細三行＋公式註腳＋三語） */}
                <NetPnlView
                  market={savedResult.market}
                  symbol={savedResult.symbol}
                  shares={savedResult.shares}
                  cost={savedResult.cost}
                  currentPrice={savedResult.currentPrice}
                  discount={feeDiscount}
                  ui={ui}
                  helpText={ui.helpNet}
                />
              </div>
            </div>
          )}

          {aiResult && (
            <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                  {ui.aiSuggestionTitle.replace('{strategy}', aiResult.strategy.nameZh)}
                </h2>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${RATING_STYLE[aiResult.advice.rating]?.text}`}
                  style={{ backgroundColor: `${RATING_STYLE[aiResult.advice.rating]?.bg}22` }}>
                  {aiResult.advice.rating}
                </span>
              </div>
              <p className="text-sm mb-1">{ui.aiConfidence.replace('{pct}', (aiResult.advice.confidence * 100).toFixed(0))}</p>
              {(aiResult.advice.fairValue != null || aiResult.advice.marginOfSafety != null || aiResult.advice.upsideDownsidePct != null) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)] mb-2">
                  {aiResult.advice.fairValue != null && <span>{ui.aiFairValue.replace('{currency}', currency).replace('{value}', aiResult.advice.fairValue.toLocaleString('en-US', { maximumFractionDigits: 2 }))}</span>}
                  {aiResult.advice.marginOfSafety != null && <span>{ui.aiMarginOfSafety.replace('{pct}', aiResult.advice.marginOfSafety.toFixed(2))}</span>}
                  {aiResult.advice.upsideDownsidePct != null && <span>{ui.aiUpside.replace('{pct}', formatPct(aiResult.advice.upsideDownsidePct))}</span>}
                </div>
              )}
              <p className="text-sm font-medium mb-2">{aiResult.advice.summary}</p>
              <div className="mb-2">
                <p className="text-xs text-[var(--text-secondary)] mb-1">{ui.aiKeyPoints}</p>
                <ul className="space-y-0.5">
                  {aiResult.advice.keyPoints.map((k, i) => (
                    <li key={i} className="text-xs text-[var(--text-primary)]">• {k}</li>
                  ))}
                </ul>
              </div>
              <div className="mb-3">
                <p className="text-xs text-[var(--text-secondary)] mb-1">{ui.aiRisks}</p>
                <ul className="space-y-0.5">
                  {aiResult.advice.risks.map((r, i) => (
                    <li key={i} className="text-xs text-[var(--accent-red)]">• {r}</li>
                  ))}
                </ul>
              </div>
              <p className="text-sm bg-[var(--bg-secondary)] rounded-lg p-3 border border-white/5">{aiResult.advice.action}</p>
              {aiResult.usedFallback && <p className="mt-2 text-[10px] text-[var(--text-secondary)]">{ui.aiUsedFallback}</p>}
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {history.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-4">
            <p className="text-xs text-[var(--text-secondary)]">{ui.summaryHoldings}</p>
            <p className="text-xl font-bold mt-1">{history.length}</p>
          </div>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-4">
            <p className="text-xs text-[var(--text-secondary)]">{ui.summaryWithAi}</p>
            <p className="text-xl font-bold mt-1">{aiAdviceCount}</p>
          </div>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-4">
            <p className="text-xs text-[var(--text-secondary)]">{ui.summaryTwPnl}</p>
            <p className={`text-lg font-bold mt-1 ${stats.tw.pnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>{formatMoney(stats.tw.pnl, 'tw')}</p>
          </div>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-white/5 p-4">
            <p className="text-xs text-[var(--text-secondary)]">{ui.summaryTotalCost}</p>
            <p className="text-lg font-bold mt-1">{formatMoney(stats.totalCost, 'tw')}</p>
          </div>
        </div>
      )}

      <div className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <History className="w-5 h-5 text-[var(--text-secondary)]" />
              {ui.historyTitle}
            </h2>
            <div className="flex rounded-lg overflow-hidden border border-white/10">
              {(['positions', 'risk'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setListTab(t)}
                  className={`px-3 py-1 text-xs transition ${listTab === t ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  {t === 'positions' ? ui.riskTabPositions : ui.riskTabRisk}
                </button>
              ))}
            </div>
          </div>
          {/* #33：同步現價鈕（in-flight disabled＋旋轉，沿用 #25 守衛）＋ #28 紀錄檢視切換器 */}
          <div className="flex items-center gap-2">
            {history.length > 0 && listTab === 'positions' && (
              <button
                type="button"
                onClick={handleSyncPrices}
                disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/10 text-xs hover:bg-white/15 transition disabled:opacity-50 disabled:cursor-wait"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? ui.syncSyncing : ui.syncPricesBtn}
              </button>
            )}
            <div className="hidden md:flex rounded-lg overflow-hidden border border-white/10" role="group" aria-label="records view">
              {(['cards', 'table'] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => handleRecordsViewChange(v)}
                  aria-pressed={recordsView === v}
                  className={`px-3 py-1 text-xs transition ${recordsView === v ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  {v === 'cards' ? ui.viewCards : ui.viewTable}
                </button>
              ))}
            </div>
            {/* #34：欄位下拉勾選面板（桌機表格檢視用；勾選即時生效，偏好記 localStorage）。 */}
            {history.length > 0 && listTab === 'positions' && (
              <div ref={columnsRef} className="hidden md:block relative">
                <button
                  type="button"
                  onClick={() => setColumnsOpen((v) => !v)}
                  aria-expanded={columnsOpen}
                  aria-haspopup="true"
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/10 text-xs hover:bg-white/15 transition"
                >
                  {ui.tableColumns}
                  {columnsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {columnsOpen && (
                  <div
                    role="menu"
                    aria-label={ui.tableColumns}
                    className="absolute right-0 z-30 mt-1 w-44 rounded-xl border border-white/10 bg-[var(--bg-card)] p-2 shadow-xl"
                  >
                    {TABLE_COLUMN_IDS.map((c) => (
                      <label
                        key={c}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] hover:bg-white/5 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={visibleColumns[c]}
                          onChange={() => toggleColumn(c)}
                          className="accent-[var(--accent)]"
                        />
                        <span className="truncate">{columnLabels[c]}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {/* #33：同步時間註明（price_synced_at 最大值＋非即時說明）＋失敗清單 */}
        {latestSyncAt && listTab === 'positions' && (
          <p className="text-[11px] text-[var(--text-secondary)] mb-3">
            {ui.syncUpdatedAt.replace('{time}', latestSyncAt)} · {ui.syncNonRealtime}
          </p>
        )}
        {/* #34：排序中的欄位被隱藏→回到無排序的註明（手動排序後清除）。 */}
        {sortReset && listTab === 'positions' && effectiveRecordsView === 'table' && (
          <p className="text-[11px] text-[var(--text-secondary)] mb-3">{ui.sortResetNote}</p>
        )}
        {syncFailed.length > 0 && listTab === 'positions' && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 mb-3">
            <p className="text-xs font-medium text-amber-400">{ui.syncFailedTitle.replace('{n}', String(syncFailed.length))}</p>
            <ul className="mt-1 space-y-0.5">
              {syncFailed.map((f) => (
                <li key={f.id} className="text-xs text-[var(--text-secondary)]">
                  {ui.syncFailedItem.replace('{symbol}', f.symbol).replace('{reason}', syncReasonText(f.reason))}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* #35：YTD 估算公式註腳＋除息快取無檔原因（非空白顯示，不報錯當機）。 */}
        {listTab === 'positions' && history.length > 0 && (
          <>
            <p className="text-[10px] text-[var(--text-secondary)] mb-2">{ui.divYtdFormula}</p>
            {divReasonText && (
              <p className="text-[11px] text-amber-400/90 mb-3">{divReasonText}</p>
            )}
          </>
        )}
        {/* #43：歷史區整體覆盤（統計免費純算；覆盤扣與 journal 共用 quota；
            文案與 journal 單筆紀律覆盤區隔：此處看持倉歷史、彼處看交易日誌）。 */}
        {listTab === 'positions' && history.length > 0 && (
          <section className="bg-[var(--bg-card)] rounded-xl border border-white/5 p-4 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                {ui.reviewTitle}
              </h3>
              <div className="flex rounded-lg overflow-hidden border border-white/10">
                {(['month', 'all'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { setReviewScope(s); setReviewText(null); setReviewError(null) }}
                    className={`px-3 py-1 text-xs transition ${reviewScope === s ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                  >
                    {s === 'month' ? `${ui.reviewScopeMonth}（${thisMonth}）` : ui.reviewScopeAll}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mb-1">{ui.reviewDesc}</p>
            <p className="text-xs text-[var(--text-secondary)] mb-3">{ui.reviewStatsFreeNote} {ui.reviewQuotaNote}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <div className="rounded-xl bg-white/5 p-3">
                <div className="text-xs text-[var(--text-secondary)]">{ui.reviewStatCount}</div>
                <div className="text-xl font-bold mt-1">{reviewStats.count}</div>
              </div>
              <div className="rounded-xl bg-white/5 p-3">
                <div className="text-xs text-[var(--text-secondary)]">{ui.reviewStatWinRate}</div>
                <div className="text-xl font-bold mt-1">{reviewStats.winRate == null ? '—' : `${reviewStats.winRate.toFixed(1)}%`}</div>
              </div>
              <div className="rounded-xl bg-white/5 p-3">
                <div className="text-xs text-[var(--text-secondary)]">{ui.reviewStatAvgPnl}</div>
                <div className="text-xl font-bold mt-1">{fmtSigned(reviewStats.avgPnl)}</div>
              </div>
              <div className="rounded-xl bg-white/5 p-3">
                <div className="text-xs text-[var(--text-secondary)]">{ui.reviewStatMaxLoss}</div>
                <div className="text-xl font-bold mt-1">
                  {reviewStats.maxLossEntry ? `#${reviewStats.maxLossEntry.id} ${fmtSigned(reviewStats.maxLossEntry.pnl)}` : ui.reviewNoMaxLoss}
                </div>
                {reviewStats.maxLossEntry && (
                  <div className="text-xs text-[var(--text-secondary)] mt-1">{reviewStats.maxLossEntry.symbol}｜{(reviewStats.maxLossEntry.createdAt || '').replace('T', ' ').slice(0, 10)}</div>
                )}
              </div>
            </div>
            {authMode === 'user' ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleReview}
                  disabled={reviewing}
                  className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
                >
                  {reviewing ? ui.btnReviewing : ui.btnReview}
                </button>
                <a href="/journal" className="text-xs text-[var(--accent)] hover:underline">{ui.reviewJournalLink}</a>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-secondary)]">
                {ui.guestAiLoginRequired}{' '}
                <a href="/login?redirect=/portfolio" className="text-[var(--accent)] hover:underline">{ui.guestLogin}</a>
              </p>
            )}
            {reviewError && <p className="text-sm text-red-400 mt-3">{reviewError}</p>}
            {reviewText ? (
              <div className="mt-3 text-sm whitespace-pre-wrap leading-relaxed">{reviewText}</div>
            ) : (
              !reviewError && <p className="text-xs text-[var(--text-secondary)] mt-3">{ui.reviewEmpty}</p>
            )}
            <p className="text-xs text-[var(--text-secondary)] mt-3">{ui.reviewDisclaimer}</p>
          </section>
        )}
        {listTab === 'risk' ? (
          <PortfolioRiskPanel
            ui={ui}
            isLoggedIn={authMode === 'user'}
            summary={riskSummaryForPanel}
            summaryStale={riskSummaryStale}
            quota={riskQuota}
            holdingsHash={holdingsHash}
            onSummarySaved={handleRiskSummarySaved}
            onQuota={handleRiskQuota}
          />
        ) : history.length === 0 ? (
          <div className="bg-[var(--bg-card)] rounded-xl border border-white/5 p-8 text-center">
            <p className="text-sm text-[var(--text-secondary)]">{ui.historyEmpty}</p>
            {!showAdd && (
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition"
              >
                <Plus className="w-4 h-4" />
                {ui.historyAddFirst}
              </button>
            )}
          </div>
        ) : effectiveRecordsView === 'table' ? (
          <div className="hidden md:block overflow-x-auto rounded-xl border border-white/5 bg-[var(--bg-card)]">
            <table className="w-full min-w-[1500px] text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--text-secondary)] border-b border-white/10">
                  {visibleColumns.rating && <th className="px-3 py-2 whitespace-nowrap font-medium">{ui.colRating}</th>}
                  {visibleColumns.name && (
                    <th className="px-3 py-2 whitespace-nowrap font-medium">
                      <RecordsSortHeader label={ui.colName} active={sortKey === 'name'} dir={sortDir} ascLabel={ui.sortAsc} descLabel={ui.sortDesc} onToggle={() => toggleSort('name')} />
                    </th>
                  )}
                  {visibleColumns.symbol && <th className="px-3 py-2 whitespace-nowrap font-medium">{ui.colSymbol}</th>}
                  {visibleColumns.shares && (
                    <th className="px-3 py-2 whitespace-nowrap font-medium text-right">
                      <RecordsSortHeader label={ui.detailShares} active={sortKey === 'shares'} dir={sortDir} ascLabel={ui.sortAsc} descLabel={ui.sortDesc} onToggle={() => toggleSort('shares')} />
                    </th>
                  )}
                  {visibleColumns.cost && (
                    <th className="px-3 py-2 whitespace-nowrap font-medium text-right">
                      <RecordsSortHeader label={ui.detailCost} active={sortKey === 'cost'} dir={sortDir} ascLabel={ui.sortAsc} descLabel={ui.sortDesc} onToggle={() => toggleSort('cost')} />
                    </th>
                  )}
                  {visibleColumns.price && (
                    <th className="px-3 py-2 whitespace-nowrap font-medium text-right">
                      <RecordsSortHeader label={ui.detailPrice} active={sortKey === 'price'} dir={sortDir} ascLabel={ui.sortAsc} descLabel={ui.sortDesc} onToggle={() => toggleSort('price')} />
                    </th>
                  )}
                  {visibleColumns.totalCost && (
                    <th className="px-3 py-2 whitespace-nowrap font-medium text-right">
                      <RecordsSortHeader label={ui.detailTotalCost} active={sortKey === 'totalCost'} dir={sortDir} ascLabel={ui.sortAsc} descLabel={ui.sortDesc} onToggle={() => toggleSort('totalCost')} />
                    </th>
                  )}
                  {visibleColumns.marketValue && (
                    <th className="px-3 py-2 whitespace-nowrap font-medium text-right">
                      <RecordsSortHeader label={ui.detailMarketValue} active={sortKey === 'marketValue'} dir={sortDir} ascLabel={ui.sortAsc} descLabel={ui.sortDesc} onToggle={() => toggleSort('marketValue')} />
                    </th>
                  )}
                  {visibleColumns.unrealized && (
                    <th className="px-3 py-2 whitespace-nowrap font-medium text-right">
                      <RecordsSortHeader label={ui.detailUnrealizedPnl} active={sortKey === 'unrealized'} dir={sortDir} ascLabel={ui.sortAsc} descLabel={ui.sortDesc} onToggle={() => toggleSort('unrealized')} />
                    </th>
                  )}
                  {visibleColumns.return && (
                    <th className="px-3 py-2 whitespace-nowrap font-medium text-right">
                      <RecordsSortHeader label={ui.resultTotalReturn} active={sortKey === 'returnRate'} dir={sortDir} ascLabel={ui.sortAsc} descLabel={ui.sortDesc} onToggle={() => toggleSort('returnRate')} />
                    </th>
                  )}
                  {visibleColumns.dividend && (
                    <th className="px-3 py-2 whitespace-nowrap font-medium text-right">
                      <span className="inline-flex items-center gap-1">
                        <RecordsSortHeader label={ui.detailDividend} active={sortKey === 'dividend'} dir={sortDir} ascLabel={ui.sortAsc} descLabel={ui.sortDesc} onToggle={() => toggleSort('dividend')} />
                        <FieldHelp text={ui.helpDividend} />
                      </span>
                    </th>
                  )}
                  {visibleColumns.yield && (
                    <th className="px-3 py-2 whitespace-nowrap font-medium text-right">
                      <span className="inline-flex items-center gap-1">
                        <RecordsSortHeader label={ui.detailYield} active={sortKey === 'yield'} dir={sortDir} ascLabel={ui.sortAsc} descLabel={ui.sortDesc} onToggle={() => toggleSort('yield')} />
                        <FieldHelp text={ui.helpYield} />
                      </span>
                    </th>
                  )}
                  {visibleColumns.refYield && (
                    <th className="px-3 py-2 whitespace-nowrap font-medium text-right">
                      <span className="inline-flex items-center gap-1">
                        <RecordsSortHeader label={ui.colRefYield} active={sortKey === 'refYield'} dir={sortDir} ascLabel={ui.sortAsc} descLabel={ui.sortDesc} onToggle={() => toggleSort('refYield')} />
                        <FieldHelp text={ui.helpRefYield} />
                      </span>
                    </th>
                  )}
                  {visibleColumns.net && (
                    <th className="px-3 py-2 whitespace-nowrap font-medium text-right">
                      <span className="inline-flex items-center gap-1">
                        <RecordsSortHeader label={ui.netTitle} active={sortKey === 'net'} dir={sortDir} ascLabel={ui.sortAsc} descLabel={ui.sortDesc} onToggle={() => toggleSort('net')} />
                        <FieldHelp text={ui.helpNet} />
                      </span>
                    </th>
                  )}
                  {visibleColumns.created && (
                    <th className="px-3 py-2 whitespace-nowrap font-medium">
                      <RecordsSortHeader label={ui.detailCreatedAt} active={sortKey === 'created'} dir={sortDir} ascLabel={ui.sortAsc} descLabel={ui.sortDesc} onToggle={() => toggleSort('created')} />
                    </th>
                  )}
                  <th className="px-3 py-2 whitespace-nowrap font-medium">{ui.colAction}</th>
                </tr>
              </thead>
              <tbody>
                {sortedHistory.map(item => {
                  const open = expandedId === item.id
                  // #28：淨損益單欄沿用 computeNetPnL（與 NetPnlView 同邏輯）；明細放在展開列的 NetPnlView。
                  const net = computeNetPnL({ market: item.market, symbol: item.symbol, shares: item.shares, cost: item.cost, currentPrice: item.current_price, discount: feeDiscount })
                  return (
                    <Fragment key={item.id}>
                      <tr onClick={() => expandHistory(item)} className="border-b border-white/5 hover:bg-white/5 transition cursor-pointer">
                        {visibleColumns.rating && (
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${ratingColor(item.recommendation)}`}
                              style={item.recommendation ? { backgroundColor: `${RATING_STYLE[item.recommendation]?.bg || 'rgba(255,255,255,0.08)'}22` } : undefined}>
                              {item.recommendation || '—'}
                            </span>
                          </td>
                        )}
                        {visibleColumns.name && <td className="px-3 py-2 whitespace-nowrap font-medium">{item.symbol_name || item.symbol}</td>}
                        {visibleColumns.symbol && <td className="px-3 py-2 whitespace-nowrap text-xs text-[var(--text-secondary)]">{item.symbol}</td>}
                        {visibleColumns.shares && <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">{item.shares}</td>}
                        {visibleColumns.cost && <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">{formatMoney(item.cost, item.market)}</td>}
                        {visibleColumns.price && <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">{formatMoney(item.current_price, item.market)}</td>}
                        {visibleColumns.totalCost && <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">{formatMoney(item.cost_basis, item.market)}</td>}
                        {visibleColumns.marketValue && <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">{formatMoney(item.market_value, item.market)}</td>}
                        {visibleColumns.unrealized && (
                          <td className={`px-3 py-2 whitespace-nowrap text-right tabular-nums font-medium ${item.unrealized_pnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                            {formatMoney(item.unrealized_pnl, item.market)} ({formatPct(item.unrealized_pnl_pct)})
                          </td>
                        )}
                        {visibleColumns.return && (
                          <td className={`px-3 py-2 whitespace-nowrap text-right tabular-nums font-medium ${item.total_return >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                            {formatMoney(item.total_return, item.market)} {formatPct(item.total_return_pct)}
                          </td>
                        )}
                        {visibleColumns.dividend && (
                          <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">
                            {formatMoney(item.dividend, item.market)}
                            {ytdEstText(item.id, item.market) && (
                              <div className="text-[10px] font-normal text-[var(--accent)]">{ytdEstText(item.id, item.market)}</div>
                            )}
                          </td>
                        )}
                        {visibleColumns.yield && <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">{item.yield_on_cost.toFixed(2)}%</td>}
                        {visibleColumns.refYield && <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums text-[var(--text-secondary)]">{refYieldText(item.id)}</td>}
                        {visibleColumns.net && (
                          <td className={`px-3 py-2 whitespace-nowrap text-right tabular-nums font-medium ${net.netPnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                            {formatMoney(net.netPnl, item.market)} ({formatPct(net.netPnlPct)})
                          </td>
                        )}
                        {visibleColumns.created && <td className="px-3 py-2 whitespace-nowrap text-xs">{(item.created_at || '').replace('T', ' ')}</td>}
                        <td className="px-3 py-2 whitespace-nowrap">
                          {authMode === 'user' && (
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => openEditRecord(item)}
                                title={ui.btnEditRecord}
                                aria-label={ui.btnEditRecord}
                                className="p-1.5 rounded-lg bg-white/5 text-[var(--accent)] hover:bg-white/10 transition"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteRecord(item)}
                                disabled={deletingId === item.id}
                                title={ui.btnDeleteRecord}
                                aria-label={ui.btnDeleteRecord}
                                className="p-1.5 rounded-lg bg-white/5 text-red-400 hover:bg-red-500/10 transition disabled:opacity-50 disabled:cursor-wait"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b border-white/5">
                          <td colSpan={visibleColumnCount + 1} className="px-4 pb-4 pt-2 bg-white/[0.02]">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                              <NetPnlView
                                market={item.market}
                                symbol={item.symbol}
                                shares={item.shares}
                                cost={item.cost}
                                currentPrice={item.current_price}
                                discount={feeDiscount}
                                ui={ui}
                                helpText={ui.helpNet}
                              />
                              {item.summary && (
                                <div className="col-span-2 md:col-span-4">
                                  <p className="text-xs text-[var(--text-secondary)]">{ui.detailAiSummary}</p>
                                  <p className="text-sm">{item.summary}</p>
                                </div>
                              )}
                              {item.report_json && <JsonAdviceView json={item.report_json} market={item.market} ui={ui} />}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map(item => {
              const open = expandedId === item.id
              return (
                <div key={item.id} className="bg-[var(--bg-card)] rounded-xl border border-white/5 overflow-hidden">
                  <button type="button" onClick={() => expandHistory(item)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/5 transition">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`px-2.5 py-0.5 rounded-md text-xs font-bold ${ratingColor(item.recommendation)}`}
                        style={item.recommendation ? { backgroundColor: `${RATING_STYLE[item.recommendation]?.bg || 'rgba(255,255,255,0.08)'}22` } : undefined}>
                        {item.recommendation || '—'}
                      </span>
                      <span className="font-medium truncate">{item.symbol_name || item.symbol}</span>
                      <span className="text-xs text-[var(--text-secondary)] shrink-0">{item.symbol}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-sm font-bold ${item.total_return >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                        {formatMoney(item.total_return, item.market)} {formatPct(item.total_return_pct)}
                      </span>
                      {item.strategy && <span className="text-[10px] text-[var(--text-secondary)] hidden md:inline">{strategyName(item.strategy)}</span>}
                      {open ? <ChevronUp className="w-4 h-4 text-[var(--text-secondary)]" /> : <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" />}
                    </div>
                  </button>
                  {open && (
                    <div className="px-4 pb-4 pt-1 border-t border-white/5">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm pt-3">
                        <div><p className="text-xs text-[var(--text-secondary)]">{ui.detailShares}</p><p>{item.shares}</p></div>
                        <div><p className="text-xs text-[var(--text-secondary)]">{ui.detailCost}</p><p>{formatMoney(item.cost, item.market)}</p></div>
                        <div><p className="text-xs text-[var(--text-secondary)]">{ui.detailPrice}</p><p>{formatMoney(item.current_price, item.market)}</p></div>
                        <div>
                          <p className="text-xs text-[var(--text-secondary)]"><span className="inline-flex items-center gap-1">{ui.detailDividend} <FieldHelp text={ui.helpDividend} /></span></p>
                          <p>{formatMoney(item.dividend, item.market)}</p>
                          {ytdEstText(item.id, item.market) && (
                            <p className="text-[10px] text-[var(--accent)]">{ytdEstText(item.id, item.market)}</p>
                          )}
                        </div>
                        <div><p className="text-xs text-[var(--text-secondary)]">{ui.detailTotalCost}</p><p>{formatMoney(item.cost_basis, item.market)}</p></div>
                        <div><p className="text-xs text-[var(--text-secondary)]">{ui.detailMarketValue}</p><p>{formatMoney(item.market_value, item.market)}</p></div>
                        <div className="text-[var(--accent-red)]"><p className="text-xs text-[var(--text-secondary)]">{ui.detailUnrealizedPnl}</p><p>{formatMoney(item.unrealized_pnl, item.market)} ({formatPct(item.unrealized_pnl_pct)})</p></div>
                        {/* #27：舊紀錄向下相容——稅費由既有欄位前端重算，無稅費欄也不炸版 */}
                        <NetPnlView
                          market={item.market}
                          symbol={item.symbol}
                          shares={item.shares}
                          cost={item.cost}
                          currentPrice={item.current_price}
                          discount={feeDiscount}
                          ui={ui}
                          helpText={ui.helpNet}
                        />
                        <div><p className="text-xs text-[var(--text-secondary)]"><span className="inline-flex items-center gap-1">{ui.detailYield} <FieldHelp text={ui.helpYield} /></span></p><p>{item.yield_on_cost.toFixed(2)}%</p></div>
                        <div><p className="text-xs text-[var(--text-secondary)]"><span className="inline-flex items-center gap-1">{ui.detailRefYield} <FieldHelp text={ui.helpRefYield} /></span></p><p>{refYieldText(item.id)}</p></div>
                        <div className="col-span-2 md:col-span-4">
                          <p className="text-xs text-[var(--text-secondary)]">{ui.detailCreatedAt}</p>
                          <p className="text-xs">{(item.created_at || '').replace('T', ' ')}</p>
                        </div>
                        {item.summary && (
                          <div className="col-span-2 md:col-span-4">
                            <p className="text-xs text-[var(--text-secondary)]">{ui.detailAiSummary}</p>
                            <p className="text-sm">{item.summary}</p>
                          </div>
                        )}
                        {item.report_json && <JsonAdviceView json={item.report_json} market={item.market} ui={ui} />}
                      </div>
                      {authMode === 'user' && (
                        <div className="flex justify-end gap-2 pt-3">
                          <button
                            type="button"
                            onClick={() => openEditRecord(item)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-xs text-[var(--accent)] hover:bg-white/10 transition"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            {ui.btnEditRecord}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRecord(item)}
                            disabled={deletingId === item.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-xs text-red-400 hover:bg-red-500/10 transition disabled:opacity-50 disabled:cursor-wait"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {ui.btnDeleteRecord}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* #26：紀錄編輯 modal（欄位預填市場/代號/股數/成本/現價/配息/策略） */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeEditRecord}>
          <div
            className="w-full max-w-lg bg-[var(--bg-card)] rounded-2xl border border-white/10 p-5 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={ui.editPanelTitle}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">{ui.editPanelTitle}</h3>
              <button type="button" onClick={closeEditRecord} className="p-1 rounded-lg hover:bg-white/10 transition" aria-label={ui.editPanelCancel}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs space-y-1">
                <span className="text-[var(--text-secondary)]">{ui.formMarket}</span>
                <select
                  value={editMarket}
                  onChange={(e) => setEditMarket(e.target.value === 'us' ? 'us' : 'tw')}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-sm"
                >
                  <option value="tw">{ui.marketTw}</option>
                  <option value="us">{ui.marketUs}</option>
                </select>
              </label>
              <label className="text-xs space-y-1">
                <span className="text-[var(--text-secondary)]">{ui.colSymbol}</span>
                <input
                  value={editSymbol}
                  onChange={(e) => setEditSymbol(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-sm"
                />
              </label>
              <label className="text-xs space-y-1 col-span-2">
                <span className="text-[var(--text-secondary)]">{ui.colName}</span>
                <input
                  value={editSymbolName}
                  onChange={(e) => setEditSymbolName(e.target.value)}
                  placeholder={ui.placeholderName}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-sm"
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-[var(--text-secondary)]">{ui.formShares}</span>
                <input
                  value={editShares}
                  onChange={(e) => setEditShares(e.target.value)}
                  inputMode="decimal"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-sm"
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-[var(--text-secondary)]">{ui.formCostPerShare.replace('{currency}', editMarket === 'tw' ? 'NT$' : '$')}</span>
                <input
                  value={editCost}
                  onChange={(e) => setEditCost(e.target.value)}
                  inputMode="decimal"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-sm"
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-[var(--text-secondary)]">{ui.formPricePerShare.replace('{currency}', editMarket === 'tw' ? 'NT$' : '$')}</span>
                <input
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  inputMode="decimal"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-sm"
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-[var(--text-secondary)]">{ui.formCumDividend.replace('{currency}', editMarket === 'tw' ? 'NT$' : '$')}</span>
                <input
                  value={editDividend}
                  onChange={(e) => setEditDividend(e.target.value)}
                  inputMode="decimal"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-sm"
                />
              </label>
              <label className="text-xs space-y-1 col-span-2">
                <span className="text-[var(--text-secondary)]">{ui.formStrategy}</span>
                <select
                  value={editStrategy}
                  onChange={(e) => setEditStrategy(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-white/10 text-sm"
                >
                  {STRATEGIES.map((s) => (
                    <option key={s.id} value={s.id}>{s.nameZh}</option>
                  ))}
                </select>
              </label>
            </div>
            {editError && <p className="text-xs text-red-400">{editError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEditRecord}
                disabled={editSaving}
                className="px-4 py-2 rounded-xl bg-white/10 text-sm hover:bg-white/15 transition disabled:opacity-50"
              >
                {ui.editPanelCancel}
              </button>
              <button
                type="button"
                onClick={handleUpdateRecord}
                disabled={editSaving}
                className="px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
              >
                {editSaving ? ui.editPanelSaving : ui.editPanelSave}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// #35：「?」欄位說明浮層（沿用 admin `_components.tsx` Help 風格：portal 掛 body
// 避免被 overflow-x-auto 裁切；hover/focus 顯示＋click 切換，手機可點開）。
function FieldHelp({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const show = () => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const tipW = 264
    const left = r.right + 10 + tipW > window.innerWidth ? Math.max(8, r.left - tipW - 10) : r.right + 10
    setPos({ top: r.top - 2, left })
    setOpen(true)
  }
  const hide = () => setOpen(false)

  return (
    <>
      <span
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label="說明"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation()
          if (open) hide()
          else show()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (open) hide()
            else show()
          }
        }}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/10 text-[var(--text-secondary)] text-[10px] cursor-help select-none align-middle"
      >
        ?
      </span>
      {open && pos
        ? createPortal(
            <span
              style={{ position: 'fixed', top: pos.top, left: pos.left, width: 264, maxHeight: 220, overflowY: 'auto' }}
              className="z-[100] rounded-lg border border-white/10 bg-[var(--bg-primary)] px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)] shadow-xl whitespace-normal"
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </>
  )
}

// #28：表格可排序欄頭按鈕（升降冪圖示＋三語 aria-label；排序本身由上層 useMemo 純前端處理）。
function RecordsSortHeader({ label, active, dir, ascLabel, descLabel, onToggle }: {
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  ascLabel: string
  descLabel: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={active ? `${label} ${dir === 'asc' ? ascLabel : descLabel}` : label}
      className="inline-flex items-center gap-1 hover:text-[var(--text-primary)] transition"
    >
      {label}
      {active && (dir === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
    </button>
  )
}

// #27：淨損益並列區（裸損益保留，另列淨損益＋稅費明細三行＋公式註腳＋ETF 判定註明）。
// 純前端重算：舊紀錄無稅費欄也能由 shares/cost/current_price 還原，不炸版。
function NetPnlView({ market, symbol, shares, cost, currentPrice, discount, ui, helpText }: {
  market: Market
  symbol: string
  shares: number
  cost: number
  currentPrice: number
  discount: number
  ui: { netTitle: string; netBuyFee: string; netSellFee: string; netTax: string; netFormula: string; netEtfNote: string }
  helpText?: string
}) {
  const net = computeNetPnL({ market, symbol, shares, cost, currentPrice, discount })
  return (
    <div className="col-span-full rounded-lg bg-[var(--bg-secondary)] border border-white/5 p-3 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-[var(--text-secondary)]"><span className="inline-flex items-center gap-1">{ui.netTitle}{helpText ? <FieldHelp text={helpText} /> : null}</span></p>
        <p className={`text-sm font-bold ${net.netPnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
          {formatMoney(net.netPnl, market)} <span className="text-xs">{formatPct(net.netPnlPct)}</span>
        </p>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">{ui.netBuyFee}：{formatMoney(net.buyFee, market)}</p>
      <p className="text-xs text-[var(--text-secondary)]">{ui.netSellFee}：{formatMoney(net.sellFee, market)}</p>
      <p className="text-xs text-[var(--text-secondary)]">{ui.netTax}：{formatMoney(net.tax, market)}</p>
      <p className="text-[10px] text-[var(--text-secondary)] pt-1">{ui.netFormula}</p>
      {market === 'tw' && <p className="text-[10px] text-[var(--text-secondary)]">{ui.netEtfNote}</p>}
    </div>
  )
}

function JsonAdviceView({ json, market, ui }: { json: string; market: Market; ui: { detailKeyPoints: string; detailRisks: string; detailAction: string } }) {
  const [parsed, setParsed] = useState<{ advice?: Advice } | null>(null)
  useEffect(() => {
    try {
      setParsed(JSON.parse(json))
    } catch {
      setParsed(null)
    }
  }, [json])
  if (!parsed?.advice) return null
  return (
    <div className="col-span-2 md:col-span-4 rounded-lg bg-[var(--bg-secondary)] p-3 border border-white/5 space-y-2">
      <p className="text-xs text-[var(--text-secondary)]">{ui.detailKeyPoints}</p>
      <ul className="space-y-0.5">
        {parsed.advice.keyPoints.map((k, i) => (
          <li key={i} className="text-xs">• {k}</li>
        ))}
      </ul>
      <p className="text-xs text-[var(--accent-red)]">{ui.detailRisks}</p>
      <ul className="space-y-0.5">
        {parsed.advice.risks.map((r, i) => (
          <li key={i} className="text-xs text-[var(--accent-red)]">• {r}</li>
        ))}
      </ul>
      <p className="text-xs text-[var(--text-secondary)]">{ui.detailAction}</p>
      <p className="text-sm">{parsed.advice.action}</p>
    </div>
  )
}
