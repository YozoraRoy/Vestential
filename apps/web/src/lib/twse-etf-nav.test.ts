import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearTwseEtfNavCache,
  getTwseEtfNav,
  parseTwseAllEtfPayload,
} from './twse-etf-nav'

describe('twse-etf-nav (Issue #212 TWSE ETF 即時淨值與折溢價)', () => {
  beforeEach(() => {
    clearTwseEtfNavCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    clearTwseEtfNavCache()
  })

  it('parseTwseAllEtfPayload 正確解析 NAV、折溢價與估算規模 AUM', () => {
    const map = parseTwseAllEtfPayload({
      a1: [
        {
          msgArray: [
            {
              a: '0050',
              b: '元大台灣50',
              c: '5000000000',
              e: '92.50',
              f: '92.09',
              g: '0.45',
              i: '20261127',
              j: '14:59:45',
            },
            {
              a: 'BAD',
              f: '0',
              g: '1.2',
            },
          ],
        },
        {},
      ],
    })

    expect(map.size).toBe(1)
    const item = map.get('0050')
    expect(item).toEqual({
      symbol: '0050',
      nav: 92.09,
      price: 92.5,
      premiumDiscountPct: 0.45,
      issuedUnits: 5_000_000_000,
      estimatedAumTwd: Math.round(92.09 * 5_000_000_000),
      updatedAt: '20261127 14:59:45',
    })
  })

  it('getTwseEtfNav 具備 5 分鐘記憶體快取與異常降級', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          a1: [
            {
              msgArray: [
                { a: '00919', c: '1000000', e: '28.72', f: '28.73', g: '-0.03', i: '20261127', j: '14:59:45' },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const first = await getTwseEtfNav('00919.TW')
    const second = await getTwseEtfNav('00919')
    expect(first?.nav).toBe(28.73)
    expect(first?.premiumDiscountPct).toBe(-0.03)
    expect(second?.symbol).toBe('00919')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    clearTwseEtfNavCache()
    fetchMock.mockRejectedValueOnce(new Error('network timeout'))
    const failed = await getTwseEtfNav('00919')
    expect(failed).toBeNull()
  })
})
