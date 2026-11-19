'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bookmark,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  CircleAlert,
  Coins,
  DollarSign,
  Edit3,
  Gauge,
  HelpCircle,
  Info,
  Layers,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react'
import type { BottomRadarDashboardData } from '@/lib/bottom-radar'
import { useI18n } from '@/i18n/LanguageProvider'
import { localizePath } from '@/i18n/paths'
import type { Locale } from '@/i18n/config'

const MARKET_COPY = {
  'zh-TW': {
    statusLabels: {
      extreme_cold: { full: '極冷（深度低估）', short: '極冷' },
      cold: { full: '偏冷（具安全邊際）', short: '偏冷' },
      fair: { full: '合理（估值中樞）', short: '合理' },
      warm: { full: '偏熱（估值偏高）', short: '偏熱' },
      overheated: { full: '過熱（歷史高位階）', short: '過熱' },
    } as Record<string, { full: string; short: string }>,
    guidelines: `1. 生存活水原則（緊急預備防線）：
   • 務必保留 6～12 個月生活必要開支之緊急預備金，絕對不可在下殺段動用作為抄底或攤平資金。
   • 僅以 1～2 年以上不影響生活的充裕閒置資金進行階梯式分批配置。

2. 階梯式分批佈局策略（拒絕單筆一次凹單）：
   • 第一批（30% 資金）：指標滿足 ≥ 3 項（中度超跌區，季線負乖離達 -5%～-7%）時啟動試單。
   • 第二批（40% 資金）：恐慌極值區（季線負乖離 ≤ -8% 且融資維持率斷頭 ≤ 130%）加碼核心部位。
   • 第三批（30% 資金）：右側轉折確認（破曉長紅吞噬站上 5MA、台幣止貶回升）後回補完畢。

3. 標的配置優先順序（防禦與反彈兼具）：
   • 第 1 順位【大盤市值型 ETF（如 0050 / 006208）】：具備最強均值回歸動能，歷史勝率最高、無個別公司倒閉風險。
   • 第 2 順位【高股息防禦型 ETF（如 0056 / 00878 / 00919）】：大跌後現金殖利率墊高，提供下檔支撐與被動現金流。
   • 警戒避開【高融資中小型投機股】：浮額斷頭踩踏未結束前，切勿過早猜底承接。`,
    syncFail: '同步失敗',
    throttledMsg: '資料已是最新（60 秒內剛同步過）',
    syncedMsg: (d: string) => `已成功同步最新大盤水位與落底指標（${d}）`,
    syncRetryMsg: '手動同步失敗，請稍後再試',
    loadFail: '載入失敗',
    fetchFail: '取得大盤水位失敗',
    errTitle: '無法取得大盤水位資料',
    retryBtn: '重新整理',
    metricPe: '大盤本益比 (P/E)',
    metricPb: '大盤股價淨值比 (P/B)',
    pageTitle: '大盤水位儀表板',
    pageBadge: '加權指數估值位階',
    pageSubtitle: '以 TWSE 官方每日 PER、PBR 與殖利率，計算 5 年滾動歷史分位與常態分布帶',
    tradeDateLabel: '數據基準交易日',
    refreshTitle: '立即同步最新加權指數與估值位階數據',
    refreshing: '同步中...',
    refreshBtn: '手動更新',
    currentSignalBadge: '當前水位燈號',
    windowNote: '5 年歷史窗口綜合評價',
    compositePercentileTitle: '綜合歷史分位數',
    percentileUnit: '分位',
    nowAt: (p: number) => `目前 ${p}%`,
    scale0: '0% 極冷',
    scale20: '20% 偏冷',
    scale40: '40% 合理',
    scale60: '60% 偏熱',
    scale80: '80% 過熱',
    scaleTitles: ['極冷 (<20%)', '偏冷 (20-40%)', '合理 (40-60%)', '偏熱 (60-80%)', '過熱 (>80%)'],
    dailyCommentary: '今日大盤解讀：',
    kpiTaiex: '加權指數點位 (TAIEX)',
    kpiTaiexSub: '台股大盤最新收盤',
    kpiPe: '大盤本益比 (P/E)',
    kpiPb: '股價淨值比 (P/B)',
    kpiYield: '市場平均殖利率',
    kpiYieldSub: '全市場現金股利水準',
    histPercentile: '歷史分位：',
    radarTitle: '大盤落底訊號雷達 ＆ 抄底 SOP',
    radarBadge: '四大指標共振',
    radarDesc: '核心不在於猜測指數跌到幾點，而在於觀察「籌碼去槓桿、季線負乖離、量價換手、外資期權」四大客觀訊號是否共振衰竭',
    radarMechanism: '抄底判定機制',
    radarThreshold: '滿足 ≥ 3 項視為安全買點',
    metCountLabel: '目前達成條件：',
    cond1Title: '籌碼去槓桿：',
    cond1Desc: '融資維持率 ≤ 135% 或 單日融資大減 ≥ 50 億',
    cond1Sub: '當前融資增減：',
    billionUnit: '億元',
    billionShort: '億',
    maintRatio: (r: number | string) => ` · 維持率約 ${r}%`,
    cond2Title: '季線負乖離：',
    cond2Desc: '0050 或加權指數之 60MA 季線負乖離 ≤ -5%',
    cond2Taiex: '加權負乖離：',
    cond2Etf: '0050 負乖離：',
    cond3Title: '量價型態：',
    cond3Desc: '爆量長下影線（打樁）、量縮窒息底或破曉吞噬',
    cond3Current: '當前型態：',
    cond4Title: '期權避險：',
    cond4Desc: '外資台指期淨空單顯著回補（單日 ≥ 5000 口或水位 < 2.5 萬口）',
    cond4Sub: '外資淨空單：',
    contractsUnit: '口',
    singleDayPrefix: '單日 ',
    cond5Title: '匯率動向：',
    cond5Desc: '新台幣匯率停止貶值（USD/TWD 由貶轉升，外資資金停止提款）',
    cond5Sub: '最新匯率：',
    fxStable: '● 台幣止貶回升',
    fxWeak: '● 台幣仍處貶值整理',
    card1Title: '一、籌碼去槓桿與融資維持率',
    card1Balance: '大盤融資餘額',
    card1Change: '單日融資增減',
    card1Maint: '大盤估計維持率',
    card2Title: '二、60 日季線負乖離率 (BIAS60)',
    card2Trig: '中度超跌／恐慌極值',
    card2Normal: '常態技術回檔',
    card2Taiex: '加權指數負乖離',
    card2Etf: '0050 季線負乖離',
    card2Ma60: '季線：',
    card2Note: '區間 1：0% ~ -3%（常態定期定額）· 區間 2：-5% ~ -7%（階梯試單 30%）· 區間 3：≤ -8%（恐慌甜蜜擊球區）',
    card3Title: '三、量價換手與 K 線型態',
    card3Trig: '已出現轉折型態',
    card3None: '尚未出現型態',
    card3HammerLabel: '爆量長下影線（打樁線）：',
    card3HammerYes: '✓ 滿足（融資斷頭被全數吸收）',
    card3DryingLabel: '量縮窒息底（跌無可跌）：',
    card3DryingYes: '✓ 滿足（量縮至 60% 且 3 日不破低）',
    card3DawnLabel: '破曉長紅吞噬（右側確認）：',
    card3DawnYes: '✓ 滿足（紅 K 吞噬前高並站上 5MA）',
    notAppeared: '未出現',
    card4Title: '四、外資期權避險與新台幣匯率',
    card4Trig: '期權空單回補',
    card4Pressure: '空單壓力仍重',
    card4Oi: '外資台指期淨空單',
    card4Daily: '單日：',
    card4Fx: '美元兌新台幣 (USD/TWD)',
    card4FxStable: '止貶由貶轉升',
    card4FxWeak: '仍處貶值趨勢',
    card4Note: '外資期貨淨空單若大於 3.5 萬口摜壓沉重；當單日大幅回補 ≥ 5,000 口或台幣領先止貶，代表熱錢避險賣壓退潮。',
    tierTitle: '0050 動態階梯掛單價試算',
    tierMa60: '當前 0050 季線 (MA60)：',
    tier2Label: '區間 2 試單價 (-5%)',
    tier2Sub: '中度超跌 · 第一筆投入 30% 資金',
    tier3Label: '區間 3 甜美價 (-8%)',
    tier3Sub: '恐慌極值 · 最佳風險報酬擊球區',
    twdUnit: '元',
    notesTitle: '大盤落底抄底資金紀律與操作建議',
    notesSaved: '✓ 已儲存備忘',
    notesReset: '恢復通用建議',
    notesSave: '儲存自訂',
    notesEdit: '自訂備忘',
    notesEditTitle: '自訂個人專屬資金紀律筆記',
    notesPlaceholder: '請輸入您的大盤落底抄底資金紀律提醒...',
    notesWarning: '核心心法提醒：融資斷頭潮徹底釋放前勿躁進，生存活水備用金絕對不可在下殺段當作攤平籌碼。',
    dcaPrompt: '想知道大盤拉回時，定期定額搭配逢低加碼能幫你多累積多少資產？',
    dcaCta: '🎯 ETF 智慧加碼雙軌試算',
    riverTitle: '5 年河流圖帶狀分析',
    riverSub: '以歷史均線（Mean）與標準差（±1σ、±2σ）劃分估值常態分佈',
    tabPe: '本益比 (P/E)',
    tabPb: '淨值比 (P/B)',
    sigmaP2: '+2σ（極高估）',
    sigmaP1: '+1σ（偏高估）',
    sigmaMean: 'Mean（5年均線）',
    sigmaM1: '-1σ（偏低估）',
    sigmaM2: '-2σ（極低估）',
    currentLevelPos: (m: string) => `當前 ${m} 位階：`,
    percentileParen: (p: number | null) => `（第 ${p}% 分位）`,
    historyTitle: '歷史交易日水位明細',
    historyRecent: '顯示最近 10 筆交易日',
    colDate: '交易日期',
    colTaiex: '加權指數',
    colPe: '本益比 (P/E)',
    colPb: '淨值比 (P/B)',
    colComp: '綜合分位',
    colBadge: '水位燈號',
    complianceTitle: '合規警語與免責聲明',
  },
  en: {
    statusLabels: {
      extreme_cold: { full: 'Extreme Cold (Deeply Undervalued)', short: 'Extreme Cold' },
      cold: { full: 'Cool (Margin of Safety)', short: 'Cool' },
      fair: { full: 'Fair (Valuation Mean)', short: 'Fair' },
      warm: { full: 'Warm (Elevated)', short: 'Warm' },
      overheated: { full: 'Overheated (Historical High)', short: 'Overheated' },
    } as Record<string, { full: string; short: string }>,
    guidelines: `1. Emergency Liquidity Rule (Survival Buffer):
   • Keep 6–12 months of essential living expenses untouched. Never deploy emergency reserves for dip-buying or averaging down.
   • Deploy only idle capital not needed for 1–2+ years in staged tranches.

2. Staged Tranche Entry (No All-In Guessing):
   • Tranche 1 (30%): Trigger starter buy when ≥ 3 bottom signals are met (60MA bias -5% to -7%).
   • Tranche 2 (40%): Add core exposure in panic zone (60MA bias ≤ -8% & margin maintenance ratio ≤ 130%).
   • Tranche 3 (30%): Complete allocation on right-side confirmation (bullish engulfing reclaiming 5MA + TWD stabilization).

3. Asset Allocation Priority:
   • Priority 1 [Broad Market ETFs e.g. 0050 / 006208]: Strongest mean-reversion and zero single-stock bankruptcy risk.
   • Priority 2 [High-Dividend ETFs e.g. 0056 / 00878 / 00919]: Higher cash yield after drawdowns provides downside cushion.
   • Avoid [High-Margin Speculative Small Caps]: Wait until forced margin liquidations finish clearing.`,
    syncFail: 'Sync failed',
    throttledMsg: 'Data is already up to date (synced within 60s)',
    syncedMsg: (d: string) => `Synced latest market valuation & bottom radar (${d})`,
    syncRetryMsg: 'Manual sync failed, please try again later',
    loadFail: 'Failed to load',
    fetchFail: 'Failed to fetch market level',
    errTitle: 'Unable to Load Market Valuation Data',
    retryBtn: 'Retry',
    metricPe: 'Market P/E',
    metricPb: 'Market P/B',
    pageTitle: 'Market Valuation Dashboard',
    pageBadge: 'TAIEX Valuation Regime',
    pageSubtitle: 'Computes 5-year rolling historical percentiles & normal-distribution bands from official TWSE PER, PBR & dividend yield',
    tradeDateLabel: 'Trade Date',
    refreshTitle: 'Sync latest TAIEX valuation & regime data',
    refreshing: 'Syncing...',
    refreshBtn: 'Sync Now',
    currentSignalBadge: 'Current Regime Signal',
    windowNote: '5-Year Rolling Composite Assessment',
    compositePercentileTitle: 'Composite Percentile',
    percentileUnit: 'pct',
    nowAt: (p: number) => `Now ${p}%`,
    scale0: '0% Extreme Cold',
    scale20: '20% Cool',
    scale40: '40% Fair',
    scale60: '60% Warm',
    scale80: '80% Overheated',
    scaleTitles: ['Extreme Cold (<20%)', 'Cool (20-40%)', 'Fair (40-60%)', 'Warm (60-80%)', 'Overheated (>80%)'],
    dailyCommentary: 'Daily Commentary:',
    kpiTaiex: 'TAIEX Index',
    kpiTaiexSub: 'Latest TWSE Close',
    kpiPe: 'Market P/E Ratio',
    kpiPb: 'Market P/B Ratio',
    kpiYield: 'Avg. Dividend Yield',
    kpiYieldSub: 'Market-wide Cash Yield',
    histPercentile: 'Percentile:',
    radarTitle: 'Market Bottom Radar & Dip-Buying SOP',
    radarBadge: '4-Factor Confluence',
    radarDesc: 'Instead of guessing an index target, monitor whether margin deleveraging, 60MA negative bias, volume-price capitulation, and foreign futures/FX show joint exhaustion.',
    radarMechanism: 'Trigger Rule',
    radarThreshold: '≥ 3 criteria met = Safe Buy Zone',
    metCountLabel: 'Criteria Met:',
    cond1Title: 'Deleveraging:',
    cond1Desc: 'Margin maintenance ratio ≤ 135% or 1-day margin drop ≥ NT$5B',
    cond1Sub: '1D Margin Change:',
    billionUnit: 'B NT$',
    billionShort: 'B',
    maintRatio: (r: number | string) => ` · Est. Maint ${r}%`,
    cond2Title: '60MA Negative Bias:',
    cond2Desc: '0050 or TAIEX 60MA bias ≤ -5%',
    cond2Taiex: 'TAIEX Bias:',
    cond2Etf: '0050 Bias:',
    cond3Title: 'Price & Volume:',
    cond3Desc: 'Capitulation hammer, dried-up base, or bullish engulfing',
    cond3Current: 'Current Pattern:',
    cond4Title: 'Futures Hedging:',
    cond4Desc: 'Foreign TX net shorts cover significantly (≥ 5,000 contracts/d or OI < 25k)',
    cond4Sub: 'Foreign Net Shorts:',
    contractsUnit: 'cts',
    singleDayPrefix: '1D ',
    cond5Title: 'FX Momentum:',
    cond5Desc: 'TWD stops depreciating (USD/TWD turns down, foreign outflow pauses)',
    cond5Sub: 'Latest FX:',
    fxStable: '● TWD Stabilizing',
    fxWeak: '● TWD Still Weakening',
    card1Title: '1. Margin Deleveraging & Maintenance Ratio',
    card1Balance: 'Margin Balance',
    card1Change: '1D Change',
    card1Maint: 'Est. Maint Ratio',
    card2Title: '2. 60-Day MA Negative Bias (BIAS60)',
    card2Trig: 'Oversold / Panic Zone',
    card2Normal: 'Normal Pullback',
    card2Taiex: 'TAIEX 60MA Bias',
    card2Etf: '0050 60MA Bias',
    card2Ma60: '60MA:',
    card2Note: 'Zone 1: 0% to -3% (Regular DCA) · Zone 2: -5% to -7% (30% Starter Buy) · Zone 3: ≤ -8% (Panic Sweet Spot)',
    card3Title: '3. Volume & Candlestick Patterns',
    card3Trig: 'Reversal Detected',
    card3None: 'No Pattern Yet',
    card3HammerLabel: 'High-Vol Lower Shadow:',
    card3HammerYes: '✓ Met (Forced selling absorbed)',
    card3DryingLabel: 'Volume-Dry Base:',
    card3DryingYes: '✓ Met (Vol < 60% & 3d higher low)',
    card3DawnLabel: 'Bullish Engulfing (>5MA):',
    card3DawnYes: '✓ Met (Right-side confirmation)',
    notAppeared: 'Not met',
    card4Title: '4. Foreign TX Hedging & USD/TWD',
    card4Trig: 'Short Covering',
    card4Pressure: 'Heavy Short Pressure',
    card4Oi: 'Foreign TX Net OI',
    card4Daily: '1D:',
    card4Fx: 'USD / TWD Rate',
    card4FxStable: 'Stabilizing / Rebounding',
    card4FxWeak: 'Depreciation Trend',
    card4Note: 'Net shorts > 35k indicate heavy hedging pressure; 1D covering ≥ 5,000 contracts or TWD stabilizing signals easing outflow.',
    tierTitle: '0050 Staged Limit-Order Estimator',
    tierMa60: 'Current 0050 60MA:',
    tier2Label: 'Zone 2 Starter (-5%)',
    tier2Sub: 'Moderate oversold · Deploy 30%',
    tier3Label: 'Zone 3 Sweet Spot (-8%)',
    tier3Sub: 'Panic extreme · Optimal R/R zone',
    twdUnit: 'NT$',
    notesTitle: 'Capital Discipline & Dip-Buying Playbook',
    notesSaved: '✓ Saved',
    notesReset: 'Reset Default',
    notesSave: 'Save Notes',
    notesEdit: 'Edit Notes',
    notesEditTitle: 'Customize personal dip-buying playbook',
    notesPlaceholder: 'Enter your personal dip-buying rules & reminders...',
    notesWarning: 'Core Rule: Avoid rushing in before forced margin selling clears; never tap your emergency reserve during drawdowns.',
    dcaPrompt: 'Want to see how much extra wealth dip-weighted DCA builds during pullbacks?',
    dcaCta: '🎯 Smart Dip-DCA Dual Simulator',
    riverTitle: '5-Year River Band Valuation',
    riverSub: 'Splits valuation history by 5-year Mean and standard deviations (±1σ, ±2σ)',
    tabPe: 'P/E Ratio',
    tabPb: 'P/B Ratio',
    sigmaP2: '+2σ (Extreme High)',
    sigmaP1: '+1σ (Elevated)',
    sigmaMean: 'Mean (5Y Avg)',
    sigmaM1: '-1σ (Undervalued)',
    sigmaM2: '-2σ (Deep Value)',
    currentLevelPos: (m: string) => `Current ${m} Level:`,
    percentileParen: (p: number | null) => `(${p}th pct)`,
    historyTitle: 'Recent Trading Day Valuation History',
    historyRecent: 'Latest 10 trading days',
    colDate: 'Date',
    colTaiex: 'TAIEX',
    colPe: 'P/E',
    colPb: 'P/B',
    colComp: 'Composite Pct',
    colBadge: 'Signal',
    complianceTitle: 'Compliance & Disclaimer',
  },
  ja: {
    statusLabels: {
      extreme_cold: { full: '極冷（大幅割安）', short: '極冷' },
      cold: { full: 'やや割安（安全域あり）', short: 'やや割安' },
      fair: { full: '適正（バリュエーション中立）', short: '適正' },
      warm: { full: 'やや過熱（割高圏）', short: 'やや過熱' },
      overheated: { full: '過熱（歴史的高水準）', short: '過熱' },
    } as Record<string, { full: string; short: string }>,
    guidelines: `1. 生活防衛資金の原則（絶対防衛ライン）：
   • 6〜12ヶ月分の生活費は必ず緊急予備資金として確保し、急落時の押し目買い・ナンピンには絶対に使用しないこと。
   • 今後1〜2年以上使う予定のない余裕資金のみを段階的に投入する。

2. 段階的分批エントリー戦略（一括全力買いの禁止）：
   • 第1弾（資金30%）：底打ち指標が 3項目以上点灯（60日線乖離 -5%〜-7%）で打診買い。
   • 第2弾（資金40%）：パニック極値圏（60日線乖離 ≤ -8% かつ信用維持率 ≤ 130%）でコアポジション積み増し。
   • 第3弾（資金30%）：右肩転換確認後（陽線包み足で5MA上抜け・台湾ドル安一服）に残りを投入。

3. 銘柄選定の優先順位：
   • 第1優先【市場インデックス ETF（0050 / 006208 等）】：平均回帰力が最も強く、個別倒産リスクなし。
   • 第2優先【高配当ディフェンシブ ETF（0056 / 00878 / 00919 等）】：下落後の配当利回り上昇が下値支持となる。
   • 回避対象【信用買い残の重い中小型テーマ株】：追証投げ売りが一巡するまで安易な逆張りは厳禁。`,
    syncFail: '同期に失敗しました',
    throttledMsg: 'データは最新です（60秒以内に同期済み）',
    syncedMsg: (d: string) => `最新の相場水準と底打ちレーダーを同期しました（${d}）`,
    syncRetryMsg: '手動同期に失敗しました。しばらくしてから再試行してください',
    loadFail: '読み込みに失敗しました',
    fetchFail: '相場水準データの取得に失敗しました',
    errTitle: '相場水準データを取得できません',
    retryBtn: '再読み込み',
    metricPe: '市場 PER',
    metricPb: '市場 PBR',
    pageTitle: '相場水準ダッシュボード',
    pageBadge: 'TWSE 加権指数バリュエーション',
    pageSubtitle: 'TWSE 公式の日次 PER・PBR・配当利回りから 5年ローリング歴史分位と正規分布バンドを算出',
    tradeDateLabel: '基準営業日',
    refreshTitle: '最新の加権指数とバリュエーションデータを同期',
    refreshing: '同期中...',
    refreshBtn: '手動更新',
    currentSignalBadge: '現在の水準シグナル',
    windowNote: '5年ヒストリカル総合評価',
    compositePercentileTitle: '総合ヒストリカル分位',
    percentileUnit: '分位',
    nowAt: (p: number) => `現在 ${p}%`,
    scale0: '0% 極冷',
    scale20: '20% やや割安',
    scale40: '40% 適正',
    scale60: '60% やや過熱',
    scale80: '80% 過熱',
    scaleTitles: ['極冷 (<20%)', 'やや割安 (20-40%)', '適正 (40-60%)', 'やや過熱 (60-80%)', '過熱 (>80%)'],
    dailyCommentary: '本日の相場解説：',
    kpiTaiex: '加権指数 (TAIEX)',
    kpiTaiexSub: '台湾市場 最新終値',
    kpiPe: '市場 PER',
    kpiPb: '市場 PBR',
    kpiYield: '市場平均配当利回り',
    kpiYieldSub: '市場全体の現金配当水準',
    histPercentile: '歴史分位：',
    radarTitle: '大底シグナルレーダー ＆ 押し目買い SOP',
    radarBadge: '4大指標共鳴',
    radarDesc: '指数の底値を当てるのではなく、「信用整理・60日線乖離・出来高転換・外資先物/為替」の4つの客観的シグナルが同時に極値へ達するかを監視します。',
    radarMechanism: '買い場判定ルール',
    radarThreshold: '3項目以上の点灯で安全買付圏',
    metCountLabel: '現在の達成条件：',
    cond1Title: '信用レバレッジ解消：',
    cond1Desc: '信用維持率 ≤ 135% または 1日の信用買い残減少 ≥ 50億NT$',
    cond1Sub: '直近信用残増減：',
    billionUnit: '億NT$',
    billionShort: '億',
    maintRatio: (r: number | string) => ` · 推定維持率 約${r}%`,
    cond2Title: '60日線マイナス乖離：',
    cond2Desc: '0050 または加権指数の 60MA 乖離率 ≤ -5%',
    cond2Taiex: '加権乖離：',
    cond2Etf: '0050 乖離：',
    cond3Title: '出来高・ローソク足：',
    cond3Desc: '大商いの長い下ヒゲ・出来高枯渇底・陽線包み足',
    cond3Current: '現在の形状：',
    cond4Title: '先物ヘッジ動向：',
    cond4Desc: '外資の台指先物ネット売り越しの大幅買戻し（日次 ≥ 5,000枚 または残高 < 2.5万枚）',
    cond4Sub: '外資ネット売り残：',
    contractsUnit: '枚',
    singleDayPrefix: '日次 ',
    cond5Title: '為替トレンド：',
    cond5Desc: '台湾ドル安の停止（USD/TWD が反転し、外資の資金流出が一服）',
    cond5Sub: '最新為替：',
    fxStable: '● TWD 安一服・反発',
    fxWeak: '● TWD 軟調推移継続',
    card1Title: '1. 信用取引整理と信用維持率',
    card1Balance: '市場信用買い残',
    card1Change: '日次増減',
    card1Maint: '推定維持率',
    card2Title: '2. 60日移動平均線乖離率 (BIAS60)',
    card2Trig: '売られ過ぎ／パニック圏',
    card2Normal: '通常の調整範囲',
    card2Taiex: '加権指数 60MA乖離',
    card2Etf: '0050 60MA乖離',
    card2Ma60: '60MA：',
    card2Note: '帯域1：0%〜-3%（通常積立）· 帯域2：-5%〜-7%（第1弾30%投入）· 帯域3：≤ -8%（パニック好機圏）',
    card3Title: '3. 出来高転換とチャート形状',
    card3Trig: '転換シグナル点灯',
    card3None: 'シグナル未点灯',
    card3HammerLabel: '大商い下ヒゲ（セリクラ）：',
    card3HammerYes: '✓ 条件達成（投げ売りを吸収）',
    card3DryingLabel: '出来高枯渇底：',
    card3DryingYes: '✓ 条件達成（60%以下縮小・3日安値更新せず）',
    card3DawnLabel: '大陽線包み足（5MA上抜け）：',
    card3DawnYes: '✓ 条件達成（右肩転換確認）',
    notAppeared: '未出現',
    card4Title: '4. 外資先物ヘッジと USD/TWD 為替',
    card4Trig: '先物買戻し進行',
    card4Pressure: '売り圧力継続中',
    card4Oi: '外資先物ネット売り残',
    card4Daily: '日次：',
    card4Fx: '米ドル／台湾ドル (USD/TWD)',
    card4FxStable: 'ドル安台湾ドル高へ転換',
    card4FxWeak: '台湾ドル安トレンド継続',
    card4Note: '外資のネット売り残が3.5万枚超では下押し圧力が強く、日次5,000枚以上の買戻しや為替安定が資金流出一服のサインです。',
    tierTitle: '0050 段階指値ターゲット試算',
    tierMa60: '現在の 0050 60MA：',
    tier2Label: '帯域 2 打診指値 (-5%)',
    tier2Sub: 'やや売られ過ぎ · 資金 30% 投入',
    tier3Label: '帯域 3 好機指値 (-8%)',
    tier3Sub: 'パニック極値 · 最良リスクリワード圏',
    twdUnit: 'NT$',
    notesTitle: '資金管理規律・押し目買いメモ',
    notesSaved: '✓ 保存しました',
    notesReset: '標準ガイドに戻す',
    notesSave: '保存',
    notesEdit: 'メモを編集',
    notesEditTitle: '独自の資金管理ルールを編集',
    notesPlaceholder: 'ご自身の押し目買いルールや資金管理メモを入力してください...',
    notesWarning: '重要原則：信用投げ売りが完全に一巡する前のフライング買いは控え、生活防衛資金は絶対に投入しないでください。',
    dcaPrompt: '下落時に積立＋スマート増額を組み合わせると資産差がどう変わるか検証しますか？',
    dcaCta: '🎯 ETF スマート増額デュアル試算へ',
    riverTitle: '5年リバーバンド・バリュエーション分析',
    riverSub: '5年平均（Mean）と標準偏差（±1σ、±2σ）で割安・割高水準を可視化',
    tabPe: 'PER（株価収益率）',
    tabPb: 'PBR（株価純資産倍率）',
    sigmaP2: '+2σ（極度割高）',
    sigmaP1: '+1σ（やや割高）',
    sigmaMean: 'Mean（5年平均）',
    sigmaM1: '-1σ（やや割安）',
    sigmaM2: '-2σ（極度割安）',
    currentLevelPos: (m: string) => `現在の ${m} 水準：`,
    percentileParen: (p: number | null) => `（第 ${p}% 分位）`,
    historyTitle: '直近営業日の水準履歴明細',
    historyRecent: '直近 10 営業日を表示',
    colDate: '営業日',
    colTaiex: '加権指数',
    colPe: 'PER',
    colPb: 'PBR',
    colComp: '総合分位',
    colBadge: 'シグナル',
    complianceTitle: 'コンプライアンス・免責事項',
  },
} as const

