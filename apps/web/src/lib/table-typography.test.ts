import { describe, it, expect } from 'vitest'
import {
  headTrClass,
  normalizeTableTypography,
  tableClass,
  TABLE_TYPOGRAPHY_DEFAULT,
} from './table-typography'

// Issue #75：字級開關分支收斂單測（v1/v2 判定只在 helper 內）。
describe('normalizeTableTypography', () => {
  it('預設 v2', () => {
    expect(TABLE_TYPOGRAPHY_DEFAULT).toBe('v2')
  })

  it('僅 "v1" 回 v1，其餘一律 v2（含未知值兜底）', () => {
    expect(normalizeTableTypography('v1')).toBe('v1')
    expect(normalizeTableTypography('v2')).toBe('v2')
    expect(normalizeTableTypography('')).toBe('v2')
    expect(normalizeTableTypography(null)).toBe('v2')
    expect(normalizeTableTypography(undefined)).toBe('v2')
    expect(normalizeTableTypography('V1')).toBe('v2')
    expect(normalizeTableTypography('v3')).toBe('v2')
  })
})

describe('tableClass / headTrClass', () => {
  it('v2＝表頭 text-sm font-semibold、內文 text-[13px]', () => {
    expect(tableClass('v2', 'w-full')).toContain('text-[13px]')
    expect(tableClass('v2', 'w-full')).toContain('w-full')
    expect(headTrClass('v2', 'text-left')).toContain('text-sm')
    expect(headTrClass('v2', 'text-left')).toContain('font-semibold')
  })

  it('v1＝回舊字級（預設表頭 text-xs、內文 text-sm）', () => {
    expect(tableClass('v1', 'w-full')).toContain('text-sm')
    expect(tableClass('v1', 'w-full')).not.toContain('text-[13px]')
    expect(headTrClass('v1', 'text-left')).toContain('text-xs')
    expect(headTrClass('v1', 'text-left')).not.toContain('font-semibold')
  })

  it('v1 可指定回退字級（text-xs／text-[11px] 特例表還原用）', () => {
    expect(tableClass('v1', 'w-full', 'text-xs')).toContain('text-xs')
    expect(tableClass('v1', 'w-full', 'text-[11px]')).toContain('text-[11px]')
    expect(headTrClass('v1', 'text-left', '')).toBe('text-left')
  })

  it('extra class 原樣保留', () => {
    expect(tableClass('v2', 'w-full min-w-[560px]')).toContain('min-w-[560px]')
    expect(headTrClass('v2', 'text-left uppercase tracking-wide')).toContain('uppercase')
  })
})
