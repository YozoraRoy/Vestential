/**
 * OAuth 登入入口的導流規則（純函式，方便測試）。
 *
 * 目的：`stock_oauth` cookie 只會種在「使用者實際瀏覽的 host」上，而 callback 的
 * `redirect_uri` 固定走 `AUTH_BASE_URL`（https://vestential.com）。只要入口是 http
 * 或舊的 Azure 主機，cookie 就種在別的 origin／被瀏覽器丟棄，callback 一定驗不到 state。
 * 因此在發 cookie 之前先把使用者導到唯一主網域的 https 版本。
 */
export const CANONICAL_ORIGIN = 'https://vestential.com'

/** 舊的 Azure 預設主機，一律導回主網域。 */
const LEGACY_HOSTNAMES = ['stock-platform-roy.azurewebsites.net']

/** 本機開發豁免（任何埠），否則 `http://localhost:3000` 會被導去 https 而連不上 dev server。 */
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]']

/** `x-forwarded-host`／`x-forwarded-proto` 可能是逗號分隔串，取第一個（最靠近使用者的值）。 */
export function firstHeaderValue(raw: string | null | undefined): string {
  return (raw ?? '').split(',')[0].trim()
}

/** 去掉埠號並轉小寫；IPv6 保留 `[::1]` 形式。 */
export function hostnameOf(host: string): string {
  const value = host.trim().toLowerCase()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end === -1 ? value : value.slice(0, end + 1)
  }
  return value.split(':')[0]
}

export interface OAuthEntryRequest {
  host: string
  protocol: string
  pathname: string
  search: string
}

/**
 * 回傳應該 301 過去的絕對網址；不需要導流時回 `null`（照舊發 cookie、307 出站）。
 */
export function resolveOAuthEntryRedirect(req: OAuthEntryRequest): string | null {
  const hostname = hostnameOf(req.host)
  if (LOCAL_HOSTNAMES.includes(hostname)) return null

  const pathAndQuery = `${req.pathname}${req.search}`
  if (LEGACY_HOSTNAMES.includes(hostname)) return `${CANONICAL_ORIGIN}${pathAndQuery}`
  if (req.protocol.toLowerCase() === 'http') return `https://${req.host}${pathAndQuery}`
  return null
}
