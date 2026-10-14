import { describe, it, expect } from 'vitest'
import { buildChipDigestText, type ChipDigestItem } from './email'

// Issue #75：digest 信站一致四要素單測（不寄真信，只斷言內文）。
const items: ChipDigestItem[] = Array.from({ length: 25 }, (_, i) => ({
  symbol: `2${300 + i}`,
  name: `測試${i}`,
  direction: i % 2 === 0 ? ('buy' as const) : ('sell' as const),
  days: 3,
  netShares: (i + 1) * 10000,
  ratioPct: 15 - i * 0.4,
}))

describe('buildChipDigestText 四要素（#75 信站一致）', () => {
  it('門檻行含後台值（consec_days／ratio_pct）＋「依佔比排序」註', () => {
    const text = buildChipDigestText('2026-10-13', items.slice(0, 3), 1200, {
      consecDays: 4,
      ratioPct: 8,
    })
    expect(text).toContain('連買／賣 ≥4 天')
    expect(text).toContain('佔比 ≥8%')
    expect(text).toContain('依佔比排序')
  })

  it('前 20 截斷註明（超過 20 檔）', () => {
    const text = buildChipDigestText('2026-10-13', items, 1200, {
      consecDays: 3,
      ratioPct: 5,
    })
    expect(text).toContain('僅列前 20')
    expect(text).toContain('共 25 檔')
    // 內文只列 20 條
    expect(text).toContain('20. ')
    expect(text).not.toContain('21. ')
  })

  it('快照聲明：寄送時快照（asOf），隔日重算以網站為準', () => {
    const text = buildChipDigestText('2026-10-13', items.slice(0, 3), 1200)
    expect(text).toContain('寄送時快照（2026-10-13）')
    expect(text).toContain('若已隔日重算以網站即時為準')
  })

  it('免責維持「統計訊號非投資建議」', () => {
    const text = buildChipDigestText('2026-10-13', items.slice(0, 3), 1200)
    expect(text).toContain('統計訊號非投資建議')
  })
})
