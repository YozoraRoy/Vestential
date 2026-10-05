import { describe, it, expect } from 'vitest'
import {
  SOCIAL_ALERT_LINE_MAX_CHARS,
  SOCIAL_ALERT_MAX_ERROR_CHARS,
  SOCIAL_ALERT_RETRY_HINT,
  buildFestivalPartialFailMessage,
  buildFirstReplyFailMessage,
  buildSocialPartialFailMessage,
  succeededPlatforms,
  truncateAlertError,
  truncateAlertText,
} from './social-alert'

// Issue #57：組裝函式純函式測，三語境（日常／節慶／首回覆失敗）輸出快照；無新增外部依賴。

const DAILY_RESULTS = [
  { platform: 'threads' as const, status: 'published', error: null },
  { platform: 'facebook' as const, status: 'published', error: null },
  { platform: 'instagram' as const, status: 'failed', error: 'Application request limit reached (4)' },
]

describe('buildSocialPartialFailMessage（日常）', () => {
  it('含內容名、成功平台、失敗平台＋錯誤原文、重試方式、edition key', () => {
    const out = buildSocialPartialFailMessage('2026-10-02T17:16:00.000Z', DAILY_RESULTS)
    expect(out).toContain('今日市場焦點總覽 2026-10-02')
    expect(out).toContain('成功：Threads、FB')
    expect(out).toContain('IG: Application request limit reached (4)')
    expect(out).toContain(SOCIAL_ALERT_RETRY_HINT)
    expect(out).toContain('/admin/social')
    expect(out).toContain('edition: 2026-10-02T17:16:00.000Z')
    expect(out).toMatchSnapshot()
  })
})

describe('buildFestivalPartialFailMessage（節慶）', () => {
  it('含節慶名＋日期、成功平台、失敗平台＋錯誤原文、重試方式、edition key', () => {
    const out = buildFestivalPartialFailMessage('mid-autumn', '2026-09-25', 'festival:mid-autumn:2026-09-25', DAILY_RESULTS)
    expect(out).toContain('中秋節賀文 2026-09-25')
    expect(out).toContain('成功：Threads、FB')
    expect(out).toContain('IG: Application request limit reached (4)')
    expect(out).toContain(SOCIAL_ALERT_RETRY_HINT)
    expect(out).toContain('edition: festival:mid-autumn:2026-09-25')
    expect(out).toMatchSnapshot()
  })
})

describe('buildFirstReplyFailMessage（首回覆失敗）', () => {
  it('含內容名、失敗平台＋錯誤原文、重試方式、edition key，主文不受影響備註', () => {
    const out = buildFirstReplyFailMessage('instagram', 'IG_ACCESS_TOKEN 未設定', '2026-10-02T17:16:00.000Z')
    expect(out).toContain('今日市場焦點總覽 2026-10-02首回覆')
    expect(out).toContain('IG: IG_ACCESS_TOKEN 未設定')
    expect(out).toContain(SOCIAL_ALERT_RETRY_HINT)
    expect(out).toContain('edition: 2026-10-02T17:16:00.000Z')
    expect(out).toContain('主文')
    expect(out).toMatchSnapshot()
  })
})

describe('succeededPlatforms', () => {
  it('未失敗者即成功（IG 失敗 → Threads、FB 成功）', () => {
    expect(succeededPlatforms(['instagram', 'threads', 'facebook'], [{ platform: 'instagram' }])).toEqual([
      'threads',
      'facebook',
    ])
  })
})

describe('LINE 截斷規則', () => {
  it('單則錯誤超長先截錯誤尾，全文仍保持 ≤5000 字', () => {
    const longError = `Application request limit reached ${'x'.repeat(6000)}`
    const out = buildSocialPartialFailMessage('2026-10-02T17:16:00.000Z', [
      { platform: 'threads', status: 'failed', error: longError },
      { platform: 'facebook', status: 'failed', error: longError },
      { platform: 'instagram', status: 'failed', error: longError },
    ])
    expect(Array.from(out).length).toBeLessThanOrEqual(SOCIAL_ALERT_LINE_MAX_CHARS)
    expect(out).toContain('錯誤過長已截斷')
    expect(out).toContain('今日市場焦點總覽 2026-10-02')
    expect(out).toContain('edition: 2026-10-02T17:16:00.000Z')
  })

  it('全文超 5000 字（防禦層）截尾＋附全文總字數', () => {
    const out = truncateAlertText(`內容：今日市場焦點總覽\n${'x'.repeat(6000)}`)
    expect(Array.from(out).length).toBeLessThanOrEqual(SOCIAL_ALERT_LINE_MAX_CHARS)
    expect(out).toContain('訊息過長已截斷，全文共')
    expect(out).toContain('內容：今日市場焦點總覽')
  })

  it('truncateAlertText 以 code point 計，不切半 emoji', () => {
    const out = truncateAlertText(`${'🎃'.repeat(100)}${'x'.repeat(6000)}`, 100)
    expect(Array.from(out).length).toBeLessThanOrEqual(100)
    expect(out).toContain('訊息過長已截斷')
  })

  it('Issue #61：首次 403 根因在前，經 1000 字截斷仍可辨識', () => {
    const combined =
      `Meta 限流重試用罄（首次 HTTP 403 code=4 subcode=100：Application request limit reached；` +
      `末次 HTTP 400 code=-1：Fatal downstream error，已退避重打 2 次）${'x'.repeat(2000)}`
    const truncated = truncateAlertError(combined)
    expect(Array.from(truncated).length).toBeLessThanOrEqual(SOCIAL_ALERT_MAX_ERROR_CHARS + 20)
    expect(truncated).toContain('首次 HTTP 403 code=4')
    // 告警內文透傳同樣保留根因於截斷保留側
    const out = buildSocialPartialFailMessage('2026-10-02T17:16:00.000Z', [
      { platform: 'instagram', status: 'failed', error: combined },
    ])
    expect(out).toContain('首次 HTTP 403 code=4')
  })
})
