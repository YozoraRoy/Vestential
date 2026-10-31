/**
 * Issue #121 零股頁「板塊」（TWSE 官方產業別）名稱與純函式。
 *
 * 資料流：DB `stock_industry.industry_name` 只存「官方中文名」（如「半導體業」，
 * 來源 openapi t187ap03_L），本檔負責把中文名對照成 en／ja 顯示字串（key 為官方
 * 中文名），並集中管理 33 個板塊。非公司代號的 ETF／債券 ETF／存託憑證在 DB 內
 * 也是以中文名存（'ETF'／'債券 ETF'／'存託憑證'），其多語標籤由 i18n 字典提供
 * （industryEtf／industryBondEtf／industryDr），避免兩處各寫一份翻譯。
 *
 * 未分類（industry_name 為空）不落 DB，前端以 `INDUSTRY_UNCLASSIFIED` 當分組 key，
 * 顯示文字取自 i18n（industryUnclassified），表格欄位則顯示「—」。
 */

export const INDUSTRY_ETF = 'ETF'
export const INDUSTRY_BOND_ETF = '債券 ETF'
export const INDUSTRY_DR = '存託憑證'
/** 未分類分組 key（僅存在於前端彙總，不是 DB 值）。 */
export const INDUSTRY_UNCLASSIFIED = '未分類'
/** 「全部板塊」的篩選 key。 */
export const INDUSTRY_ALL = 'ALL'

export type IndustryLang = 'zh-TW' | 'en' | 'ja'

export interface IndustryMeta {
  /** TWSE 產業別代碼（2 碼，如 '24'）。 */
  code: string
  /** 官方中文名＝DB/對照 key。 */
  zh: string
  en: string
  ja: string
}

/** 33 個 TWSE 產業別（代碼與名稱皆實測自 t187ap03_L）。 */
export const INDUSTRIES: IndustryMeta[] = [
  { code: '01', zh: '水泥工業', en: 'Cement', ja: 'セメント工業' },
  { code: '02', zh: '食品工業', en: 'Food', ja: '食品工業' },
  { code: '03', zh: '塑膠工業', en: 'Plastics', ja: 'プラスチック工業' },
  { code: '04', zh: '紡織纖維', en: 'Textiles', ja: '繊維工業' },
  { code: '05', zh: '電機機械', en: 'Electrical Machinery', ja: '電機機械' },
  { code: '06', zh: '電器電纜', en: 'Electric Appliances & Cables', ja: '電器・ケーブル' },
  { code: '08', zh: '玻璃陶瓷', en: 'Glass & Ceramics', ja: 'ガラス・陶磁器' },
  { code: '09', zh: '造紙工業', en: 'Paper & Pulp', ja: '紙・パルプ' },
  { code: '10', zh: '鋼鐵工業', en: 'Steel', ja: '鉄鋼' },
  { code: '11', zh: '橡膠工業', en: 'Rubber', ja: 'ゴム工業' },
  { code: '12', zh: '汽車工業', en: 'Automobiles', ja: '自動車工業' },
  { code: '14', zh: '建材營造', en: 'Building Materials & Construction', ja: '建材・建設' },
  { code: '15', zh: '航運業', en: 'Shipping & Transportation', ja: '海運' },
  { code: '16', zh: '觀光餐旅', en: 'Tourism & Hospitality', ja: '観光・レジャー' },
  { code: '17', zh: '金融保險業', en: 'Finance & Insurance', ja: '金融・保険' },
  { code: '18', zh: '貿易百貨', en: 'Trading & Consumer Goods', ja: '貿易・百貨店' },
  { code: '20', zh: '其他', en: 'Others', ja: 'その他' },
  { code: '21', zh: '化學工業', en: 'Chemicals', ja: '化学工業' },
  { code: '22', zh: '生技醫療業', en: 'Biotechnology & Medical Care', ja: 'バイオ・医療' },
  { code: '23', zh: '油電燃氣業', en: 'Oil, Gas & Electricity', ja: '石油・ガス・電力' },
  { code: '24', zh: '半導體業', en: 'Semiconductors', ja: '半導体' },
  { code: '25', zh: '電腦及週邊設備業', en: 'Computers & Peripherals', ja: 'コンピュータ・周辺機器' },
  { code: '26', zh: '光電業', en: 'Optoelectronics', ja: '光電' },
  { code: '27', zh: '通信網路業', en: 'Communications & Internet', ja: '通信・ネットワーク' },
  { code: '28', zh: '電子零組件業', en: 'Electronic Parts & Components', ja: '電子部品' },
  { code: '29', zh: '電子通路業', en: 'Electronic Distribution', ja: '電子商取引・販売' },
  { code: '30', zh: '資訊服務業', en: 'Information Services', ja: '情報サービス' },
  { code: '31', zh: '其他電子業', en: 'Other Electronics', ja: 'その他電子' },
  { code: '35', zh: '綠能環保', en: 'Green Energy & Environmental Protection', ja: 'グリーンエネルギー・環境' },
  { code: '36', zh: '數位雲端', en: 'Digital & Cloud', ja: 'デジタル・クラウド' },
  { code: '37', zh: '運動休閒', en: 'Sports & Leisure', ja: 'スポーツ・レジャー' },
  { code: '38', zh: '居家生活', en: 'Household & Lifestyle', ja: '生活用品' },
  { code: '91', zh: '存託憑證', en: 'Depositary Receipts', ja: '預託証券' },
]

