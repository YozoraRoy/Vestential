/**
 * 全站核心標的池定義（Single Source of Truth）。
 *
 * 設計原則（Issue #128 & docs/roadmap_zh.md）：
 * 1. 核心原型 ETF（50~60 檔）：台股市值型、高股息型、主題產業型、主動型與熱門債券/跨國型。
 *    嚴格排除槓桿型（正2）、反向型（反1）、期貨型與冷門小規模 ETF。
 * 2. 市值前 100 大權值個股（TOP_50 + TOP_100）：
 *    - TOP_50：台灣 50 成分股（核心權值龍頭）
 *    - TOP_100：中型 100 前段績優股（涵蓋高股息 ETF 常納入之民生、金融與績優電子股）
 *    - 移除已下市/合併代號（如 2311 日月光、2823 中壽、2888 新光金）與小型投機股（如 2611 志信）。
 */

export type UniverseTier = 'ETF' | 'TOP_50' | 'TOP_100' | 'OTHER'

export type EtfSubCategory = '市值型' | '高股息' | '科技主題' | '主動型' | '債券跨國'

export interface UniverseEntry {
  symbol: string
  name: string
  tier: UniverseTier
  subCategory?: EtfSubCategory
}

/** 核心原型 ETF 清單（約 54 檔，無槓桿反向） */
export const CORE_ETF_UNIVERSE: UniverseEntry[] = [
  // ─── 市值型 ──────────────────────────────────────────
  { symbol: '0050.TW', name: '元大台灣50', tier: 'ETF', subCategory: '市值型' },
  { symbol: '006208.TW', name: '富邦台50', tier: 'ETF', subCategory: '市值型' },
  { symbol: '0051.TW', name: '元大中型100', tier: 'ETF', subCategory: '市值型' },
  { symbol: '00692.TW', name: '富邦公司治理', tier: 'ETF', subCategory: '市值型' },
  { symbol: '00850.TW', name: '元大臺灣ESG永續', tier: 'ETF', subCategory: '市值型' },
  { symbol: '00905.TW', name: 'FT臺灣Smart', tier: 'ETF', subCategory: '市值型' },
  { symbol: '00922.TW', name: '國泰台灣領袖50', tier: 'ETF', subCategory: '市值型' },
  { symbol: '00923.TW', name: '群益台ESG低碳50', tier: 'ETF', subCategory: '市值型' },
  { symbol: '00935.TW', name: '野村臺灣創新科技50', tier: 'ETF', subCategory: '市值型' },
  { symbol: '00921.TW', name: '兆豐龍頭等權重', tier: 'ETF', subCategory: '市值型' },

  // ─── 高股息型 ────────────────────────────────────────
  { symbol: '0056.TW', name: '元大高股息', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00878.TW', name: '國泰永續高股息', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00919.TW', name: '群益台灣精選高息', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00929.TW', name: '復華台灣科技優息', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00713.TW', name: '元大台灣高息低波', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00915.TW', name: '凱基優選高股息30', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00918.TW', name: '大華優利高填息30', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00939.TW', name: '統一台灣高息動能', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00940.TW', name: '元大台灣價值高息', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00946.TW', name: '群益科技高息成長', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00934.TW', name: '中信成長高股息', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00936.TW', name: '台新永續高息中小', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00701.TW', name: '國泰股利擇優', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00730.TW', name: '富邦臺灣優質高息', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00900.TW', name: '富邦特選高股息30', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00932.TW', name: '兆豐永續高息等權', tier: 'ETF', subCategory: '高股息' },
  { symbol: '00944.TW', name: '野村趨勢動能高息', tier: 'ETF', subCategory: '高股息' },

  // ─── 科技與產業主題型 ────────────────────────────────
  { symbol: '0052.TW', name: '富邦科技', tier: 'ETF', subCategory: '科技主題' },
  { symbol: '00881.TW', name: '國泰台灣5G+', tier: 'ETF', subCategory: '科技主題' },
  { symbol: '00891.TW', name: '中信關鍵半導體', tier: 'ETF', subCategory: '科技主題' },
  { symbol: '00892.TW', name: '富邦台灣半導體', tier: 'ETF', subCategory: '科技主題' },
  { symbol: '00830.TW', name: '國泰費城半導體', tier: 'ETF', subCategory: '科技主題' },
  { symbol: '00662.TW', name: '富邦NASDAQ', tier: 'ETF', subCategory: '科技主題' },
  { symbol: '00757.TW', name: '統一FANG+', tier: 'ETF', subCategory: '科技主題' },
  { symbol: '00646.TW', name: '元大S&P500', tier: 'ETF', subCategory: '科技主題' },
  { symbol: '00893.TW', name: '國泰智能電動車', tier: 'ETF', subCategory: '科技主題' },
  { symbol: '00941.TW', name: '中信上游半導體', tier: 'ETF', subCategory: '科技主題' },
  { symbol: '00947.TW', name: '台新臺灣IC設計', tier: 'ETF', subCategory: '科技主題' },
  { symbol: '00949.TW', name: '復華日本龍頭', tier: 'ETF', subCategory: '科技主題' },

  // ─── 主動型 ETF ──────────────────────────────────────
  { symbol: '00400A.TW', name: '國泰動能高息', tier: 'ETF', subCategory: '主動型' },
  { symbol: '00401A.TW', name: '統一台灣動力', tier: 'ETF', subCategory: '主動型' },

  // ─── 債券與跨國穩定型 ────────────────────────────────
  { symbol: '00679B.TW', name: '元大美債20年', tier: 'ETF', subCategory: '債券跨國' },
  { symbol: '00687B.TW', name: '國泰20年美債', tier: 'ETF', subCategory: '債券跨國' },
  { symbol: '00937B.TW', name: '群益ESG投等債20+', tier: 'ETF', subCategory: '債券跨國' },
  { symbol: '00933B.TW', name: '國泰10Y+金融債', tier: 'ETF', subCategory: '債券跨國' },
  { symbol: '00720B.TW', name: '元大投資級公司債', tier: 'ETF', subCategory: '債券跨國' },
  { symbol: '00740B.TW', name: '富邦全球投等債', tier: 'ETF', subCategory: '債券跨國' },
  { symbol: '00772B.TW', name: '中信高評級公司債', tier: 'ETF', subCategory: '債券跨國' },
  { symbol: '00751B.TW', name: '元大AAA至A公司債', tier: 'ETF', subCategory: '債券跨國' },
  { symbol: '00948B.TW', name: '中信優息投資級債', tier: 'ETF', subCategory: '債券跨國' },
  { symbol: '00645.TW', name: '富邦日本東証', tier: 'ETF', subCategory: '債券跨國' },
]

/** 市值前 50 大個股（台灣 50 核心權值龍頭） */
export const TOP_50_STOCKS_UNIVERSE: UniverseEntry[] = [
  { symbol: '2330.TW', name: '台積電', tier: 'TOP_50' },
  { symbol: '2317.TW', name: '鴻海', tier: 'TOP_50' },
  { symbol: '2454.TW', name: '聯發科', tier: 'TOP_50' },
  { symbol: '2308.TW', name: '台達電', tier: 'TOP_50' },
  { symbol: '2382.TW', name: '廣達', tier: 'TOP_50' },
  { symbol: '2881.TW', name: '富邦金', tier: 'TOP_50' },
  { symbol: '2882.TW', name: '國泰金', tier: 'TOP_50' },
  { symbol: '2891.TW', name: '中信金', tier: 'TOP_50' },
  { symbol: '2412.TW', name: '中華電', tier: 'TOP_50' },
  { symbol: '2886.TW', name: '兆豐金', tier: 'TOP_50' },
  { symbol: '3711.TW', name: '日月光投控', tier: 'TOP_50' },
  { symbol: '2303.TW', name: '聯電', tier: 'TOP_50' },
  { symbol: '6669.TW', name: '緯穎', tier: 'TOP_50' },
  { symbol: '3231.TW', name: '緯創', tier: 'TOP_50' },
  { symbol: '2884.TW', name: '玉山金', tier: 'TOP_50' },
  { symbol: '2892.TW', name: '第一金', tier: 'TOP_50' },
  { symbol: '2880.TW', name: '華南金', tier: 'TOP_50' },
  { symbol: '2885.TW', name: '元大金', tier: 'TOP_50' },
  { symbol: '2887.TW', name: '台新金', tier: 'TOP_50' },
  { symbol: '2890.TW', name: '永豐金', tier: 'TOP_50' },
  { symbol: '5880.TW', name: '合庫金', tier: 'TOP_50' },
  { symbol: '2883.TW', name: '凱基金', tier: 'TOP_50' },
  { symbol: '3008.TW', name: '大立光', tier: 'TOP_50' },
  { symbol: '2357.TW', name: '華碩', tier: 'TOP_50' },
  { symbol: '2379.TW', name: '瑞昱', tier: 'TOP_50' },
  { symbol: '3034.TW', name: '聯詠', tier: 'TOP_50' },
  { symbol: '1216.TW', name: '統一', tier: 'TOP_50' },
  { symbol: '2603.TW', name: '長榮', tier: 'TOP_50' },
  { symbol: '2609.TW', name: '陽明', tier: 'TOP_50' },
  { symbol: '2615.TW', name: '萬海', tier: 'TOP_50' },
  { symbol: '2002.TW', name: '中鋼', tier: 'TOP_50' },
  { symbol: '1101.TW', name: '台泥', tier: 'TOP_50' },
  { symbol: '1102.TW', name: '亞泥', tier: 'TOP_50' },
  { symbol: '1301.TW', name: '台塑', tier: 'TOP_50' },
  { symbol: '1303.TW', name: '南亞', tier: 'TOP_50' },
  { symbol: '1326.TW', name: '台化', tier: 'TOP_50' },
  { symbol: '6505.TW', name: '台塑化', tier: 'TOP_50' },
  { symbol: '2327.TW', name: '國巨', tier: 'TOP_50' },
  { symbol: '2301.TW', name: '光寶科' , tier: 'TOP_50' },
  { symbol: '2356.TW', name: '英業達', tier: 'TOP_50' },
  { symbol: '2376.TW', name: '技嘉', tier: 'TOP_50' },
  { symbol: '2377.TW', name: '微星', tier: 'TOP_50' },
  { symbol: '3017.TW', name: '奇鋐', tier: 'TOP_50' },
  { symbol: '3037.TW', name: '欣興', tier: 'TOP_50' },
  { symbol: '3661.TW', name: '世芯-KY', tier: 'TOP_50' },
  { symbol: '3443.TW', name: '創意', tier: 'TOP_50' },
  { symbol: '3533.TW', name: '嘉澤', tier: 'TOP_50' },
  { symbol: '2207.TW', name: '和泰車', tier: 'TOP_50' },
  { symbol: '2912.TW', name: '統一超', tier: 'TOP_50' },
  { symbol: '3045.TW', name: '台灣大', tier: 'TOP_50' },
]

/** 市值第 51～100 大個股（中型 100 前段績優股） */
export const TOP_51_100_STOCKS_UNIVERSE: UniverseEntry[] = [
  { symbol: '4904.TW', name: '遠傳', tier: 'TOP_100' },
  { symbol: '5871.TW', name: '中租-KY', tier: 'TOP_100' },
  { symbol: '5876.TW', name: '上海商銀', tier: 'TOP_100' },
  { symbol: '2801.TW', name: '彰銀', tier: 'TOP_100' },
  { symbol: '2834.TW', name: '臺企銀', tier: 'TOP_100' },
  { symbol: '2812.TW', name: '台中銀', tier: 'TOP_100' },
  { symbol: '6005.TW', name: '群益證', tier: 'TOP_100' },
  { symbol: '2897.TW', name: '王道銀行', tier: 'TOP_100' },
  { symbol: '1504.TW', name: '東元', tier: 'TOP_100' },
  { symbol: '1513.TW', name: '中興電', tier: 'TOP_100' },
  { symbol: '1519.TW', name: '華城', tier: 'TOP_100' },
  { symbol: '1503.TW', name: '士電', tier: 'TOP_100' },
  { symbol: '1605.TW', name: '華新', tier: 'TOP_100' },
  { symbol: '2324.TW', name: '仁寶', tier: 'TOP_100' },
  { symbol: '2353.TW', name: '宏碁', tier: 'TOP_100' },
  { symbol: '2347.TW', name: '聯強', tier: 'TOP_100' },
  { symbol: '2344.TW', name: '華邦電', tier: 'TOP_100' },
  { symbol: '2408.TW', name: '南亞科', tier: 'TOP_100' },
  { symbol: '2368.TW', name: '金像電', tier: 'TOP_100' },
  { symbol: '2395.TW', name: '研華', tier: 'TOP_100' },
  { symbol: '2449.TW', name: '京元電子', tier: 'TOP_100' },
  { symbol: '3044.TW', name: '健鼎', tier: 'TOP_100' },
  { symbol: '3653.TW', name: '健策', tier: 'TOP_100' },
  { symbol: '3680.TW', name: '家登', tier: 'TOP_100' },
  { symbol: '3702.TW', name: '大聯大', tier: 'TOP_100' },
  { symbol: '4938.TW', name: '和碩', tier: 'TOP_100' },
  { symbol: '4958.TW', name: '臻鼎-KY', tier: 'TOP_100' },
  { symbol: '5269.TW', name: '祥碩', tier: 'TOP_100' },
  { symbol: '6409.TW', name: '旭隼', tier: 'TOP_100' },
  { symbol: '6415.TW', name: '矽力-KY', tier: 'TOP_100' },
  { symbol: '6488.TW', name: '環球晶', tier: 'TOP_100' },
  { symbol: '6515.TW', name: '穎崴', tier: 'TOP_100' },
  { symbol: '8210.TW', name: '勤誠', tier: 'TOP_100' },
  { symbol: '8069.TW', name: '元太', tier: 'TOP_100' },
  { symbol: '6239.TW', name: '力成', tier: 'TOP_100' },
  { symbol: '6176.TW', name: '瑞儀', tier: 'TOP_100' },
  { symbol: '3023.TW', name: '信邦', tier: 'TOP_100' },
  { symbol: '2618.TW', name: '長榮航', tier: 'TOP_100' },
  { symbol: '2610.TW', name: '華航', tier: 'TOP_100' },
  { symbol: '2606.TW', name: '裕民', tier: 'TOP_100' },
  { symbol: '2634.TW', name: '漢翔', tier: 'TOP_100' },
  { symbol: '9904.TW', name: '寶成', tier: 'TOP_100' },
  { symbol: '9910.TW', name: '豐泰', tier: 'TOP_100' },
  { symbol: '9917.TW', name: '中保科', tier: 'TOP_100' },
  { symbol: '9921.TW', name: '巨大', tier: 'TOP_100' },
  { symbol: '9945.TW', name: '潤泰新', tier: 'TOP_100' },
  { symbol: '2542.TW', name: '興富發', tier: 'TOP_100' },
  { symbol: '2105.TW', name: '正新', tier: 'TOP_100' },
  { symbol: '1402.TW', name: '遠東新', tier: 'TOP_100' },
  { symbol: '1717.TW', name: '長興', tier: 'TOP_100' },
  { symbol: '6770.TW', name: '力積電', tier: 'TOP_100' },
]

/**
 * 全站核心標的池（總計約 150 檔：50 檔核心原型 ETF + 100 檔市值龍頭個股）。
 * 保證已移除下市合併代號（如 2311、2823、2888）與非前百大投機股（如 2611、2498）。
 */
export const TW_LARGE_CAP_UNIVERSE: UniverseEntry[] = [
  ...CORE_ETF_UNIVERSE,
  ...TOP_50_STOCKS_UNIVERSE,
  ...TOP_51_100_STOCKS_UNIVERSE,
]

/** 依 symbol（完整帶 .TW 或純代號）索引之名稱快照。 */
export const TW_LARGE_CAP_UNIVERSE_BY_SYMBOL: Map<string, UniverseEntry> = new Map()

for (const item of TW_LARGE_CAP_UNIVERSE) {
  const clean = item.symbol.replace(/\.(TW|TWO)$/i, '')
  TW_LARGE_CAP_UNIVERSE_BY_SYMBOL.set(item.symbol, item)
  TW_LARGE_CAP_UNIVERSE_BY_SYMBOL.set(`${clean}.TW`, item)
  TW_LARGE_CAP_UNIVERSE_BY_SYMBOL.set(clean, item)
}

/**
 * 取得標的的宇宙層級分類：
 * - 'ETF'：核心原型 ETF
 * - 'TOP_50'：市值前 50 大核心權值股
 * - 'TOP_100'：市值 51~100 大中型績優股
 * - 'OTHER'：非核心池（中小型股或槓桿反向 ETF）
 */
export function getUniverseTier(symbol: string): UniverseTier {
  if (!symbol) return 'OTHER'
  const trimmed = symbol.trim().toUpperCase()
  const clean = trimmed.replace(/\.(TW|TWO)$/i, '')

  const entry =
    TW_LARGE_CAP_UNIVERSE_BY_SYMBOL.get(trimmed) ||
    TW_LARGE_CAP_UNIVERSE_BY_SYMBOL.get(`${clean}.TW`) ||
    TW_LARGE_CAP_UNIVERSE_BY_SYMBOL.get(clean)

  if (entry) return entry.tier

  // 若代號為 00 開頭但不在核心原型 ETF 池內（如槓桿 00631L 或冷門小規模），仍標記為 OTHER
  return 'OTHER'
}

/** 判斷是否屬於核心原型 ETF */
export function isCoreEtf(symbol: string): boolean {
  return getUniverseTier(symbol) === 'ETF'
}

/** 判斷是否屬於市值前 100 大個股（TOP_50 或 TOP_100） */
export function isTop100Stock(symbol: string): boolean {
  const tier = getUniverseTier(symbol)
  return tier === 'TOP_50' || tier === 'TOP_100'
}

/**
 * 解析標的名稱（繁體中文優先，除非原本就是英文標的）。
 * - 優先比對核心標的池中文名稱（支援 "2317.TW"、"0050.TW" 或純代號 "2317"、"0050"）
 * - 若 rawName 包含中文字元，保留中文名稱
 * - 否則回傳 rawName（若原本即為英文標的）或純代號
 */
export function resolveStockName(symbol: string, rawName?: string | null): string {
  if (!symbol) return rawName ?? ''
  const trimmed = symbol.trim()
  const cleanSym = trimmed.replace(/\.(TW|TWO)$/i, '')

  // 1. 優先查核心標的池（支援帶尾綴或純代號）
  const match =
    TW_LARGE_CAP_UNIVERSE_BY_SYMBOL.get(trimmed) ||
    TW_LARGE_CAP_UNIVERSE_BY_SYMBOL.get(`${cleanSym}.TW`) ||
    TW_LARGE_CAP_UNIVERSE_BY_SYMBOL.get(cleanSym)
  if (match) return match.name

  // 2. 若 rawName 包含中文字元，保留中文
  if (rawName && /[\u4e00-\u9fa5]/.test(rawName)) {
    return rawName.trim()
  }

  // 3. 原本就是英文標的或其他無中文對照，保留 rawName
  if (rawName && rawName.trim().length > 0) {
    return rawName.trim()
  }

  // 4. 保底回傳純代號
  return cleanSym
}
