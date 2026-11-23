/**
 * /cashflow-plan 專業財富管理風格 HTML 報告產生器（client-safe，零外部依賴）。
 */

import type { Locale } from '@/i18n/config'
import { getPlanAssetDisplayName, type CashflowPlanEvaluation } from './cashflow-plan'

export interface CashflowPlanExportParams {
  evaluation: CashflowPlanEvaluation
  styleName: string
  exportedAt?: string
  locale?: Locale
}

interface ExportCopy {
  htmlLang: string
  docTitle: string
  reportTitle: string
  styleLabel: string
  targetLabel: string
  generatedLabel: string
  printBtn: string
  kpiAvgMonthly: string
  kpiAchievement: (target: string, pct: number) => string
  kpiTotalCapital: string
  kpiAssetsCount: (n: number) => string
  kpiAnnualNet: string
  kpiAnnualNetSub: (gross: string, yld: string) => string
  kpiNhi: string
  kpiNhiSub: string
  sec1Title: string
  sec1Note: string
  colAsset: string
  colPrice: string
  colLots: string
  colCapital: string
  colWeight: string
  col54c: string
  colSafeLots: string
  colAnnualNet: string
  colNhiStatus: string
  safeUnlimited: string
  lotsUnit: string
  sharesUnit: string
  statusWarn: (fee: string) => string
  statusOk: string
  historyInsufficient: string
  totalLabel: string
  effectiveYieldLabel: (yld: string) => string
  sec2Title: string
  sec2Note: (target: string) => string
  targetTag: (target: string) => string
  sec3Title: string
  sec3Note: string
  colMonth: string
  colGross: string
  colNhi: string
  colNet: string
  colMonthItems: string
  noMonthItems: string
  monthLabel: (m: number) => string
  disclaimerTitle: string
  disclaimer1: string
  disclaimer2: string
  disclaimer3: string
}

