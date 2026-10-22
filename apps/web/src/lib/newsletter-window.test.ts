import { describe, it, expect } from 'vitest'
import { isNewsletterSendWindow } from './newsletter-window'

describe('isNewsletterSendWindow', () => {
  it('allows 08:00–13:59 TW (09:00 send + 13:00 fallback)', () => {
    for (let h = 8; h < 14; h += 1) expect(isNewsletterSendWindow(h)).toBe(true)
  })

  it('blocks the 01:00 overnight refresh round', () => {
    expect(isNewsletterSendWindow(1)).toBe(false)
    expect(isNewsletterSendWindow(0)).toBe(false)
  })

  it('blocks 14:00 and later (13:00 is the last fallback)', () => {
    expect(isNewsletterSendWindow(14)).toBe(false)
    expect(isNewsletterSendWindow(19)).toBe(false)
    expect(isNewsletterSendWindow(23)).toBe(false)
  })
})
