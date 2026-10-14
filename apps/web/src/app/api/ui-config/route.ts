import { NextResponse } from 'next/server'
import { getAgentSetting } from '@stock/database'
import { TABLE_TYPOGRAPHY_DEFAULT, normalizeTableTypography } from '@/lib/table-typography'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Issue #75：公開表格字級方案（免登入；展示性質）。
 * 後台 `ui.table_typography` 可調（v2 新字級預設／v1 舊字級），
 * 前台表格經 `useTableTypography` 讀取即時生效（沿 `api/portfolio/fee-discount` 模式）。
 */
export async function GET() {
  let tableTypography = TABLE_TYPOGRAPHY_DEFAULT
  try {
    const raw = await getAgentSetting('ui.table_typography').catch(() => null)
    tableTypography = normalizeTableTypography(raw)
  } catch {
    // DB 失敗兜底預設值，不炸版
  }
  return NextResponse.json({ tableTypography, default: TABLE_TYPOGRAPHY_DEFAULT })
}
