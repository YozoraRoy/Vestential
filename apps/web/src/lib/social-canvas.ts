import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import path from 'node:path'
import fs from 'node:fs'
import type { MarketFocusItem, MarketFocusMeta } from '@stock/database'

// ─── 圖卡 (OG-style) 生成 ─────────────────────────────────────────
// 1080×1080 深色品牌卡：Vestential / 日期 / 主標題 / 總覽 / footer。
// 字體：bundle 進 repo 的 Noto Sans CJK TC（Azure Linux 無系統中文字型）。

const CARD_W = 1080
const CARD_H = 1080
const FONT_NAME = 'Noto Sans CJK TC'

let fontLoaded = false
function ensureFont() {
  if (fontLoaded) return
  const candidates = [
    path.join(process.cwd(), 'apps/web/public/fonts/NotoSansTC-Regular.otf'),
    path.join(process.cwd(), 'public/fonts/NotoSansTC-Regular.otf'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        GlobalFonts.registerFromPath(p, FONT_NAME)
        fontLoaded = true
        return
      }
    } catch (e) {
      console.warn('[SocialCanvas] font register failed:', p, e)
    }
  }
  console.warn('[SocialCanvas] Noto Sans CJK TC not found; card text may render as boxes')
}

/** 依基底透明度的由上而下漸層遮罩（effect 底色越淺＝越保留 FLUX 構圖細節）。 */
function createMask(ctx: any, base: number) {
  const overlay = ctx.createLinearGradient(0, 0, 0, CARD_H)
  overlay.addColorStop(0, `rgba(11, 13, 19, ${base})`)
  overlay.addColorStop(0.4, `rgba(11, 13, 19, ${Math.min(base + 0.07, 0.95)})`)
  overlay.addColorStop(1, `rgba(11, 13, 19, ${Math.min(base + 0.17, 0.95)})`)
  return overlay
}

export interface SocialCardData {
  meta: MarketFocusMeta
  items: MarketFocusItem[]
}

export type SocialCardStyle = 'classic' | 'meme' | 'ai' | 'festival'

export interface SocialCardOptions {
  /** classic＝品牌資訊卡；meme＝梗圖大字版式；ai＝FLUX 專屬藝術圖＋大字 Hero；festival＝節慶賀卡（中秋）。 */
  style?: SocialCardStyle
  /** style=meme 或 style=ai 時的梗圖內容。 */
  meme?: { title: string; punchline: string } | null
  /** AI 生成的高品質科技底圖 Buffer（選填，未傳入或失敗時使用純色漸層兜底）。 */
  backgroundImage?: Buffer | null
  /** style=festival 時的賀詞大字（預設「中秋快樂」）與副標。 */
  festival?: { title?: string; subtitle?: string } | null
}

