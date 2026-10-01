export type AnalysisLanguage = 'zh-TW' | 'en' | 'ja'

export const DEFAULT_ANALYSIS_LANGUAGE: AnalysisLanguage = 'zh-TW'

export const ANALYSIS_LANGUAGE_OPTIONS: { id: AnalysisLanguage; label: string; labelEn: string; labelJa: string }[] = [
  { id: 'zh-TW', label: '繁體中文', labelEn: 'Traditional Chinese', labelJa: '繁体中国語' },
  { id: 'en', label: 'English', labelEn: 'English', labelJa: '英語' },
  { id: 'ja', label: '日本語', labelEn: 'Japanese', labelJa: '日本語' },
]

/**
 * 12 個 AI Agent 的執行順序與節點名稱。
 * 引擎、API 與前端共用同一份金鑰，避免名稱不一致。
 * 順序：4 分析 → Bull→Bear（一輪多空辯論）→ Research Manager → Trader
 * → 風險三方（aggressive→conservative→neutral 各一次）→ Portfolio Manager。
 * Bull↔Bear 輪數寫死（Issue #52：不進後台）。
 */
export const AGENT_KEYS = [
  'Market Analyst',
  'Sentiment Analyst',
  'News Analyst',
  'Fundamentals Analyst',
  'Bull Researcher',
  'Bear Researcher',
  'Research Manager',
  'Trader',
  'Aggressive Analyst',
  'Conservative Analyst',
  'Neutral Analyst',
  'Portfolio Manager',
] as const

export type AgentKey = (typeof AGENT_KEYS)[number]

export const AGENT_KEY_SET: ReadonlySet<string> = new Set<string>(AGENT_KEYS)

const DEFAULT_TWD_USD_RATE = 32

/**
 * 依照語言產出輸出指令，注入每個 Agent 的 prompt。
 * zh-TW：全程使用繁體中文，貨幣計算一律以新台幣 (NTD) 呈現；
 * en：全程使用英文並以標的本身幣別呈現。
 */
export function buildAnalysisLanguageInstruction(
  language: AnalysisLanguage,
  twdUsdRate?: number,
): string {
  const rate = twdUsdRate && twdUsdRate > 0 ? twdUsdRate : DEFAULT_TWD_USD_RATE

  if (language === 'zh-TW') {
    return [
      'Language, Currency & Writing Style Instructions (繁體中文 / 說人話・去 AI 味規範):',
      '- 語言與貨幣：全程使用繁體中文（台灣金融用語習慣），金額統一以新台幣（NT$ / TWD）呈現與計算。若為美股資料，保留原始 USD 並依 1 USD ≈ NT$ ' + rate + ' 換算標註。',
      '- 開門見山，直奔重點：第一句直接給出關鍵結論、具體技術位階或財報核心數據。嚴禁抒情開場、天氣與情緒比喻（如「市場瀰漫著…的味道」、「風起雲湧」）。',
      '- 拒絕說教與心靈雞湯：嚴禁「作為投資者我們必須保持冷靜」、「投資是一場修行」等人生導師腔調與自我感動。分析師只提供事實、數據與客觀推論，不對讀者做道德喊話。',
      '- 剔除公式化解說導引詞：嚴禁使用「值得注意的是」、「不可否認的是」、「顯而易見的是」、「不得不說」、「無疑是」等贅詞，直接陳述後續事實與數字。',
      '- 禁絕假推論與生硬對比：慎用「這意味著」，無直接因果不妄加定論；避免「不是…而是…」、「不僅是…更是…」等機械式句型。',
      '- 自然收尾，禁罐頭結論：報告結尾直接停在具體操作價位或風險預警，嚴禁以「總結來說」、「綜上所述」、「總而言之」作昇華性套話總結。',
      '- 標點與段落：使用全形標點符號（，、。！？），段落簡短有力，每段聚焦單一論點與客觀證據。',
    ].join('\n')
  }

  if (language === 'ja') {
    return [
      'Language & Currency Instructions:',
      '- Write your entire report in Japanese (日本語).',
      '- Present and calculate every monetary amount in New Taiwan Dollars (NTD / TWD, symbol NT$).',
      `- If the source data is quoted in another currency (e.g., US stocks in USD), keep the original currency labeled, and also convert USD figures to NTD using 1 USD ≈ NT$ ${rate}.`,
      '- Tone: Professional, concise, data-driven, and objective. Avoid generic filler words or preaching tone.',
    ].join('\n')
  }

  return [
    'Language & Currency Instructions:',
    '- Write your entire report in English.',
    "- Present monetary amounts in the listing's native currency (NTD for Taiwan stocks, USD for US stocks) and always label the currency clearly.",
    '- Tone & Style: Direct, data-driven, objective, and analytical. Avoid preachy advice, cliché opening lines, and generic transition fillers (e.g., "It is worth noting", "In conclusion", "It goes without saying").',
  ].join('\n')
}