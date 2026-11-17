'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, Info, ShieldAlert } from 'lucide-react'
import { useI18n } from '@/i18n/LanguageProvider'
import type { Locale } from '@/i18n/config'
import {
  buildDividendCalendar,
  type CalendarDividendInput,
  type CalendarHoldingInput,
} from '@/lib/dividend-calendar'

interface PortfolioDividendCalendarProps {
  holdings: CalendarHoldingInput[]
  dividends: CalendarDividendInput[]
  today: string
  loading?: boolean
}

const COPY: Record<
  Locale,
  {
    title: string
    subtitle: string
    preTax: string
    postTax: string
    totalInvestedCost: string
    costYield: string
    symbolsCountLabel: string
    filterWholeLot: string
    filterAllShares: string
    excludedNoticePrefix: string
    excludedNoticeSuffix: string
    totalGross: string
    totalNhi: string
    totalNet: string
    taxCredit: string
    taxCreditHint: string
    nhiHint: string
    netYield: string
    emptyHoldings: string
    emptyEvents: string
    exPassed: string
    upcoming: string
    payPending: string
    nhiBadge: string
    sharesUnit: string
    perShare: string
    exDateLabel: string
    monthSuffix: string
    disclaimerTitle: string
    disclaimer1: string
    disclaimer2: string
    disclaimer3: string
  }
> = {
  'zh-TW': {
    title: '未來 12 個月股利現金流月曆',
    subtitle: '依台股持股與 TWSE 除息快取試算每月現金股利、二代健保補充保費與可抵減稅額（2026 年適用稅制）。',
    preTax: '稅前金額',
    postTax: '稅後實拿',
    totalInvestedCost: '實際投入產生股利總金額',
    costYield: '成本殖利率',
    symbolsCountLabel: '檔領息標的',
    filterWholeLot: '僅 ≥ 1,000 股',
    filterAllShares: '含零股',
    excludedNoticePrefix: '已自動剔除',
    excludedNoticeSuffix: '檔不足 1,000 股之標的',
    totalGross: '年度預估總股利（稅前）',
    totalNhi: '二代健保補充保費（2.11%）',
    totalNet: '預估實拿現金流（稅後）',
    taxCredit: '可抵減稅額（單獨列示）',
    taxCreditHint: '合併計稅 8.5%，每戶上限 NT$80,000（不混入實拿）',
    nhiHint: '單檔單次給付 ≥ NT$20,000 扣繳 2.11%',
    netYield: '實質稅後殖利率',
    emptyHoldings: '目前尚無台股持股紀錄，請先於「持股總覽」新增持股即可自動試算股利現金流。',
    emptyEvents: '所選年度尚無對應持股的除息紀錄，不顯示 0 元假事件。',
    exPassed: '已除息',
    upcoming: '待除息',
    payPending: '發放日：待公告',
    nhiBadge: '達二代健保門檻',
    sharesUnit: '股',
    perShare: '每股',
    exDateLabel: '除息日',
    monthSuffix: '月',
    disclaimerTitle: '試算口徑與免責聲明',
    disclaimer1: '1. 發放日未由公司正式公告前一律標示「待公告」，實際入帳日與金額以各公司公告及集保入帳為準。',
    disclaimer2: '2. 二代健保（≥ NT$20,000 扣 2.11%）先以「單檔單次給付」試算；可抵減稅額（8.5%、上限 80,000 元）僅供合併計稅情境參考，不構成稅務或投資建議。',
    disclaimer3: '3. 稅制參數生效年度：2026 年；資料來源：TWSE 除息快取（twse_dividends）。',
  },
  en: {
    title: '12-Month Dividend Cashflow Calendar',
    subtitle: 'Estimates monthly cash dividends, 2.11% NHI supplementary premium, and 8.5% dividend tax credit (2026 rules).',
    preTax: 'Pre-tax',
    postTax: 'Net Take-home',
    totalInvestedCost: 'Invested Capital (Dividend Stocks)',
    costYield: 'Yield on Cost',
    symbolsCountLabel: 'dividend stocks',
    filterWholeLot: '≥ 1,000 sh only',
    filterAllShares: 'Incl. odd lots',
    excludedNoticePrefix: 'Excluded',
    excludedNoticeSuffix: 'odd-lot holdings (< 1,000 sh)',
    totalGross: 'Est. Annual Dividends (Pre-tax)',
    totalNhi: 'NHI Supplementary Fee (2.11%)',
    totalNet: 'Est. Net Cashflow',
    taxCredit: 'Dividend Tax Credit (Separate)',
    taxCreditHint: '8.5% up to NT$80,000 cap (not added to net cashflow)',
    nhiHint: '2.11% applies when single payout ≥ NT$20,000',
    netYield: 'Net Yield',
    emptyHoldings: 'No Taiwan stock holdings found. Add holdings in the Overview tab to compute your dividend calendar.',
    emptyEvents: 'No dividend events found for your holdings in the selected year.',
    exPassed: 'Ex-Dividend Passed',
    upcoming: 'Upcoming',
    payPending: 'Pay Date: Pending',
    nhiBadge: 'NHI 2.11%',
    sharesUnit: 'sh',
    perShare: 'DPS',
    exDateLabel: 'Ex-Date',
    monthSuffix: '',
    disclaimerTitle: 'Methodology & Disclaimer',
    disclaimer1: '1. Unannounced payout dates are marked "Pending" and never fabricated; actual payouts follow official company announcements.',
    disclaimer2: '2. NHI premium (2.11% for single payout ≥ NT$20,000) and 8.5% tax credit (cap NT$80,000) are estimates only and not tax or investment advice.',
    disclaimer3: '3. Tax parameters effective year: 2026. Data source: TWSE twse_dividends.',
  },
  ja: {
    title: '年間配当キャッシュフロー・カレンダー',
    subtitle: '台湾株の保有銘柄と TWSE 配当データに基づく月別配当・二代健保（2.11%）・税額控除（8.5%）試算（2026年基準）。',
    preTax: '税引前',
    postTax: '手取り額',
    totalInvestedCost: '配当対象銘柄の投資元本合計',
    costYield: '取得利回り',
    symbolsCountLabel: '銘柄',
    filterWholeLot: '1,000株以上',
    filterAllShares: '単元未満含む',
    excludedNoticePrefix: '1,000株未満の',
    excludedNoticeSuffix: '銘柄を除外済',
    totalGross: '年間配当見込（税引前）',
    totalNhi: '二代健保追加保険料（2.11%）',
    totalNet: '手取りキャッシュフロー',
    taxCredit: '配当税額控除（別掲）',
    taxCreditHint: '8.5%・上限 NT$80,000（手取り額には含めません）',
    nhiHint: '1回 NT$20,000 以上で 2.11% 課徴',
    netYield: '実質配当利回り',
    emptyHoldings: '台湾株の保有データがありません。保有銘柄を追加すると自動で試算されます。',
    emptyEvents: '対象年度の配当イベントがありません。',
    exPassed: '権利落済',
    upcoming: '権利落前',
    payPending: '支払日：未公表',
    nhiBadge: '健保2.11%対象',
    sharesUnit: '株',
    perShare: '1株配当',
    exDateLabel: '権利落日',
    monthSuffix: '月',
    disclaimerTitle: '試算基準・免責事項',
    disclaimer1: '1. 未公表の支払日は「未公表」と表示し、推測日付は作成しません。実際の支払日は各社の公式発表に準じます。',
    disclaimer2: '2. 二代健保および税額控除は参考試算であり、税務または投資助言ではありません。',
    disclaimer3: '3. 適用税制年度：2026年 / データソース：TWSE twse_dividends。',
  },
}

