import { NextResponse } from 'next/server'
import { registry } from '@stock/market-data'
import { getAgentSetting, getTwseDividendsInWindow, logDcaEvent, normalizeArenaDividendSymbol } from '@stock/database'
import { resolveYahooSymbol, DEFAULT_FEE_DISCOUNT } from '@/lib/portfolio'
import { simulateDca, DCA_SAVINGS_RATE_DEFAULT } from '@/lib/dca'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const YEARS_SET = [1, 3, 5, 10] as const

function toTaipeiToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })
}

/**
 * GET /api/dca/simulate?symbol=0050&monthly=5000&years=5&mode=reinvest&fees=1
 * 零股定期定額試算：adjclose 逐月首交易日買入＋除息再投入（引擎見 lib/dca.ts 純函式）。
 * - 價格源：Yahoo adjclose 全還原（yahoo-finance.ts 全域等比還原）。
 * - 股息源：TWSE TWT48U 快取（twse_dividends；缺檔月份視為無配息，不 throw）。
 * - 費率：後台 portfolio.fee_discount（預設 6 折）；定存利率：後台 dca.savings_rate（預設 1.5%）。
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const rawSymbol = (searchParams.get('symbol') ?? '0050').trim().toUpperCase()
    const monthly = Number(searchParams.get('monthly') ?? 5000)
    const yearsRaw = Number(searchParams.get('years') ?? 5)
    const years = (YEARS_SET as readonly number[]).includes(yearsRaw) ? yearsRaw : 5
    const mode = searchParams.get('mode') === 'cash' ? 'cash' : 'reinvest'
    const includeFees = (searchParams.get('fees') ?? '1') !== '0'
    if (!/^\d{4,6}[A-Z0-9]{0,2}$/.test(rawSymbol)) {
      return NextResponse.json({ error: 'invalid symbol' }, { status: 400 })
    }
    if (!Number.isFinite(monthly) || monthly < 1000 || monthly > 1000000) {
      return NextResponse.json({ error: 'monthly must be 1000~1000000' }, { status: 400 })
    }

    const yahooSymbol = await resolveYahooSymbol(rawSymbol, 'tw')
    const today = toTaipeiToday()
    const start = new Date(`${today}T12:00:00+08:00`)
    start.setFullYear(start.getFullYear() - years)
    const startStr = start.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })

    const provider = registry.get('yahoo-finance')
    const history = await provider.getHistory(yahooSymbol, 'TW', startStr, today)
    if (history.length < 20) {
      return NextResponse.json({ error: '資料不足，無法試算（需至少約 1 個月交易日）' }, { status: 422 })
    }
    const bars = history.map((h) => ({
      date: new Date(h.timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }),
      close: h.close,
    }))

    const plain = normalizeArenaDividendSymbol(rawSymbol)
    const divRows = await getTwseDividendsInWindow([plain], startStr, today).catch(() => [])
    const dividends = (divRows ?? []).map((r) => ({ exDate: r.ex_date, cashPerShare: r.cash_dividend }))

    let feeDiscount = DEFAULT_FEE_DISCOUNT
    try {
      const raw = await getAgentSetting('portfolio.fee_discount').catch(() => null)
      const n = raw == null || raw === '' ? NaN : Number(raw)
      if (Number.isFinite(n) && n >= 0 && n <= 1) feeDiscount = n
    } catch {}
    let savingsRate = DCA_SAVINGS_RATE_DEFAULT
    try {
      const raw = await getAgentSetting('dca.savings_rate').catch(() => null)
      const n = raw == null || raw === '' ? NaN : Number(raw)
      if (Number.isFinite(n) && n >= 0 && n < 1) savingsRate = n
    } catch {}

    const result = simulateDca({
      symbol: plain,
      monthlyAmount: monthly,
      nMonths: years * 12,
      bars,
      dividends,
      dividendMode: mode,
      includeFees,
      feeDiscount,
      savingsAnnualRate: savingsRate,
    })

    void logDcaEvent('dca_simulate', { symbol: plain }).catch(() => {})
    return NextResponse.json(
      { success: true, params: { symbol: plain, monthly, years, mode, includeFees }, feeDiscount, savingsRate, result },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '試算失敗' }, { status: 500 })
  }
}
