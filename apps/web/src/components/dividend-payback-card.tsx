'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import {
  computeDividendPayback,
  pickRateForWindow,
  type DividendLookbackYears,
  type RollingDividendRates,
} from '@/lib/dividend-payback'
import type { HealthVerdict } from '@/lib/portfolio-health'

interface DividendPaybackCardProps {
  market: 'tw' | 'us'
  symbol: string
  shares: number
  cost: number
  currentPrice: number
  /** 近 1 / 2 / 3 年滾動年均每股配息 */
  dividendRates?: RollingDividendRates | null
  /** 單一每股年配息備援（Yahoo dividendRate） */
  fallbackDividendRate?: number | null
  /** 預扣稅率（美股預設 0.3，台股 0） */
  taxRate?: number
  /** 健檢狀態（用於減配／貼息風險防呆提醒） */
  verdict?: HealthVerdict
  /** 配息發放率 %（> 95% 時提示吃老本風險） */
  payoutRatioPct?: number | null
}

function fmtMoney(n: number, market: 'tw' | 'us'): string {
  const sym = market === 'tw' ? 'NT$' : '$'
  return `${sym}${n.toLocaleString('en-US', {
    minimumFractionDigits: market === 'us' ? 2 : 0,
    maximumFractionDigits: market === 'us' ? 2 : 0,
  })}`
}

function fmtPerShare(n: number, market: 'tw' | 'us'): string {
  const sym = market === 'tw' ? 'NT$' : '$'
  return `${sym}${n.toFixed(market === 'us' ? 3 : 2)}`
}

export function DividendPaybackCard({
  market,
  symbol,
  shares,
  cost,
  currentPrice,
  dividendRates,
  fallbackDividendRate,
  taxRate,
  verdict,
  payoutRatioPct,
}: DividendPaybackCardProps) {
  const [lookback, setLookback] = useState<DividendLookbackYears>(1)
  const [receivedInput, setReceivedInput] = useState('')

  const effectiveTaxRate = taxRate ?? (market === 'us' ? 0.3 : 0)
  const receivedSoFar = Math.max(0, Number(receivedInput) || 0)

  const picked = useMemo(
    () => pickRateForWindow(dividendRates, lookback, fallbackDividendRate),
    [dividendRates, lookback, fallbackDividendRate],
  )

  const result = useMemo(
    () =>
      computeDividendPayback({
        shares,
        cost,
        currentPrice,
        annualDivPerShare: picked.rate,
        taxRate: effectiveTaxRate,
        receivedDividendsSoFar: receivedSoFar,
      }),
    [shares, cost, currentPrice, picked.rate, effectiveTaxRate, receivedSoFar],
  )

  const showRiskWarning =
    verdict === 'warning' ||
    verdict === 'watch' ||
    (payoutRatioPct != null && payoutRatioPct > 95)

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="col-span-2 md:col-span-4 rounded-xl border border-white/10 bg-[var(--bg-secondary)]/60 p-3.5 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-sky-300 shrink-0" />
          <span className="text-xs font-semibold text-white">
            配息回本年數試算（{symbol}）
          </span>
          {picked.isPartialHistory && dividendRates?.spanYears != null && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
              紀錄約 {dividendRates.spanYears} 年
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {([1, 2, 3] as const).map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setLookback(y)}
              className={`px-2.5 py-0.5 rounded-full text-[11px] border transition ${
                lookback === y
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-white/10 hover:text-white'
              }`}
            >
              近 {y} 年均息
            </button>
          ))}
        </div>
      </div>

      {!result.hasDividend ? (
        <p className="text-xs text-[var(--text-secondary)]">
          近 {lookback} 年查無配息紀錄（或目前持有股數為 0），無法估算領息回本年數。
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg bg-black/20 p-2.5 space-y-0.5">
              <div className="text-[10px] text-[var(--text-secondary)]">補平帳面虧損（維持現價）</div>
              {result.alreadyRecovered ? (
                <div className="text-sm font-bold text-emerald-300">帳面已回本</div>
              ) : (
                <div className="text-sm font-bold text-amber-300 tabular-nums">
                  約 {result.lossPaybackYears} 年
                  {result.estimatedLossRecoveryYear != null && (
                    <span className="text-xs font-medium text-white/80 ml-1.5">
                      （預計 {result.estimatedLossRecoveryYear} 年）
                    </span>
                  )}
                </div>
              )}
              <div className="text-[10px] text-[var(--text-secondary)] tabular-nums">
                待補價差 {fmtMoney(result.remainingLossToRecover, market)}
              </div>
            </div>

            <div className="rounded-lg bg-black/20 p-2.5 space-y-0.5">
              <div className="text-[10px] text-[var(--text-secondary)]">零成本存股（領回 100% 本金）</div>
              <div className="text-sm font-bold text-sky-300 tabular-nums">
                約 {result.principalPaybackYears} 年
                {result.estimatedZeroCostYear != null && (
                  <span className="text-xs font-medium text-white/80 ml-1.5">
                    （預計 {result.estimatedZeroCostYear} 年）
                  </span>
                )}
              </div>
              <div className="text-[10px] text-[var(--text-secondary)] tabular-nums">
                近 {lookback} 年均息 {fmtPerShare(result.annualDivPerShareNet ?? 0, market)}/股
                {effectiveTaxRate > 0 ? `（已扣 ${(effectiveTaxRate * 100).toFixed(0)}% 稅）` : ''}
              </div>
            </div>

            <div className="rounded-lg bg-black/20 p-2.5 space-y-1">
              <label className="block text-[10px] text-[var(--text-secondary)]">
                已累計領回股息（選填扣減，{market === 'tw' ? 'NT$' : 'US$'}）
              </label>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="預設 0（從今日起算）"
                value={receivedInput}
                onChange={(e) => setReceivedInput(e.target.value)}
                className="w-full bg-[var(--bg-card)] border border-white/10 rounded px-2 py-1 text-xs text-white tabular-nums focus:outline-none focus:border-[var(--accent)]"
              />
              <div className="text-[10px] text-[var(--text-secondary)] tabular-nums">
                推估年領 {fmtMoney(result.annualTotalNet ?? 0, market)}
                {market === 'tw' && (result.annualTotalNet ?? 0) >= 20000 ? '（留意二代健保 2.11%）' : ''}
              </div>
            </div>
          </div>

          {showRiskWarning && (
            <div className="flex items-start gap-2 rounded-lg bg-rose-500/15 border border-rose-500/30 px-3 py-2 text-[11px] text-rose-200">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
              <span>
                基本面提示：此標的目前體質轉弱或配息發放率偏高，歷史配息不保證未來續發，請留意減配或貼息風險。
              </span>
            </div>
          )}

          <p className="text-[10px] text-[var(--text-secondary)]">
            假設從今日起繼續持有、未計入未知歷史已領股息，且未來股價與配息率維持近 {lookback} 年均值（僅供試算參考，非投資建議）。
          </p>
        </>
      )}
    </div>
  )
}