/** 依市場焦點總覽與新聞生成 1080×1080 PNG buffer。 */
export async function renderSocialCard(data: SocialCardData, opts: SocialCardOptions = {}): Promise<Buffer> {
  ensureFont()
  const style = opts.style ?? 'classic'
  const canvas = createCanvas(CARD_W, CARD_H)
  const ctx = canvas.getContext('2d')

  // ── 背景：若有傳入底圖則繪製並疊上深色遮罩，否則使用深色純色漸層 ──────
  // AI 全圖卡／節慶賀卡全幅展示藝術構圖，遮罩最淺；classic/meme 以可讀性優先，遮罩較深。
  let drawnBg = false
  if (opts.backgroundImage && opts.backgroundImage.length > 0) {
    try {
      const bgImg = await loadImage(opts.backgroundImage)
      ctx.drawImage(bgImg, 0, 0, CARD_W, CARD_H)
      const overlay = createMask(ctx, style === 'ai' || style === 'festival' ? 0.2 : 0.55)
      ctx.fillStyle = overlay
      ctx.fillRect(0, 0, CARD_W, CARD_H)
      drawnBg = true
    } catch (err) {
      console.warn('[SocialCanvas] 載入背景圖失敗，降級使用純色漸層:', err)
    }
  }

  if (!drawnBg && style === 'festival') {
    // 節慶賀卡兜底：深藍夜空→墨綠的金綠漸層（無 FLUX 底圖時仍可發出）
    const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H)
    bg.addColorStop(0, '#0d1526')
    bg.addColorStop(0.55, '#0b1a17')
    bg.addColorStop(1, '#0b0d13')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, CARD_W, CARD_H)
    // 右上金色月暈
    const moon = ctx.createRadialGradient(CARD_W - 190, 220, 20, CARD_W - 190, 220, 220)
    moon.addColorStop(0, 'rgba(250, 204, 21, 0.55)')
    moon.addColorStop(1, 'rgba(250, 204, 21, 0)')
    ctx.fillStyle = moon
    ctx.fillRect(0, 0, CARD_W, CARD_H)
    drawnBg = true
  }

  if (!drawnBg) {
    const bg = ctx.createLinearGradient(0, 0, 0, CARD_H)
    bg.addColorStop(0, '#10131a')
    bg.addColorStop(1, '#0b0d13')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, CARD_W, CARD_H)
  }

  // 裝飾：右上小色塊（品牌綠）與底部細線
  ctx.fillStyle = '#22c55e'
  ctx.fillRect(CARD_W - 260, 0, 260, 10)
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.fillRect(72, CARD_H - 120, CARD_W - 144, 1)

  // ── 品牌列 ─────────────────────────────────────────────────────
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 40px "${FONT_NAME}"`
  ctx.fillStyle = '#22c55e'
  ctx.fillText('Vestential', 72, 96)

  const dateStr = data.meta.generated_at ?? ''
  ctx.font = `400 28px "${FONT_NAME}"`
  ctx.fillStyle = '#9ca3af'
  ctx.textAlign = 'right'
  ctx.fillText(dateStr.slice(0, 10), CARD_W - 72, 96)

  const maxWidth = CARD_W - 144

  if (style === 'meme' && opts.meme) {
    renderMeme(ctx, opts.meme, maxWidth, CARD_H)
  } else if (style === 'ai' && opts.meme) {
    renderAiCard(ctx, opts.meme, maxWidth, CARD_H)
  } else if (style === 'festival') {
    renderFestival(ctx, opts.festival, dateStr, maxWidth)
  } else {
    renderClassic(ctx, data, maxWidth)
  }

  // IG 只接受 JPEG; Threads 亦支援 JPEG。以高品質 JPEG 輸出。
  return canvas.toBuffer('image/jpeg', 92)
}

// ─── Issue #69：DCA 存股試算圖卡（純 Canvas，不經 AI 生圖）─────────
// 1080×1080：投入 vs 市值＋股利再投入加成＋免責小字。供 /api/social/og?type=dca 使用。
export interface DcaCardData {
  symbol: string
  monthly: number
  years: number
  invested: number
  marketValue: number
  /** 股利加成（百分點）。 */
  divBoostPp: number
  /** 含股利總報酬 %。 */
  totalReturnPct: number
}

function fmtTWD(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `NT$${Math.round(n).toLocaleString('en-US')}`
}

/** 依 DCA 試算結果生成 1080×1080 JPEG buffer（純 Canvas 鏈路，無 LLM／無 AI 生圖）。 */
export async function renderDcaCard(d: DcaCardData): Promise<Buffer> {
  ensureFont()
  const canvas = createCanvas(CARD_W, CARD_H)
  const ctx = canvas.getContext('2d')

  const bg = ctx.createLinearGradient(0, 0, 0, CARD_H)
  bg.addColorStop(0, '#10131a')
  bg.addColorStop(1, '#0b0d13')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  ctx.fillStyle = '#22c55e'
  ctx.fillRect(CARD_W - 260, 0, 260, 10)
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.fillRect(72, CARD_H - 120, CARD_W - 144, 1)

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 40px "${FONT_NAME}"`
  ctx.fillStyle = '#22c55e'
  ctx.fillText('Vestential', 72, 96)
  ctx.font = `400 28px "${FONT_NAME}"`
  ctx.fillStyle = '#9ca3af'
  ctx.textAlign = 'right'
  ctx.fillText('零股存股試算所', CARD_W - 72, 96)
  ctx.textAlign = 'left'

  const title = `${d.symbol} · 每月 ${fmtTWD(d.monthly)} × ${d.years} 年`
  ctx.font = `700 56px "${FONT_NAME}"`
  ctx.fillStyle = '#ffffff'
  const lines = wrapText(ctx, title, CARD_W - 144, 2)
  let y = 230
  for (const line of lines) {
    ctx.fillText(line, 72, y)
    y += 76
  }

  // 投入 vs 市值雙欄
  y += 30
  const colW = (CARD_W - 144 - 32) / 2
  const cards = [
    { label: '投入本金', value: fmtTWD(d.invested), color: '#9ca3af' },
    { label: '期末總值（含股利）', value: fmtTWD(d.marketValue), color: '#22c55e' },
  ]
  cards.forEach((c, i) => {
    const x = 72 + i * (colW + 32)
    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    roundRect(ctx, x, y, colW, 220, 20)
    ctx.fill()
    ctx.font = `400 30px "${FONT_NAME}"`
    ctx.fillStyle = '#9ca3af'
    ctx.fillText(c.label, x + 32, y + 62)
    ctx.font = `700 52px "${FONT_NAME}"`
    ctx.fillStyle = c.color
    ctx.fillText(c.value, x + 32, y + 150)
  })
  y += 270

  // 股利再投入加成＋總報酬
  ctx.font = `400 32px "${FONT_NAME}"`
  ctx.fillStyle = '#d1d5db'
  const boost = Number.isFinite(d.divBoostPp) ? `+${d.divBoostPp.toFixed(2)} 百分點` : '—'
  const total = Number.isFinite(d.totalReturnPct)
    ? `${d.totalReturnPct >= 0 ? '+' : ''}${d.totalReturnPct.toFixed(2)}%`
    : '—'
  ctx.fillText(`股利再投入加成：${boost}`, 72, y)
  y += 58
  ctx.fillText(`含股利總報酬：${total}`, 72, y)
  y += 58
  ctx.font = `400 26px "${FONT_NAME}"`
  ctx.fillStyle = '#6b7280'
  ctx.fillText('歷史回測，不代表未來表現', 72, y)

  drawCtaBottom(ctx)
  return canvas.toBuffer('image/jpeg', 92)
}

