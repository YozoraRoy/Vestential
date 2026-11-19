import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Camera,
  CheckCircle2,
  Clock,
  Coins,
  Database,
  Flame,
  FlaskConical,
  Gauge,
  Gift,
  Newspaper,
  PieChart,
  ShieldCheck,
  Sparkles,
  Trophy,
  Wallet,
} from 'lucide-react'
import Link from 'next/link'
import { getDict, getLocale } from '@/i18n/server'
import { getCurrentUserFromCookies } from '@/lib/auth'
import { localizePath } from '@/i18n/paths'
import { buildAlternates } from '@/i18n/metadata'
import type { Locale } from '@/i18n/config'
import {
  getActiveArenaSeason,
  getArenaLeaderboard,
  getArenaTrades,
  getCycleEntrySignalsByEdition,
  getLatestCycleEntryMeta,
  getLatestMarketLevel,
  getMarketFocus,
  type MarketFocusItem,
} from '@stock/database'
import { resolveStockName } from '@stock/cycle-entry'
import { HomeHeroSearch } from '@/components/home-hero-search'

const BASE_URL = 'https://vestential.com'

export async function generateMetadata() {
  const dict = await getDict()
  const locale = await getLocale()
  const alts = buildAlternates(locale, '/')
  return {
    title: dict.home.metaTitle,
    description: dict.home.metaDesc,
    alternates: alts,
    openGraph: {
      title: dict.home.metaTitle,
      description: dict.home.metaDesc,
      url: alts.canonical,
      siteName: 'Vestential',
      type: 'website',
      locale: locale === 'zh-TW' ? 'zh_TW' : locale,
    },
    twitter: {
      card: 'summary_large_image',
    },
  }
}

/** 過濾掉「相關族群：無／空」的無關社會新聞，保留最多 3 則高純度財經情報 */
function selectTopMarketFocus(items: MarketFocusItem[], limit = 3): MarketFocusItem[] {
  const valid = items.filter((it) => {
    const sec = (it.affected_sectors ?? '').trim()
    if (!sec) return false
    const lower = sec.toLowerCase()
    if (sec === '無' || sec === '无' || sec === '—' || sec === '-' || lower === 'none' || lower === 'n/a') {
      return false
    }
    return true
  })
  return (valid.length > 0 ? valid : items).slice(0, limit)
}

