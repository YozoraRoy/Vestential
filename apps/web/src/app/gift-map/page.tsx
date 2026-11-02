'use client'

import React, { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  GiftCalendarItem,
  GiftCalendarSummary,
  GiftEligibility,
} from '@/lib/gift-map'

export default function GiftMapPage() {
  const [view, setView] = useState<'active' | 'review'>('active')
  const [search, setSearch] = useState('')
  const [eligibilityFilter, setEligibilityFilter] = useState<string>('ALL')
  const [onlyPopular, setOnlyPopular] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<GiftCalendarSummary | null>(null)
  const [items, setItems] = useState<GiftCalendarItem[]>([])
  const [disclaimer, setDisclaimer] = useState<string>('')

  // 載入資料
  useEffect(() => {
    let active = true
    setLoading(true)

    fetch(`/api/gifts/calendar?view=${view}&limit=200`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        if (data.success) {
          setSummary(data.summary)
          setItems(data.items ?? [])
          setDisclaimer(data.disclaimer ?? '')
        }
      })
      .catch((err) => console.error('Fetch gift calendar failed:', err))
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [view])

  // 前端即時過濾
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (search.trim()) {
        const kw = search.trim().toLowerCase()
        const match =
          item.stockId.toLowerCase().includes(kw) ||
          item.stockName.toLowerCase().includes(kw) ||
          item.giftName.toLowerCase().includes(kw)
        if (!match) return false
      }

      if (eligibilityFilter !== 'ALL' && item.eligibility !== eligibilityFilter) {
        return false
      }

      if (onlyPopular && !item.isPopular) {
        return false
      }

      return true
    })
  }, [items, search, eligibilityFilter, onlyPopular])

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 pb-16 font-sans">
      {/* 頂部導航 */}
      <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link
              href="/"
              className="text-xs text-zinc-400 hover:text-white transition flex items-center gap-1"
            >
              <span>← 回首頁</span>
            </Link>
            <span className="text-zinc-600">/</span>
            <Link
              href="/odd-lot"
              className="text-xs text-zinc-400 hover:text-white transition"
            >
              零股情報
            </Link>
            <span className="text-zinc-600">/</span>
            <span className="text-xs text-emerald-400 font-medium">紀念品攻略</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-950 text-emerald-400 border border-emerald-800">
              {view === 'active' ? '2027 旺季預備' : '2026 股東會回顧'}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pt-6 space-y-6">
        {/* Title Banner */}
        <div className="bg-gradient-to-r from-emerald-950/60 via-zinc-900 to-zinc-900 border border-emerald-800/40 rounded-2xl p-6 relative overflow-hidden">
          <div className="relative z-10 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🎁</span>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                股東會紀念品最後買進倒數＆領取攻略
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl">
              專為台股零股存股族設計！一眼看清還來得及買哪幾檔、零股能不能領、要不要電子投票，不錯過一年一度的股東會紀念品紅利。
            </p>

            {/* 視圖切換 */}
            <div className="pt-2 flex flex-wrap gap-2">
              <button
                onClick={() => setView('active')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  view === 'active'
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
                    : 'bg-zinc-800/80 text-zinc-400 hover:text-white hover:bg-zinc-700'
                }`}
              >
                🔥 即將截止倒數（2027 旺季預備）
              </button>
              <button
                onClick={() => setView('review')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  view === 'review'
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
                    : 'bg-zinc-800/80 text-zinc-400 hover:text-white hover:bg-zinc-700'
                }`}
              >
                🏆 2026 股東會熱門回顧（示範庫）
              </button>
            </div>
          </div>
        </div>

        {/* 4 大關鍵指標 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-4">
            <div className="text-[11px] text-zinc-400 mb-1">今日最後買進</div>
            <div className="text-2xl font-bold text-rose-400">
              {summary ? summary.todayCount : '—'}
              <span className="text-xs font-normal text-zinc-500 ml-1">檔</span>
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">今天 13:30 盤後截止</div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-4">
            <div className="text-[11px] text-zinc-400 mb-1">T-3 內即將截止</div>
            <div className="text-2xl font-bold text-amber-400">
              {summary ? summary.t3Count : '—'}
              <span className="text-xs font-normal text-zinc-500 ml-1">檔</span>
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">剩餘 1~3 天可下單</div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-4">
            <div className="text-[11px] text-zinc-400 mb-1">零股即可領取</div>
            <div className="text-2xl font-bold text-emerald-400">
              {summary ? summary.oneShareCount : '—'}
              <span className="text-xs font-normal text-zinc-500 ml-1">檔</span>
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">一股可領 / 含電子投票</div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-xl p-4">
            <div className="text-[11px] text-zinc-400 mb-1">已建檔紀念品</div>
            <div className="text-2xl font-bold text-zinc-200">
              {summary ? summary.totalCount : '—'}
              <span className="text-xs font-normal text-zinc-500 ml-1">檔</span>
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">{summary?.dataYear ?? 2026} 年度追蹤</div>
          </div>
        </div>

        {/* 搜尋與過濾列 */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="搜尋股票代號、名稱、或紀念品關鍵字（如：大魯閣、超商卡、中鋼...）"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs sm:text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-2.5 text-xs text-zinc-500 hover:text-zinc-300"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={eligibilityFilter}
                onChange={(e) => setEligibilityFilter(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs sm:text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="ALL">全部資格</option>
                <option value="ONE_SHARE">零股可領</option>
                <option value="VOTE_REQUIRED">須電子投票</option>
                <option value="MEETING_ONLY">限親自出席</option>
                <option value="NO_GIFT">不發放紀念品</option>
                <option value="UNKNOWN">待公司公告</option>
              </select>

              <button
                onClick={() => setOnlyPopular(!onlyPopular)}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition whitespace-nowrap ${
                  onlyPopular
                    ? 'bg-amber-950/80 border-amber-700 text-amber-300'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                ★ 只看熱門常客
              </button>
            </div>
          </div>
        </div>

        {/* 列表內容 */}
        {loading ? (
          <div className="py-20 text-center text-zinc-500 text-sm">
            載入股東會紀念品攻略中...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-16 text-center bg-zinc-900/40 border border-dashed border-zinc-800 rounded-2xl space-y-2">
            <div className="text-3xl">🔍</div>
            <div className="text-sm text-zinc-300 font-medium">沒有符合篩選條件的紀念品</div>
            <p className="text-xs text-zinc-500">
              建議切換視圖至「🏆 2026 股東會熱門回顧」或清除搜尋字串
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredItems.map((item) => {
              const isExpanded = expandedId === item.id

              return (
                <div
                  key={item.id}
                  className={`bg-zinc-900 border rounded-xl p-4 flex flex-col justify-between transition hover:border-zinc-700 ${
                    item.isPopular ? 'border-amber-800/40 bg-zinc-900/90' : 'border-zinc-800'
                  }`}
                >
                  <div className="space-y-3">
                    {/* Header: 代號 + 股名 + 倒數標籤 */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/odd-lot?symbol=${item.stockId}`}
                            className="font-bold text-base text-zinc-100 hover:text-emerald-400 transition"
                          >
                            {item.stockId} {item.stockName}
                          </Link>
                          {item.isPopular && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-400 border border-amber-800 font-medium">
                              熱門
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          開會日: {item.meetingDate ?? '待公告'}
                        </div>
                      </div>

                      {/* 倒數標籤 */}
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                          item.countdownTag === 'TODAY'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800 animate-pulse'
                            : item.countdownTag === 'T_3'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : item.countdownTag === 'T_7'
                                ? 'bg-yellow-950 text-yellow-300 border border-yellow-800'
                                : item.countdownTag === 'EXPIRED'
                                  ? 'bg-zinc-800 text-zinc-400'
                                  : 'bg-zinc-800/70 text-zinc-400'
                        }`}
                      >
                        {item.countdownLabel}
                      </span>
                    </div>

                    {/* 紀念品品名 */}
                    <div className="p-3 bg-zinc-950/70 border border-zinc-800/60 rounded-lg">
                      <div className="text-[10px] text-zinc-500 mb-0.5">股東會紀念品</div>
                      <div className="font-semibold text-sm text-emerald-300 line-clamp-2">
                        {item.giftName}
                      </div>
                    </div>

                    {/* 關鍵時效與資格 */}
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between items-center text-zinc-400">
                        <span>最後買進日：</span>
                        <span className="font-mono font-medium text-zinc-200">
                          {item.lastBuyDateFull ?? item.lastBuyDate ?? '待公司公告'}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-zinc-400">
                        <span>零股領取資格：</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                            item.eligibilityColor === 'green'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : item.eligibilityColor === 'amber'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : item.eligibilityColor === 'purple'
                                  ? 'bg-purple-950 text-purple-300 border border-purple-800'
                                  : item.eligibilityColor === 'gray'
                                    ? 'bg-zinc-800 text-zinc-400'
                                    : 'bg-blue-950 text-blue-300 border border-blue-800'
                          }`}
                        >
                          {item.eligibilityLabel}
                        </span>
                      </div>

                      {item.distributionMethod && (
                        <div className="flex justify-between items-start text-zinc-400 pt-1 border-t border-zinc-800/60">
                          <span className="shrink-0 text-[11px]">發放管道：</span>
                          <span className="text-[11px] text-zinc-300 text-right line-clamp-1">
                            {item.distributionMethod}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 展開公告原文 */}
                    {item.mopsGiftText && (
                      <div className="pt-1">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : item.id)}
                          className="text-[11px] text-zinc-400 hover:text-emerald-400 transition flex items-center gap-1"
                        >
                          <span>{isExpanded ? '▼ 收合公告說明' : '▶ 查看 MOPS 官方公告原文'}</span>
                        </button>

                        {isExpanded && (
                          <div className="mt-2 p-2.5 bg-zinc-950 border border-zinc-800 rounded text-[11px] text-zinc-300 whitespace-pre-wrap leading-relaxed">
                            {item.mopsGiftText}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 底部行動按鈕 */}
                  <div className="pt-3 mt-3 border-t border-zinc-800/70 flex items-center justify-between">
                    <Link
                      href={`/odd-lot?symbol=${item.stockId}`}
                      className="text-xs text-emerald-400 hover:text-emerald-300 transition font-medium flex items-center gap-1"
                    >
                      <span>查看盤後零股行情</span>
                      <span>→</span>
                    </Link>

                    {item.mopsSourceUrl && (
                      <a
                        href={item.mopsSourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-zinc-500 hover:text-zinc-300 transition underline"
                      >
                        來源公告
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 免責聲明 */}
        <div className="mt-12 p-4 bg-zinc-900/40 border border-zinc-800/80 rounded-xl text-[11px] text-zinc-500 leading-relaxed space-y-1">
          <div className="font-semibold text-zinc-400">合規警語與免責聲明</div>
          <p>{disclaimer}</p>
        </div>
      </main>
    </div>
  )
}