function renderClassic(ctx: any, data: SocialCardData, maxWidth: number) {
  // ── 主標題（auto-wrap，最多 3 行）─────────────────────────────
  const headline = data.items[0]?.title ?? data.meta.summary ?? '今日市場焦點'
  ctx.textAlign = 'left'
  ctx.font = `700 58px "${FONT_NAME}"`
  ctx.fillStyle = '#ffffff'
  const lines = wrapText(ctx, headline, maxWidth, 3)
  let y = 220
  const lineH = 78
  for (const line of lines) {
    ctx.fillText(line, 72, y)
    y += lineH
  }

  // ── 總覽摘要（auto-wrap，最多 7 行，保留底部 CTA 空間）────────────
  const summary = data.meta.summary ?? ''
  ctx.font = `400 34px "${FONT_NAME}"`
  ctx.fillStyle = '#d1d5db'
  const summaryLines = wrapText(ctx, summary, maxWidth, 7)
  y += 24
  const summaryLineH = 52
  for (const line of summaryLines) {
    ctx.fillText(line, 72, y)
    y += summaryLineH
  }

  drawCtaBottom(ctx)
}

function renderMeme(ctx: any, meme: { title: string; punchline: string }, maxWidth: number, CARD_H: number) {
  // ── 梗：左上繞大的逗趣小徽章 ─────────────────────────────────
  ctx.save()
  ctx.translate(96, 170)
  ctx.font = `700 32px "${FONT_NAME}"`
  ctx.fillStyle = '#22c55e'
  ctx.rotate(-Math.PI / 22)
  ctx.fillText('MEME', 0, 0)
  ctx.restore()

  // ── 主標題：極大字，auto-wrap 最多 3 行 ──────────────────────
  ctx.textAlign = 'left'
  ctx.font = `700 84px "${FONT_NAME}"`
  ctx.fillStyle = '#ffffff'
  const lines = wrapText(ctx, meme.title, maxWidth, 3)
  let y = 360
  const lineH = 112
  for (const line of lines) {
    ctx.fillText(line, 72, y)
    y += lineH
  }

  // ── punchline ───────────────────────────────────────────────
  ctx.font = `400 48px "${FONT_NAME}"`
  ctx.fillStyle = '#22c55e'
  const punch = wrapText(ctx, meme.punchline, maxWidth, 2)
  y += 36
  for (const line of punch) {
    ctx.fillText(line, 72, y)
    y += 64
  }

  drawCtaBottom(ctx)
}

