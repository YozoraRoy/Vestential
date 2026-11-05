import { describe, it, expect } from 'vitest'
import { getOddLotRestriction } from './odd-lot-restriction'

describe('getOddLotRestriction｜零股 1 股領取與代領可行性分類', () => {
  it('1432 大魯閣：僅限股東本人 APP 線上領取抵用券、無代領', () => {
    const res = getOddLotRestriction('800元消費抵用券', '', null, null, undefined, '1432')
    expect(res.status).toBe('APP_ONLY')
    expect(res.label).toContain('僅本人APP')
    expect(res.officialText).toContain('大魯閣 Plus')
  })

  it('集保 eGift 電子禮卡：5608、8996、6698、6598、4746 線上直接入袋無須代領', () => {
    const stocks = ['5608', '8996', '6698', '6598', '4746']
    for (const sid of stocks) {
      const res = getOddLotRestriction('超商商品卡 35元', '', null, null, undefined, sid)
      expect(res.status).toBe('EGIFT_ONLINE')
      expect(res.label).toContain('集保eGift')
      expect(res.officialText).toContain('電子投票')
    }
  })

  it('其餘常規零股標的：需先電子投票，會後至券商股代部櫃檯領取', () => {
    const res = getOddLotRestriction('多用途矽膠隔熱餐墊(二入)', '領取日期', null, null, undefined, '2887')
    expect(res.status).toBe('EVOTE_STOCK_AGENT')
    expect(res.label).toContain('需電投至股代領')
    expect(res.officialText).toContain('民間三大徵求點拒收零股')
  })

  it('明確不發放或需滿千股之標的', () => {
    const resNo = getOddLotRestriction('不發放紀念品', '', null, null, undefined, '2330')
    expect(resNo.status).toBe('NO_ODD_LOT_GIFT')

    const resFull = getOddLotRestriction('超商卡 50元 (限持有一千股以上)', '', null, null, undefined, '9999')
    expect(resFull.status).toBe('NO_ODD_LOT_GIFT')
  })
})
