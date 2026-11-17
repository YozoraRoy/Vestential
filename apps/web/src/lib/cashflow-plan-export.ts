/**
 * /cashflow-plan 專業財富管理風格 HTML 報告產生器（client-safe，零外部依賴）。
 */

import type { CashflowPlanEvaluation } from './cashflow-plan'

export interface CashflowPlanExportParams {
  evaluation: CashflowPlanEvaluation
  styleName: string
  exportedAt?: string
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
}: CashflowPlanExportParams): string {
  const timestamp =
    exportedAt ??
    new Date().toLocaleString('zh-TW', {
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
          ? '無上限（免扣）'
          : `${a.safeMaxLots.toLocaleString('en-US')} 張`
      const statusBadge = a.nhiTriggered
        ? `<span class="badge badge-warn">單次逾門檻（+${fmtNtd(a.annualNhiFee)}/年）</span>`
        : `<span class="badge badge-ok">免扣安全區</span>`
      const historyNote = a.insufficientHistory
        ? `<span class="badge badge-muted">近1年配息紀錄不足</span>`
        : ''

      return `
        <tr>
          <td>
            <div class="sym">${escapeHtml(a.symbol)}</div>
            <div class="sub">${escapeHtml(a.name)}</div>
          </td>
          <td class="num">${fmtNtd(a.price)}</td>
          <td class="num">
            <strong>${a.lots.toLocaleString('en-US')} 張</strong>
            <div class="sub">${(a.lots * 1000).toLocaleString('en-US')} 股</div>
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
          <div class="bar-lbl">${m.month}月</div>
        </div>`
    })
    .join('\n')

  const monthRows = evaluation.months
    .map((m) => {
      const itemsHtml =
        m.items.length === 0
          ? `<span class="sub">本月無預估入帳</span>`
          : m.items
              .map(
                (it) =>
                  `<div class="event-pill">
                    <span class="event-sym">${escapeHtml(it.symbol)}</span>
                    <span>${it.lots.toLocaleString('en-US')}張 × ${it.cashDividend}元</span>
                    <span class="event-date">(${escapeHtml(it.payDate)})</span>
                    <strong class="strong-green">${fmtNtd(it.net)}</strong>
                  </div>`,
              )
              .join('')

      return `
        <tr>
          <td class="month-cell">${m.month} 月</td>
          <td class="num">${fmtNtd(m.gross)}</td>
          <td class="num ${m.nhiFee > 0 ? 'warn-text' : 'sub'}">${m.nhiFee > 0 ? `-${fmtNtd(m.nhiFee)}` : 'NT$0'}</td>
          <td class="num strong-green">${fmtNtd(m.net)}</td>
          <td>${itemsHtml}</td>
        </tr>`
    })
    .join('\n')

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vestential 股利現金流自由配置規劃報告｜月領目標 ${fmtNtd(evaluation.targetMonthlyNet)}</title>
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
        <h1>股利現金流自由配置規劃報告</h1>
        <div class="meta-row">
          <span class="meta-chip">配置風格：${escapeHtml(styleName)}</span>
          <span class="meta-chip">目標月領（稅後）：${fmtNtd(evaluation.targetMonthlyNet)}</span>
          <span class="meta-chip">報告產出時間：${escapeHtml(timestamp)}（台北時間）</span>
        </div>
      </div>
      <button type="button" class="print-btn" onclick="window.print()">列印 / 另存 PDF</button>
    </header>

    <section class="kpi-grid">
      <div class="kpi-card highlight">
        <div class="kpi-label">預估月均實拿（稅後）</div>
        <div class="kpi-value" style="color: var(--emerald);">${fmtNtd(evaluation.monthlyAvgNet)}</div>
        <div class="kpi-sub">目標 ${fmtNtd(evaluation.targetMonthlyNet)} · 達成率 ${achievementPct}%</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">預估總投入本金</div>
        <div class="kpi-value">${fmtNtd(evaluation.totalCapital)}</div>
        <div class="kpi-sub">共配置 ${evaluation.assets.length} 檔標的</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">年度預估稅後實拿</div>
        <div class="kpi-value">${fmtNtd(evaluation.annualNet)}</div>
        <div class="kpi-sub">稅前 ${fmtNtd(evaluation.annualGross)} · 實質殖利率 ${fmtPct(evaluation.portfolioYieldPct)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">二代健保補充保費（2.11%）</div>
        <div class="kpi-value" style="color: ${evaluation.annualNhiFee > 0 ? 'var(--amber)' : 'var(--navy)'};">
          ${evaluation.annualNhiFee > 0 ? `-${fmtNtd(evaluation.annualNhiFee)}` : 'NT$0'}
        </div>
        <div class="kpi-sub">僅就單次 54C ≥ NT$20,000 扣繳</div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">
        <span>一、標的張數配置與二代健保安全水位</span>
        <span class="section-note">安全張數＝單次配息 54C 股利所得低於 NT$20,000 之最大持有張數</span>
      </h2>
      <table>
        <thead>
          <tr>
            <th>標的</th>
            <th class="num">目前市價</th>
            <th class="num">配置張數</th>
            <th class="num">投入本金</th>
            <th class="num">資金佔比</th>
            <th class="num">54C 佔比</th>
            <th class="num">免扣安全張數</th>
            <th class="num">預估年領（稅後）</th>
            <th>健保檢核狀態</th>
          </tr>
        </thead>
        <tbody>
          ${assetRows}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2">合計</td>
            <td class="num">${evaluation.assets.reduce((s, a) => s + a.lots, 0).toLocaleString('en-US')} 張</td>
            <td class="num">${fmtNtd(evaluation.totalCapital)}</td>
            <td class="num">100.00%</td>
            <td class="num">—</td>
            <td class="num">—</td>
            <td class="num strong-green">${fmtNtd(evaluation.annualNet)}</td>
            <td class="sub">實質年化殖利率 ${fmtPct(evaluation.portfolioYieldPct)}</td>
          </tr>
        </tfoot>
      </table>
    </section>

    <section class="section">
      <h2 class="section-title">
        <span>二、1 至 12 月預估稅後實拿現金流分佈</span>
        <span class="section-note">綠色柱狀表示當月實拿達月領目標（${fmtNtd(evaluation.targetMonthlyNet)}）</span>
      </h2>
      <div class="chart-wrap">
        <div class="chart-area">
          <div class="target-line" style="bottom: ${targetLinePct}%;">
            <span class="target-tag">目標 ${fmtNtd(evaluation.targetMonthlyNet)}</span>
          </div>
          ${monthBars}
        </div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">
        <span>三、逐月入帳明細表</span>
        <span class="section-note">依近 12 個月實際配息發放月份分組</span>
      </h2>
      <table>
        <thead>
          <tr>
            <th>月份</th>
            <th class="num">稅前股利</th>
            <th class="num">二代健保</th>
            <th class="num">稅後實拿</th>
            <th>當月入帳標的明細</th>
          </tr>
        </thead>
        <tbody>
          ${monthRows}
        </tbody>
      </table>
    </section>

    <footer class="footer">
      <strong>試算口徑與免責聲明</strong>
      <ul>
        <li>本報告依 Vestential 近 12 個月實際除息與發放紀錄（TWSE / FinMind）試算，新掛牌或配息不足一年之標的不進行年化捏造。</li>
        <li>二代健保補充保費（2.11%）依據 2026 年適用稅制，僅針對單次給付之「54C 境內股利所得」達 NT$20,000（含）以上計扣；資本利得與收益平準金免扣。</li>
        <li>本報告僅供個人現金流模擬與資產配置參考，不構成任何形式之投資或稅務建議，實際配息金額與發放日以各投信／發行公司公告為準。</li>
      </ul>
    </footer>
  </div>
</body>
</html>`
}
