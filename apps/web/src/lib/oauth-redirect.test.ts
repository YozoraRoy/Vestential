import { describe, expect, it } from 'vitest'
import { firstHeaderValue, hostnameOf, resolveOAuthEntryRedirect } from './oauth-redirect'

const base = { pathname: '/api/auth/login/line', search: '' }

describe('resolveOAuthEntryRedirect', () => {
  it('http 主網域導到同 path 的 https', () => {
    expect(resolveOAuthEntryRedirect({ ...base, host: 'vestential.com', protocol: 'http' }))
      .toBe('https://vestential.com/api/auth/login/line')
  })

  it('導流保留 query string', () => {
    expect(resolveOAuthEntryRedirect({
      ...base, host: 'vestential.com', protocol: 'http', search: '?redirect=/portfolio',
    })).toBe('https://vestential.com/api/auth/login/line?redirect=/portfolio')
  })

  it('https 主網域不導流', () => {
    expect(resolveOAuthEntryRedirect({ ...base, host: 'vestential.com', protocol: 'https' })).toBeNull()
  })

  it('舊 Azure 主機一律導回主網域（https 也導）', () => {
    expect(resolveOAuthEntryRedirect({
      ...base, host: 'stock-platform-roy.azurewebsites.net', protocol: 'https',
    })).toBe('https://vestential.com/api/auth/login/line')
  })

  it('舊 Azure 主機帶埠號仍導回主網域，並保留 query', () => {
    expect(resolveOAuthEntryRedirect({
      ...base,
      host: 'stock-platform-roy.azurewebsites.net:443',
      protocol: 'http',
      search: '?redirect=/portfolio',
    })).toBe('https://vestential.com/api/auth/login/line?redirect=/portfolio')
  })

  it.each([
    'localhost:3000',
    '127.0.0.1:3000',
    '[::1]:3000',
    'localhost',
  ])('本機 host %s 豁免導流', host => {
    expect(resolveOAuthEntryRedirect({ ...base, host, protocol: 'http' })).toBeNull()
  })
})

describe('hostnameOf', () => {
  it('去掉埠號並轉小寫', () => {
    expect(hostnameOf('Vestential.com:443')).toBe('vestential.com')
  })

  it('IPv6 保留方括號', () => {
    expect(hostnameOf('[::1]:3000')).toBe('[::1]')
  })
})

describe('firstHeaderValue', () => {
  it('逗號分隔時取第一個', () => {
    expect(firstHeaderValue('vestential.com, stock-platform-roy.azurewebsites.net')).toBe('vestential.com')
  })

  it('缺值回空字串', () => {
    expect(firstHeaderValue(null)).toBe('')
  })
})