interface MarketLevelBand {
  mean: number
  plus1Sigma: number
  plus2Sigma: number
  minus1Sigma: number
  minus2Sigma: number
}

interface MarketLevelAnalysis {
  tradeDate: string
  taiex: number | null
  peRatio: number | null
  pbRatio: number | null
  dividendYield: number | null
  pePercentile: number | null
  pbPercentile: number | null
  compositePercentile: number | null
  levelStatus: 'extreme_cold' | 'cold' | 'fair' | 'warm' | 'overheated'
  statusLabel: string
  statusDescription: string
  peBand: MarketLevelBand
  pbBand: MarketLevelBand
}

interface MarketLevelRow {
  trade_date: string
  taiex: number | null
  pe_ratio: number | null
  pb_ratio: number | null
  dividend_yield: number | null
  pe_percentile: number | null
  pb_percentile: number | null
  composite_percentile: number | null
  level_status: string | null
}

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; badge: string; textClass: string; bgClass: string; borderClass: string }
> = {
  extreme_cold: {
    label: '極冷（深度低估）',
    color: '#3b82f6',
    badge: 'bg-blue-500 text-white',
    textClass: 'text-blue-400',
    bgClass: 'bg-blue-500/10',
    borderClass: 'border-blue-500/30',
  },
  cold: {
    label: '偏冷（具安全邊際）',
    color: '#06b6d4',
    badge: 'bg-cyan-500 text-white',
    textClass: 'text-cyan-400',
    bgClass: 'bg-cyan-500/10',
    borderClass: 'border-cyan-500/30',
  },
  fair: {
    label: '合理（估值中樞）',
    color: '#10b981',
    badge: 'bg-emerald-500 text-white',
    textClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/30',
  },
  warm: {
    label: '偏熱（估值偏高）',
    color: '#f59e0b',
    badge: 'bg-amber-500 text-white',
    textClass: 'text-amber-400',
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/30',
  },
  overheated: {
    label: '過熱（歷史高位階）',
    color: '#ef4444',
    badge: 'bg-red-500 text-white',
    textClass: 'text-red-400',
    bgClass: 'bg-red-500/10',
    borderClass: 'border-red-500/30',
  },
}

