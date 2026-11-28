import { describe, expect, it } from 'vitest'
import {
  buildTodayDcaSignal,
  formatCostReduction,
  formatSignedPct,
} from './dca-lab-format'

describe('dca-lab-format (Issue #213)', () => {
  it('formatCostReduction：成本下降顯示負號、上升顯示正號，絕不出現 --0.2%', () => {
    expect(formatCostReduction(1.8)).toEqual({ isReduced: true, formattedPct: '-1.8%' })
    expect(formatCostReduction(-0.17)).toEqual({ isReduced: false, formattedPct: '+0.2%' })
    expect(formatCostReduction(0)).toEqual({ isReduced: true, formattedPct: '0.0%' })
    expect(formatCostReduction(-0.04)).toEqual({ isReduced: true, formattedPct: '0.0%' })
  })

  it('formatSignedPct：負值不出現 +-0.6%', () => {
    expect(formatSignedPct(2.4)).toBe('+2.4%')
    expect(formatSignedPct(-0.6)).toBe('-0.6%')
    expect(formatSignedPct(0)).toBe('0.0%')
  })

  it('buildTodayDcaSignal：大盤過熱且落底雷達觸發時，不誤稱大盤指標呈現低檔區', () => {
    const res = buildTodayDcaSignal({
      currentBiasPct: -12.2,
      thresholdPct: -5,
      marketLevelStatus: 'overheated',
      isRadarTriggered: true,
    })
    expect(res.action).toBe('AGGRESSIVE_ADD')
    expect(res.actionBadge).toContain('今日建議：2.0x')
    expect(res.reason).not.toContain('大盤指標呈現低檔區')
    expect(res.reason).toContain('短線落底雷達已觸發')
    expect(res.reason).toContain('偏高區')
  })

  it('buildTodayDcaSignal：大盤低檔且雷達觸發時才顯示黃金加碼點', () => {
    const res = buildTodayDcaSignal({
      currentBiasPct: -10.5,
      thresholdPct: -5,
      marketLevelStatus: 'cold',
      isRadarTriggered: true,
    })
    expect(res.action).toBe('AGGRESSIVE_ADD')
    expect(res.reason).toContain('低檔區')
    expect(res.reason).toContain('黃金加碼點')
  })
})