function renderAiCard(ctx: any, meme: { title: string; punchline: string }, maxWidth: number, CARD_H: number) {
  // ── 角落小徽章：VESTY 吉祥物 ───────────────────────────────
  ctx.save()
  ctx.rotate(-Math.PI / 24)
  ctx.font = `700 28px "${FONT_NAME}"`
  ctx.fillStyle = '#22c55e'
  ctx.fillText('VESTY ROBOT', 48, 150)
  ctx.restore()

  // ── 自適應縮放：字級由大而小收斂，確保標題＋punchline 不跳出圖卡 ──
  const maxTitleLines = 3
  const maxPunchLines = 2
  const blockTop = 236
  const availBottom = 852 // CTA 之上

  let titleSize = 74
  let titleLH = 102
  let punchSize = 46
  let punchLH = 64
  let lines: string[] = []
  let punch: string[] = []
  for (;;) {
    ctx.font = `700 ${titleSize}px "${FONT_NAME}"`
    lines = wrapText(ctx, meme.title, maxWidth, maxTitleLines)
    ctx.font = `400 ${punchSize}px "${FONT_NAME}"`
    punch = wrapText(ctx, meme.punchline, maxWidth, maxPunchLines)
    const totalH = lines.length * titleLH + punch.length * punchLH + 88
    if (blockTop + totalH <= availBottom) break
    if (titleSize <= 52 && punchSize <= 32) break
    titleSize = Math.max(52, titleSize - 6)
    titleLH = Math.max(74, titleLH - 8)
    punchSize = Math.max(32, punchSize - 4)
    punchLH = Math.max(46, punchLH - 6)
  }

  // ── 半透明深色圓角底襯（大小依最終行數）──────────────────────
  const titleH = lines.length * titleLH
  const punchH = punch.length * punchLH
  const pad = 40
  const scrimTop = blockTop - pad
  const scrimH = Math.min(titleH + punchH + pad * 2 + 30, availBottom - scrimTop + 20)
  ctx.save()
  ctx.globalAlpha = 0.66
  ctx.fillStyle = '#0c0e13'
  roundRect(ctx, 40, scrimTop, CARD_W - 80, scrimH, 26)
  ctx.fill()
  ctx.restore()

  // ── Hero 主標題 ─────────────────────────────────────────────
  ctx.textAlign = 'left'
  ctx.font = `700 ${titleSize}px "${FONT_NAME}"`
  ctx.fillStyle = '#ffffff'
  let y = scrimTop + pad + titleLH - 8
  for (const line of lines) {
    ctx.fillText(line, 72, y)
    y += titleLH
  }

  // ── punchline：品牌綠 ───────────────────────────────────────
  ctx.font = `400 ${punchSize}px "${FONT_NAME}"`
  ctx.fillStyle = '#22c55e'
  y += 12
  for (const line of punch) {
    ctx.fillText(line, 72, y)
    y += punchLH
  }

  drawCtaBottom(ctx)
}