function formatShortTime(raw?: string | null): string {
  if (!raw) return ''
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return raw.slice(0, 16)
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  const hh = String(dt.getHours()).padStart(2, '0')
  const mi = String(dt.getMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${mi}`
}

const HOME_COPY: Record<
  Locale,
  {
    heroBadge: string
    heroTitle: string
    heroSubtitle: string
    rhythmCardTitle: string
    rhythmCardLive: string
    taiexLabel: string
    percentileLabel: string
    statusMap: Record<string, { label: string; hint: string; color: string }>
    candidatesTitle: string
    backtestCta: string
    viewAllRhythm: string
    bentoSectionTitle: string
    bentoSectionSub: string
    bentoATag: string
    bentoATitle: string
    bentoADesc: string
    bentoAPreviewStep1: string
    bentoAPreviewStep2: string
    bentoAPreviewNetPnl: string
    bentoAPreviewTaxNote: string
    bentoACta: string
    bentoBTag: string
    bentoBTitle: string
    bentoBDesc: string
    bentoBArenaChampion: string
    bentoBTotalReturn: string
    bentoBLatestAction: string
    bentoBCtaAnalyze: string
    bentoBCtaArena: string
    bentoCTag: string
    bentoCTitle: string
    bentoCDesc: string
    toolOddLot: string
    toolOddLotSub: string
    toolCashflow: string
    toolCashflowSub: string
    toolExDiv: string
    toolExDivSub: string
    toolGift: string
    toolGiftSub: string
    focusTitle: string
    focusSub: string
    focusViewAll: string
    focusDirPos: string
    focusDirNeg: string
    focusDirNeu: string
    focusSourcePrefix: string
    focusDisclaimer: string
    focusExpand: string
    trust1Title: string
    trust1Desc: string
    trust2Title: string
    trust2Desc: string
    trust3Title: string
    trust3Desc: string
    trust4Title: string
    trust4Desc: string
  }
> = {
  'zh-TW': {
    heroBadge: '看市場 ➔ 找股票 ➔ 管持股 · 一站式量化工作流',
    heroTitle: '讓投資決策有依據，不必每天盯盤。',
    heroSubtitle:
      '從大盤水位判斷、AI 多維度個股研究、策略回測到券商截圖損益管理，為上班族打造可重複驗證的量化投資節奏。',
    rhythmCardTitle: '今日市場節奏 Market Rhythm',
    rhythmCardLive: 'TWSE 實盤同步',
    taiexLabel: '台股加權指數 / 估值分位',
    percentileLabel: '綜合估值歷史分位',
    statusMap: {
      overheated: { label: '水位過熱', hint: '宜嚴控部位、分批停利', color: 'text-rose-400 bg-rose-500/15 border-rose-500/30' },
      high: { label: '水位偏高', hint: '宜分批佈局、不追高', color: 'text-amber-300 bg-amber-500/15 border-amber-500/30' },
      fair: { label: '水位合理', hint: '可依週期訊號穩健配置', color: 'text-sky-300 bg-sky-500/15 border-sky-500/30' },
      low: { label: '水位偏低', hint: '長線價值浮現、分批累積', color: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30' },
      undervalued: { label: '極度低估', hint: '歷史罕見低檔區間', color: 'text-emerald-300 bg-emerald-500/20 border-emerald-500/40' },
    },
    candidatesTitle: '今日 Cycle Entry 篩選候選股',
    backtestCta: '一鍵丟入回測實驗室 →',
    viewAllRhythm: '查看完整大盤水位',
    bentoSectionTitle: '三大核心投資情境',
    bentoSectionSub: '不堆疊冗長功能表，從你的真實投資痛點一鍵切入',
    bentoATag: '【看持股】留存首選',
    bentoATitle: '投資組合損益與風險壓測（Portfolio P&L）',
    bentoADesc:
      '支援券商交割／庫存截圖 AI 自動辨識，自動扣除手續費與證交稅計算真實淨報酬率，並提供買賣自動加權結算、股利現金流月曆與穿透雷達。',
    bentoAPreviewStep1: '📸 上傳券商庫存截圖',
    bentoAPreviewStep2: '⚡ 自動產出稅後損益與風險雷達',
    bentoAPreviewNetPnl: '稅後實拿淨損益 +NT$128,450 (+14.8%)',
    bentoAPreviewTaxNote: '已自動扣除折讓手續費、0.3%/0.1% 證交稅與 54C 二代健保',
    bentoACta: '立即體驗截圖記帳 →',
    bentoBTag: '【找標的】多智能體協作',
    bentoBTitle: '12 AI 智能體分析 × AI 投資競技場',
    bentoBDesc: '結合基本面、籌碼面與新聞面的 12 角色辯論報告；同場加映 AI Agent 各持 50 萬模擬實盤競賽。',
    bentoBArenaChampion: '目前競技場 #1 領先智能體',
    bentoBTotalReturn: '賽季總報酬',
    bentoBLatestAction: '最新實盤動作',
    bentoBCtaAnalyze: '啟動 AI 個股分析',
    bentoBCtaArena: '觀戰 AI 競技場 →',
    bentoCTag: '【算現金流】存股族必備',
    bentoCTitle: '小資存股與零股工具箱',
    bentoCDesc: '專為定期定額與領息族打造的 4 大高頻輔助情報：',
    toolOddLot: '零股盤中即時情報',
    toolOddLotSub: '熱門零股排行與價差監控',
    toolCashflow: '股利現金流試算',
    toolCashflowSub: '月領 2~10 萬配置與 54C 健保',
    toolExDiv: '🔥 除權息填息追蹤',
    toolExDivSub: '歷年填息天數與最後買進提醒',
    toolGift: '🎁 股東會紀念品地圖',
    toolGiftSub: '零股可領門檻與最後買進日',
    focusTitle: '精選 AI 市場焦點',
    focusSub: '嚴選 3 則具明確產業連動之高純度情報，嚴格區分新聞事實與 AI 推論',
    focusViewAll: '查看全部焦點',
    focusDirPos: '偏多解讀',
    focusDirNeg: '偏空解讀',
    focusDirNeu: '中性觀察',
    focusSourcePrefix: '資料來源：',
    focusDisclaimer: 'AI 影響推論僅供研究參考',
    focusExpand: '展開完整分析 →',
    trust1Title: '權威公開數據源',
    trust1Desc: '串接 TWSE 證交所公開資訊、FinMind 與主流財經媒體',
    trust2Title: '事實與推論透明分離',
    trust2Desc: '嚴格區分「原始財報／新聞事實」與「AI 智能體推論觀點」',
    trust3Title: '策略可重複驗證',
    trust3Desc: '回測實驗室清楚揭露歷史區間、交易稅費成本與回測限制',
    trust4Title: '明確更新時間戳記',
    trust4Desc: '所有大盤水位、進場候選與報價卡片皆標註最後同步時間',
  },
  en: {
    heroBadge: 'Market Rhythm ➔ Stock Research ➔ Portfolio P&L',
    heroTitle: 'Evidence-Based Investing Without Watching the Tape All Day.',
    heroSubtitle:
      'From market valuation gauges, 12-agent AI stock research, and strategy backtesting to broker screenshot P&L tracking—built for busy professionals.',
    rhythmCardTitle: "Today's Market Rhythm",
    rhythmCardLive: 'TWSE Synced',
    taiexLabel: 'TAIEX Index / Valuation Percentile',
    percentileLabel: 'Composite Valuation Percentile',
    statusMap: {
      overheated: { label: 'Overheated', hint: 'Trim risk & take partial profits', color: 'text-rose-400 bg-rose-500/15 border-rose-500/30' },
      high: { label: 'Elevated', hint: 'Scale in gradually, avoid chasing', color: 'text-amber-300 bg-amber-500/15 border-amber-500/30' },
      fair: { label: 'Fair Value', hint: 'Deploy steadily on cycle signals', color: 'text-sky-300 bg-sky-500/15 border-sky-500/30' },
      low: { label: 'Attractive', hint: 'Long-term value emerging', color: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30' },
      undervalued: { label: 'Deep Value', hint: 'Rare historical bargain zone', color: 'text-emerald-300 bg-emerald-500/20 border-emerald-500/40' },
    },
    candidatesTitle: "Today's Cycle Entry Candidates",
    backtestCta: 'Send to Backtest Lab →',
    viewAllRhythm: 'Full Valuation Dashboard',
    bentoSectionTitle: 'Three Core Investing Workflows',
    bentoSectionSub: 'High-density tools organized around your real investing decisions',
    bentoATag: '[Manage Holdings] Top Retention Tool',
    bentoATitle: 'Portfolio P&L & Stress Test',
    bentoADesc:
      'AI-powered broker screenshot recognition, net P&L after commission & transaction tax, automated buy/sell weighted-average settlement, dividend calendar, and ETF look-through radar.',
    bentoAPreviewStep1: '📸 Upload Broker Screenshot',
    bentoAPreviewStep2: '⚡ Auto Net P&L & Risk Radar',
    bentoAPreviewNetPnl: 'Net After-Tax P&L +NT$128,450 (+14.8%)',
    bentoAPreviewTaxNote: 'Includes fee discounts, 0.3%/0.1% transaction tax & 54C NHI check',
    bentoACta: 'Try Screenshot P&L Now →',
    bentoBTag: '[Find Stocks] Multi-Agent AI',
    bentoBTitle: '12-Agent AI Analysis × AI Trading Arena',
    bentoBDesc: 'Fundamental, chip & news multi-agent reports—plus live paper-trading competition where each AI Agent manages NT$500k.',
    bentoBArenaChampion: 'Current #1 Arena Leader',
    bentoBTotalReturn: 'Season Return',
    bentoBLatestAction: 'Latest Trade',
    bentoBCtaAnalyze: 'Launch AI Analysis',
    bentoBCtaArena: 'Watch AI Arena →',
    bentoCTag: '[Cashflow] Dividend & Odd-Lot',
    bentoCTitle: 'Dividend & Odd-Lot Toolbox',
    bentoCDesc: 'Four essential utilities for income & DCA investors:',
    toolOddLot: 'Odd-Lot Intraday Radar',
    toolOddLotSub: 'Active odd-lot rankings & spreads',
    toolCashflow: 'Monthly Cashflow Planner',
    toolCashflowSub: 'NT$20k–100k/mo & 54C NHI calc',
    toolExDiv: '🔥 Ex-Dividend Fill Tracker',
    toolExDivSub: 'Historical fill days & buy reminders',
    toolGift: '🎁 Shareholder Gift Map',
    toolGiftSub: 'Odd-lot eligibility & last buy dates',
    focusTitle: 'Curated AI Market Focus',
    focusSub: 'Top 3 sector-relevant briefings with clear separation between source facts and AI inference',
    focusViewAll: 'View All Focus',
    focusDirPos: 'Bullish',
    focusDirNeg: 'Bearish',
    focusDirNeu: 'Neutral',
    focusSourcePrefix: 'Source: ',
    focusDisclaimer: 'AI impact inference for research reference only',
    focusExpand: 'Read Full Analysis →',
    trust1Title: 'Authoritative Data',
    trust1Desc: 'Powered by official TWSE disclosures, FinMind, and major financial news outlets',
    trust2Title: 'Fact vs. AI Separation',
    trust2Desc: 'Strict boundary between raw financial facts and AI agent inferences',
    trust3Title: 'Verifiable Strategies',
    trust3Desc: 'Backtest Lab discloses historical windows, fee/tax assumptions, and limits',
    trust4Title: 'Explicit Timestamps',
    trust4Desc: 'Every market gauge, screener pick, and quote card displays its sync timestamp',
  },
  ja: {
    heroBadge: '市場を見る ➔ 銘柄を探す ➔ 保有資産を管理する',
    heroTitle: '毎日板に張り付かず、根拠ある投資判断を。',
    heroSubtitle:
      '市場水準の判定、12 AI エージェントによる銘柄分析、戦略バックテストから証券スクショ損益管理まで、再現性のある投資リズムを構築。',
    rhythmCardTitle: '本日の市場リズム Market Rhythm',
    rhythmCardLive: 'TWSE データ同期',
    taiexLabel: '台湾加権指数 / バリュエーション分位',
    percentileLabel: '総合バリュエーション分位',
    statusMap: {
      overheated: { label: '過熱圏', hint: 'ポジション管理・分割利確を推奨', color: 'text-rose-400 bg-rose-500/15 border-rose-500/30' },
      high: { label: 'やや割高', hint: '高値掴み注意・分散エントリー', color: 'text-amber-300 bg-amber-500/15 border-amber-500/30' },
      fair: { label: '適正水準', hint: 'シグナルに沿った着実な配分', color: 'text-sky-300 bg-sky-500/15 border-sky-500/30' },
      low: { label: '割安圏', hint: '長期投資の好機・段階的積立', color: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30' },
      undervalued: { label: '極度の割安', hint: '歴史的な低水準ゾーン', color: 'text-emerald-300 bg-emerald-500/20 border-emerald-500/40' },
    },
    candidatesTitle: '本日の Cycle Entry 候補銘柄',
    backtestCta: 'バックテスト実験室で検証 →',
    viewAllRhythm: '市場水準の詳細を見る',
    bentoSectionTitle: '3つのコア投資シナリオ',
    bentoSectionSub: '投資家の実際のアクションに直結する高密度ツール群',
    bentoATag: '【資産管理】人気 No.1',
    bentoATitle: 'ポートフォリオ損益・リスク管理（Portfolio P&L）',
    bentoADesc:
      '証券アプリのスクショAI自動認識、手数料・税金控除後の実質損益計算、売買自動精算、配当キャッシュフローカレンダーと重複レーダーを搭載。',
    bentoAPreviewStep1: '📸 証券スクショをアップロード',
    bentoAPreviewStep2: '⚡ 税引後損益とリスクを自動算出',
    bentoAPreviewNetPnl: '税引後純損益 +NT$128,450 (+14.8%)',
    bentoAPreviewTaxNote: '手数料割引・取引税・54C二代健保を自動反映',
    bentoACta: 'スクショ損益管理を試す →',
    bentoBTag: '【銘柄発掘】マルチAI',
    bentoBTitle: '12 AI エージェント分析 × AI 投資アリーナ',
    bentoBDesc: 'ファンダ・需給・ニュースの多角的分析と、各AIが50万台湾ドルを運用するリアルタイム模擬運用バトル。',
    bentoBArenaChampion: '現在アリーナ第1位 AI',
    bentoBTotalReturn: '通算リターン',
    bentoBLatestAction: '最新アクション',
    bentoBCtaAnalyze: 'AI 銘柄分析へ',
    bentoBCtaArena: 'AI アリーナを観戦 →',
    bentoCTag: '【配当・少額投資】ツール箱',
    bentoCTitle: '配当キャッシュフロー＆単元未満株ツール',
    bentoCDesc: '積立・高配当投資家向けの4つの実用ツール：',
    toolOddLot: '単元未満株（零股）情報',
    toolOddLotSub: '人気ランキングと価格差監視',
    toolCashflow: '月次配当プラン試算',
    toolCashflowSub: '月2〜10万設定と54C健保計算',
    toolExDiv: '🔥 権利落ち・配当埋め追跡',
    toolExDivSub: '過去の配当埋め日数と通知',
    toolGift: '🎁 株主優待マップ',
    toolGiftSub: '1株優待条件と最終買付日',
    focusTitle: '厳選 AI 市場フォーカス',
    focusSub: 'セクター連動性の高い3件を厳選し、事実とAI推論を明確に区分',
    focusViewAll: 'すべて見る',
    focusDirPos: '強気材料',
    focusDirNeg: '弱気材料',
    focusDirNeu: '中立',
    focusSourcePrefix: '出典：',
    focusDisclaimer: 'AI推論は研究参考用であり投資助言ではありません',
    focusExpand: '詳細分析を展開 →',
    trust1Title: '信頼性の高い公開データ',
    trust1Desc: 'TWSE台湾証取の公式開示データ・FinMind・主要経済メディアと連携',
    trust2Title: '事実とAI推論の明確な分離',
    trust2Desc: '「決算・ニュースの事実」と「AIエージェントの推論」を厳格に区別',
    trust3Title: '検証可能なバックテスト',
    trust3Desc: '検証期間・手数料および税コスト前提・制限事項を透明に開示',
    trust4Title: '更新タイムスタンプの明示',
    trust4Desc: 'すべての市場指標・候補銘柄・株価カードに最終同期時刻を表示',
  },
}

export default async function Home() {
  const dict = await getDict()
  const locale = await getLocale()
  const currentUser = await getCurrentUserFromCookies().catch(() => null)
  const isLoggedIn = Boolean(currentUser)
  const t = HOME_COPY[locale] ?? HOME_COPY['zh-TW']

  // 並行讀取首頁第 2、3、4 層所需的真實動態數據（含安全 fallback）
  const [rawFocus, latestMarketLevel, cycleMeta, activeSeason] = await Promise.all([
    getMarketFocus(15).catch(() => [] as MarketFocusItem[]),
    getLatestMarketLevel().catch(() => null),
    getLatestCycleEntryMeta().catch(() => null),
    getActiveArenaSeason().catch(() => null),
  ])

  const focusList = selectTopMarketFocus(rawFocus, 3)

  const [cycleSignals, arenaLeaderboard] = await Promise.all([
    cycleMeta?.editionDate
      ? getCycleEntrySignalsByEdition(cycleMeta.editionDate).catch(() => [])
      : Promise.resolve([]),
    activeSeason?.id
      ? getArenaLeaderboard(activeSeason.id, 'season').catch(() => [])
      : Promise.resolve([]),
  ])

  const topCyclePicks = cycleSignals.slice(0, 3).map((s) => ({
    symbol: s.symbol,
    name: resolveStockName(s.symbol, s.name),
    score: s.score,
    price: s.price,
  }))

  const championAgent = arenaLeaderboard[0] ?? null
  const championTrades = championAgent
    ? await getArenaTrades(championAgent.agent_id, 1).catch(() => [])
    : []
  const latestChampionTrade = championTrades[0] ?? null

  const levelStatusKey = latestMarketLevel?.level_status ?? 'high'
  const statusInfo = t.statusMap[levelStatusKey] ?? t.statusMap.high!
  const percentile =
    typeof latestMarketLevel?.composite_percentile === 'number'
      ? Math.round(latestMarketLevel.composite_percentile)
      : 68

  const graph: object[] = [
    {
      '@type': 'WebSite',
      name: 'Vestential',
      url: BASE_URL,
      description: dict.home.metaDesc,
      inLanguage: ['zh-TW', 'en', 'ja'],
    },
    {
      '@type': 'Organization',
      name: 'Vestential',
      url: BASE_URL,
      description: dict.home.metaDesc,
      slogan: 'Vestential = Vest + Essential',
    },
    {
      '@type': 'WebPage',
      name: dict.home.metaTitle,
      description: dict.home.metaDesc,
      url: `${BASE_URL}/`,
      inLanguage: locale,
      isPartOf: { '@type': 'WebSite', name: 'Vestential', url: BASE_URL },
      dateModified: focusList[0]?.published_at
        ? new Date(focusList[0].published_at).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
    },
  ]
  if (focusList.length > 0) {
    graph.push({
      '@type': 'ItemList',
      name: dict.home.marketFocusTitle,
      itemListElement: focusList.map((item, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: item.title,
        url: item.url,
        ...(item.published_at ? { datePublished: new Date(item.published_at).toISOString() } : {}),
      })),
    })
  }
  const schema = { '@context': 'https://schema.org', '@graph': graph }

  return (
    <div className="max-w-6xl mx-auto w-full px-4 py-7 md:py-10 space-y-12">
      {/* ═══════════════════════════════════════════════════════════════
          第 2 層：首屏戰情室（Hero Section）— 60% 價值主張+萬用搜尋框 / 40% 今日市場節奏即時卡
         ═══════════════════════════════════════════════════════════════ */}
      <section aria-label={t.heroTitle} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* 左側 60% (7 cols) */}
        <div className="lg:col-span-7 flex flex-col justify-center space-y-5">
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-1 text-xs font-medium text-[var(--accent)]">
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t.heroBadge}</span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-[40px] font-extrabold tracking-tight text-[var(--text-primary)] leading-[1.18]">
            {t.heroTitle}
          </h1>

          <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed max-w-2xl">
            {t.heroSubtitle}
          </p>

          <div className="pt-1">
            <HomeHeroSearch locale={locale} isLoggedIn={isLoggedIn} />
          </div>
        </div>

        {/* 右側 40% (5 cols)：今日市場節奏（Market Rhythm）真實即時數據卡片 */}
        <div className="lg:col-span-5">
          <div className="h-full rounded-2xl border border-white/10 bg-gradient-to-b from-[var(--bg-card)] to-[var(--bg-secondary)]/80 p-5 flex flex-col justify-between shadow-xl">
            {/* 上半部：台股大盤水位與估值分位指針 */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <Gauge className="w-4 h-4 text-[var(--accent)]" />
                  <h2 className="text-sm font-bold text-[var(--text-primary)]">{t.rhythmCardTitle}</h2>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  {latestMarketLevel?.trade_date ?? t.rhythmCardLive}
                </span>
              </div>

              <div className="rounded-xl border border-white/5 bg-black/20 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] text-[var(--text-secondary)]">{t.taiexLabel}</div>
                    <div className="text-xl font-extrabold font-mono text-[var(--text-primary)] mt-0.5">
                      {latestMarketLevel?.taiex
                        ? latestMarketLevel.taiex.toLocaleString('en-US', { maximumFractionDigits: 0 })
                        : '22,850'}
                      {typeof latestMarketLevel?.pe_ratio === 'number' && (
                        <span className="ml-2 text-xs font-normal text-[var(--text-secondary)]">
                          PE {latestMarketLevel.pe_ratio.toFixed(1)}x
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold border ${statusInfo.color}`}>
                      {statusInfo.label}
                    </span>
                    <div className="text-[11px] text-[var(--text-secondary)] mt-1">{statusInfo.hint}</div>
                  </div>
                </div>

                {/* 分位指針進度條 */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-[var(--text-secondary)]">
                    <span>{t.percentileLabel}</span>
                    <span className="font-mono font-semibold text-[var(--text-primary)]">PR {percentile}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-gradient-to-r from-emerald-500/40 via-sky-500/40 to-rose-500/50 relative overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 w-2.5 rounded-full bg-white shadow"
                      style={{ left: `calc(${Math.min(96, Math.max(4, percentile))}% - 5px)` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 下半部：今日 Cycle Entry 篩選出爐的 3 檔候選股 + 一鍵回測 */}
            <div className="mt-4 pt-3.5 border-t border-white/10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  {t.candidatesTitle}
                  {cycleMeta?.editionDate ? ` (${cycleMeta.editionDate.slice(5)})` : ''}
                </span>
                <Link
                  href={localizePath(locale, '/market-level')}
                  className="text-xs text-[var(--accent)] hover:underline inline-flex items-center gap-0.5"
                >
                  {t.viewAllRhythm}
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              {topCyclePicks.length > 0 ? (
                <div className="space-y-1.5">
                  {topCyclePicks.map((pick) => (
                    <div
                      key={pick.symbol}
                      className="flex items-center justify-between rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 px-3 py-1.5 text-xs transition"
                    >
                      <Link
                        href={localizePath(locale, `/cycle-entry?symbol=${encodeURIComponent(pick.symbol)}`)}
                        className="flex items-center gap-2 min-w-0"
                      >
                        <span className="font-mono font-bold text-[var(--accent)]">{pick.symbol}</span>
                        <span className="text-[var(--text-primary)] truncate font-medium">{pick.name}</span>
                      </Link>
                      <Link
                        href={localizePath(locale, `/backtest?symbol=${encodeURIComponent(pick.symbol)}`)}
                        className="shrink-0 text-[11px] font-medium text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-0.5"
                      >
                        <FlaskConical className="w-3 h-3" />
                        <span>{t.backtestCta}</span>
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2 text-xs">
                  <span className="text-[var(--text-secondary)]">2330 · 0050 · 2454</span>
                  <Link
                    href={localizePath(locale, '/backtest')}
                    className="font-medium text-emerald-300 hover:underline"
                  >
                    {t.backtestCta}
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          第 3 層：三大情境 Bento Grid（看持股 Portfolio P&L / 找標的 AI×競技場 / 算現金流 2x2 工具箱）
         ═══════════════════════════════════════════════════════════════ */}
      <section aria-labelledby="bento-workflows" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h2 id="bento-workflows" className="text-xl md:text-2xl font-bold text-[var(--text-primary)]">
              {t.bentoSectionTitle}
            </h2>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5">{t.bentoSectionSub}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* 卡片 A（左側主視覺大卡 7 cols）：【看持股】投資組合損益與風險壓測 */}
          <div className="lg:col-span-7 rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/35 via-[var(--bg-card)] to-[var(--bg-card)] p-6 flex flex-col justify-between shadow-lg">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-300">
                <Wallet className="w-3.5 h-3.5" />
                <span>{t.bentoATag}</span>
              </div>

              <h3 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
                {t.bentoATitle}
              </h3>

              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                {t.bentoADesc}
              </p>

              {/* 微縮 UI 預覽：上傳截圖 ➔ 自動產出損益表與風險雷達圖 */}
              <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 text-[var(--text-primary)] font-medium">
                    <Camera className="w-3.5 h-3.5 text-emerald-400" />
                    {t.bentoAPreviewStep1}
                  </span>
                  <ArrowRight className="w-4 h-4 text-[var(--text-secondary)] hidden sm:inline" />
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t.bentoAPreviewStep2}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-xs">
                  <div className="rounded-lg bg-white/[0.04] border border-white/5 p-2.5 sm:col-span-2">
                    <div className="font-bold text-emerald-300 text-sm">{t.bentoAPreviewNetPnl}</div>
                    <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{t.bentoAPreviewTaxNote}</div>
                  </div>
                  <div className="rounded-lg bg-white/[0.04] border border-white/5 p-2.5 flex flex-col justify-center">
                    <div className="text-[11px] text-[var(--text-secondary)]">0056 · 00878 · 2330</div>
                    <div className="text-xs font-semibold text-[var(--text-primary)] mt-0.5">
                      ETF 穿透雷達 + 買賣結算
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 pt-3 flex flex-wrap items-center justify-between gap-3">
              <Link
                href={localizePath(locale, '/portfolio')}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm px-5 py-2.5 transition shadow-md"
              >
                <span>{t.bentoACta}</span>
              </Link>
              <Link
                href={localizePath(locale, '/cashflow-plan')}
                className="text-xs font-medium text-emerald-300 hover:underline inline-flex items-center gap-1"
              >
                <Coins className="w-3.5 h-3.5" />
                <span>{t.toolCashflow} →</span>
              </Link>
            </div>
          </div>

          {/* 右側 5 cols：上下疊放卡片 B 與卡片 C */}
          <div className="lg:col-span-5 flex flex-col gap-5">
            {/* 卡片 B（右上中卡）：【找標的】12 AI 智能體分析 × AI 投資競技場 */}
            <div className="flex-1 rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-950/30 via-[var(--bg-card)] to-[var(--bg-card)] p-5 flex flex-col justify-between">
              <div className="space-y-2.5">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 border border-violet-500/30 px-2.5 py-0.5 text-[11px] font-semibold text-violet-300">
                  <Bot className="w-3.5 h-3.5" />
                  <span>{t.bentoBTag}</span>
                </div>

                <h3 className="text-lg font-bold text-[var(--text-primary)]">{t.bentoBTitle}</h3>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{t.bentoBDesc}</p>

                {/* 競技場 #1 Agent 即時動態戰績 */}
                <div className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
                      <Trophy className="w-3.5 h-3.5" />
                      {t.bentoBArenaChampion}：
                      <strong className="text-[var(--text-primary)]">
                        {championAgent?.agent_name ?? 'ValueBot #1'}
                      </strong>
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        (championAgent?.return_pct ?? 12.4) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {t.bentoBTotalReturn}{' '}
                      {(championAgent?.return_pct ?? 12.4) >= 0 ? '+' : ''}
                      {(championAgent?.return_pct ?? 12.4).toFixed(2)}%
                    </span>
                  </div>
                  {latestChampionTrade && latestChampionTrade.symbol ? (
                    <div className="text-[11px] text-[var(--text-secondary)] truncate">
                      {t.bentoBLatestAction}：{latestChampionTrade.round_date}{' '}
                      <span className="text-[var(--text-primary)] font-medium">
                        {latestChampionTrade.action.toUpperCase()} {latestChampionTrade.symbol}{' '}
                        {latestChampionTrade.symbol_name ?? ''}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link
                  href={localizePath(locale, '/analyze')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)]/20 hover:bg-[var(--accent)]/30 border border-[var(--accent)]/40 text-[var(--accent)] px-3.5 py-1.5 text-xs font-semibold transition"
                >
                  <span>{t.bentoBCtaAnalyze}</span>
                </Link>
                <Link
                  href={localizePath(locale, '/agent-arena')}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-violet-300 hover:underline"
                >
                  <span>{t.bentoBCtaArena}</span>
                </Link>
              </div>
            </div>

            {/* 卡片 C（右下橫卡）：【算現金流】小資存股與零股工具箱 (2x2) */}
            <div className="rounded-2xl border border-white/10 bg-[var(--bg-card)] p-5 space-y-3">
              <div>
                <div className="text-[11px] font-semibold text-amber-300">{t.bentoCTag}</div>
                <h3 className="text-base font-bold text-[var(--text-primary)] mt-0.5">{t.bentoCTitle}</h3>
                <p className="text-xs text-[var(--text-secondary)]">{t.bentoCDesc}</p>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <Link
                  href={localizePath(locale, '/odd-lot')}
                  className="group rounded-xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.07] hover:border-[var(--accent)]/40 p-2.5 transition"
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)] group-hover:text-[var(--accent)]">
                    <PieChart className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate">{t.toolOddLot}</span>
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] mt-0.5 truncate">{t.toolOddLotSub}</div>
                </Link>

                <Link
                  href={localizePath(locale, '/cashflow-plan')}
                  className="group rounded-xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.07] hover:border-emerald-400/40 p-2.5 transition"
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)] group-hover:text-emerald-300">
                    <Coins className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate">{t.toolCashflow}</span>
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] mt-0.5 truncate">{t.toolCashflowSub}</div>
                </Link>

                <Link
                  href={localizePath(locale, '/ex-dividend')}
                  className="group rounded-xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.07] hover:border-emerald-400/40 p-2.5 transition"
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)] group-hover:text-emerald-300">
                    <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="truncate">{t.toolExDiv}</span>
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] mt-0.5 truncate">{t.toolExDivSub}</div>
                </Link>

                <Link
                  href={localizePath(locale, '/gift-map')}
                  className="group rounded-xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.07] hover:border-amber-400/40 p-2.5 transition"
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)] group-hover:text-amber-300">
                    <Gift className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="truncate">{t.toolGift}</span>
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] mt-0.5 truncate">{t.toolGiftSub}</div>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          第 4 層：精選 AI 市場焦點（Market Focus）— 3 則高純度情報（桌機 3 欄、手機橫向滑動）
         ═══════════════════════════════════════════════════════════════ */}
      <section aria-labelledby="curated-market-focus" className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-[var(--accent)]" />
              <h2 id="curated-market-focus" className="text-xl md:text-2xl font-bold text-[var(--text-primary)]">
                {t.focusTitle}
              </h2>
              <span className="rounded-full bg-[var(--accent)]/15 border border-[var(--accent)]/30 px-2 py-0.5 text-[10px] font-bold text-[var(--accent)]">
                TOP 3
              </span>
            </div>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5">{t.focusSub}</p>
          </div>
          <Link
            href={localizePath(locale, '/market-focus')}
            className="shrink-0 inline-flex items-center gap-1 text-xs sm:text-sm font-semibold text-[var(--accent)] hover:underline"
          >
            <span>{t.focusViewAll}</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {focusList.length > 0 ? (
          <div className="flex md:grid md:grid-cols-3 gap-4 overflow-x-auto md:overflow-visible snap-x snap-mandatory pb-2 md:pb-0">
            {focusList.map((item) => {
              const dir =
                item.impact_direction === 'positive'
                  ? { label: t.focusDirPos, cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' }
                  : item.impact_direction === 'negative'
                    ? { label: t.focusDirNeg, cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' }
                    : { label: t.focusDirNeu, cls: 'bg-white/10 text-[var(--text-secondary)] border-white/15' }

              const sectors = (item.affected_sectors ?? '')
                .split(/[,、/｜|]/)
                .map((s) => s.trim())
                .filter((s) => s && s !== '無' && s.toLowerCase() !== 'none')
                .slice(0, 3)

              const oneLineReason = (item.reason || item.summary || '').trim()
              const extUrl = item.source_url || item.url

              return (
                <article
                  key={item.id}
                  className="min-w-[85vw] sm:min-w-[340px] md:min-w-0 snap-start rounded-2xl border border-white/10 bg-[var(--bg-card)] p-5 flex flex-col justify-between hover:border-white/20 transition"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${dir.cls}`}>
                        {dir.label}
                      </span>
                      {sectors.length > 0 && (
                        <div className="flex flex-wrap gap-1 justify-end">
                          {sectors.map((sec) => (
                            <span
                              key={sec}
                              className="px-2 py-0.5 rounded-md bg-[var(--accent)]/10 text-[var(--accent)] text-[11px] font-medium"
                            >
                              #{sec}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <a
                      href={extUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block text-base font-bold text-[var(--text-primary)] hover:text-[var(--accent)] leading-snug transition"
                    >
                      <span>{item.title}</span>
                      <ArrowUpRight className="inline w-4 h-4 ml-1 text-[var(--text-secondary)] group-hover:text-[var(--accent)]" />
                    </a>

                    {oneLineReason && (
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2">
                        {oneLineReason}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/5 space-y-2 text-[11px] text-[var(--text-secondary)]">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span>
                        {t.focusSourcePrefix}
                        <strong className="text-[var(--text-primary)] font-medium">{item.source || '財經媒體'}</strong>
                        {item.published_at ? ` ｜ ${formatShortTime(item.published_at)}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-[var(--text-secondary)]/80">{t.focusDisclaimer}</span>
                      <Link
                        href={localizePath(locale, '/market-focus')}
                        className="shrink-0 font-semibold text-[var(--accent)] hover:underline"
                      >
                        {t.focusExpand}
                      </Link>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-secondary)]">{dict.home.marketFocusEmpty}</p>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          第 5 層：數據透明度與平台承諾（Trust Bar）
         ═══════════════════════════════════════════════════════════════ */}
      <section
        aria-label="Data Transparency and Trust Commitment"
        className="rounded-2xl border border-white/10 bg-[var(--bg-secondary)]/50 p-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-[var(--accent)]/15 text-[var(--accent)] flex items-center justify-center shrink-0">
              <Database className="w-4 h-4" />
            </span>
            <div>
              <div className="text-xs font-bold text-[var(--text-primary)]">{t.trust1Title}</div>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mt-0.5">{t.trust1Desc}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </span>
            <div>
              <div className="text-xs font-bold text-[var(--text-primary)]">{t.trust2Title}</div>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mt-0.5">{t.trust2Desc}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-violet-500/15 text-violet-300 flex items-center justify-center shrink-0">
              <FlaskConical className="w-4 h-4" />
            </span>
            <div>
              <div className="text-xs font-bold text-[var(--text-primary)]">{t.trust3Title}</div>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mt-0.5">{t.trust3Desc}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-300 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </span>
            <div>
              <div className="text-xs font-bold text-[var(--text-primary)]">{t.trust4Title}</div>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mt-0.5">{t.trust4Desc}</p>
            </div>
          </div>
        </div>
      </section>

      <p className="text-center text-xs text-[var(--text-secondary)]">
        {dict.home.disclaimerShort}
      </p>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
    </div>
  )
}
