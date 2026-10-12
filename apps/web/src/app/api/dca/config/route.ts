import { NextResponse } from 'next/server'
import { getAgentSetting } from '@stock/database'
import { DCA_SAVINGS_RATE_DEFAULT } from '@/lib/dca'
import { DEFAULT_FEE_DISCOUNT } from '@/lib/portfolio-net'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * #69：DCA 試算參數公開端（免登入；試算性質）。
 * - 定存年利率：後台 `dca.savings_rate` 可調（預設 0.015＝1.5%），非法／缺值兜底預設。
 * - 手續費折讓：沿用後台 `portfolio.fee_discount`（預設 0.6），與 /portfolio 同口徑。
 */
export async function GET() {
  let savingsRate = DCA_SAVINGS_RATE_DEFAULT
  let feeDiscount = DEFAULT_FEE_DISCOUNT
  try {
    const raw = await getAgentSetting('dca.savings_rate').catch(() => null)
    const n = raw == null || raw === '' ? NaN : Number(raw)
    if (Number.isFinite(n) && n >= 0 && n < 1) savingsRate = n
  } catch {}
  try {
    const raw = await getAgentSetting('portfolio.fee_discount').catch(() => null)
    const n = raw == null || raw === '' ? NaN : Number(raw)
    if (Number.isFinite(n) && n >= 0 && n <= 1) feeDiscount = n
  } catch {}
  return NextResponse.json({
    savingsRate,
    savingsRateDefault: DCA_SAVINGS_RATE_DEFAULT,
    feeDiscount,
    feeDiscountDefault: DEFAULT_FEE_DISCOUNT,
  })
}
