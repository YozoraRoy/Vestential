import { describe, it, expect, vi } from 'vitest'

vi.mock('@stock/market-data', () => ({ registry: { get: vi.fn() } }))
vi.mock('@stock/cycle-entry', () => ({}))
vi.mock('@stock/database', () => ({}))
vi.mock('@stock/core', () => ({}))
vi.mock('@stock/ai-engine', () => ({}))

import { ruleCoverage, SUMMARY_SYSTEM_PROMPT, RULE_LABELS } from './cycle-entry'

// Issue #86：總覽防幻覺——覆蓋率程式先算、LLM 只引用；R2 改名站上均線。
describe('ruleCoverage（程式先算交集）', () => {
  it('各規則 x/N 格式、顺序固定 R1..R5', () => {
    expect(
      ruleCoverage([
        ['R2', 'R4', 'R5'],
        ['R1', 'R2', 'R4'],
        ['R2', 'R4', 'R5'],
      ]),
    ).toBe('R1 1/3、R2 3/3、R3 0/3、R4 3/3、R5 2/3')
  })

  it('空清單不炸（0/0）', () => {
    expect(ruleCoverage([])).toBe('R1 0/0、R2 0/0、R3 0/0、R4 0/0、R5 0/0')
  })
})

describe('SUMMARY_SYSTEM_PROMPT（防幻覺約束）', () => {
  it('「共同特徵」僅限 100%，其餘強制 N 檔中有 M 檔表述', () => {
    expect(SUMMARY_SYSTEM_PROMPT).toContain('100%')
    expect(SUMMARY_SYSTEM_PROMPT).toContain('直接引用')
    expect(SUMMARY_SYSTEM_PROMPT).toContain('禁用')
  })

  it('R2 標籤已改名站上均線（note prompt 連動）', () => {
    expect(RULE_LABELS.R2).toBe('站上均線')
  })
})
