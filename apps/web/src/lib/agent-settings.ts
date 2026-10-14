export interface AgentSettingMeta {
  category: string
  label: string
  defaultValue: string
  /** false 表示唯讀（平台硬上限／系統值），後台只顯示不給輸入框。 */
  editable?: boolean
  /** 設定旁的「?」說明（hover 顯示）。 */
  help?: string
}

export const DEFAULT_AGENT_SETTINGS: Record<string, AgentSettingMeta> = {
  // 市場焦點小編
  'market_focus.select_count': {
    category: 'market-focus',
    label: '精選新聞數量',
    defaultValue: '10',
    help: '每日從新聞池中挑選幾則精選（乾跑/發布皆適用）。',
  },
  'market_focus.select_prompt': {
    category: 'market-focus',
    label: '選新聞 System Prompt',
    defaultValue: '',
    help: '覆寫「篩選新聞」的系統提示詞；空白＝用內建預設。',
  },
  'market_focus.summary_prompt': {
    category: 'market-focus',
    label: '每日總覽 System Prompt',
    defaultValue: '',
    help: '覆寫「每日總覽」的系統提示詞；空白＝用內建預設。',
  },
  'market_focus.summary_max_tokens': {
    category: 'market-focus',
    label: '每日總覽 max_tokens',
    defaultValue: '1000',
    help: '生成每日總覽時 LLM 的 token 上限。超過 1000 會使 Groq qwen 備援 429 而 fallback，請勿調高。',
  },
  // 社群小編
  'social.ig_prompt': {
    category: 'social',
    label: 'IG 文案 System Prompt',
    defaultValue: '',
    help: '覆寫 IG 文案生成提示詞；空白＝用內建預設。',
  },
  'social.threads_prompt': {
    category: 'social',
    label: 'Threads 文案 System Prompt',
    defaultValue: '',
    help: '覆寫 Threads 文案生成提示詞；空白＝用內建預設。',
  },
  'social.fb_prompt': {
    category: 'social',
    label: 'Facebook 文案 System Prompt',
    defaultValue: '',
    help: '覆寫 Facebook 文案生成提示詞；空白＝用內建預設。',
  },
  'social.ig_max_chars': {
    category: 'social',
    label: 'IG 上限字數',
    defaultValue: '500',
    editable: false,
    help: 'Instagram 平台文案上限，為硬性限制，不可調整。',
  },
  'social.threads_max_chars': {
    category: 'social',
    label: 'Threads 上限字數',
    defaultValue: '500',
    editable: false,
    help: 'Threads 平台文案上限，為硬性限制，不可調整。',
  },
  'social.fb_max_chars': {
    category: 'social',
    label: 'Facebook 上限字數',
    defaultValue: '500',
    editable: false,
    help: 'Facebook 平台文案上限，為硬性限制，不可調整。',
  },
  'social.card_style': {
    category: 'social',
    label: '圖卡樣式',
    defaultValue: 'ai',
    help: 'classic＝品牌資訊卡；meme＝經濟/科技梗圖大字版式。',
  },
  'social.meme_prompt': {
    category: 'social',
    label: '梗圖 System Prompt',
    defaultValue: '',
    help: '覆寫「梗圖概念」生成提示詞；空白＝用內建預設。',
  },
  'social.reply_tag_metaai': {
    category: 'social',
    label: '首回覆問 Meta AI',
    defaultValue: 'editor',
    help: 'on＝主文後自動發「@meta.ai＋問題」首回覆（Threads 自回覆＋IG 第二則留言）；editor＝降級版（去 tag 小編提問，不標註）；off＝關閉，不發首回覆。台灣目前未開放 @meta.ai，故預設 editor；待開放後再切 on（先乾跑驗證）。',
  },
  // 試算頁
  'portfolio.fee_discount': {
    category: 'portfolio',
    label: '手續費折讓 discount',
    defaultValue: '0.6',
    help: '台股手續費折讓（0~1；0.6＝6 折 0.0855%）。試算頁淨損益即時生效；美股不收稅費不受影響。',
  },
  // 主力籌碼雷達（Issue #71：异常閾值後台可調；改值後下輪榜單即生效，讀時即算）
  'chip.consec_days': {
    category: 'chip',
    label: '連買/賣天數門檻',
    defaultValue: '3',
    help: '連買或連賣達幾天才列入異常榜（2~5；預設 3）。改值後下輪榜單即生效。',
  },
  'chip.ratio_pct': {
    category: 'chip',
    label: '法人佔比門檻％',
    defaultValue: '5',
    help: '當日法人合計買賣超金額佔成交額達幾％才列入異常榜（預設 5）。改值後下輪榜單即生效。',
  },
  'chip.margin_diverge_on': {
    category: 'chip',
    label: '融資背離標籤開關',
    defaultValue: 'on',
    help: 'on＝融資大減＋股價上漲掛背離標籤；本期無融資源（未含融資）故永不觸發，第二期接源即生效。',
  },
  // 全站表格字級（Issue #75：v2 新方案預設／v1 舊方案；前台經 /api/ui-config 即時切換）
  'ui.table_typography': {
    category: 'ui',
    label: '表格字級方案',
    defaultValue: 'v2',
    help: 'v2＝新字級（表頭 text-sm 粗體、內文 13px，預設）；v1＝舊字級（表頭 text-xs、內文 text-sm）。存檔後前台表格下次載入即生效，免改碼。',
  },
  // 競技場
  'arena.slippage': {
    category: 'arena',
    label: '滑價 slippage',
    defaultValue: '0.003',
    help: '下單打滑成本：買＝價×(1+slip)、賣＝價×(1−slip)。預設 0.3% 模擬無法剛好成交在收盤價。',
  },
  'arena.system_prompt': {
    category: 'arena',
    label: '競技場 Agent System Prompt',
    defaultValue: '',
    help: '附加到每個競技場 agent 決策提示詞末尾的全域覆寫（空白＝不用）。',
  },
}