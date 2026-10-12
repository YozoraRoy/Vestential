import { NextResponse } from 'next/server'
import { getMarketFocus, getMarketFocusMeta, getSocialCardImage, logDcaEvent } from '@stock/database'
import { renderDcaCard, renderSocialCard, type SocialCardStyle } from '@/lib/social-canvas'
import { getFallbackMemeConcept } from '@/lib/social'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function numParam(v: string | null, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 圖卡公開端點：依 edition（market_focus_meta.generated_at）與 style（classic | meme | ai）
 * 回傳圖卡。優先讀取已預先快取的快照，若無則純 Canvas 即時繪製。
 * 嚴禁在此 GET 端點中調用 LLM（Meta 爬蟲僅等待 5~10 秒，動態 LLM 耗時過長必導致 9004 逾時）。
 * 不需授權（對 Meta 伺服器公開）。
 *
 * Issue #69：`?type=dca&symbol=&monthly=&years=&invested=&value=&boost=&ret=`
 * 走 social-canvas 純 Canvas 鏈路（renderDcaCard），不用 social-ai-image AI 生圖。
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    // Issue #69 DCA 圖卡：純 Canvas 即時繪製（參數皆為展示用數字，不進 DB、不調 LLM）。
    if (searchParams.get('type') === 'dca') {
      const symbol = (searchParams.get('symbol') ?? '0050').trim().toUpperCase().slice(0, 12) || '0050'
      const buf = await renderDcaCard({
        symbol,
        monthly: numParam(searchParams.get('monthly'), 5000),
        years: numParam(searchParams.get('years'), 5),
        invested: numParam(searchParams.get('invested'), 0),
        marketValue: numParam(searchParams.get('value'), 0),
        divBoostPp: numParam(searchParams.get('boost'), 0),
        totalReturnPct: numParam(searchParams.get('ret'), 0),
      })
      void logDcaEvent('dca_og_view', { symbol }).catch(() => {})
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=3600',
          'Content-Length': String(buf.length),
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
    const edition = searchParams.get('edition')?.trim()
    const styleParam = searchParams.get('style')?.trim()
    const style: SocialCardStyle = styleParam === 'meme' ? 'meme' : styleParam === 'ai' ? 'ai' : 'classic'

    // 1. 若指定 edition，優先讀取 DB 已存的圖卡快照（毫秒級回傳）
    if (edition) {
      const cachedBuf = await getSocialCardImage(edition, style).catch(() => null)
      if (cachedBuf && cachedBuf.length > 0) {
        return new NextResponse(new Uint8Array(cachedBuf), {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=3600, immutable',
            'Content-Length': String(cachedBuf.length),
            'X-Content-Type-Options': 'nosniff',
          },
        })
      }
    }

    const meta = await getMarketFocusMeta()
    if (!meta?.summary) {
      return new Response('no data', { status: 404 })
    }

    // 2. 快照未命中時以純 Canvas 重繪（meme/ai 使用兜底標題概念，絕不 await LLM）
    const items = await getMarketFocus(6, 2)
    const meme = style === 'classic' ? null : getFallbackMemeConcept(items)
    const buf = await renderSocialCard({ meta, items }, { style, meme })

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': edition ? 'public, max-age=3600, immutable' : 'no-store',
        'Content-Length': String(buf.length),
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error: any) {
    console.error('[API/social/og] Failed:', error)
    return new Response('render failed', { status: 500 })
  }
}