function renderFestival(
  ctx: any,
  festival: { title?: string; subtitle?: string } | null | undefined,
  dateStr: string,
  maxWidth: number,
) {
  const title = festival?.title?.trim() || '中秋快樂'
  const subtitle = festival?.subtitle?.trim() || '月圓人團圓，Vestential 陪你走長期投資的路'

  // ── 金色滿月 ──────────────────────────────────────────────────
  ctx.save()
  ctx.beginPath()
  ctx.arc(CARD_W - 200, 250, 110, 0, Math.PI * 2)
  ctx.fillStyle = '#facc15'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(CARD_W - 200, 250, 132, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.35)'
  ctx.lineWidth = 6
  ctx.stroke()
  ctx.restore()

  // ── 品牌列沿用上方 Vestential＋日期；此處加節慶徽章 ──────────────
  ctx.save()
  ctx.translate(76, 190)
  ctx.rotate(-Math.PI / 26)
  ctx.font = `700 34px "${FONT_NAME}"`
  ctx.fillStyle = '#facc15'
  ctx.fillText('Vestential × 中秋', 0, 0)
  ctx.restore()

  // ── 大字賀詞（自適應縮放，最多 2 行）──────────────────────────
  let titleSize = 148
  let titleLH = 180
  let lines: string[] = []
  for (;;) {
    ctx.font = `700 ${titleSize}px "${FONT_NAME}"`
    lines = wrapText(ctx, title, maxWidth, 2)
    if (titleSize <= 96) break
    if (lines.length * titleLH <= 400) break
    titleSize -= 10
    titleLH -= 12
  }
  ctx.textAlign = 'left'
  ctx.fillStyle = '#fde68a'
  let y = 560
  for (const line of lines) {
    ctx.fillText(line, 72, y)
    y += titleLH
  }

  // ── 副標 ─────────────────────────────────────────────────────
  ctx.font = `400 44px "${FONT_NAME}"`
  ctx.fillStyle = '#d1d5db'
  const sub = wrapText(ctx, subtitle, maxWidth, 2)
  y += 24
  for (const line of sub) {
    ctx.fillText(line, 72, y)
    y += 62
  }

  // ── 節慶 CTA ─────────────────────────────────────────────────
  const ctaX = 72
  const ctaY = CARD_H - 196
  const ctaW = CARD_W - 144
  const ctaH = 80
  const ctaBg = ctx.createLinearGradient(ctaX, 0, ctaX + ctaW, 0)
  ctaBg.addColorStop(0, '#14532d')
  ctaBg.addColorStop(1, '#713f12')
  ctx.fillStyle = ctaBg
  roundRect(ctx, ctaX, ctaY, ctaW, ctaH, 18)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let ctaFontSize = 44
  ctx.font = `700 ${ctaFontSize}px "${FONT_NAME}"`
  while (ctx.measureText('月圓，部位也要圓 → vestential.com').width > ctaW - 32 && ctaFontSize > 28) {
    ctaFontSize -= 2
    ctx.font = `700 ${ctaFontSize}px "${FONT_NAME}"`
  }
  ctx.fillStyle = '#ffffff'
  ctx.fillText('月圓，部位也要圓 → vestential.com', CARD_W / 2, ctaY + ctaH / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  // ── Footer ────────────────────────────────────────────────────
  ctx.font = `400 26px "${FONT_NAME}"`
  ctx.fillStyle = '#6b7280'
  const footerDate = dateStr ? dateStr.slice(0, 10) : ''
  ctx.fillText(`Vestential 中秋賀卡${footerDate ? ` · ${footerDate}` : ''}`, 72, CARD_H - 60)
}

function drawCtaBottom(ctx: any) {
  const ctaX = 72
  const ctaY = CARD_H - 196
  const ctaW = CARD_W - 144
  const ctaH = 80
  ctx.fillStyle = '#14532d'
  roundRect(ctx, ctaX, ctaY, ctaW, ctaH, 18)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let ctaFontSize = 44
  ctx.font = `700 ${ctaFontSize}px "${FONT_NAME}"`
  while (ctx.measureText(`更多資訊 → vestential.com/market-focus`).width > ctaW - 32 && ctaFontSize > 28) {
    ctaFontSize -= 2
    ctx.font = `700 ${ctaFontSize}px "${FONT_NAME}"`
  }
  ctx.fillStyle = '#ffffff'
  ctx.fillText('更多資訊 → vestential.com/market-focus', CARD_W / 2, ctaY + ctaH / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  // ── Footer ────────────────────────────────────────────────────
  ctx.font = `400 26px "${FONT_NAME}"`
  ctx.fillStyle = '#6b7280'
  ctx.fillText('Vestential 市場焦點 · 價值投資陪你透過數據看台灣股市', 72, CARD_H - 60)
}

/** 依 UTF-8 斷詞做換行（對中文逐字斷行防止中文標點被切），超過 maxLines 以 … 收尾。 */
function wrapText(ctx: { measureText: (t: string) => { width: number } }, text: string, maxWidth: number, maxLines: number): string[] {
  const chars = Array.from(text)
  const lines: string[] = []
  let line = ''
  let idx = 0
  while (idx < chars.length) {
    const ch = chars[idx]
    const test = line + ch
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      if (lines.length >= maxLines) {
        lines[maxLines - 1] = line.slice(0, Math.max(1, line.length - 1)).replace(/\s+$/, '') + '…'
        return lines
      }
      line = ch
    } else {
      line = test
    }
    idx += 1
  }
  if (line) lines.push(line)
  return lines
}

/** 繪製圓角矩形路徑（不 fill/stroke，需自行呼叫）。 */
function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
