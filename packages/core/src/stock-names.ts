/**
 * 全站共用的多語系股票名稱解析與格式化引擎（client-safe，零 DB/網路依賴）。
 *
 * 顯示規則（Issue #190）：
 * - `zh-TW`：台股／台股 ETF 100% 優先繁體中文（DB nameZh → 靜態字典 → nameEn → symbol）；
 *            美股優先英文官方名稱（nameEn → nameZh → symbol）。
 * - `en`   ：優先 nameEn → nameZh → symbol。
 * - `ja`   ：優先 nameJa → 靜態日文對照 → nameEn → nameZh → symbol。
 */

export type StockLocale = 'zh-TW' | 'en' | 'ja'

export interface StockMultilingualName {
  nameZh?: string | null
  nameEn?: string | null
  nameJa?: string | null
  market?: string | null
}

/** 常見台股 ETF 與核心權值股靜態繁中對照（最後 fallback，避免無 DB 資料時退回英文或純代號） */
export const STATIC_TW_STOCK_ZH_NAMES: Record<string, string> = {
  // 市值型 / 指數型 ETF
  '0050': '元大台灣50',
  '0051': '元大中型100',
  '0052': '富邦科技',
  '0053': '元大電子',
  '0055': '元大MSCI金融',
  '0057': '富邦摩台',
  '006203': '元大MSCI台灣',
  '006204': '永豐臺灣加權',
  '006208': '富邦台50',
  '00690': '兆豐藍籌30',
  '00692': '富邦公司治理',
  '00728': '第一金工業30',
  '00733': '富邦臺灣中小',
  '00850': '元大臺灣ESG永續',
  '00881': '國泰台灣5G+',
  '00891': '中信關鍵半導體',
  '00892': '富邦台灣半導體',
  '00894': '中信小資高價30',
  '00901': '永豐智能車供應鏈',
  '00904': '新光臺灣半導體30',
  '00905': 'FT臺灣Smart',
  '00912': '中信臺灣智慧50',
  '00921': '兆豐龍頭等權重',
  '00922': '國泰台灣領袖50',
  '00923': '群益台ESG低碳50',
  '00927': '群益半導體收益',
  '00928': '中信上櫃ESG 30',
  '00935': '野村臺灣創新科技50',
  '00938': '凱基優選30',
  '00941': '中信上游半導體',
  '00947': '台新臺灣IC設計',
  // 高股息 ETF
  '0056': '元大高股息',
  '00701': '國泰股利擇優',
  '00713': '元大台灣高息低波',
  '00730': '富邦臺灣優質高息',
  '00731': '復華富時高息低波',
  '00878': '國泰永續高股息',
  '00900': '富邦特選高股息30',
  '00907': '永豐優息存股',
  '00915': '凱基優選高股息30',
  '00918': '大華優利高填息30',
  '00919': '群益台灣精選高息',
  '00929': '復華台灣科技優息',
  '00930': '永豐ESG低碳高息',
  '00932': '兆豐永續高息等權',
  '00934': '中信成長高股息',
  '00936': '台新永續高息中小',
  '00939': '統一台灣高息動能',
  '00940': '元大台灣價值高息',
  '00943': '兆豐電子高息等權',
  '00944': '野村趨勢動能高息',
  '00946': '群益科技高息成長',
  '00961': 'FT臺灣永續高息',
  // 主動型 / 跨國 / 債券 ETF
  '00400A': '國泰動能高息',
  '00401A': '統一台灣動力',
  '00645': '富邦日本東証',
  '00646': '元大S&P500',
  '00662': '富邦NASDAQ',
  '00679B': '元大美債20年',
  '00687B': '國泰20年美債',
  '00720B': '元大投資級公司債',
  '00740B': '富邦全球投等債',
  '00751B': '元大AAA至A公司債',
  '00757': '統一FANG+',
  '00772B': '中信高評級公司債',
  '00830': '國泰費城半導體',
  '00893': '國泰智能電動車',
  '00933B': '國泰10Y+金融債',
  '00937B': '群益ESG投等債20+',
  '00948B': '中信優息投資級債',
  '00949': '復華日本龍頭',
  // 核心權值股
  '2330': '台積電',
  '2317': '鴻海',
  '2454': '聯發科',
  '2308': '台達電',
  '2382': '廣達',
  '2881': '富邦金',
  '2882': '國泰金',
  '2891': '中信金',
  '2412': '中華電',
  '2886': '兆豐金',
  '3711': '日月光投控',
  '2303': '聯電',
  '2884': '玉山金',
  '2892': '第一金',
  '1216': '統一',
  '2002': '中鋼',
  '2603': '長榮',
}

