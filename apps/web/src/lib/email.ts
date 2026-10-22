import nodemailer from 'nodemailer'
import type { MarketFocusItem, MarketFocusMeta } from '@stock/database'
import { getMarketFocus, getMarketFocusMeta, listActiveMarketFocusSubscribers, getAgentSetting, setAgentSetting } from '@stock/database'
import { getTaiwanDateStr } from '@/lib/auth'
import { getTaiwanHour, isNewsletterSendWindow } from './newsletter-window'
import { DEFAULT_CHIP_THRESHOLDS } from './chip-radar'

export const FALLBACK_SUMMARY_PREFIX = '當日市場焦點：'

const FALLBACK_SUMMARY_REGEX = new RegExp(`^${FALLBACK_SUMMARY_PREFIX}`)

export function isSummaryFallback(summary: string): boolean {
  return FALLBACK_SUMMARY_REGEX.test(summary)
}

const SITE_BASE = process.env.AUTH_BASE_URL ?? 'https://vestential.com'
const SITE_LINK = `${SITE_BASE}/market-focus`

// 社群推廣：設定這兩個 env 後，電子報 footer 會放 IG / Threads 追蹤連結。
const SOCIAL_LINKS = {
  instagram: process.env.INSTAGRAM_PROFILE_URL ?? '',
  threads: process.env.THREADS_PROFILE_URL ?? '',
}

// ─── SMTP / 收件人設定 ────────────────────────────────────────────
function smtpConfig() {
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const to = process.env.NOTIFY_TO
  if (!user || !pass || !to) {
    console.warn('[Notify] SMTP_USER / SMTP_PASS / NOTIFY_TO 未設定,略過寄送')
    return null
  }
  return {
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user, pass },
    from: process.env.NOTIFY_FROM || user,
    to,
  }
}

export async function sendMailCore(subject: string, text: string, html?: string, toOverride?: string): Promise<boolean> {
  const cfg = smtpConfig()
  if (!cfg) return false
  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.auth,
      // 2026-09-26 job 卡 running 教訓：Gmail SMTP 卡住時預設等超久，單封信就能拖垮整條 job
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 60_000,
    })
    const sendPromise = transporter.sendMail({
      from: `Vestential <${cfg.from}>`,
      to: toOverride ?? cfg.to,
      subject,
      text,
      html,
    })
    // 雙保險：整封信 90 秒還沒完就放棄（best-effort 通知不該卡死主流程）
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('email send timeout (90s)')), 90_000),
    )
    await Promise.race([sendPromise, timeoutPromise])
    console.log(`[Notify] email sent: ${subject} -> ${toOverride ?? cfg.to}`)
    return true
  } catch (e) {
    console.error('[Notify] email send failed:', subject, e)
    return false
  }
}

// ─── 時間格式化 (Asia/Taipei) ────────────────────────────────────
function formatTwDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

function formatTwDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(d)
}

