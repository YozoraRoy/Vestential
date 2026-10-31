import { describe, it, expect } from 'vitest'
import {
  INDUSTRIES,
  INDUSTRY_ALL,
  INDUSTRY_BOND_ETF,
  INDUSTRY_DR,
  INDUSTRY_ETF,
  INDUSTRY_UNCLASSIFIED,
  countByIndustry,
  industryCodeOf,
  industryKeyOf,
  industryLabel,
  matchesIndustry,
  splitIndustryChips,
  type IndustryCountable,
} from './industry'

function item(industry_name?: string | null, industry_code?: string | null): IndustryCountable {
  return { industry_name, industry_code }
}

describe('industryLabel｜33 板塊三語對照', () => {
  it('33 個官方板塊都有 en／ja', () => {
    expect(INDUSTRIES).toHaveLength(33)
    for (const meta of INDUSTRIES) {
      expect(meta.zh.length).toBeGreaterThan(1)
      expect(meta.en.length).toBeGreaterThan(1)
      expect(meta.ja.length).toBeGreaterThan(1)
    }
  })

  it('中文名 → 依語系顯示；未知名稱原樣回傳、空值回空字串', () => {
    expect(industryLabel('半導體業', 'zh-TW')).toBe('半導體業')
    expect(industryLabel('半導體業', 'en')).toBe('Semiconductors')
    expect(industryLabel('金融保險業', 'ja')).toBe('金融・保険')
    expect(industryLabel('未知板塊', 'en')).toBe('未知板塊')
    expect(industryLabel(null, 'en')).toBe('')
  })

  it('industryCodeOf：中文名 → 2 碼代碼', () => {
    expect(industryCodeOf('半導體業')).toBe('24')
    expect(industryCodeOf('存託憑證')).toBe('91')
    expect(industryCodeOf('不存在')).toBeNull()
  })
})

describe('industryKeyOf｜空值歸未分類', () => {
  it('industry_name 有值時原樣；null／空字串／缺欄位 → 未分類', () => {
    expect(industryKeyOf(item('半導體業'))).toBe('半導體業')
    expect(industryKeyOf(item(null))).toBe(INDUSTRY_UNCLASSIFIED)
    expect(industryKeyOf(item('  '))).toBe(INDUSTRY_UNCLASSIFIED)
    expect(industryKeyOf({})).toBe(INDUSTRY_UNCLASSIFIED)
    expect(industryKeyOf(null)).toBe(INDUSTRY_UNCLASSIFIED)
  })
})

describe('countByIndustry｜筆數遞減、同筆數依名稱排序', () => {
  it('ETF／債券 ETF／存託憑證各自獨立成板塊', () => {
    const counts = countByIndustry([
      item('半導體業'),
      item('半導體業'),
      item('金融保險業'),
      item(INDUSTRY_ETF),
      item(INDUSTRY_ETF),
      item(INDUSTRY_ETF),
      item(INDUSTRY_BOND_ETF),
      item(INDUSTRY_DR),
    ])
    const map = Object.fromEntries(counts.map((c) => [c.name, c.count]))
    expect(map['半導體業']).toBe(2)
    expect(map['金融保險業']).toBe(1)
    expect(map[INDUSTRY_ETF]).toBe(3)
    expect(map[INDUSTRY_BOND_ETF]).toBe(1)
    expect(map[INDUSTRY_DR]).toBe(1)
    expect(counts[0]).toEqual({ name: INDUSTRY_ETF, count: 3 })
  })

  it('未分類只在確實有未分類標的（count > 0）時列入', () => {
    const withoutUnclassified = countByIndustry([item('半導體業'), item('航運業')])
    expect(withoutUnclassified.some((c) => c.name === INDUSTRY_UNCLASSIFIED)).toBe(false)

    const withUnclassified = countByIndustry([item('半導體業'), item(null), item('')])
    const unclassified = withUnclassified.find((c) => c.name === INDUSTRY_UNCLASSIFIED)
    expect(unclassified?.count).toBe(2)
  })

  it('同筆數依名稱排序（zh-TW）', () => {
    const counts = countByIndustry([item('鋼鐵工業'), item('航運業'), item('半導體業')])
    expect(counts.map((c) => c.name)).toEqual(['半導體業', '航運業', '鋼鐵工業'])
  })
})

describe('splitIndustryChips｜前 10 大 + 其他板塊', () => {
  const many = countByIndustry([
    ...Array.from({ length: 12 }, (_, i) => item(`板塊${String(i).padStart(2, '0')}`)).flatMap((x, i) =>
      Array.from({ length: 13 - i }, () => item(x.industry_name)),
    ),
    item(null),
    item(null),
  ])

  it('top 取前 10 大且依筆數遞減', () => {
    const { top } = splitIndustryChips(many)
    expect(top).toHaveLength(10)
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1].count).toBeGreaterThanOrEqual(top[i].count)
    }
  })

  it('第 11 名以後與未分類都收在 rest；未分類不進 top', () => {
    const { top, rest } = splitIndustryChips(many)
    expect(top.some((c) => c.name === INDUSTRY_UNCLASSIFIED)).toBe(false)
    expect(rest.some((c) => c.name === INDUSTRY_UNCLASSIFIED)).toBe(true)
    expect(rest).toHaveLength(many.length - 10)
  })

  it('板塊數 ≤ 10 時 rest 為空（未分類 count=0 不出現）', () => {
    const counts = countByIndustry([item('半導體業'), item('航運業')])
    const { top, rest } = splitIndustryChips(counts)
    expect(top).toHaveLength(2)
    expect(rest).toHaveLength(0)
  })
})

describe('matchesIndustry｜板塊篩選', () => {
  it('ALL／空字串視為全選', () => {
    expect(matchesIndustry(item('半導體業'), INDUSTRY_ALL)).toBe(true)
    expect(matchesIndustry(item('半導體業'), '')).toBe(true)
    expect(matchesIndustry(item(null), null)).toBe(true)
  })

  it('比對 industry_name；空值標的對應未分類', () => {
    expect(matchesIndustry(item('半導體業'), '半導體業')).toBe(true)
    expect(matchesIndustry(item('半導體業'), '金融保險業')).toBe(false)
    expect(matchesIndustry(item(null), INDUSTRY_UNCLASSIFIED)).toBe(true)
    expect(matchesIndustry(item(null), '半導體業')).toBe(false)
    expect(matchesIndustry(item(null, '24'), '24')).toBe(true)
  })

  it('ETF／債券 ETF 互相不匹配', () => {
    expect(matchesIndustry(item(INDUSTRY_ETF), INDUSTRY_ETF)).toBe(true)
    expect(matchesIndustry(item(INDUSTRY_ETF), INDUSTRY_BOND_ETF)).toBe(false)
    expect(matchesIndustry(item(INDUSTRY_BOND_ETF), INDUSTRY_BOND_ETF)).toBe(true)
  })
})
