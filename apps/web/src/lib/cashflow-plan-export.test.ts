import { describe, expect, it } from 'vitest'
import { buildAssetProfile, evaluateCashflowPlan } from './cashflow-plan'
import { buildCashflowPlanExportHtml } from './cashflow-plan-export'

describe('cashflow-plan-export', () => {
  it('產出完整自包含 HTML 報告並包含 KPI、12 個月結構與 XSS 跳脫', () => {
    const asset = buildAssetProfile({
      symbol: '0056',
      name: '元大高股息<script>alert(1)</script>',
      price: 36.5,
      today: '2026-11-17',
      rawDividends: [
        { ex_date: '2026-01-22', pay_date: '2026-02-11', cash_dividend: 0.866 },
        { ex_date: '2026-04-21', pay_date: '2026-05-14', cash_dividend: 1.0 },
        { ex_date: '2026-07-21', pay_date: '2026-08-13', cash_dividend: 1.35 },
        { ex_date: '2026-10-20', pay_date: '2026-11-12', cash_dividend: 1.72 },
      ],
    })

    const evaluation = evaluateCashflowPlan([{ asset, lots: 15 }], 40_000)
    const html = buildCashflowPlanExportHtml({
      evaluation,
      styleName: '均衡月月領',
      exportedAt: '2026-11-17 10:30',
    })

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('股利現金流自由配置規劃報告')
    expect(html).toContain('均衡月月領')
    expect(html).toContain('2026-11-17 10:30')
    expect(html).toContain('12 月')
    expect(html).toContain('0056')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('支援英文 (en) 與日文 (ja) 語系報告輸出', () => {
    const asset = buildAssetProfile({
      symbol: '0056',
      name: '元大高股息',
      price: 36.5,
      today: '2026-11-17',
      rawDividends: [{ ex_date: '2026-01-22', pay_date: '2026-02-11', cash_dividend: 0.866 }],
    })
    const evaluation = evaluateCashflowPlan([{ asset, lots: 10 }], 40_000)

    const enHtml = buildCashflowPlanExportHtml({
      evaluation,
      styleName: 'Balanced Monthly Income',
      exportedAt: '2026-11-17 16:30',
      locale: 'en',
    })
    expect(enHtml).toContain('<html lang="en">')
    expect(enHtml).toContain('Monthly Dividend Cashflow Plan Report')
    expect(enHtml).toContain('Balanced Monthly Income')

    const jaHtml = buildCashflowPlanExportHtml({
      evaluation,
      styleName: 'バランス毎月配当',
      exportedAt: '2026-11-17 16:30',
      locale: 'ja',
    })
    expect(jaHtml).toContain('<html lang="ja">')
    expect(jaHtml).toContain('配当キャッシュフロー自由配分計画レポート')
    expect(jaHtml).toContain('バランス毎月配当')
  })
})
