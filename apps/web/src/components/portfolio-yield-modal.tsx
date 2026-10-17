'use client'

/**
 * Issue #100：殖利率明細 modal。
 * Issue #101：第 4 張卡「5 年平均（逐年已實現）」＋逐年表新增「÷除息日價」欄
 *   （分母＝該年最後一次除息日昨收；缺值顯示「—」，不以現價或 0 代墊）。
 *
 * 沿 `cycle-entry-detail-modal.tsx` 模式：overlay 點擊關閉 / `role="dialog"` /
 * `aria-modal` / Esc 關閉 / `document.body.style.overflow` 鎖定 / 關閉後由呼叫端
 * 把焦點還給觸發鈕（見 `app/portfolio/page.tsx` 的 `closeYieldModal`）。
 *
 * 資料來源：呼叫端已在 state 的 `divRows`（TWSE 快取）＋ `computeYieldBreakdown`
 * 純函式結果，本元件**不打 API、不扣 quota、不碰 DB**。
 * 免責：`yieldDetailFormula`（公式）＋ `yieldDetailSource`（來源／限制）置底。
 */

import { useCallback, useEffect, useRef } from 'react'
import { X, TrendingUp } from 'lucide-react'
import { computeCurrentYearYield, type YieldBreakdown } from '@/lib/portfolio-yield'
import { headTrClass, tableClass } from '@/lib/table-typography'
import { useTableTypography } from '@/lib/use-table-typography'

/** 本 modal 用到的三語鍵（逐字對齊 Issue #100 文案表；#101 新增 4 鍵同表定稿）。 */
export type YieldModalDict = {
  yieldModalTitle: string
  yieldModalSubtitle: string
  yieldModalClose: string
  yieldNoData: string
  yieldPartialNote: string
  yieldCardTtm: string
  yieldCardTtmNote: string
  yieldCardCur: string
  yieldCardCurNone: string
  yieldCardAvg5Price: string
  yieldCardAvg5PriceNote: string
  yieldCardAvg5Realized: string
  yieldCardAvg5RealizedNote: string
  yieldCardNotAvailable: string
  yieldColYear: string
  yieldColTimes: string
  yieldColYearTotal: string
  yieldColYieldOnPrice: string
  yieldColYieldOnExPrice: string
  yieldColExDate: string
  yieldColCash: string
  yieldColEventYield: string
  yieldDetailFormula: string
  yieldDetailSource: string
}

interface Props {
  symbol: string
  name?: string | null
  /** 現價（＝上次同步值，非即時）。 */
  price: number
  /** `computeYieldBreakdown` 結果；無資料（現價非法等）為 null。 */
  breakdown: YieldBreakdown | null
  dict: YieldModalDict
  onClose: () => void
}

/** 百分比（2 位；null／非有限＝「—」）。 */
function fmtPct(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? `${v.toFixed(2)}%` : '—'
}

/** 元（2 位；null／非有限＝「—」）。 */
function fmtCash(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? v.toFixed(2) : '—'
}