const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const EXPORT_COPY: Record<Locale, ExportCopy> = {
  'zh-TW': {
    htmlLang: 'zh-Hant',
    docTitle: 'Vestential 股利現金流自由配置規劃報告｜月領目標',
    reportTitle: '股利現金流自由配置規劃報告',
    styleLabel: '配置風格',
    targetLabel: '目標月領（稅後）',
    generatedLabel: '報告產出時間（台北時間）',
    printBtn: '列印 / 另存 PDF',
    kpiAvgMonthly: '預估月均實拿（稅後）',
    kpiAchievement: (target, pct) => `目標 ${target} · 達成率 ${pct}%`,
    kpiTotalCapital: '預估總投入本金',
    kpiAssetsCount: (n) => `共配置 ${n} 檔標的`,
    kpiAnnualNet: '年度預估稅後實拿',
    kpiAnnualNetSub: (gross, yld) => `稅前 ${gross} · 實質殖利率 ${yld}`,
    kpiNhi: '二代健保補充保費（2.11%）',
    kpiNhiSub: '僅就單次 54C ≥ NT$20,000 扣繳',
    sec1Title: '一、標的張數配置與二代健保安全水位',
    sec1Note: '安全張數＝單次配息 54C 股利所得低於 NT$20,000 之最大持有張數',
    colAsset: '標的',
    colPrice: '目前市價',
    colLots: '配置張數',
    colCapital: '投入本金',
    colWeight: '資金佔比',
    col54c: '54C 佔比',
    colSafeLots: '免扣安全張數',
    colAnnualNet: '預估年領（稅後）',
    colNhiStatus: '健保檢核狀態',
    safeUnlimited: '無上限（免扣）',
    lotsUnit: '張',
    sharesUnit: '股',
    statusWarn: (fee) => `單次逾門檻（+${fee}/年）`,
    statusOk: '免扣安全區',
    historyInsufficient: '近1年配息紀錄不足',
    totalLabel: '合計',
    effectiveYieldLabel: (yld) => `實質年化殖利率 ${yld}`,
    sec2Title: '二、1 至 12 月預估稅後實拿現金流分佈',
    sec2Note: (target) => `綠色柱狀表示當月實拿達月領目標（${target}）`,
    targetTag: (target) => `目標 ${target}`,
    sec3Title: '三、逐月入帳明細表',
    sec3Note: '依近 12 個月實際配息發放月份分組',
    colMonth: '月份',
    colGross: '稅前股利',
    colNhi: '二代健保',
    colNet: '稅後實拿',
    colMonthItems: '當月入帳標的明細',
    noMonthItems: '本月無預估入帳',
    monthLabel: (m) => `${m} 月`,
    disclaimerTitle: '試算口徑與免責聲明',
    disclaimer1: '本報告依 Vestential 近 12 個月實際除息與發放紀錄（TWSE / FinMind）試算，新掛牌或配息不足一年之標的不進行年化捏造。',
    disclaimer2: '二代健保補充保費（2.11%）依據 2026 年適用稅制，僅針對單次給付之「54C 境內股利所得」達 NT$20,000（含）以上計扣；資本利得與收益平準金免扣。',
    disclaimer3: '本報告僅供個人現金流模擬與資產配置參考，不構成任何形式之投資或稅務建議，實際配息金額與發放日以各投信／發行公司公告為準。',
  },
  en: {
    htmlLang: 'en',
    docTitle: 'Vestential Monthly Dividend Cashflow Plan Report | Target',
    reportTitle: 'Monthly Dividend Cashflow Plan Report',
    styleLabel: 'Strategy Style',
    targetLabel: 'Target Monthly Net',
    generatedLabel: 'Generated At (Taipei Time)',
    printBtn: 'Print / Save PDF',
    kpiAvgMonthly: 'Est. Monthly Avg (Net)',
    kpiAchievement: (target, pct) => `Target ${target} · ${pct}% achieved`,
    kpiTotalCapital: 'Est. Total Capital',
    kpiAssetsCount: (n) => `${n} holdings configured`,
    kpiAnnualNet: 'Est. Annual Net Payout',
    kpiAnnualNetSub: (gross, yld) => `Pre-tax ${gross} · Net Yield ${yld}`,
    kpiNhi: 'NHI Supplementary Fee (2.11%)',
    kpiNhiSub: 'Applies only when single 54C ≥ NT$20,000',
    sec1Title: '1. Holdings Allocation & NHI Safe Lot Threshold',
    sec1Note: 'Safe lots = max lots keeping single 54C dividend below NT$20,000',
    colAsset: 'Symbol',
    colPrice: 'Ref Price',
    colLots: 'Lots',
    colCapital: 'Capital',
    colWeight: 'Weight',
    col54c: '54C Ratio',
    colSafeLots: 'Safe Max Lots',
    colAnnualNet: 'Est. Annual Net',
    colNhiStatus: 'NHI Status',
    safeUnlimited: 'Unlimited (Exempt)',
    lotsUnit: 'lots',
    sharesUnit: 'sh',
    statusWarn: (fee) => `Exceeds threshold (+${fee}/yr)`,
    statusOk: 'Exempt',
    historyInsufficient: 'Insufficient 1Y history',
    totalLabel: 'Total',
    effectiveYieldLabel: (yld) => `Portfolio Net Yield ${yld}`,
    sec2Title: '2. 12-Month Net Cashflow Distribution',
    sec2Note: (target) => `Green bars indicate months reaching target (${target})`,
    targetTag: (target) => `Target ${target}`,
    sec3Title: '3. Monthly Payout Schedule',
    sec3Note: 'Grouped by actual payout month over the trailing 12 months',
    colMonth: 'Month',
    colGross: 'Pre-tax',
    colNhi: 'NHI Fee',
    colNet: 'Net Payout',
    colMonthItems: 'Payout Breakdown',
    noMonthItems: 'No scheduled payout',
    monthLabel: (m) => MONTH_NAMES_EN[m - 1] ?? `${m}`,
    disclaimerTitle: 'Methodology & Disclaimer',
    disclaimer1: 'Calculations use trailing 12-month official TWSE / FinMind ex-dividend and payout records without extrapolating newly listed ETFs.',
    disclaimer2: 'NHI supplementary premium (2.11%, 2026 rules) applies only to domestic 54C dividend income ≥ NT$20,000 per payout; capital gains and equalization reserves are exempt.',
    disclaimer3: 'For personal cashflow simulation only and not investment or tax advice. Actual payouts follow official issuer announcements.',
  },
  ja: {
    htmlLang: 'ja',
    docTitle: 'Vestential 月次配当キャッシュフロー計画レポート｜目標',
    reportTitle: '配当キャッシュフロー自由配分計画レポート',
    styleLabel: '配分スタイル',
    targetLabel: '目標月額（手取り）',
    generatedLabel: '作成日時（台北時間）',
    printBtn: '印刷 / PDF保存',
    kpiAvgMonthly: '月平均手取り見込',
    kpiAchievement: (target, pct) => `目標 ${target} · 達成率 ${pct}%`,
    kpiTotalCapital: '必要投資元本見込',
    kpiAssetsCount: (n) => `合計 ${n} 銘柄`,
    kpiAnnualNet: '年間手取り配当見込',
    kpiAnnualNetSub: (gross, yld) => `税引前 ${gross} · 実質利回り ${yld}`,
    kpiNhi: '二代健保追加保険料（2.11%）',
    kpiNhiSub: '1回の 54C 所得 ≥ NT$20,000 のみ課徴',
    sec1Title: '一、銘柄配分と二代健保の安全単元ライン',
    sec1Note: '安全単元＝1回あたりの 54C 配当が NT$20,000 未満に収まる最大保有枚数',
    colAsset: '銘柄',
    colPrice: '参考株価',
    colLots: '保有枚数',
    colCapital: '投資元本',
    colWeight: '構成比',
    col54c: '54C 比率',
    colSafeLots: '免除安全枚数',
    colAnnualNet: '年間手取り見込',
    colNhiStatus: '健保判定',
    safeUnlimited: '上限なし（免除）',
    lotsUnit: '枚',
    sharesUnit: '株',
    statusWarn: (fee) => `基準超過（+${fee}/年）`,
    statusOk: '免除ライン内',
    historyInsufficient: '直近1年の配当実績不足',
    totalLabel: '合計',
    effectiveYieldLabel: (yld) => `ポートフォリオ実質利回り ${yld}`,
    sec2Title: '二、1〜12月 手取りキャッシュフロー分布',
    sec2Note: (target) => `緑色の棒グラフは月次目標（${target}）達成月を示します`,
    targetTag: (target) => `目標 ${target}`,
    sec3Title: '三、月別配当明細表',
    sec3Note: '直近12ヶ月の実際の支払月に基づき集計',
    colMonth: '月',
    colGross: '税引前配当',
    colNhi: '二代健保',
    colNet: '手取り額',
    colMonthItems: '当月配当内訳',
    noMonthItems: '当月の配当予定なし',
    monthLabel: (m) => `${m} 月`,
    disclaimerTitle: '試算基準および免責事項',
    disclaimer1: '直近12ヶ月の TWSE / FinMind 公式実績データに基づき試算しています（上場1年未満の銘柄を年率換算で水増ししません）。',
    disclaimer2: '二代健保追加保険料（2.11%、2026年基準）は1回あたり 54C 配当所得が NT$20,000 以上の場合のみ適用されます。',
    disclaimer3: '本レポートは試算参考資料であり、投資助言や税務アドバイスではありません。実際の配当は各運用会社の公式発表に準じます。',
  },
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function fmtNtd(n: number): string {
  return `NT$${Math.round(n).toLocaleString('en-US')}`
}

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`
}

/**
 * 產生單一自包含、可離線瀏覽與 A4 列印之專業風格 HTML5 報告。
 */
export function buildCashflowPlanExportHtml({
  evaluation,
  styleName,
  exportedAt,
  locale = 'zh-TW',
}: CashflowPlanExportParams): string {
  const c = EXPORT_COPY[locale] ?? EXPORT_COPY['zh-TW']
  const timestamp =
    exportedAt ??
    new Date().toLocaleString(locale === 'en' ? 'en-US' : locale === 'ja' ? 'ja-JP' : 'zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

  const achievementPct =
    evaluation.targetMonthlyNet > 0
      ? Math.round((evaluation.monthlyAvgNet / evaluation.targetMonthlyNet) * 1000) / 10
      : 0

  const maxMonthNet = Math.max(
    evaluation.targetMonthlyNet * 1.15,
    ...evaluation.months.map((m) => m.net),
    1,
  )
  const targetLinePct = Math.min(100, Math.round((evaluation.targetMonthlyNet / maxMonthNet) * 1000) / 10)

  const assetRows = evaluation.assets
    .map((a) => {
      const weightPct = evaluation.totalCapital > 0 ? (a.capital / evaluation.totalCapital) * 100 : 0
      const ratio54cPct = Math.round(a.dividend54cRatio * 100)
      const safeLabel =
        a.safeMaxLots == null
          ? c.safeUnlimited
          : `${a.safeMaxLots.toLocaleString('en-US')} ${c.lotsUnit}`
      const statusBadge = a.nhiTriggered
        ? `<span class="badge badge-warn">${c.statusWarn(fmtNtd(a.annualNhiFee))}</span>`
        : `<span class="badge badge-ok">${c.statusOk}</span>`
      const historyNote = a.insufficientHistory
        ? `<span class="badge badge-muted">${c.historyInsufficient}</span>`
        : ''

      return `
        <tr>
          <td>
            <div class="sym">${escapeHtml(a.symbol)}</div>
            <div class="sub">${escapeHtml(getPlanAssetDisplayName(a.symbol, a.name, a.names, locale))}</div>
          </td>
          <td class="num">${fmtNtd(a.price)}</td>
          <td class="num">
            <strong>${a.lots.toLocaleString('en-US')} ${c.lotsUnit}</strong>
            <div class="sub">${(a.lots * 1000).toLocaleString('en-US')} ${c.sharesUnit}</div>
          </td>
          <td class="num">${fmtNtd(a.capital)}</td>
          <td class="num">${fmtPct(weightPct)}</td>
          <td class="num">${ratio54cPct}%</td>
          <td class="num">${safeLabel}</td>
          <td class="num strong-green">${fmtNtd(a.annualNet)}</td>
          <td>${statusBadge}${historyNote}</td>
        </tr>`
    })
    .join('\n')

  const monthBars = evaluation.months
    .map((m) => {
      const barPct = Math.max(2, Math.min(100, Math.round((m.net / maxMonthNet) * 1000) / 10))
      const reached = m.net >= evaluation.targetMonthlyNet
      return `
        <div class="bar-col">
          <div class="bar-val">${m.net > 0 ? `${Math.round(m.net / 1000)}k` : '0'}</div>
          <div class="bar-track">
            <div class="bar-fill ${reached ? 'bar-fill-hit' : ''}" style="height: ${barPct}%;"></div>
          </div>
          <div class="bar-lbl">${escapeHtml(c.monthLabel(m.month))}</div>
        </div>`
    })
    .join('\n')

  const monthRows = evaluation.months
    .map((m) => {
      const itemsHtml =
        m.items.length === 0
          ? `<span class="sub">${c.noMonthItems}</span>`
          : m.items
              .map(
                (it) =>
                  `<div class="event-pill">
                    <span class="event-sym">${escapeHtml(it.symbol)}</span>
                    <span>${it.lots.toLocaleString('en-US')}${c.lotsUnit} × ${it.cashDividend}</span>
                    <span class="event-date">(${escapeHtml(it.payDate)})</span>
                    <strong class="strong-green">${fmtNtd(it.net)}</strong>
                  </div>`,
              )
              .join('')

      return `
        <tr>
          <td class="month-cell">${escapeHtml(c.monthLabel(m.month))}</td>
          <td class="num">${fmtNtd(m.gross)}</td>
          <td class="num ${m.nhiFee > 0 ? 'warn-text' : 'sub'}">${m.nhiFee > 0 ? `-${fmtNtd(m.nhiFee)}` : 'NT$0'}</td>
          <td class="num strong-green">${fmtNtd(m.net)}</td>
          <td>${itemsHtml}</td>
        </tr>`
    })
    .join('\n')

  return `<!DOCTYPE html>
<html lang="${c.htmlLang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(c.docTitle)} ${fmtNtd(evaluation.targetMonthlyNet)}</title>
  <style>
    :root {
      --navy: #0f172a;
      --navy-2: #1e293b;
      --slate: #475569;
      --muted: #64748b;
      --border: #e2e8f0;
      --bg: #f8fafc;
      --card: #ffffff;
      --emerald: #059669;
      --emerald-soft: #ecfdf5;
      --amber: #d97706;
      --amber-soft: #fffbeb;
      --blue: #2563eb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 28px 20px 48px;
      background: var(--bg);
      color: var(--navy);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", "Microsoft JhengHei", sans-serif;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      max-width: 1080px;
      margin: 0 auto;
    }
    .header {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 65%, #064e3b 100%);
      color: #f8fafc;
      border-radius: 16px;
      padding: 28px 32px;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.14);
    }
    .brand {
      font-size: 12px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #34d399;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .header h1 {
      margin: 0 0 8px;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 12px;
      color: #cbd5e1;
    }
    .meta-chip {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.18);
      padding: 3px 10px;
      border-radius: 999px;
    }
    .print-btn {
      background: #10b981;
      color: #06281e;
      border: none;
      border-radius: 10px;
      padding: 9px 16px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }
    .print-btn:hover { background: #34d399; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-top: 20px;
    }
    .kpi-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px 18px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
    }
    .kpi-card.highlight {
      border-color: #a7f3d0;
      background: linear-gradient(180deg, #ffffff 0%, #f0fdf4 100%);
    }
    .kpi-label {
      font-size: 12px;
      color: var(--muted);
      font-weight: 600;
    }
    .kpi-value {
      margin-top: 6px;
      font-size: 22px;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      color: var(--navy);
    }
    .kpi-sub {
      margin-top: 4px;
      font-size: 11px;
      color: var(--slate);
      font-variant-numeric: tabular-nums;
    }
    .section {
      margin-top: 22px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 20px 22px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
    }
    .section-title {
      margin: 0 0 14px;
      font-size: 16px;
      font-weight: 700;
      color: var(--navy);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .section-note {
      font-size: 12px;
      font-weight: 500;
      color: var(--muted);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      text-align: left;
      padding: 10px 10px;
      font-size: 11px;
      font-weight: 700;
      color: var(--slate);
      background: #f1f5f9;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    th.num, td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    td {
      padding: 11px 10px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: middle;
    }
    tr:last-child td { border-bottom: none; }
    tfoot td {
      background: #f8fafc;
      border-top: 2px solid var(--border);
      font-weight: 700;
    }
    .sym { font-weight: 700; color: var(--navy); }
    .sub { font-size: 11px; color: var(--muted); }
    .strong-green { color: var(--emerald); font-weight: 700; }
    .warn-text { color: var(--amber); font-weight: 600; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      margin-right: 4px;
    }
    .badge-ok { background: var(--emerald-soft); color: #047857; border: 1px solid #a7f3d0; }
    .badge-warn { background: var(--amber-soft); color: #b45309; border: 1px solid #fde68a; }
    .badge-muted { background: #f1f5f9; color: var(--slate); border: 1px solid var(--border); }
    .chart-wrap {
      position: relative;
      padding-top: 12px;
    }
    .chart-area {
      position: relative;
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 8px;
      height: 190px;
      align-items: end;
      padding: 12px 6px 0;
      border-bottom: 1px solid var(--border);
    }
    .target-line {
      position: absolute;
      left: 0;
      right: 0;
      border-top: 1.5px dashed #2563eb;
      pointer-events: none;
      z-index: 2;
    }
    .target-tag {
      position: absolute;
      right: 6px;
      top: -18px;
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 4px;
    }
    .bar-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 100%;
      justify-content: flex-end;
      gap: 4px;
    }
    .bar-val {
      font-size: 10px;
      color: var(--slate);
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    .bar-track {
      width: 100%;
      max-width: 34px;
      flex: 1;
      display: flex;
      align-items: flex-end;
      background: #f1f5f9;
      border-radius: 6px 6px 0 0;
      overflow: hidden;
    }
    .bar-fill {
      width: 100%;
      background: linear-gradient(180deg, #38bdf8 0%, #0284c7 100%);
      border-radius: 6px 6px 0 0;
    }
    .bar-fill-hit {
      background: linear-gradient(180deg, #34d399 0%, #059669 100%);
    }
    .bar-lbl {
      font-size: 11px;
      color: var(--slate);
      padding-bottom: 6px;
      font-weight: 600;
    }
    .month-cell {
      font-weight: 700;
      white-space: nowrap;
      width: 64px;
    }
    .event-pill {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 3px 8px;
      margin: 2px 4px 2px 0;
      font-size: 12px;
    }
    .event-sym { font-weight: 700; color: var(--navy); }
    .event-date { color: var(--muted); font-size: 11px; }
    .footer {
      margin-top: 20px;
      padding: 16px 20px;
      background: #f1f5f9;
      border-radius: 12px;
      font-size: 11.5px;
      color: var(--slate);
    }
    .footer strong { color: var(--navy); }
    .footer ul { margin: 6px 0 0; padding-left: 18px; }
    @media (max-width: 768px) {
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .section { padding: 14px; overflow-x: auto; }
    }
    @media print {
      body { background: #ffffff; padding: 0; }
      .print-btn { display: none; }
      .header { box-shadow: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .section, .kpi-card { box-shadow: none; break-inside: avoid; }
      .bar-fill, .bar-fill-hit, .badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <div>
        <div class="brand">VESTENTIAL · WEALTH CASHFLOW PLANNER</div>
        <h1>${c.reportTitle}</h1>
        <div class="meta-row">
          <span class="meta-chip">${c.styleLabel}：${escapeHtml(styleName)}</span>
          <span class="meta-chip">${c.targetLabel}：${fmtNtd(evaluation.targetMonthlyNet)}</span>
          <span class="meta-chip">${c.generatedLabel}：${escapeHtml(timestamp)}</span>
        </div>
      </div>
      <button type="button" class="print-btn" onclick="window.print()">${c.printBtn}</button>
    </header>

    <section class="kpi-grid">
      <div class="kpi-card highlight">
        <div class="kpi-label">${c.kpiAvgMonthly}</div>
        <div class="kpi-value" style="color: var(--emerald);">${fmtNtd(evaluation.monthlyAvgNet)}</div>
        <div class="kpi-sub">${c.kpiAchievement(fmtNtd(evaluation.targetMonthlyNet), achievementPct)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${c.kpiTotalCapital}</div>
        <div class="kpi-value">${fmtNtd(evaluation.totalCapital)}</div>
        <div class="kpi-sub">${c.kpiAssetsCount(evaluation.assets.length)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${c.kpiAnnualNet}</div>
        <div class="kpi-value">${fmtNtd(evaluation.annualNet)}</div>
        <div class="kpi-sub">${c.kpiAnnualNetSub(fmtNtd(evaluation.annualGross), fmtPct(evaluation.portfolioYieldPct))}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">${c.kpiNhi}</div>
        <div class="kpi-value" style="color: ${evaluation.annualNhiFee > 0 ? 'var(--amber)' : 'var(--navy)'};">
          ${evaluation.annualNhiFee > 0 ? `-${fmtNtd(evaluation.annualNhiFee)}` : 'NT$0'}
        </div>
        <div class="kpi-sub">${c.kpiNhiSub}</div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">
        <span>${c.sec1Title}</span>
        <span class="section-note">${c.sec1Note}</span>
      </h2>
      <table>
        <thead>
          <tr>
            <th>${c.colAsset}</th>
            <th class="num">${c.colPrice}</th>
            <th class="num">${c.colLots}</th>
            <th class="num">${c.colCapital}</th>
            <th class="num">${c.colWeight}</th>
            <th class="num">${c.col54c}</th>
            <th class="num">${c.colSafeLots}</th>
            <th class="num">${c.colAnnualNet}</th>
            <th>${c.colNhiStatus}</th>
          </tr>
        </thead>
        <tbody>
          ${assetRows}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2">${c.totalLabel}</td>
            <td class="num">${evaluation.assets.reduce((s, a) => s + a.lots, 0).toLocaleString('en-US')} ${c.lotsUnit}</td>
            <td class="num">${fmtNtd(evaluation.totalCapital)}</td>
            <td class="num">100.00%</td>
            <td class="num">—</td>
            <td class="num">—</td>
            <td class="num strong-green">${fmtNtd(evaluation.annualNet)}</td>
            <td class="sub">${c.effectiveYieldLabel(fmtPct(evaluation.portfolioYieldPct))}</td>
          </tr>
        </tfoot>
      </table>
    </section>

    <section class="section">
      <h2 class="section-title">
        <span>${c.sec2Title}</span>
        <span class="section-note">${c.sec2Note(fmtNtd(evaluation.targetMonthlyNet))}</span>
      </h2>
      <div class="chart-wrap">
        <div class="chart-area">
          <div class="target-line" style="bottom: ${targetLinePct}%;">
            <span class="target-tag">${c.targetTag(fmtNtd(evaluation.targetMonthlyNet))}</span>
          </div>
          ${monthBars}
        </div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">
        <span>${c.sec3Title}</span>
        <span class="section-note">${c.sec3Note}</span>
      </h2>
      <table>
        <thead>
          <tr>
            <th>${c.colMonth}</th>
            <th class="num">${c.colGross}</th>
            <th class="num">${c.colNhi}</th>
            <th class="num">${c.colNet}</th>
            <th>${c.colMonthItems}</th>
          </tr>
        </thead>
        <tbody>
          ${monthRows}
        </tbody>
      </table>
    </section>

    <footer class="footer">
      <strong>${c.disclaimerTitle}</strong>
      <ul>
        <li>${c.disclaimer1}</li>
        <li>${c.disclaimer2}</li>
        <li>${c.disclaimer3}</li>
      </ul>
    </footer>
  </div>
</body>
</html>`
}
