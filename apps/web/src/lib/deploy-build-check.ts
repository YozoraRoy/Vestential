export interface BuildInfo {
  version: string
  builtAt: string
}

/**
 * 判斷 `/api/health` 回傳是否確認已由目標版本（expectedVersion）的新容器服務。
 *
 * 四態契約（#157 / #186）：
 * - 版本相符且不為 `'unknown'` -> `true`
 * - 版本不符 -> `false`
 * - 缺 `build` 或 `build.version` 欄位／格式無效 -> `false`
 * - `version === 'unknown'` 或 `expectedVersion === 'unknown'` -> `false`
 */
export function isNewBuildServed(body: unknown, expectedVersion: string): boolean {
  if (!expectedVersion || expectedVersion === 'unknown') return false
  let payload: unknown = body
  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    if (!trimmed) return false
    try {
      payload = JSON.parse(trimmed)
    } catch {
      return false
    }
  }
  if (!payload || typeof payload !== 'object') return false
  const build = (payload as { build?: unknown }).build
  if (!build || typeof build !== 'object') return false
  const version = (build as { version?: unknown }).version
  if (typeof version !== 'string' || !version || version === 'unknown') return false
  return version === expectedVersion
}