// ─── HTML 逃逸 ───────────────────────────────────────────────────
function escapeHtml(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── ① 每日市場焦點總覽信 ──────────────────────────────────────
function buildBrandHeader(generatedAtIso?: string | null): string {
  const timeStr = formatTwDateTime(generatedAtIso ?? new Date().toISOString())
  return `
  <div style="background:#0f172a;background:linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);color:#ffffff;padding:26px 28px;border-radius:12px 12px 0 0;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span style="font-size:20px;font-weight:800;letter-spacing:0.5px;color:#ffffff;">Vestential · 市場焦點</span>
      <span style="background:rgba(255,255,255,0.12);color:#c7d2fe;font-size:11px;font-weight:600;padding:3px 10px;border-radius:9999px;border:1px solid rgba(255,255,255,0.15);">近 2 天精選</span>
    </div>
    <div style="font-size:13px;color:#94a3b8;line-height:1.6;margin-top:4px;">
      依價值投資與長期累積精神，由 AI 篩選近期台股關鍵要聞與產業實質影響
    </div>
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1);font-size:12px;color:#cbd5e1;display:flex;gap:16px;">
      <span>🕒 發布時間：${escapeHtml(timeStr)}</span>
      <span style="margin-left:12px;">📊 來源：多來源財經聚合</span>
    </div>
  </div>`
}

function buildSocialPromoBlock(): string {
  const items = [
    SOCIAL_LINKS.instagram ? `<a href="${escapeHtml(SOCIAL_LINKS.instagram)}" style="color:#64748b;text-decoration:underline;">Instagram</a>` : '',
    SOCIAL_LINKS.threads ? `<a href="${escapeHtml(SOCIAL_LINKS.threads)}" style="color:#64748b;text-decoration:underline;">Threads</a>` : '',
  ].filter(Boolean)
  if (items.length === 0) return ''
  return `<div style="margin-top:6px;">追蹤我們：${items.join(' · ')}，每日市場焦點不漏接。</div>`
}

function buildUnsubscribeBlock(opts?: { email?: string; token?: string }): string {
  if (opts?.email && opts?.token) {
    const url = `${SITE_BASE}/api/market-focus/unsubscribe?email=${encodeURIComponent(opts.email)}&token=${encodeURIComponent(opts.token)}`
    return `<div style="margin-top:6px;">不想再收到電子報？<a href="${escapeHtml(url)}" style="color:#64748b;text-decoration:underline;">立即退訂</a>。</div>`
  }
  return ''
}

function buildSummaryHtml(
  summary: string,
  items: MarketFocusItem[],
  generatedAtIso?: string | null,
  opts?: { email?: string; token?: string },
): string {
  const listHtml = items
    .map((it, i) => {
      const link = it.source_url ?? it.url
      const sourceBadge = it.source
        ? `<span style="display:inline-block;background:#e0e7ff;color:#3730a3;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;margin-right:8px;">${escapeHtml(it.source)}</span>`
        : ''
      const time = it.published_at ? `<span style="color:#64748b;font-size:12px;">🕒 ${escapeHtml(formatTwDateTime(it.published_at))}</span>` : ''

      const summaryBlock = it.summary
        ? `
        <div style="background:#f8fafc;border-left:3px solid #3b82f6;padding:10px 14px;border-radius:0 8px 8px 0;margin:10px 0;font-size:13.5px;line-height:1.75;color:#334155;">
          <div style="font-weight:700;color:#1e40af;font-size:12px;margin-bottom:3px;">📝 AI 重點摘要</div>
          ${escapeHtml(it.summary)}
        </div>`
        : ''

      const reasonBlock = it.reason
        ? `<div style="color:#475569;font-size:13px;margin:8px 0 4px;line-height:1.6;">
            <b style="color:#0f172a;">💡 選取理由：</b>${escapeHtml(it.reason)}
          </div>`
        : ''

      return `
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;margin:12px 0;background:#ffffff;">
        <div style="margin-bottom:6px;">
          ${sourceBadge}
          ${time}
        </div>
        <div style="font-size:15.5px;font-weight:700;color:#0f172a;line-height:1.5;">
          ${i + 1}. ${escapeHtml(it.title)}
        </div>
        ${summaryBlock}
        ${reasonBlock}
        <div style="margin-top:10px;font-size:13px;">
          <a href="${escapeHtml(link)}" style="color:#2563eb;text-decoration:none;font-weight:600;" target="_blank">閱讀新聞原文 →</a>
        </div>
      </div>`
    })
    .join('\n')

  return `
    <div style="background:#f1f5f9;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,Microsoft JhengHei,sans-serif;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
        ${buildBrandHeader(generatedAtIso)}
        <div style="padding:26px 24px;">
          <!-- 總覽區塊 -->
          <div style="margin-bottom:24px;">
            <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:4px;">✨ 本期市場總覽</div>
            <div style="font-size:13px;color:#64748b;margin-bottom:12px;">由 AI 通讀近期重要財經要聞後，提煉出當前台股大盤、焦點產業與總體經濟核心脈動：</div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;font-size:14.5px;line-height:1.85;color:#1e293b;white-space:pre-wrap;">${escapeHtml(summary)}</div>
          </div>

          <!-- 前往官網按鈕 -->
          <div style="text-align:center;margin:24px 0 28px;">
            <a href="${escapeHtml(SITE_LINK)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:9999px;box-shadow:0 2px 4px rgba(37,99,235,0.2);">前往 Vestential 瀏覽完整市場焦點 →</a>
          </div>

          <!-- 精選新聞列表 -->
          <div style="border-top:1px solid #e2e8f0;padding-top:20px;">
            <div style="font-size:17px;font-weight:800;color:#0f172a;margin-bottom:4px;">📰 本期精選新聞</div>
            <div style="font-size:13px;color:#64748b;margin-bottom:14px;">嚴選具實質基本面影響力的關鍵報導，每則皆附 AI 摘要與選取原因：</div>
            ${listHtml}
          </div>
        </div>

        <!-- 頁尾 -->
        <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 24px;font-size:12px;color:#64748b;line-height:1.8;">
          <b>關於此信件：</b><br/>
          • 本信由 Vestential 排程自動產出並寄送（每 4 小時追蹤一次最新市場焦點）。<br/>
          • 篩選範圍涵蓋近 2 天重點報導；內容僅供研究參考，不構成任何買賣投資建議。<br/>
          • 新聞原始全文版權均屬原始媒體所有。<br/>
          ${buildSocialPromoBlock()}
          ${buildUnsubscribeBlock(opts)}
          <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #cbd5e1;color:#94a3b8;">
            <a href="${escapeHtml(SITE_BASE)}" style="color:#64748b;text-decoration:underline;">Vestential 首頁</a> · 
            <a href="${escapeHtml(SITE_LINK)}" style="color:#64748b;text-decoration:underline;">市場焦點專頁</a> — 價值投資路上的必備工具
          </div>
        </div>
      </div>
    </div>`
}

function buildSummaryText(
  summary: string,
  items: MarketFocusItem[],
  generatedAtIso?: string | null,
  opts?: { email?: string; token?: string },
): string {
  const timeStr = formatTwDateTime(generatedAtIso ?? new Date().toISOString())
  const list = items
    .map((it, i) => {
      const link = it.source_url ?? it.url
      const source = it.source ? `[${it.source}] ` : ''
      const time = it.published_at ? ` (${formatTwDateTime(it.published_at)})` : ''
      const summaryPart = it.summary ? `   【AI 重點摘要】${it.summary}\n` : ''
      const reasonPart = it.reason ? `   【選取理由】${it.reason}\n` : ''
      return `${i + 1}. ${source}${it.title}${time}\n${summaryPart}${reasonPart}   前往原文: ${link}`
    })
    .join('\n\n')

  return `========================================
Vestential · 市場焦點（近 2 天精選）
發布時間：${timeStr}
說明：依價值投資精神，由 AI 篩選近期台股關鍵要聞與產業實質影響
========================================

【✨ 本期市場總覽】
（由 AI 通讀近期要聞提煉之核心脈絡）
${summary}

----------------------------------------
【📰 本期精選新聞】
（共 ${items.length} 則關鍵報導，附 AI 摘要與選取原因）
----------------------------------------
${list}

========================================
查看完整網頁版：${SITE_LINK}

※ 本信由 Vestential 自動排程產生並發送。
※ 資料來源涵蓋鉅亨網、經濟日報等財經媒體；內容僅供研究參考，不構成投資建議。
${opts?.email && opts?.token ? `\n不想再收到電子報？退訂：${SITE_BASE}/api/market-focus/unsubscribe?email=${encodeURIComponent(opts.email)}&token=${encodeURIComponent(opts.token)}` : ''}
========================================`
}

/**
 * 將最新一輪市場焦點總覽寄給 NOTIFY_TO 與所有 active 訂閱者。
 * 訂閱者會收到個人化退訂連結。回傳管理員信箱是否寄送成功。
 */
// ─── ①a 訂閱確認信（double opt-in）───────────────────────────
export async function sendMarketFocusConfirmEmail(email: string, token: string): Promise<boolean> {
  const confirmUrl = `${SITE_BASE}/api/market-focus/confirm?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`
  const subject = '📬 確認訂閱 Vestential 市場焦點'
  const text = `您好，

您剛剛在 Vestential「市場焦點」頁面提交了電子報訂閱申請。
請點選下方連結完成確認訂閱（若您並未申請，請直接忽略此信）：

${confirmUrl}

完成確認後，最新一期市場焦點總覽更新時，就會自動寄送到您的信箱 ${email}。
退訂與管理，之後信件內也有提供。

—— Vestential 團隊`
  const html = `
    <div style="background:#f1f5f9;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,Microsoft JhengHei,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
        ${buildBrandHeader()}
        <div style="padding:26px 24px;">
          <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:4px;">📬 確認您的訂閱</div>
          <div style="font-size:13px;color:#64748b;margin-bottom:16px;">您剛剛在 Vestential 市場焦點頁面提交了電子報訂閱申請。</div>
          <div style="font-size:14px;color:#1e293b;line-height:1.8;margin-bottom:24px;">
            請點選下方按鈕完成確認訂閱。若您並未申請訂閱，請直接忽略這封信。
          </div>
          <div style="text-align:center;margin-bottom:24px;">
            <a href="${escapeHtml(confirmUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 30px;border-radius:9999px;box-shadow:0 2px 4px rgba(37,99,235,0.2);">✅ 確認訂閱市場焦點</a>
          </div>
          <div style="font-size:12px;color:#64748b;line-height:1.8;">
            · 確認後，最新一期市場焦點總覽更新時即自動寄送。<br/>
            · 若按鈕無法點擊，請複製以下連結到瀏覽器開啟：<br/>
            <a href="${escapeHtml(confirmUrl)}" style="color:#2563eb;word-break:break-all;">${escapeHtml(confirmUrl)}</a>
          </div>
        </div>
        <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 24px;font-size:12px;color:#64748b;line-height:1.8;">
          ${buildSocialPromoBlock()}
          <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #cbd5e1;color:#94a3b8;">
            <a href="${escapeHtml(SITE_BASE)}" style="color:#64748b;text-decoration:underline;">Vestential 首頁</a> ·
            <a href="${escapeHtml(SITE_LINK)}" style="color:#64748b;text-decoration:underline;">市場焦點專頁</a> — 價值投資路上的必備工具
          </div>
        </div>
      </div>
    </div>`
  return sendMailCore(subject, text, html, email)
}

export async function sendMarketFocusSummary(
  forcedEditionKey?: string,
  force = false,
  bypassWindow = false,
): Promise<boolean> {
  const [meta, items] = await Promise.all([getMarketFocusMeta(), getMarketFocus(6, 2)])
  if (!meta?.summary) {
    console.warn('[Notify] market_focus_meta 無內容,略過寄送')
    return false
  }

  if (!force && !bypassWindow) {
    const hourTw = getTaiwanHour()
    if (!isNewsletterSendWindow(hourTw)) {
      console.log(
        `[Notify] 現在 ${hourTw}:xx（TW）不在電子報寄送時段（08:00–13:59），略過寄送（凌晨／晚間排程只刷新頁面）`,
      )
      return false
    }
  }

  const editionKey = forcedEditionKey || meta.generated_at
  const todayStr = getTaiwanDateStr()
  if (!force) {
    if (editionKey) {
      const lastSent = await getAgentSetting('email.last_sent_edition').catch(() => null)
      if (lastSent === editionKey) {
        console.log(`[Notify] editionKey ${editionKey} 已寄送過電子報，略過重複寄送（防洗版保護）`)
        return false
      }
    }
    // 每日一封：同日已有寄送紀錄時，第二～四版不再寄；DB 讀不到保守放行（寧多寄不漏寄）
    const lastSentDate = await getAgentSetting('email.last_sent_date').catch(() => null)
    if (lastSentDate === todayStr) {
      console.log(`[Notify] 今日(${todayStr})電子報已寄送，略過重複寄送`)
      return false
    }
  }

  const dateStr = formatTwDate(meta.generated_at ?? new Date().toISOString())
  const subject = `📬 今日市場焦點 (Vestential) — ${dateStr}（近 2 天重點精選）`

  const adminOk = await sendMailCore(
    subject,
    buildSummaryText(meta.summary, items, meta.generated_at),
    buildSummaryHtml(meta.summary, items, meta.generated_at),
  )

  const subscribers = await listActiveMarketFocusSubscribers().catch(() => [])
  // 併發寄送（一人卡住不拖全家；單封已有 90 秒上限）
  // 注意：map 回呼內 property narrowing 會失效，先把值 hoist 成 const 再用
  const summaryText = meta.summary
  const generatedAt = meta.generated_at
  const mailTasks = subscribers
    .map((sub) => {
      const to = sub.email
      if (!to || !to.includes('@')) return null
      return sendMailCore(
        subject,
        buildSummaryText(summaryText, items, generatedAt, { email: to, token: sub.token }),
        buildSummaryHtml(summaryText, items, generatedAt, { email: to, token: sub.token }),
        to,
      )
    })
    .filter((t): t is Promise<boolean> => t !== null)
  const results = await Promise.allSettled(mailTasks)
  const sentTo = results.filter((r) => r.status === 'fulfilled' && r.value).length
  if (subscribers.length > 0) {
    console.log(`[Notify] 電子報已寄出 ${sentTo}/${subscribers.length} 位訂閱者`)
  }

  if (editionKey) {
    await setAgentSetting({
      key: 'email.last_sent_edition',
      value: editionKey,
      category: 'email',
      label: '最後寄送之電子報版本',
    }).catch((e) => {
      console.warn('[Notify] 記錄 email.last_sent_edition 失敗:', e)
    })
  }

  // 每日標記：只有成功（adminOk）才記日期，SMTP 失敗不寫、失敗同日可補寄
  if (adminOk) {
    await setAgentSetting({
      key: 'email.last_sent_date',
      value: todayStr,
      category: 'email',
      label: '電子報最後寄送日期',
    }).catch((e) => {
      console.warn('[Notify] 記錄 email.last_sent_date 失敗:', e)
    })
  }

  return adminOk
}

// ─── ② 異常告警信 ───────────────────────────────────────────────
export async function sendMarketFocusAlert(topic: string, message: string): Promise<boolean> {
  const ts = formatTwDateTime(new Date().toISOString())
  const env = process.env.NODE_ENV ?? 'development'
  const text = `Vestential 系統告警通知

時間 : ${ts}
類型 : ${topic}
錯誤 : ${message}
環境 : ${env}

建議 : 查看 Azure Logic App run、GitHub Actions run 或容器 log
       ${SITE_LINK}`
  const html = `
    <div style="background:#fffbeb;padding:24px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #fde68a;border-radius:12px;overflow:hidden;">
        <div style="background:#b45309;color:#ffffff;padding:16px 24px;font-weight:800;font-size:16px;">⚠️ Vestential 系統告警通知</div>
        <div style="padding:20px 24px;font-size:14px;color:#374151;line-height:1.8;">
          <div><b>時間</b>: ${escapeHtml(ts)}</div>
          <div><b>類型</b>: ${escapeHtml(topic)}</div>
          <div><b>錯誤</b>: ${escapeHtml(message)}</div>
          <div><b>環境</b>: ${escapeHtml(env)}</div>
          <div style="margin-top:14px;font-size:13px;color:#6b7280;">建議查看 Azure Logic App run、GitHub Actions run 或容器 log:<br/>${escapeHtml(SITE_LINK)}</div>
        </div>
      </div>
    </div>`
  return sendMailCore(`⚠️ Vestential 系統告警通知 — ${topic}`, text, html)
}

// ─── ②a 籌碼雷達異常榜 digest（Issue #71，email-only） ──────────
// 沿 sendMarketFocusSummary 扇出模式：NOTIFY_TO＋既有 market_focus_subscribers
//（active；個人化退訂連結沿 buildUnsubscribeBlock），不新增任何渠道；
// 每日一榜：agent_settings `email.last_chip_edition` 記 asOf，同日不重寄。

export interface ChipDigestItem {
  symbol: string
  name: string
  direction: 'buy' | 'sell'
  days: number
  netShares: number
  ratioPct: number
}

function fmtShares(n: number): string {
  const a = Math.abs(n)
  if (a >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}億股`
  if (a >= 10_000) return `${(n / 10_000).toFixed(1)}萬股`
  return `${n.toLocaleString('en-US')}股`
}

/** Issue #75 單測用：digest 內文（門檻行／排序註／前20註／快照聲明四要素）。 */
export function buildChipDigestText(
  asOf: string,
  items: ChipDigestItem[],
  scanned: number,
  thresholds?: { consecDays: number; ratioPct: number },
): string {
  const consecDays = thresholds?.consecDays ?? DEFAULT_CHIP_THRESHOLDS.consecDays
  const ratioPct = thresholds?.ratioPct ?? DEFAULT_CHIP_THRESHOLDS.ratioPct
  const lines = items
    .slice(0, 20)
    .map(
      (it, i) =>
        `${i + 1}. ${it.symbol} ${it.name}：法人${it.direction === 'buy' ? '連買' : '連賣'}${it.days}天，` +
        `當日淨${it.netShares >= 0 ? '買超' : '賣超'}${fmtShares(it.netShares)}，佔成交額 ${it.ratioPct.toFixed(2)}%`,
    )
    .join('\n')
  const more = items.length > 20 ? `\n…等共 ${items.length} 檔（信內僅列前 20，完整榜單請見網站）` : ''
  return `========================================
Vestential · 主力籌碼雷達（法人連買賣異常榜）
資料時間：${asOf}（盤後初值；上市；未含融資）
門檻：連買／賣 ≥${consecDays} 天且佔比 ≥${ratioPct}%（後台可調）· 依佔比排序 · 掃描 ${scanned} 檔
========================================

${lines}${more}

----------------------------------------
查看完整榜單：${SITE_BASE}/chip-radar

※ 榜單依佔比排序${items.length > 20 ? '，信內僅列前 20 檔' : ''}。
※ 本信為寄送時快照（${asOf}），若已隔日重算以網站即時為準。
※ 法人＝外資合計＋投信（TWT38U＋TWT44U）；佔比＝|淨超×收盤|／成交額。
※ 統計訊號非投資建議；使用即代表同意服務條款 ${SITE_BASE}/terms。
========================================`
}

/** 異常榜 digest（讀時順帶 best-effort；同 asOf 已寄即略過；回傳是否寄出）。 */
export async function sendChipRadarDigest(
  asOf: string,
  items: ChipDigestItem[],
  scanned: number,
  thresholds?: { consecDays: number; ratioPct: number },
): Promise<boolean> {
  if (!asOf || items.length === 0) return false
  try {
    const lastSent = await getAgentSetting('email.last_chip_edition').catch(() => null)
    if (lastSent === asOf) return false

    const subject = `📡 主力籌碼雷達 ${asOf} — 法人連買賣異常 ${items.length} 檔（盤後初值）`
    const text = buildChipDigestText(asOf, items, scanned, thresholds)
    const consecDays = thresholds?.consecDays ?? DEFAULT_CHIP_THRESHOLDS.consecDays
    const ratioPct = thresholds?.ratioPct ?? DEFAULT_CHIP_THRESHOLDS.ratioPct
    const listHtml = items
      .slice(0, 20)
      .map(
        (it, i) =>
          `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;margin:8px 0;background:#ffffff;font-size:14px;color:#0f172a;">` +
          `<b>${i + 1}. ${escapeHtml(it.symbol)} ${escapeHtml(it.name)}</b>：` +
          `法人${it.direction === 'buy' ? '連買' : '連賣'}${it.days}天，` +
          `當日淨${it.netShares >= 0 ? '買超' : '賣超'}${escapeHtml(fmtShares(it.netShares))}，` +
          `佔成交額 ${it.ratioPct.toFixed(2)}%</div>`,
      )
      .join('\n')
    const moreHtml = items.length > 20 ? `<div style="font-size:13px;color:#64748b;">…等共 ${items.length} 檔（信內僅列前 20，完整榜單請見網站）。</div>` : ''
    const html = `
    <div style="background:#f1f5f9;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,Microsoft JhengHei,sans-serif;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
        <div style="background:#0f172a;color:#ffffff;padding:20px 24px;font-weight:800;font-size:16px;">📡 主力籌碼雷達 — 法人連買賣異常榜</div>
        <div style="padding:20px 24px;font-size:13px;color:#64748b;">資料時間：${escapeHtml(asOf)}（盤後初值；上市；未含融資）· 掃描 ${scanned} 檔<br/>門檻：連買／賣 ≥${consecDays} 天且佔比 ≥${ratioPct}%（後台可調）· 依佔比排序</div>
        <div style="padding:0 24px 8px;">${listHtml}${moreHtml}</div>
        <div style="text-align:center;margin:16px 0 20px;">
          <a href="${escapeHtml(SITE_BASE)}/chip-radar" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:9999px;">查看完整榜單 →</a>
        </div>
        <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 24px;font-size:12px;color:#64748b;line-height:1.8;">
          法人＝外資合計＋投信（TWT38U＋TWT44U）；佔比＝|淨超×收盤|／成交額。<br/>
          榜單依佔比排序${items.length > 20 ? '，信內僅列前 20 檔' : ''}。<br/>
          本信為寄送時快照（${escapeHtml(asOf)}），若已隔日重算以網站即時為準。<br/>
          統計訊號非投資建議；使用即代表同意<a href="${escapeHtml(SITE_BASE)}/terms" style="color:#64748b;text-decoration:underline;">服務條款</a>。
        </div>
      </div>
    </div>`

    const adminOk = await sendMailCore(subject, text, html)
    const subscribers = await listActiveMarketFocusSubscribers().catch(() => [])
    const mailTasks = subscribers
      .map((sub) => {
        const to = sub.email
        if (!to || !to.includes('@')) return null
        const unsub = buildUnsubscribeBlock({ email: to, token: sub.token })
        const htmlWithUnsub = unsub ? html.replace('服務條款</a>。', `服務條款</a>。${unsub}`) : html
        const textWithUnsub = unsub
          ? `${text}\n\n不想再收到電子報？退訂：${SITE_BASE}/api/market-focus/unsubscribe?email=${encodeURIComponent(to)}&token=${encodeURIComponent(sub.token)}`
          : text
        return sendMailCore(subject, textWithUnsub, htmlWithUnsub, to)
      })
      .filter((t): t is Promise<boolean> => t !== null)
    const results = await Promise.allSettled(mailTasks)
    const sentTo = results.filter((r) => r.status === 'fulfilled' && r.value).length
    if (subscribers.length > 0) {
      console.log(`[Notify] chip digest 已寄出 ${sentTo}/${subscribers.length} 位訂閱者`)
    }
    if (adminOk) {
      await setAgentSetting({
        key: 'email.last_chip_edition',
        value: asOf,
        category: 'email',
        label: '籌碼雷達 digest 最後寄送資料日',
      }).catch((e) => {
        console.warn('[Notify] 記錄 email.last_chip_edition 失敗:', e)
      })
    }
    return adminOk
  } catch (e) {
    console.error('[Notify] chip digest failed (non-blocking):', e)
    return false
  }
}

