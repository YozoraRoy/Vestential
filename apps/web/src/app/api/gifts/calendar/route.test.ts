import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'

vi.mock('@stock/database', () => ({
  dbQueryAll: vi.fn(),
}))

import { dbQueryAll } from '@stock/database'
const mockDbQueryAll = vi.mocked(dbQueryAll)

describe('Issue #118 GET /api/gifts/calendar API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbQueryAll.mockResolvedValue([
      {
        stock_id: '1432',
        stock_name: '大魯閣',
        meeting_date: '05/20',
        last_buy_date: '01/31',
        gift_name: '800元消費抵用券',
        distribution_method: '委託書徵求處',
        distribution_location: '全國指定據點',
        source_url: 'https://mops.twse.com.tw',
        gift_status: '已公告',
        claim_rule: '全體股東發放（零股可領）',
        claim_rule_source: 'MOPS',
        mops_gift_text: '持股未滿一仟股之股東得領取紀念品',
        validation_status: 'valid',
        twse_meeting_date: '2026-05-20',
      },
      {
        stock_id: '2002',
        stock_name: '中鋼',
        meeting_date: '06/19',
        last_buy_date: '04/17',
        gift_name: '砧心有您折疊砧板',
        distribution_method: '股務代理部',
        distribution_location: '各營業處所',
        source_url: 'https://mops.twse.com.tw',
        gift_status: '已公告',
        claim_rule: '股東得以電子方式行使表決權',
        claim_rule_source: 'MOPS',
        mops_gift_text: '未滿一仟股股東須以電子投票始得領取',
        validation_status: 'valid',
        twse_meeting_date: '2026-06-19',
      },
    ])
  })

  it('GET /api/gifts/calendar：能正確回傳紀念品清單與合規免責宣告', async () => {
    const req = new Request('http://localhost/api/gifts/calendar?view=review')
    const res = await GET(req)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.summary).toBeDefined()
    expect(json.items.length).toBe(2)
    expect(json.disclaimer).toContain('合規警語與免責聲明')

    // 檢查大魯閣項目
    const taroko = json.items.find((i: any) => i.stockId === '1432')
    expect(taroko).toBeDefined()
    expect(taroko.giftName).toBe('800元消費抵用券')
    expect(taroko.eligibility).toBe('ONE_SHARE')
    expect(taroko.isPopular).toBe(true)

    // 檢查中鋼項目
    const csc = json.items.find((i: any) => i.stockId === '2002')
    expect(csc).toBeDefined()
    expect(csc.eligibility).toBe('VOTE_REQUIRED')
  })

  it('GET /api/gifts/calendar：關鍵字過濾正確運作', async () => {
    const req = new Request('http://localhost/api/gifts/calendar?q=中鋼')
    const res = await GET(req)
    const json = await res.json()
    expect(json.items.length).toBe(1)
    expect(json.items[0].stockName).toBe('中鋼')
  })
})
