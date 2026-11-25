import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureTwStockNamesSynced: vi.fn(),
  getStockMultilingualNames: vi.fn(),
  upsertStockNames: vi.fn(),
}))

vi.mock('@stock/database', () => ({
  ensureTwStockNamesSynced: mocks.ensureTwStockNamesSynced,
  getStockMultilingualNames: mocks.getStockMultilingualNames,
  upsertStockNames: mocks.upsertStockNames,
}))

vi.mock('@stock/cycle-entry', () => ({
  resolveStockName: (code: string) => (code === '0056' ? '元大高股息' : code),
}))

import { resolveServerStockNames } from './stock-names-server'

describe('resolveServerStockNames (#200)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getStockMultilingualNames.mockResolvedValue({
      '0056': { symbol: '0056', nameZh: '元大高股息', nameEn: null, nameJa: null, market: 'TW' },
    })
    mocks.upsertStockNames.mockResolvedValue(0)
  })

  it('ensureTwStockNamesSynced 即使極慢也不得阻塞即時查詢回應', async () => {
    mocks.ensureTwStockNamesSynced.mockImplementation(() => new Promise(() => {}))

    const start = Date.now()
    const res = await resolveServerStockNames(['0056'], { marketHint: 'TW', syncIfNeeded: true })
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(200)
    expect(res['0056']?.nameZh).toBe('元大高股息')
    expect(mocks.ensureTwStockNamesSynced).toHaveBeenCalledTimes(1)
  })

  it('syncIfNeeded=false 時不觸發 ensureTwStockNamesSynced', async () => {
    const res = await resolveServerStockNames(['0056'], { marketHint: 'TW', syncIfNeeded: false })
    expect(res['0056']?.nameZh).toBe('元大高股息')
    expect(mocks.ensureTwStockNamesSynced).not.toHaveBeenCalled()
  })
})