// ─── ③ 健康覆盤告警信 ───────────────────────────────────────────
const HEALTH_ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000
let lastHealthAlertAt = 0

/** 健康覆盤發現問題(修復後仍存在)時寄信;6 小時內不重複寄,避免洗版。 */
export async function sendHealthAlert(report: {
  issues: { code: string; severity: string; message: string }[]
  repairs: { action: string; done: boolean }[]
  kind: string
}): Promise<boolean> {
  const now = Date.now()
  if (now - lastHealthAlertAt < HEALTH_ALERT_THROTTLE_MS) {
    console.warn('[Notify] health alert throttled (6h window)')
    return false
  }
  lastHealthAlertAt = now

  const ts = formatTwDateTime(new Date().toISOString())
  const env = process.env.NODE_ENV ?? 'development'
  const issueLines = report.issues.map((i) => `- [${i.severity}] ${i.code}: ${i.message}`).join('\n')
  const repairLines = report.repairs.length ? report.repairs.map((r) => `- ${r.action}: ${r.done ? 'done' : 'failed/未執行'}`).join('\n') : '無'
  const text = `Vestential 健康覆盤告警 (${report.kind})

時間   : ${ts}
環境   : ${env}
問題數 : ${report.issues.length}

問題:
${issueLines}

已執行修復:
${repairLines}

建議查看 GitHub Actions run「health-report」或 Azure 容器 log:
${SITE_LINK}`
  const html = `
    <div style="background:#fffbeb;padding:24px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #fde68a;border-radius:12px;overflow:hidden;">
        <div style="background:#b45309;color:#ffffff;padding:16px 24px;font-weight:800;font-size:16px;">🩺 Vestential 健康覆盤告警 (${escapeHtml(report.kind)})</div>
        <div style="padding:20px 24px;font-size:14px;color:#374151;line-height:1.9;">
          <div><b>時間</b>: ${escapeHtml(ts)}</div>
          <div><b>環境</b>: ${escapeHtml(env)}</div>
          <div style="margin-top:10px;"><b>問題 (${report.issues.length})</b></div>
          <ul style="margin-top:4px;padding-left:20px;color:#92400e;">
            ${report.issues.map((i) => `<li>[${escapeHtml(i.severity)}] ${escapeHtml(i.code)} — ${escapeHtml(i.message)}</li>`).join('\n')}
          </ul>
          <div style="margin-top:10px;"><b>已執行修復</b></div>
          <ul style="margin-top:4px;padding-left:20px;color:#374151;">
            ${report.repairs.length ? report.repairs.map((r) => `<li>${escapeHtml(r.action)}: ${r.done ? 'done' : 'failed / 未執行'}</li>`).join('\n') : '<li>無</li>'}
          </ul>
          <div style="margin-top:14px;font-size:13px;color:#6b7280;">建議查看 GitHub Actions「health-report」或 Azure 容器 log:<br/>${escapeHtml(SITE_LINK)}</div>
        </div>
      </div>
    </div>`
  return sendMailCore(`🩺 Vestential 健康覆盤告警 — ${report.issues.length} 項`, text, html)
}