/** 熱門標的日文對照（其餘無日文譯名者依規則 fallback 至英文） */
export const STATIC_STOCK_JA_NAMES: Record<string, string> = {
  '0050': '元大台湾50',
  '0056': '元大高配当',
  '2330': 'TSMC（台湾積体電路製造）',
}

/** 正規化代號（移除 `.TW` / `.TWO` 後綴並轉大寫） */
export function normalizeStockCode(symbol: string): string {
  return (symbol ?? '')
    .trim()
    .toUpperCase()
    .replace(/\.(TW|TWO)$/i, '')
}

/** 判斷是否為台股／台股 ETF 代號 */
export function isTwStockSymbol(symbol: string, market?: string | null): boolean {
  const m = (market ?? '').trim().toUpperCase()
  if (m === 'TW' || m === 'TWSE' || m === 'TPEX') return true
  if (m === 'US') return false
  const upper = (symbol ?? '').trim().toUpperCase()
  if (/\.(TW|TWO)$/i.test(upper)) return true
  const code = normalizeStockCode(upper)
  // 台股與台股 ETF 代號皆以數字開頭（如 2330, 0050, 00679B, 00400A）
  return /^\d/.test(code)
}

/** 檢查名稱是否幾乎純為英文/ASCII（不含 CJK 字元） */
export function isLikelyEnglishStockName(name: string | null | undefined): boolean {
  const t = (name ?? '').trim()
  if (!t) return false
  return !/[\u4e00-\u9fff\u3040-\u30ff]/.test(t)
}

function cleanName(raw: string | null | undefined, code: string): string | null {
  const t = typeof raw === 'string' ? raw.trim().replace(/\*+$/, '').trim() : ''
  if (!t) return null
  if (t.toUpperCase() === code) return null
  return t
}

/**
 * 依語系解析股票顯示名稱（不含代號）。
 * 查無可用名稱時回傳正規化代號 `code`。
 */
export function resolveStockDisplayName(
  symbol: string,
  names: StockMultilingualName | null | undefined,
  locale: StockLocale | string = 'zh-TW',
): string {
  const code = normalizeStockCode(symbol)
  if (!code) return ''

  const nameZh = cleanName(names?.nameZh, code)
  const nameEn = cleanName(names?.nameEn, code)
  const nameJa = cleanName(names?.nameJa, code)
  const isTw = isTwStockSymbol(symbol, names?.market)

  if (locale === 'en') {
    return nameEn || nameZh || code
  }

  if (locale === 'ja') {
    return nameJa || STATIC_STOCK_JA_NAMES[code] || nameEn || nameZh || code
  }

  // zh-TW（預設）
  if (isTw) {
    const staticZh = STATIC_TW_STOCK_ZH_NAMES[code]
    return nameZh || staticZh || nameEn || code
  }

  // 美股／非台股在 zh-TW 維持英文官方名稱
  return nameEn || nameZh || code
}

/**
 * 格式化「代號 ＋ 依語系名稱」標籤（例：`2330 台積電` / `2330 TSMC`）。
 * 若無名稱則僅回傳代號 `2330`。
 */
export function formatStockLabel(
  symbol: string,
  names: StockMultilingualName | null | undefined,
  locale: StockLocale | string = 'zh-TW',
): string {
  const code = normalizeStockCode(symbol)
  if (!code) return ''
  const resolved = resolveStockDisplayName(symbol, names, locale)
  if (!resolved || resolved.toUpperCase() === code) return code
  return `${code} ${resolved}`
}