const DEFAULT_BOTTOM_BUYING_GUIDELINES = `1. 生存活水原則（緊急預備防線）：
   • 務必保留 6～12 個月生活必要開支之緊急預備金，絕對不可在下殺段動用作為抄底或攤平資金。
   • 僅以 1～2 年以上不影響生活的充裕閒置資金進行階梯式分批配置。

2. 階梯式分批佈局策略（拒絕單筆一次凹單）：
   • 第一批（30% 資金）：指標滿足 ≥ 3 項（中度超跌區，季線負乖離達 -5%～-7%）時啟動試單。
   • 第二批（40% 資金）：恐慌極值區（季線負乖離 ≤ -8% 且融資維持率斷頭 ≤ 130%）加碼核心部位。
   • 第三批（30% 資金）：右側轉折確認（破曉長紅吞噬站上 5MA、台幣止貶回升）後回補完畢。

3. 標的配置優先順序（防禦與反彈兼具）：
   • 第 1 順位【大盤市值型 ETF（如 0050 / 006208）】：具備最強均值回歸動能，歷史勝率最高、無個別公司倒閉風險。
   • 第 2 順位【高股息防禦型 ETF（如 0056 / 00878 / 00919）】：大跌後現金殖利率墊高，提供下檔支撐與被動現金流。
   • 警戒避開【高融資中小型投機股】：浮額斷頭踩踏未結束前，切勿過早猜底承接。`

