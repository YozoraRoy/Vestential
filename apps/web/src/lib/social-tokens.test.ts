import { describe, expect, it, vi, beforeEach } from 'vitest'

const store = new Map<string, string>()

vi.mock('@stock/database', () => ({
  getAgentSetting: vi.fn(async (key: string) => store.get(key) ?? null),
  setAgentSetting: vi.fn(async ({ key, value }: { key: string; value: string }) => {
    store.set(key, value)
  }),
}))

import {
  calcDaysRemaining,
  getSocialAccessToken,
  getSocialTokenMeta,
  isPermanentSocialToken,
  saveRefreshedSocialToken,
} from './social-tokens'

describe('social-tokens', () => {
  beforeEach(() => {
    store.clear()
    delete process.env.THREADS_ACCESS_TOKEN
    delete process.env.IG_ACCESS_TOKEN
  })

  it('falls back to process.env when DB has no persisted token and prefers DB once saved', async () => {
    process.env.THREADS_ACCESS_TOKEN = 'THAA_ENV_OLD'
    const first = await getSocialAccessToken('threads')
    expect(first).toEqual({ token: 'THAA_ENV_OLD', source: 'env' })

    const nowMs = Date.UTC(2026, 10, 15, 0, 0, 0)
    const meta = await saveRefreshedSocialToken('threads', {
      accessToken: 'THAA_DB_NEW',
      expiresInSeconds: 5_184_000, // 60 days
      nowMs,
    })
    expect(meta.daysRemaining).toBe(60)

    const second = await getSocialAccessToken('threads')
    expect(second).toEqual({ token: 'THAA_DB_NEW', source: 'db' })

    const readMeta = await getSocialTokenMeta('threads', nowMs + 10 * 86_400_000)
    expect(readMeta.daysRemaining).toBe(50)
  })

  it('distinguishes IG permanent EAA token vs 60-day IGAA token', () => {
    expect(isPermanentSocialToken('facebook', 'EAAW123')).toBe(true)
    expect(isPermanentSocialToken('instagram', 'EAAW123')).toBe(true)
    expect(isPermanentSocialToken('instagram', 'IGAA123')).toBe(false)
    expect(isPermanentSocialToken('threads', 'THAA123')).toBe(false)
  })

  it('calculates remaining days safely and clamps at 0', () => {
    const now = Date.UTC(2026, 10, 15)
    expect(calcDaysRemaining(new Date(now - 86_400_000).toISOString(), now)).toBe(0)
    expect(calcDaysRemaining(null, now)).toBeNull()
  })
})
