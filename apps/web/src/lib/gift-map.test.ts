import { describe, it, expect } from 'vitest'
import {
  classifyGiftEligibility,
  normalizeDateToYear,
  computeCountdown,
  isEtfOrFund,
} from './gift-map'

describe('Issue #118 股東會紀念品攻略核心邏輯', () => {
  it('isEtfOrFund：能正確將所有 ETF、債券 ETF、REITs、ETN 判定為非普通股', () => {
    // 00 開頭 ETF (純數字與英文字母尾碼)
    expect(isEtfOrFund('0050', '元大台灣50')).toBe(true)
    expect(isEtfOrFund('0056', '元大高股息')).toBe(true)
    expect(isEtfOrFund('00878', '國泰永續高股息')).toBe(true)
    expect(isEtfOrFund('00940', '元大台灣價值高息')).toBe(true)
    expect(isEtfOrFund('00400A', '主動國泰動能高息')).toBe(true)
    expect(isEtfOrFund('00401A', '主動摩根台灣鑫收')).toBe(true)
    expect(isEtfOrFund('00679B', '元大美債20年')).toBe(true)

    // 01 開頭 REITs 受益證券、02 開頭 ETN
    expect(isEtfOrFund('01007T', '兆豐國泰R2')).toBe(true)
    expect(isEtfOrFund('020036', '元大金融配息N')).toBe(true)

    // 名稱含 ETF 字樣
    expect(isEtfOrFund('9999', '富邦特選高息ETF')).toBe(true)

    // 一般上市普通股（絕不可被誤判為 ETF）
    expect(isEtfOrFund('2330', '台積電')).toBe(false)
    expect(isEtfOrFund('2002', '中鋼')).toBe(false)
    expect(isEtfOrFund('1432', '大魯閣')).toBe(false)
    expect(isEtfOrFund('2887', '台新金')).toBe(false)
    expect(isEtfOrFund('2884', '玉山金')).toBe(false)
    expect(isEtfOrFund('2412', '中華電')).toBe(false)
  })
  it('classifyGiftEligibility：能正確識別不發放、電子投票、零股可領與待公告', () => {
    // 不發放
    expect(classifyGiftEligibility('本公司不發放紀念品', null, '無').eligibility).toBe('NO_GIFT')
    expect(classifyGiftEligibility(null, '本公司未編製股東會紀念品', '待公告').eligibility).toBe('NO_GIFT')

    // 電子投票
    expect(
      classifyGiftEligibility('股東得以電子方式行使表決權', null, '超商商品卡50元').eligibility,
    ).toBe('VOTE_REQUIRED')
    expect(
      classifyGiftEligibility(null, '持股未滿1000股之股東須以電子投票始得領取', '隨行杯').eligibility,
    ).toBe('VOTE_REQUIRED')

    // 限親自出席
    expect(classifyGiftEligibility('持股未滿一千股限親自出席領取', null, '洗碗精').eligibility).toBe(
      'MEETING_ONLY',
    )

    // 一股可領
    expect(classifyGiftEligibility('全體股東均予發放', null, '商品卡').eligibility).toBe('ONE_SHARE')
    expect(classifyGiftEligibility('零股可領', null, '折疊傘').eligibility).toBe('ONE_SHARE')

    // 待公告
    expect(classifyGiftEligibility(null, null, '待公告').eligibility).toBe('UNKNOWN')
  })

  it('normalizeDateToYear：能將 MM/DD 正確補齊為指定年份之 ISO 日期', () => {
    expect(normalizeDateToYear('04/22', 2026)).toBe('2026-04-22')
    expect(normalizeDateToYear('1/5', 2027)).toBe('2027-01-05')
    expect(normalizeDateToYear('2026-05-20', 2026)).toBe('2026-05-20')
    expect(normalizeDateToYear('等待', 2026)).toBeNull()
    expect(normalizeDateToYear(null, 2026)).toBeNull()
  })

  it('computeCountdown：能精確判定今日最後買進、T-3、T-7、已截止與待定', () => {
    const today = '2026-11-02'

    // 今日截止
    const resToday = computeCountdown('2026-11-02', today)
    expect(resToday.tag).toBe('TODAY')
    expect(resToday.daysLeft).toBe(0)

    // T-3
    const resT3 = computeCountdown('2026-11-04', today)
    expect(resT3.tag).toBe('T_3')
    expect(resT3.daysLeft).toBe(2)

    // T-7
    const resT7 = computeCountdown('2026-11-08', today)
    expect(resT7.tag).toBe('T_7')
    expect(resT7.daysLeft).toBe(6)

    // 7 天以上
    const resUpcoming = computeCountdown('2026-11-20', today)
    expect(resUpcoming.tag).toBe('UPCOMING')
    expect(resUpcoming.daysLeft).toBe(18)

    // 已截止
    const resExpired = computeCountdown('2026-10-30', today)
    expect(resExpired.tag).toBe('EXPIRED')
    expect(resExpired.daysLeft).toBe(-3)

    // 待定
    const resTbd = computeCountdown(null, today)
    expect(resTbd.tag).toBe('TBD')
    expect(resTbd.daysLeft).toBeNull()
  })
})