export default function MarketLevelPage() {
  const { locale } = useI18n()
  const copy = MARKET_COPY[locale]
  const [data, setData] = useState<{
    current: MarketLevelAnalysis
    history: MarketLevelRow[]
    bottomRadar?: BottomRadarDashboardData | null
    disclaimer: string
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'pe' | 'pb'>('pe')

  // 大盤落底抄底資金紀律與操作建議（支援自訂備忘錄）
  const [personalNotes, setPersonalNotes] = useState<string>(copy.guidelines)
  const [hasCustomNotes, setHasCustomNotes] = useState(false)
  const [isEditingNotes, setIsEditingNotes] = useState(false)
  const [savedNotesAlert, setSavedNotesAlert] = useState(false)

  // 手動更新按鈕狀態
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null)

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const res = await fetch('/api/market-level/refresh', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || copy.syncFail)
      }
      if (json.current) {
        setData({
          current: json.current,
          history: json.history ?? data?.history ?? [],
          bottomRadar: json.bottomRadar ?? data?.bottomRadar,
          disclaimer: json.disclaimer ?? data?.disclaimer ?? '',
        })
      }
      if (json.throttled) {
        setRefreshMsg({
          type: 'info',
          text: json.message || copy.throttledMsg,
        })
      } else {
        setRefreshMsg({
          type: 'success',
          text: json.message || copy.syncedMsg(json.today || ''),
        })
      }
      setTimeout(() => setRefreshMsg(null), 4000)
    } catch (e: unknown) {
      setRefreshMsg({
        type: 'error',
        text: e instanceof Error ? e.message : copy.syncRetryMsg,
      })
      setTimeout(() => setRefreshMsg(null), 5000)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem('vestential_capital_notes')
      // 自動升級：若本機儲存為舊版特定個人備忘，自動採用通用建議指南
      if (saved && !saved.includes('115 萬') && !saved.includes('星宇')) {
        setPersonalNotes(saved)
        setHasCustomNotes(true)
      } else {
        setPersonalNotes(copy.guidelines)
        setHasCustomNotes(false)
      }
    } catch (_) {}
  }, [copy.guidelines])

  useEffect(() => {
    if (!hasCustomNotes && !isEditingNotes) {
      setPersonalNotes(copy.guidelines)
    }
  }, [copy.guidelines, hasCustomNotes, isEditingNotes])

  const saveNotes = () => {
    try {
      localStorage.setItem('vestential_capital_notes', personalNotes)
      setHasCustomNotes(true)
      setIsEditingNotes(false)
      setSavedNotesAlert(true)
      setTimeout(() => setSavedNotesAlert(false), 2500)
    } catch (_) {}
  }

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/market-level')
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || copy.loadFail)
      setData(json)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : copy.fetchFail)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
        <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
          <div className="h-8 bg-slate-800 rounded w-48"></div>
          <div className="h-44 bg-slate-850 rounded-2xl border border-slate-800"></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="h-24 bg-slate-850 rounded-xl"></div>
            <div className="h-24 bg-slate-850 rounded-xl"></div>
            <div className="h-24 bg-slate-850 rounded-xl"></div>
            <div className="h-24 bg-slate-850 rounded-xl"></div>
          </div>
        </div>
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 flex items-center justify-center">
        <div className="bg-slate-900 border border-red-500/30 p-6 rounded-2xl max-w-md w-full text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto" />
          <h2 className="text-xl font-bold">{copy.errTitle}</h2>
          <p className="text-sm text-slate-400">{error}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition"
          >
            {copy.retryBtn}
          </button>
        </div>
      </main>
    )
  }

  const { current, history, disclaimer } = data
  const statusCfg = STATUS_CONFIG[current.levelStatus] || STATUS_CONFIG.fair
  const statusText = copy.statusLabels[current.levelStatus] || copy.statusLabels.fair
  const compositePercentile = current.compositePercentile ?? 50

  // 繪製河流帶狀圖數據
  const isPe = activeTab === 'pe'
  const activeBand = isPe ? current.peBand : current.pbBand
  const activeValue = isPe ? current.peRatio : current.pbRatio
  const activePercentile = isPe ? current.pePercentile : current.pbPercentile
  const metricName = isPe ? copy.metricPe : copy.metricPb

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 頂部標題 */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 pb-2 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <Gauge className="w-6 h-6 text-indigo-400" />
              <h1 className="text-2xl font-bold text-white tracking-tight">{copy.pageTitle}</h1>
              <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                {copy.pageBadge}
              </span>
            </div>
            <p className="text-xs md:text-sm text-slate-400 mt-1">
              {copy.pageSubtitle}
            </p>
          </div>
          <div className="flex items-center gap-3 self-start md:self-auto">
            <div className="text-left md:text-right">
              <span className="text-xs text-slate-400 block">{copy.tradeDateLabel}</span>
              <div className="text-sm font-semibold text-slate-200 font-mono">{current.tradeDate}</div>
            </div>

            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              title={copy.refreshTitle}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer select-none ${
                refreshing
                  ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40 animate-pulse cursor-wait'
                  : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/20 hover:text-indigo-200 hover:border-indigo-500/50 shadow-sm'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? copy.refreshing : copy.refreshBtn}</span>
            </button>
          </div>
        </div>

        {refreshMsg && (
          <div
            className={`text-xs px-4 py-2.5 rounded-xl border flex items-center justify-between transition-all animate-in fade-in slide-in-from-top-1 ${
              refreshMsg.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : refreshMsg.type === 'info'
                  ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                  : 'bg-red-500/10 text-red-300 border-red-500/30'
            }`}
          >
            <div className="flex items-center gap-2">
              {refreshMsg.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />}
              {refreshMsg.type === 'info' && <Info className="w-4 h-4 shrink-0 text-cyan-400" />}
              {refreshMsg.type === 'error' && <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />}
              <span>{refreshMsg.text}</span>
            </div>
            <button
              onClick={() => setRefreshMsg(null)}
              className="text-slate-400 hover:text-white text-xs ml-3 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* 核心卡片 1：水位燈號總覽（手機一屏優先） */}
        <div className={`p-6 rounded-2xl border ${statusCfg.bgClass} ${statusCfg.borderClass} relative overflow-hidden backdrop-blur-sm`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${statusCfg.badge}`}>
                  {copy.currentSignalBadge}
                </span>
                <span className="text-xs text-slate-400">{copy.windowNote}</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-extrabold text-white mt-2 flex items-center gap-3">
                {statusText.full}
              </h2>
            </div>
            <div className="md:text-right">
              <div className="text-xs text-slate-400">{copy.compositePercentileTitle}</div>
              <div className="text-3xl md:text-4xl font-black tracking-tight text-white mt-1">
                {compositePercentile}%
                <span className="text-sm font-normal text-slate-400 ml-1">{copy.percentileUnit}</span>
              </div>
            </div>
          </div>

          {/* 5 段視覺化進度指針條 */}
          <div className="mt-6 space-y-2">
            <div className="relative h-3 w-full bg-slate-900 rounded-full overflow-hidden flex">
              <div className="h-full w-1/5 bg-blue-500/80" title={copy.scaleTitles[0]}></div>
              <div className="h-full w-1/5 bg-cyan-500/80" title={copy.scaleTitles[1]}></div>
              <div className="h-full w-1/5 bg-emerald-500/80" title={copy.scaleTitles[2]}></div>
              <div className="h-full w-1/5 bg-amber-500/80" title={copy.scaleTitles[3]}></div>
              <div className="h-full w-1/5 bg-red-500/80" title={copy.scaleTitles[4]}></div>
            </div>

            {/* 指針位置標示 */}
            <div className="relative h-4 w-full">
              <div
                className="absolute -top-1 -translate-x-1/2 flex flex-col items-center transition-all duration-500"
                style={{ left: `${Math.min(98, Math.max(2, compositePercentile))}%` }}
              >
                <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[6px] border-b-white"></div>
                <span className="text-[10px] font-bold text-white bg-slate-800 px-1 rounded shadow">
                  {copy.nowAt(compositePercentile)}
                </span>
              </div>
            </div>

            {/* 標尺文字 */}
            <div className="flex justify-between text-[11px] text-slate-400 pt-1">
              <span>{copy.scale0}</span>
              <span>{copy.scale20}</span>
              <span>{copy.scale40}</span>
              <span>{copy.scale60}</span>
              <span>{copy.scale80}</span>
              <span>100%</span>
            </div>
          </div>

          {/* 白話解讀卡 */}
          <div className="mt-4 pt-4 border-t border-slate-800/60 text-xs md:text-sm text-slate-300 leading-relaxed">
            <span className="font-semibold text-white mr-1">{copy.dailyCommentary}</span>
            {current.statusDescription}
          </div>
        </div>

        {/* 核心卡片 2：四項關鍵數據指標 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {/* 加權指數 */}
          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400">{copy.kpiTaiex}</div>
            <div className="text-xl md:text-2xl font-bold text-white mt-1">
              {current.taiex ? Number(current.taiex).toLocaleString() : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">{copy.kpiTaiexSub}</div>
          </div>

          {/* 本益比 */}
          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400">{copy.kpiPe}</div>
            <div className="text-xl md:text-2xl font-bold text-indigo-400 mt-1">
              {current.peRatio ? `${current.peRatio}x` : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {copy.histPercentile}<span className="font-semibold text-slate-200">{current.pePercentile}%</span>
            </div>
          </div>

          {/* 淨值比 */}
          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400">{copy.kpiPb}</div>
            <div className="text-xl md:text-2xl font-bold text-cyan-400 mt-1">
              {current.pbRatio ? `${current.pbRatio}x` : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {copy.histPercentile}<span className="font-semibold text-slate-200">{current.pbPercentile}%</span>
            </div>
          </div>

          {/* 殖利率 */}
          <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl">
            <div className="text-xs text-slate-400">{copy.kpiYield}</div>
            <div className="text-xl md:text-2xl font-bold text-emerald-400 mt-1">
              {current.dividendYield ? `${current.dividendYield}%` : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">{copy.kpiYieldSub}</div>
          </div>
        </div>

        {/* Issue #127 核心模組：大盤落底訊號雷達 ＆ 抄底 SOP 檢核 */}
        {data.bottomRadar && (
          <div className="bg-slate-900/95 border border-indigo-500/30 p-6 rounded-2xl space-y-6 shadow-xl relative overflow-hidden backdrop-blur-md">
            {/* 標題列 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-xl font-bold text-white tracking-tight">{copy.radarTitle}</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
                    {copy.radarBadge}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {copy.radarDesc}
                </p>
              </div>
              <div className="text-right">
                <span className="text-[11px] text-slate-400">{copy.radarMechanism}</span>
                <div className="text-xs font-bold text-indigo-300">{copy.radarThreshold}</div>
              </div>
            </div>

            {/* SOP 5 條件檢視清單 */}
            <div
              className={`p-5 rounded-xl border transition-all ${
                data.bottomRadar.checklist.isSafeToBuy
                  ? 'bg-emerald-950/30 border-emerald-500/40 shadow-emerald-900/20 shadow-lg'
                  : 'bg-amber-950/20 border-amber-500/30'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2.5">
                  {data.bottomRadar.checklist.isSafeToBuy ? (
                    <ShieldCheck className="w-6 h-6 text-emerald-400 shrink-0" />
                  ) : (
                    <CircleAlert className="w-6 h-6 text-amber-400 shrink-0" />
                  )}
                  <div>
                    <div className="text-lg font-black text-white">
                      {data.bottomRadar.checklist.verdictLabel}
                    </div>
                    <div className="text-xs text-slate-300 mt-0.5">
                      {data.bottomRadar.checklist.verdictDescription}
                    </div>
                  </div>
                </div>
                <div className="text-right self-start md:self-auto bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
                  <span className="text-xs text-slate-400">{copy.metCountLabel}</span>
                  <span
                    className={`text-lg font-black ml-1.5 ${
                      data.bottomRadar.checklist.isSafeToBuy ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {data.bottomRadar.checklist.metCount} / 5
                  </span>
                </div>
              </div>

              {/* 5 條件逐項核對 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                {/* 條件 1 */}
                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition ${
                    data.bottomRadar.checklist.marginMet
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-100 font-medium'
                      : 'bg-slate-900/50 border-slate-800 text-slate-400'
                  }`}
                >
                  {data.bottomRadar.checklist.marginMet ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-200">{copy.cond1Title}</span>
                    {copy.cond1Desc}
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {copy.cond1Sub}
                      <span
                        className={`font-mono font-bold ml-1 ${
                          (data.bottomRadar.margin.marginChange ?? 0) <= -50 ? 'text-emerald-400' : 'text-slate-300'
                        }`}
                      >
                        {data.bottomRadar.margin.marginChange != null
                          ? `${data.bottomRadar.margin.marginChange > 0 ? '+' : ''}${data.bottomRadar.margin.marginChange} ${copy.billionUnit}`
                          : '—'}
                      </span>
                      {data.bottomRadar.margin.marginMaintenanceRatio != null && (
                        <span>{copy.maintRatio(data.bottomRadar.margin.marginMaintenanceRatio)}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 條件 2 */}
                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition ${
                    data.bottomRadar.checklist.biasMet
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-100 font-medium'
                      : 'bg-slate-900/50 border-slate-800 text-slate-400'
                  }`}
                >
                  {data.bottomRadar.checklist.biasMet ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-200">{copy.cond2Title}</span>
                    {copy.cond2Desc}
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {copy.cond2Taiex}
                      <span className="font-mono font-bold text-slate-300 ml-1">
                        {data.bottomRadar.bias.taiexBias != null ? `${data.bottomRadar.bias.taiexBias}%` : '—'}
                      </span>
                      {' · '}
                      {copy.cond2Etf}
                      <span
                        className={`font-mono font-bold ml-1 ${
                          (data.bottomRadar.bias.stock0050Bias ?? 0) <= -5 ? 'text-emerald-400' : 'text-slate-300'
                        }`}
                      >
                        {data.bottomRadar.bias.stock0050Bias != null
                          ? `${data.bottomRadar.bias.stock0050Bias}%`
                          : '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 條件 3 */}
                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition ${
                    data.bottomRadar.checklist.patternMet
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-100 font-medium'
                      : 'bg-slate-900/50 border-slate-800 text-slate-400'
                  }`}
                >
                  {data.bottomRadar.checklist.patternMet ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-200">{copy.cond3Title}</span>
                    {copy.cond3Desc}
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {copy.cond3Current}
                      <span
                        className={`font-semibold ml-1 ${
                          data.bottomRadar.pattern.patternTriggered ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      >
                        {data.bottomRadar.pattern.description}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 條件 4 */}
                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition ${
                    data.bottomRadar.checklist.futuresMet
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-100 font-medium'
                      : 'bg-slate-900/50 border-slate-800 text-slate-400'
                  }`}
                >
                  {data.bottomRadar.checklist.futuresMet ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-200">{copy.cond4Title}</span>
                    {copy.cond4Desc}
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {copy.cond4Sub}
                      <span className="font-mono font-bold text-slate-300 ml-1">
                        {data.bottomRadar.hedging.txForeignNetOI != null
                          ? `${data.bottomRadar.hedging.txForeignNetOI.toLocaleString()} ${copy.contractsUnit}`
                          : '—'}
                      </span>
                      {data.bottomRadar.hedging.txForeignNetChange != null && (
                        <span>
                          （{copy.singleDayPrefix}{data.bottomRadar.hedging.txForeignNetChange >= 0 ? '+' : ''}
                          {data.bottomRadar.hedging.txForeignNetChange.toLocaleString()} {copy.contractsUnit}）
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 條件 5 */}
                <div
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border md:col-span-2 transition ${
                    data.bottomRadar.checklist.fxMet
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-slate-100 font-medium'
                      : 'bg-slate-900/50 border-slate-800 text-slate-400'
                  }`}
                >
                  {data.bottomRadar.checklist.fxMet ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-200">{copy.cond5Title}</span>
                    {copy.cond5Desc}
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {copy.cond5Sub}
                      <span className="font-mono font-bold text-slate-300 ml-1">
                        {data.bottomRadar.hedging.usdTwdRate ?? '—'}
                      </span>
                      <span
                        className={`font-semibold ml-2 ${
                          data.bottomRadar.hedging.isFxStabilized ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      >
                        {data.bottomRadar.hedging.isFxStabilized ? copy.fxStable : copy.fxWeak}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 四大客觀指標監控卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 1. 籌碼去槓桿 */}
              <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Coins className="w-4 h-4 text-amber-400" />
                    {copy.card1Title}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                    {data.bottomRadar.margin.statusLabel}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="bg-slate-900 p-2 rounded-lg">
                    <div className="text-[11px] text-slate-400">{copy.card1Balance}</div>
                    <div className="text-sm font-bold text-white mt-0.5 font-mono">
                      {data.bottomRadar.margin.marginBalance ? `${data.bottomRadar.margin.marginBalance} ${copy.billionShort}` : '—'}
                    </div>
                  </div>
                  <div className="bg-slate-900 p-2 rounded-lg">
                    <div className="text-[11px] text-slate-400">{copy.card1Change}</div>
                    <div
                      className={`text-sm font-bold mt-0.5 font-mono ${
                        (data.bottomRadar.margin.marginChange ?? 0) <= -50 ? 'text-emerald-400' : 'text-slate-200'
                      }`}
                    >
                      {data.bottomRadar.margin.marginChange != null
                        ? `${data.bottomRadar.margin.marginChange > 0 ? '+' : ''}${data.bottomRadar.margin.marginChange} ${copy.billionShort}`
                        : '—'}
                    </div>
                  </div>
                  <div className="bg-slate-900 p-2 rounded-lg">
                    <div className="text-[11px] text-slate-400">{copy.card1Maint}</div>
                    <div className="text-sm font-bold text-indigo-300 mt-0.5 font-mono">
                      {data.bottomRadar.margin.marginMaintenanceRatio != null
                        ? `${data.bottomRadar.margin.marginMaintenanceRatio}%`
                        : '—'}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                  {data.bottomRadar.margin.statusDescription}
                </p>
              </div>

              {/* 2. 季線負乖離 */}
              <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <TrendingDown className="w-4 h-4 text-cyan-400" />
                    {copy.card2Title}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                    {data.bottomRadar.bias.isBiasTriggered ? copy.card2Trig : copy.card2Normal}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 text-center">
                  <div className="bg-slate-900 p-2 rounded-lg">
                    <div className="text-[11px] text-slate-400">{copy.card2Taiex}</div>
                    <div
                      className={`text-sm font-bold mt-0.5 font-mono ${
                        (data.bottomRadar.bias.taiexBias ?? 0) <= -5 ? 'text-emerald-400' : 'text-slate-200'
                      }`}
                    >
                      {data.bottomRadar.bias.taiexBias != null ? `${data.bottomRadar.bias.taiexBias}%` : '—'}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {copy.card2Ma60}{data.bottomRadar.bias.taiexMa60?.toLocaleString() ?? '—'}
                    </div>
                  </div>
                  <div className="bg-slate-900 p-2 rounded-lg">
                    <div className="text-[11px] text-slate-400">{copy.card2Etf}</div>
                    <div
                      className={`text-sm font-bold mt-0.5 font-mono ${
                        (data.bottomRadar.bias.stock0050Bias ?? 0) <= -5 ? 'text-emerald-400' : 'text-slate-200'
                      }`}
                    >
                      {data.bottomRadar.bias.stock0050Bias != null ? `${data.bottomRadar.bias.stock0050Bias}%` : '—'}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {copy.card2Ma60}{data.bottomRadar.bias.stock0050Ma60?.toFixed(2) ?? '—'}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                  {copy.card2Note}
                </p>
              </div>

              {/* 3. 量價與型態指標 */}
              <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    {copy.card3Title}
                  </span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                      data.bottomRadar.pattern.patternTriggered
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {data.bottomRadar.pattern.patternTriggered ? copy.card3Trig : copy.card3None}
                  </span>
                </div>
                <div className="space-y-1.5 pt-1 text-xs">
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-900/80">
                    <span className="text-slate-400">{copy.card3HammerLabel}</span>
                    <span
                      className={`font-semibold ${
                        data.bottomRadar.pattern.hammer ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      {data.bottomRadar.pattern.hammer ? copy.card3HammerYes : copy.notAppeared}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-900/80">
                    <span className="text-slate-400">{copy.card3DryingLabel}</span>
                    <span
                      className={`font-semibold ${
                        data.bottomRadar.pattern.volumeDrying ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      {data.bottomRadar.pattern.volumeDrying ? copy.card3DryingYes : copy.notAppeared}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-slate-900/80">
                    <span className="text-slate-400">{copy.card3DawnLabel}</span>
                    <span
                      className={`font-semibold ${
                        data.bottomRadar.pattern.dawnEngulfing ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      {data.bottomRadar.pattern.dawnEngulfing ? copy.card3DawnYes : copy.notAppeared}
                    </span>
                  </div>
                </div>
              </div>

              {/* 4. 資金與期權避險動向 */}
              <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-purple-400" />
                    {copy.card4Title}
                  </span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                      data.bottomRadar.hedging.isHedgingTriggered
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {data.bottomRadar.hedging.isHedgingTriggered ? copy.card4Trig : copy.card4Pressure}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 text-center">
                  <div className="bg-slate-900 p-2 rounded-lg">
                    <div className="text-[11px] text-slate-400">{copy.card4Oi}</div>
                    <div className="text-sm font-bold text-purple-300 mt-0.5 font-mono">
                      {data.bottomRadar.hedging.txForeignNetOI != null
                        ? `${data.bottomRadar.hedging.txForeignNetOI.toLocaleString()} ${copy.contractsUnit}`
                        : '—'}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {copy.card4Daily}{data.bottomRadar.hedging.txForeignNetChange != null ? `${data.bottomRadar.hedging.txForeignNetChange > 0 ? '+' : ''}${data.bottomRadar.hedging.txForeignNetChange.toLocaleString()}` : '—'}
                    </div>
                  </div>
                  <div className="bg-slate-900 p-2 rounded-lg">
                    <div className="text-[11px] text-slate-400">{copy.card4Fx}</div>
                    <div className="text-sm font-bold text-white mt-0.5 font-mono">
                      {data.bottomRadar.hedging.usdTwdRate ?? '—'}
                    </div>
                    <div
                      className={`text-[10px] font-semibold mt-0.5 ${
                        data.bottomRadar.hedging.isFxStabilized ? 'text-emerald-400' : 'text-slate-400'
                      }`}
                    >
                      {data.bottomRadar.hedging.isFxStabilized ? copy.card4FxStable : copy.card4FxWeak}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                  {copy.card4Note}
                </p>
              </div>
            </div>

            {/* 0050 動態階梯買進試算 ＆ 個人資金紀律提醒 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              {/* 0050 階梯目標價試算 */}
              <div className="bg-gradient-to-br from-indigo-950/40 to-slate-900 border border-indigo-500/30 p-4 rounded-xl space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-300">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  {copy.tierTitle}
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center p-2 rounded bg-slate-900/80 border border-slate-800">
                    <span className="text-slate-400">{copy.tierMa60}</span>
                    <span className="font-mono font-bold text-white">
                      {data.bottomRadar.bias.stock0050Ma60 ? `${data.bottomRadar.bias.stock0050Ma60.toFixed(2)} ${copy.twdUnit}` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-slate-900/80 border border-cyan-500/30">
                    <div>
                      <div className="font-semibold text-cyan-300">{copy.tier2Label}</div>
                      <div className="text-[10px] text-slate-400">{copy.tier2Sub}</div>
                    </div>
                    <span className="font-mono text-base font-black text-cyan-400">
                      {data.bottomRadar.bias.tier2TargetPrice ? `${data.bottomRadar.bias.tier2TargetPrice.toFixed(2)} ${copy.twdUnit}` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-slate-900/80 border border-emerald-500/30">
                    <div>
                      <div className="font-semibold text-emerald-300">{copy.tier3Label}</div>
                      <div className="text-[10px] text-slate-400">{copy.tier3Sub}</div>
                    </div>
                    <span className="font-mono text-base font-black text-emerald-400">
                      {data.bottomRadar.bias.tier3TargetPrice ? `${data.bottomRadar.bias.tier3TargetPrice.toFixed(2)} ${copy.twdUnit}` : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 通用資金紀律指南與備忘錄 */}
              <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl md:col-span-2 space-y-2.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Bookmark className="w-4 h-4 text-amber-400" />
                      {copy.notesTitle}
                    </span>
                    <div className="flex items-center gap-2">
                      {savedNotesAlert && (
                        <span className="text-[11px] text-emerald-400 font-semibold animate-pulse">
                          {copy.notesSaved}
                        </span>
                      )}
                      {isEditingNotes ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setPersonalNotes(copy.guidelines)
                              setHasCustomNotes(false)
                              localStorage.removeItem('vestential_capital_notes')
                              setIsEditingNotes(false)
                            }}
                            className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                          >
                            {copy.notesReset}
                          </button>
                          <button
                            type="button"
                            onClick={saveNotes}
                            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition"
                          >
                            <Save className="w-3 h-3" /> {copy.notesSave}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsEditingNotes(true)}
                          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition"
                          title={copy.notesEditTitle}
                        >
                          <Edit3 className="w-3 h-3" /> {copy.notesEdit}
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditingNotes ? (
                    <textarea
                      value={personalNotes}
                      onChange={(e) => setPersonalNotes(e.target.value)}
                      rows={7}
                      className="w-full mt-2 p-2.5 text-xs font-mono bg-slate-900 border border-indigo-500/40 rounded-lg text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 leading-relaxed"
                      placeholder={copy.notesPlaceholder}
                    />
                  ) : (
                    <div className="mt-2 text-xs text-slate-300 leading-relaxed whitespace-pre-line font-mono bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
                      {personalNotes}
                    </div>
                  )}
                </div>

                <div className="text-[11px] text-slate-400 border-t border-slate-800/60 pt-2 flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>{copy.notesWarning}</span>
                </div>

                <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-800/80">
                  <div className="text-xs text-slate-400">
                    {copy.dcaPrompt}
                  </div>
                  <Link
                    href={localizePath(locale, '/dca-lab')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 text-xs font-semibold shrink-0 transition"
                  >
                    <span>{copy.dcaCta}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 核心卡片 3：5 年常態河流圖帶狀估值 */}
        <div className="bg-slate-900/90 border border-slate-800 p-6 rounded-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-400" />
                {copy.riverTitle}
              </h3>
              <p className="text-xs text-slate-400">{copy.riverSub}</p>
            </div>
            {/* 切換 P/E 與 P/B */}
            <div className="flex bg-slate-800 p-1 rounded-lg text-xs font-medium self-start sm:self-auto">
              <button
                onClick={() => setActiveTab('pe')}
                className={`px-3 py-1.5 rounded-md transition ${activeTab === 'pe' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                {copy.tabPe}
              </button>
              <button
                onClick={() => setActiveTab('pb')}
                className={`px-3 py-1.5 rounded-md transition ${activeTab === 'pb' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                {copy.tabPb}
              </button>
            </div>
          </div>

          {/* 5 段帶狀常態數值展示卡 */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
            <div className="bg-slate-950/60 p-3 rounded-lg border border-red-500/20 text-center">
              <div className="text-[11px] text-red-400 font-semibold">{copy.sigmaP2}</div>
              <div className="text-base font-bold text-white mt-0.5">{activeBand.plus2Sigma}x</div>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-lg border border-amber-500/20 text-center">
              <div className="text-[11px] text-amber-400 font-semibold">{copy.sigmaP1}</div>
              <div className="text-base font-bold text-white mt-0.5">{activeBand.plus1Sigma}x</div>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-lg border border-emerald-500/20 text-center">
              <div className="text-[11px] text-emerald-400 font-semibold">{copy.sigmaMean}</div>
              <div className="text-base font-bold text-white mt-0.5">{activeBand.mean}x</div>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-lg border border-cyan-500/20 text-center">
              <div className="text-[11px] text-cyan-400 font-semibold">{copy.sigmaM1}</div>
              <div className="text-base font-bold text-white mt-0.5">{activeBand.minus1Sigma}x</div>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-lg border border-blue-500/20 text-center col-span-2 sm:col-span-1">
              <div className="text-[11px] text-blue-400 font-semibold">{copy.sigmaM2}</div>
              <div className="text-base font-bold text-white mt-0.5">{activeBand.minus2Sigma}x</div>
            </div>
          </div>

          {/* 視覺化常態分佈橫條圖 */}
          <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">{copy.currentLevelPos(metricName)}</span>
              <span className="text-white font-bold">{activeValue}x{copy.percentileParen(activePercentile)}</span>
            </div>
            {/* 帶狀刻度尺 */}
            <div className="relative h-6 bg-slate-900 rounded-lg overflow-hidden flex border border-slate-800">
              <div className="h-full flex-1 bg-blue-500/20 flex items-center justify-center text-[10px] text-blue-400 border-r border-slate-800/40">
                -2σ
              </div>
              <div className="h-full flex-1 bg-cyan-500/20 flex items-center justify-center text-[10px] text-cyan-400 border-r border-slate-800/40">
                -1σ
              </div>
              <div className="h-full flex-1 bg-emerald-500/20 flex items-center justify-center text-[10px] text-emerald-400 border-r border-slate-800/40 font-semibold">
                Mean
              </div>
              <div className="h-full flex-1 bg-amber-500/20 flex items-center justify-center text-[10px] text-amber-400 border-r border-slate-800/40">
                +1σ
              </div>
              <div className="h-full flex-1 bg-red-500/20 flex items-center justify-center text-[10px] text-red-400">
                +2σ
              </div>
            </div>
          </div>
        </div>

        {/* 核心卡片 4：近期水位歷史紀錄明細 */}
        <div className="bg-slate-900/90 border border-slate-800 p-6 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-400" />
              {copy.historyTitle}
            </h3>
            <span className="text-xs text-slate-400">{copy.historyRecent}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3 font-semibold">{copy.colDate}</th>
                  <th className="py-2.5 px-3 font-semibold">{copy.colTaiex}</th>
                  <th className="py-2.5 px-3 font-semibold">{copy.colPe}</th>
                  <th className="py-2.5 px-3 font-semibold">{copy.colPb}</th>
                  <th className="py-2.5 px-3 font-semibold">{copy.colComp}</th>
                  <th className="py-2.5 px-3 font-semibold">{copy.colBadge}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {history.slice(0, 10).map((row) => {
                  const cfg = STATUS_CONFIG[row.level_status ?? 'fair'] || STATUS_CONFIG.fair
                  const rowStatusText = copy.statusLabels[row.level_status ?? 'fair'] || copy.statusLabels.fair
                  return (
                    <tr key={row.trade_date} className="hover:bg-slate-800/40 transition">
                      <td className="py-2.5 px-3 text-slate-300 font-mono">{row.trade_date}</td>
                      <td className="py-2.5 px-3 text-white font-medium">
                        {row.taiex ? Number(row.taiex).toLocaleString() : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">{row.pe_ratio ? `${row.pe_ratio}x` : '—'}</td>
                      <td className="py-2.5 px-3 text-slate-300">{row.pb_ratio ? `${row.pb_ratio}x` : '—'}</td>
                      <td className="py-2.5 px-3 text-slate-300 font-semibold">{row.composite_percentile ?? '—'}%</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${cfg.badge}`}>
                          {rowStatusText.short}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 底部法規紅線與合規免責宣告 */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs text-slate-400 space-y-2 leading-relaxed">
          <div className="flex items-center gap-1.5 font-semibold text-slate-300">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            {copy.complianceTitle}
          </div>
          <p>{disclaimer}</p>
        </div>
      </div>
    </main>
  )
}