const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtNtd(n: number): string {
  return `NT$${Math.round(n).toLocaleString('en-US')}`
}

export function PortfolioDividendCalendar({
  holdings,
  dividends,
  today,
  loading = false,
}: PortfolioDividendCalendarProps) {
  const { locale } = useI18n()
  const t = COPY[locale] ?? COPY['zh-TW']
  const currentYear = Number(today.slice(0, 4))
  const [selectedYear, setSelectedYear] = useState<number>(currentYear)
  const [taxMode, setTaxMode] = useState<'post' | 'pre'>('post')
  const [groupBy, setGroupBy] = useState<'pay' | 'ex'>('pay')
  const [excludeOddLots, setExcludeOddLots] = useState<boolean>(true)

  const yearOptions = useMemo(() => [currentYear + 1, currentYear, currentYear - 1], [currentYear])

  const calendar = useMemo(
    () =>
      buildDividendCalendar(holdings, dividends, {
        today,
        year: selectedYear,
        groupBy,
        minShares: excludeOddLots ? 1000 : 0,
      }),
    [holdings, dividends, today, selectedYear, groupBy, excludeOddLots],
  )

  return (
    <div className="space-y-5">
      {/* 控制列：標題 + 年份 + 稅前/稅後切換 */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-[var(--accent)]" />
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t.title}</h2>
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">{t.subtitle}</p>
          {calendar.isEstimatedYear ? (
            <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300">
              {locale === 'en'
                ? 'Includes estimates averaged from up to 3 years of same-month payouts for unannounced months'
                : locale === 'ja'
                  ? '未発表の月については過去最大3年間の同月実績平均による予想を含みます'
                  : '尚未公告之月份（如今年 12 月及明年）已依近 3 年同月份歷史配息均算預估（實際以投信/公司公告為準）'}
            </p>
          ) : null}
          {calendar.excludedHoldings.length > 0 ? (
            <p className="mt-1.5 ml-0 sm:ml-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-500/30 bg-slate-500/10 px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
              {t.excludedNoticePrefix} {calendar.excludedHoldings.length} {t.excludedNoticeSuffix}（
              {calendar.excludedHoldings
                .slice(0, 6)
                .map((h) => h.symbol)
                .join('、')}
              {calendar.excludedHoldings.length > 6 ? '…' : ''}）
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            aria-label="Year"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>

          <div
            role="group"
            aria-label="Group by month"
            className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-0.5 text-xs"
          >
            <button
              type="button"
              onClick={() => setGroupBy('pay')}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                groupBy === 'pay' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'
              }`}
            >
              {locale === 'en' ? 'By Pay Month' : '依實際領錢月'}
            </button>
            <button
              type="button"
              onClick={() => setGroupBy('ex')}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                groupBy === 'ex' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'
              }`}
            >
              {locale === 'en' ? 'By Ex-Date' : '依除息月'}
            </button>
          </div>

          <div
            role="group"
            aria-label="Odd lot filter"
            className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-0.5 text-xs"
          >
            <button
              type="button"
              onClick={() => setExcludeOddLots(true)}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                excludeOddLots ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'
              }`}
            >
              {t.filterWholeLot}
            </button>
            <button
              type="button"
              onClick={() => setExcludeOddLots(false)}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                !excludeOddLots ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'
              }`}
            >
              {t.filterAllShares}
            </button>
          </div>

          <div
            role="group"
            aria-label="Tax mode"
            className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-0.5"
          >
            <button
              type="button"
              onClick={() => setTaxMode('pre')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                taxMode === 'pre'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t.preTax}
            </button>
            <button
              type="button"
              onClick={() => setTaxMode('post')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                taxMode === 'post'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t.postTax}
            </button>
          </div>
        </div>
      </div>

      {/* 摘要卡片：最上方第一張強調實際投入產生股利總金額 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-2xl border border-[var(--accent)]/40 bg-[var(--bg-card)] p-4">
          <div className="text-xs font-medium text-[var(--accent)]">{t.totalInvestedCost}</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-[var(--text-primary)]">
            {fmtNtd(calendar.totalInvestedCost)}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-secondary)] tabular-nums">
            {calendar.dividendGeneratingSymbolCount} {t.symbolsCountLabel}
            {calendar.effectiveCostYieldPct != null
              ? ` · ${t.costYield} ${calendar.effectiveCostYieldPct.toFixed(2)}%`
              : ''}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="text-xs text-[var(--text-muted)]">{t.totalGross}</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-[var(--text-primary)]">
            {fmtNtd(calendar.totalGross)}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
            {calendar.eventCount} events
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="text-xs text-[var(--text-muted)]">{t.totalNhi}</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-amber-400">
            -{fmtNtd(calendar.totalNhiFee)}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{t.nhiHint}</div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="text-xs text-[var(--text-muted)]">{t.totalNet}</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-emerald-400">
            {fmtNtd(calendar.totalNet)}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-secondary)] tabular-nums">
            {t.netYield}:{' '}
            {calendar.effectiveNetYieldPct != null ? `${calendar.effectiveNetYieldPct.toFixed(2)}%` : '—'}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="text-xs text-[var(--text-muted)]">{t.taxCredit}</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-[var(--accent)]">
            {fmtNtd(calendar.taxCredit)}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{t.taxCreditHint}</div>
        </div>
      </div>

      {/* 空狀態 / 讀取骨架 */}
      {loading && dividends.length === 0 ? (
        <div className="space-y-4">
          <div className="text-xs text-[var(--text-secondary)] flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)] animate-ping" />
            <span>{locale === 'en' ? 'Loading dividend calendar data...' : '讀取歷年除息資料與計算現金流中…'}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-3 animate-pulse"
              >
                <div className="flex justify-between">
                  <div className="h-4 w-14 rounded bg-white/10" />
                  <div className="h-4 w-20 rounded bg-white/10" />
                </div>
                <div className="h-12 rounded-xl bg-white/5" />
                <div className="h-12 rounded-xl bg-white/5" />
              </div>
            ))}
          </div>
        </div>
      ) : !calendar.hasHoldings ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--bg-card)] p-8 text-center text-sm text-[var(--text-secondary)]">
          {t.emptyHoldings}
        </div>
      ) : calendar.eventCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--bg-card)] p-8 text-center text-sm text-[var(--text-secondary)]">
          {t.emptyEvents}
        </div>
      ) : (
        /* 12 個月月曆卡片網格 */
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {calendar.months.map((m) => {
            const monthAmount = taxMode === 'pre' ? m.totalGross : m.totalNet
            const monthLabel =
              locale === 'en' ? MONTH_NAMES_EN[m.month - 1] : `${m.month}${t.monthSuffix}`
            return (
              <div
                key={m.monthKey}
                className={`flex flex-col rounded-2xl border p-4 ${
                  m.events.length > 0
                    ? 'border-[var(--border)] bg-[var(--bg-card)]'
                    : 'border-[var(--border)]/50 bg-[var(--bg-secondary)]/30 opacity-70'
                }`}
              >
                <div className="mb-3 flex items-baseline justify-between border-b border-[var(--border)] pb-2">
                  <span className="text-sm font-bold text-[var(--text-primary)]">{monthLabel}</span>
                  <span className="text-sm font-bold tabular-nums text-[var(--accent)]">
                    {m.events.length > 0 ? fmtNtd(monthAmount) : '—'}
                  </span>
                </div>

                {m.events.length === 0 ? (
                  <div className="py-3 text-center text-xs text-[var(--text-muted)]">—</div>
                ) : (
                  <div className="space-y-2.5">
                    {m.events.map((ev) => {
                      const displayAmount = taxMode === 'pre' ? ev.grossAmount : ev.netAmount
                      return (
                        <div
                          key={`${ev.symbol}:${ev.exDate}`}
                          className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/60 p-3 text-xs"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <Link
                                href={`/dividend-refill?symbol=${encodeURIComponent(ev.symbol)}`}
                                className="font-bold text-[var(--text-primary)] hover:text-[var(--accent)]"
                              >
                                {ev.symbol} {ev.name ?? ''}
                              </Link>
                              <div className="mt-0.5 text-[11px] tabular-nums text-[var(--text-muted)]">
                                {ev.payDate
                                  ? `${locale === 'en' ? 'Pay' : '發放日'}: ${ev.payDate} · `
                                  : ''}
                                {t.exDateLabel}: {ev.exDate} · {t.perShare} {ev.cashDividendPerShare} ·{' '}
                                {ev.shares.toLocaleString('en-US')} {t.sharesUnit}
                              </div>
                            </div>
                            <span className="shrink-0 font-bold tabular-nums text-[var(--text-primary)]">
                              {fmtNtd(displayAmount)}
                            </span>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                ev.exStatus === 'ex_passed'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-blue-500/15 text-blue-400'
                              }`}
                            >
                              {ev.exStatus === 'ex_passed' ? t.exPassed : t.upcoming}
                            </span>

                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                ev.payStatus === 'paid'
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : ev.payStatus === 'scheduled'
                                    ? 'bg-sky-500/15 text-sky-300'
                                    : 'bg-[var(--bg-card)] text-[var(--text-muted)]'
                              }`}
                            >
                              {ev.payStatus === 'paid'
                                ? locale === 'en'
                                  ? 'Paid'
                                  : '已領息'
                                : ev.payStatus === 'scheduled'
                                  ? ev.payEstimated
                                    ? locale === 'en'
                                      ? 'Est. Pay Date'
                                      : '預估發放日'
                                    : locale === 'en'
                                      ? 'Scheduled Pay'
                                      : '待發放'
                                  : t.payPending}
                            </span>

                            {ev.dividend54cRatio < 1 ? (
                              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                                54C {Math.round(ev.dividend54cRatio * 100)}%
                              </span>
                            ) : null}

                            {ev.isEstimated ? (
                              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                                {locale === 'en'
                                  ? `Est. (${ev.sourceYear ?? '3Y avg'})`
                                  : ev.estimateLabel || `依 ${ev.sourceYear} 推估`}
                              </span>
                            ) : null}

                            {ev.nhiTriggered && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                                <ShieldAlert className="h-3 w-3" />
                                {t.nhiBadge} (-{fmtNtd(ev.nhiFee)})
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 免責聲明 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/50 p-4 text-xs leading-relaxed text-[var(--text-muted)]">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-[var(--text-secondary)]">
          <Info className="h-3.5 w-3.5" />
          <span>{t.disclaimerTitle}</span>
        </div>
        <p>{t.disclaimer1}</p>
        <p className="mt-0.5">{t.disclaimer2}</p>
        <p className="mt-0.5">{t.disclaimer3}</p>
      </div>
    </div>
  )
}