const INDUSTRY_BY_ZH: Record<string, IndustryMeta> = Object.fromEntries(
  INDUSTRIES.map((meta) => [meta.zh, meta]),
)

/** 官方中文名 → 指定語系顯示字串；查無對照（含未知代碼兜底）時原樣回傳。 */
export function industryLabel(nameZh: string | null | undefined, lang: IndustryLang): string {
  const raw = (nameZh ?? '').trim()
  if (!raw) return ''
  const meta = INDUSTRY_BY_ZH[raw]
  if (!meta) return raw
  if (lang === 'en') return meta.en
  if (lang === 'ja') return meta.ja
  return meta.zh
}

/** 板塊名稱（中文）→ 2 碼代碼；查無回 null。 */
export function industryCodeOf(nameZh: string | null | undefined): string | null {
  const raw = (nameZh ?? '').trim()
  return INDUSTRY_BY_ZH[raw]?.code ?? null
}

export interface IndustryCountable {
  industry_code?: string | null
  industry_name?: string | null
}

export interface IndustryCount {
  /** 分組 key：官方中文名，或 `INDUSTRY_UNCLASSIFIED`。 */
  name: string
  count: number
}

/** 個股所屬板塊 key（空值歸「未分類」）。 */
export function industryKeyOf(item: IndustryCountable | null | undefined): string {
  const raw = (item?.industry_name ?? '').trim()
  return raw || INDUSTRY_UNCLASSIFIED
}

/**
 * 依板塊彙總筆數：count 遞減、同 count 依名稱排序（zh-TW）。
 * 未分類只在確實有未分類標的（count > 0）時才會出現。
 */
export function countByIndustry(items: IndustryCountable[]): IndustryCount[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = industryKeyOf(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, 'zh-TW'))
}

/**
 * 前 N 大板塊 + 其餘（供「其他板塊 (N)」展開清單）。
 * 「未分類」不進前 N（永遠收在展開清單，且僅 count > 0 時存在）。
 */
export function splitIndustryChips(
  counts: IndustryCount[],
  limit = 10,
): { top: IndustryCount[]; rest: IndustryCount[] } {
  const ranked = counts.filter((c) => c.name !== INDUSTRY_UNCLASSIFIED)
  const unclassified = counts.filter((c) => c.name === INDUSTRY_UNCLASSIFIED)
  return {
    top: ranked.slice(0, limit),
    rest: [...ranked.slice(limit), ...unclassified],
  }
}

/** 該標的是否屬於指定板塊（`INDUSTRY_ALL`／空字串視為全選）。 */
export function matchesIndustry(
  item: IndustryCountable | null | undefined,
  name: string | null | undefined,
): boolean {
  const target = (name ?? '').trim()
  if (!target || target === INDUSTRY_ALL) return true
  if (industryKeyOf(item) === target) return true
  return target === (item?.industry_code ?? '').trim()
}
