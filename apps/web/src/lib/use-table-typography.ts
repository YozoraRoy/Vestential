'use client'

import { useEffect, useState } from 'react'
import {
  normalizeTableTypography,
  TABLE_TYPOGRAPHY_DEFAULT,
  type TableTypography,
} from './table-typography'

/**
 * Issue #75：前台表格讀取後台字級方案（client-only；純函式住 `./table-typography`）。
 *
 * - 取值：公開端點 `GET /api/ui-config`（沿 `api/portfolio/fee-discount`
 *   模式，免登入＋失敗兜底 v2）；mount 時 `no-store` 取一次，同 tick 內多表
 *   共用同一個 inflight 請求；管理員存檔後，前台下次載入即生效，免改碼；
 * - 預設 v2 首屏即新字級；後台切 v1 → 取值後重渲染回舊字級。
 */
export { TABLE_TYPOGRAPHY_DEFAULT, normalizeTableTypography }
export type { TableTypography }

let inflight: Promise<TableTypography> | null = null

function fetchTypography(): Promise<TableTypography> {
  if (!inflight) {
    inflight = fetch('/api/ui-config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => normalizeTableTypography(j?.tableTypography))
      .catch(() => TABLE_TYPOGRAPHY_DEFAULT)
      .then((v) => {
        inflight = null
        return v
      })
  }
  return inflight
}

/** 前台表格讀取後台字級方案（預設 v2 首屏即新字級；v1 回舊字級）。 */
export function useTableTypography(): TableTypography {
  const [typo, setTypo] = useState<TableTypography>(TABLE_TYPOGRAPHY_DEFAULT)
  useEffect(() => {
    let alive = true
    fetchTypography().then((v) => {
      if (alive) setTypo(v)
    })
    return () => {
      alive = false
    }
  }, [])
  return typo
}
