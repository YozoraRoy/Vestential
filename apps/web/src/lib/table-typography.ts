/**
 * Issue #75：全站表格字級統一開關（`agent_settings: ui.table_typography`）。
 *
 * 本檔為純函式（無 React），server（`/api/ui-config`）與 client 共用；
 * hook 住 `use-table-typography.ts`（client-only）。
 *
 * - `v2`＝新方案（預設）：表頭 `text-sm font-semibold`、內文 `text-[13px]`；
 * - `v1`＝舊方案：表頭／內文回舊字級（見各呼叫端第三參數）；
 * - v1/v2 分支**只收斂在 `tableClass`／`headTrClass`**，呼叫端只傳各表獨有的
 *   extra class，不散落 14 處 if-else（見 風險/待確認決議）。
 */

export type TableTypography = 'v1' | 'v2'

export const TABLE_TYPOGRAPHY_KEY = 'ui.table_typography'
export const TABLE_TYPOGRAPHY_DEFAULT: TableTypography = 'v2'

export function normalizeTableTypography(raw: unknown): TableTypography {
  return raw === 'v1' ? 'v1' : 'v2'
}

/** 表格內文（tbody 繼承 table 字級）：v2 `text-[13px]`／v1 回舊字級（預設 `text-sm`）。 */
export function tableClass(typo: TableTypography, extra: string, v1 = 'text-sm'): string {
  return `${extra} ${typo === 'v2' ? 'text-[13px]' : v1}`
}

/** 表頭列：v2 `text-sm font-semibold`／v1 回舊字級（預設 `text-xs`；原無字級者傳 ''）。 */
export function headTrClass(typo: TableTypography, extra: string, v1 = 'text-xs'): string {
  const size = typo === 'v2' ? 'text-sm font-semibold' : v1
  return size ? `${extra} ${size}` : extra
}