export function PortfolioYieldModal({ symbol, name, price, breakdown, dict, onClose }: Props) {
  const typo = useTableTypography()
  const panelRef = useRef<HTMLDivElement | null>(null)

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  // 開啟時焦點進 dialog（關閉後由呼叫端還給原觸發鈕）。
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  // Esc 關閉＋背景鎖定（沿用 cycle-entry-detail-modal 模式）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [handleClose])

  const ttm = breakdown?.ttm ?? null
  const cur = breakdown?.cur ?? null
  const avg5 = breakdown?.avg5 ?? null
  const avg5Realized = breakdown?.avg5Realized ?? null
  const yearly = breakdown?.yearly ?? []
  const events = breakdown?.events ?? []
  // #101：逐年已實現殖利率（依年度索引；逐年表「÷除息日價」欄）。
  const realizedByYear = new Map((avg5Realized?.years ?? []).map((y) => [y.year, y]))
  const title = `${symbol}${name ? ` ${name}` : ''}`

  const card = (label: string, value: string, notes: string[] = []) => (
    <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
      <div className="text-[10px] text-[var(--text-secondary)] mb-1">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {notes.map((n, i) => (
        <div key={i} className="text-[10px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
          {n}
        </div>
      ))}
    </div>
  )

  const cell = 'px-3 py-2 whitespace-nowrap'
  const numCell = `${cell} text-right tabular-nums`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label={dict.yieldModalTitle}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full max-w-3xl rounded-2xl bg-[var(--bg-card)] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[88vh] outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 標頭 */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-[var(--accent)]/10 text-[var(--accent)] shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold truncate">
                {title}
                <span className="ml-2 text-xs font-normal text-[var(--text-secondary)]">{dict.yieldModalTitle}</span>
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">{dict.yieldModalSubtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-white/5 text-[var(--text-secondary)] transition shrink-0 cursor-pointer"
            aria-label={dict.yieldModalClose}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* 數字卡：TTM（含次數）／YTD／5 年平均（現價口徑）／5 年平均（逐年已實現） */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {card(
              dict.yieldCardTtm,
              fmtPct(ttm?.value),
              ttm && ttm.count > 0 ? [dict.yieldCardTtmNote.replace('{n}', String(ttm.count))] : [],
            )}
            {card(dict.yieldCardCur, fmtPct(cur?.value), cur && cur.count === 0 ? [dict.yieldCardCurNone] : [])}
            {card(dict.yieldCardAvg5Price, fmtPct(avg5?.value), [
              dict.yieldCardAvg5PriceNote,
              ...(avg5?.partial ? [dict.yieldPartialNote] : []),
            ])}
            {/* #101：逐年（該年現金合計 ÷ 該年最後一次除息日昨收）之平均；無值＝「—」 */}
            {card(dict.yieldCardAvg5Realized, fmtPct(avg5Realized?.value), [
              dict.yieldCardAvg5RealizedNote,
              ...(avg5Realized?.partial ? [dict.yieldPartialNote] : []),
              ...(avg5Realized?.value == null ? [dict.yieldCardNotAvailable] : []),
            ])}
          </div>

          {/* 逐年明細：(Y-5)..Y（缺年標「年份不全」，不補 0） */}
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className={tableClass(typo, 'w-full min-w-[460px]')}>
              <thead>
                <tr className={headTrClass(typo, 'text-left text-[var(--text-secondary)] border-b border-white/10')}>
                  <th className={`${cell} font-medium`}>{dict.yieldColYear}</th>
                  <th className={`${numCell} font-medium`}>{dict.yieldColTimes}</th>
                  <th className={`${numCell} font-medium`}>{dict.yieldColYearTotal}</th>
                  <th className={`${numCell} font-medium`}>{dict.yieldColYieldOnPrice}</th>
                  <th className={`${numCell} font-medium`}>{dict.yieldColYieldOnExPrice}</th>
                </tr>
              </thead>
              <tbody>
                {yearly.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-[var(--text-secondary)]">
                      {dict.yieldNoData}
                    </td>
                  </tr>
                ) : (
                  yearly.map((y) => {
                    // 缺年（整年 0 筆快取）不補 0：合計／殖利率皆顯示「—」＋註「年份不全」。
                    const empty = y.count === 0
                    const realized = realizedByYear.get(y.year)
                    return (
                      <tr key={y.year} className="border-b border-white/5 last:border-b-0">
                        <td className={cell}>
                          {y.year}
                          {empty && (
                            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400/90 border border-amber-400/20">
                              {dict.yieldPartialNote}
                            </span>
                          )}
                        </td>
                        <td className={numCell}>{y.count}</td>
                        <td className={numCell}>{empty ? '—' : fmtCash(y.perShareTotal)}</td>
                        <td className={numCell}>{fmtPct(empty ? null : computeCurrentYearYield(y.perShareTotal, price))}</td>
                        {/* #101：÷除息日價（缺 prev_close → 「—」，不以現價代墊） */}
                        <td className={numCell}>{fmtPct(empty ? null : realized?.value ?? null)}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 逐筆事件（TTM 窗內；筆數與 TTM 卡片次數一致，可手算重現） */}
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className={tableClass(typo, 'w-full min-w-[420px]')}>
              <thead>
                <tr className={headTrClass(typo, 'text-left text-[var(--text-secondary)] border-b border-white/10')}>
                  <th className={`${cell} font-medium`}>{dict.yieldColExDate}</th>
                  <th className={`${numCell} font-medium`}>{dict.yieldColCash}</th>
                  <th className={`${numCell} font-medium`}>{dict.yieldColEventYield}</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-[var(--text-secondary)]">
                      {dict.yieldNoData}
                    </td>
                  </tr>
                ) : (
                  events.map((e) => (
                    <tr key={e.exDate} className="border-b border-white/5 last:border-b-0">
                      <td className={cell}>{e.exDate}</td>
                      <td className={numCell}>{fmtCash(e.cash)}</td>
                      <td className={numCell}>{fmtPct(e.yieldOnPrice)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 免責：公式＋來源（資料源 TWSE；僅台股；現價非即時；非投資建議） */}
          <div className="space-y-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            <p>{dict.yieldDetailFormula}</p>
            <p>{dict.yieldDetailSource}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
