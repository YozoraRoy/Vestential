import { NextResponse } from 'next/server'
import { recognizePortfolioImage } from '@stock/ai-engine'
import { consumeRecognitionQuota, getRecognitionUsage, refundRecognitionQuota } from '@stock/database'
import { enrichRecognizedPositions } from '../../../../lib/portfolio'
import { DAILY_RECOGNITION_LIMIT, getCurrentUserFromCookies, getTaiwanDateStr } from '../../../../lib/auth'
import { reportServerError } from '../../../../lib/server-alert'
import { withApiAudit } from '@/lib/api-audit'

export const runtime = 'nodejs'
export const maxDuration = 120

/** 回傳今日剩餘辨識額度。 */
export async function GET() {
  const user = await getCurrentUserFromCookies()
  if (!user) {
    return NextResponse.json({ error: 'login required' }, { status: 401 })
  }
  const used = await getRecognitionUsage(user.id, getTaiwanDateStr())
  return NextResponse.json({
    used,
    max: DAILY_RECOGNITION_LIMIT,
    remaining: Math.max(0, DAILY_RECOGNITION_LIMIT - used),
  })
}

/** 上傳圖片（multipart file 或 JSON base64）並由 AI 辨識多檔持股。 */
export async function POST(req: Request) {
  return withApiAudit(req, '/api/portfolio/recognize', () => handlePost(req))
}

async function handlePost(req: Request) {
  try {
    const user = await getCurrentUserFromCookies()
    if (!user) {
      return NextResponse.json({ error: 'login required' }, { status: 401 })
    }

    let imageDataUrl: string | null = null

    const contentType = req.headers.get('content-type') || ''
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('image')
      if (!(file instanceof File)) {
        return NextResponse.json({ error: '缺少圖片檔案 (image)' }, { status: 400 })
      }
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: '圖片不能超過 10MB' }, { status: 400 })
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      let base64 = ''
      for (const b of bytes) base64 += String.fromCharCode(b)
      const type = file.type || 'image/png'
      imageDataUrl = `data:${type};base64,${btoa(base64)}`
    } else {
      const body = await req.json().catch(() => null)
      const raw = typeof body?.image === 'string' ? body.image : ''
      if (!raw.startsWith('data:image/')) {
        // also accept bare base64
        imageDataUrl = /^[A-Za-z0-9+/=]+$/.test(raw) ? `data:image/png;base64,${raw}` : null
      } else {
        imageDataUrl = raw
      }
      if (!imageDataUrl) {
        return NextResponse.json({ error: '請提供圖片 (image)' }, { status: 400 })
      }
    }

    const quota = await consumeRecognitionQuota(user.id, getTaiwanDateStr(), DAILY_RECOGNITION_LIMIT)
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: `今日圖片辨識額度已用完（${quota.used}/${quota.max}），請明天再試`,
          quota,
        },
        { status: 429 },
      )
    }

    let result
    try {
      result = await recognizePortfolioImage(imageDataUrl)
    } catch (e) {
      // 技術性失敗（LLM/OCR 錯誤）不應消耗使用者額度，補回本次扣的。
      await refundRecognitionQuota(user.id, getTaiwanDateStr())
      throw e
    }

    // 空結果通常是 OCR 讀不到，也視為未成功消耗額度。
    if (result.positions.length === 0) {
      await refundRecognitionQuota(user.id, getTaiwanDateStr())
    }

    // 自動補齊：用 Yahoo 搜尋/報價把空缺欄位（代號/名稱/現價）填好。
    // 補齊是 best-effort，失敗保留原值，不影響辨識與額度結果。
    let positions = result.positions
    const enriched = { names: 0, symbols: 0, prices: 0 }
    if (result.positions.length > 0) {
      const e = await enrichRecognizedPositions(result.positions)
      positions = e.positions
      enriched.names = e.enriched.names
      enriched.symbols = e.enriched.symbols
      enriched.prices = e.enriched.prices
    }

    const used = await getRecognitionUsage(user.id, getTaiwanDateStr())
    return NextResponse.json({
      success: true,
      ...result,
      positions,
      enriched,
      quota: {
        used,
        max: DAILY_RECOGNITION_LIMIT,
        remaining: Math.max(0, DAILY_RECOGNITION_LIMIT - used),
      },
    })
  } catch (e: any) {
    const status = e?.message?.includes('額度') ? 429 : 500
    if (status === 500) {
      // #24：辨識鏈 500 → 後端告警（去重 30min，不含 user_id 等個資）。
      void reportServerError({ route: 'POST /api/portfolio/recognize', status, error: e?.message || e })
    }
    return NextResponse.json({ error: e.message || '圖片辨識失敗' }, { status })
  }
}