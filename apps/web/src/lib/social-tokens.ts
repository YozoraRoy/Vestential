/**
 * Issue #152：社群平台（Threads / Instagram / Facebook）Access Token
 * DB 持久化管理層。
 *
 * - 複用既有 `agent_settings` 表儲存換發後的新 Token 與到期時間，免 DB migration。
 * - 讀取順序：DB 持久化值優先 → 若無則 fallback 回環境變數 (`process.env`)。
 * - 絕不將 Token 明文輸出至 API 回應或日誌。
 */

import { getAgentSetting, setAgentSetting } from '@stock/database'

export type ManagedSocialPlatform = 'threads' | 'instagram' | 'facebook'

const TOKEN_SETTING_KEYS: Record<ManagedSocialPlatform, string> = {
  threads: 'social.token.threads',
  instagram: 'social.token.instagram',
  facebook: 'social.token.facebook',
}

const EXPIRES_AT_SETTING_KEYS: Record<ManagedSocialPlatform, string> = {
  threads: 'social.token_expires_at.threads',
  instagram: 'social.token_expires_at.instagram',
  facebook: 'social.token_expires_at.facebook',
}

const REFRESHED_AT_SETTING_KEYS: Record<ManagedSocialPlatform, string> = {
  threads: 'social.token_refreshed_at.threads',
  instagram: 'social.token_refreshed_at.instagram',
  facebook: 'social.token_refreshed_at.facebook',
}

const ENV_VAR_NAMES: Record<ManagedSocialPlatform, string> = {
  threads: 'THREADS_ACCESS_TOKEN',
  instagram: 'IG_ACCESS_TOKEN',
  facebook: 'FB_ACCESS_TOKEN',
}

export interface ResolvedSocialToken {
  token: string | undefined
  source: 'db' | 'env' | 'none'
}

export interface SocialTokenMeta {
  expiresAt: string | null
  lastRefreshedAt: string | null
  daysRemaining: number | null
}

/** 計算距離到期時間的剩餘天數（無條件捨去，最小 0；無效或未設定回 null）。 */
export function calcDaysRemaining(expiresAtIso: string | null | undefined, nowMs = Date.now()): number | null {
  if (!expiresAtIso) return null
  const expMs = Date.parse(expiresAtIso)
  if (!Number.isFinite(expMs)) return null
  const diffDays = Math.floor((expMs - nowMs) / 86_400_000)
  return Math.max(0, diffDays)
}

/** 判斷該平台 Token 是否為永久／System User Token（FB 或 IG EAA* 皆為長期有效）。 */
export function isPermanentSocialToken(platform: ManagedSocialPlatform, token: string | undefined): boolean {
  if (platform === 'facebook') return true
  if (platform === 'instagram') {
    const trimmed = (token ?? '').trim()
    // IGAA* 為 60 天長效 IG User Token；EAA* 為長期 FB Page / System User Token
    return trimmed.startsWith('IGAA') ? false : true
  }
  return false
}

/** 優先讀取 DB 持久化的最新 Token；若 DB 無資料則 fallback 回 process.env。 */
export async function getSocialAccessToken(platform: ManagedSocialPlatform): Promise<ResolvedSocialToken> {
  try {
    const dbVal = await getAgentSetting(TOKEN_SETTING_KEYS[platform])
    const trimmedDb = dbVal?.trim()
    if (trimmedDb) {
      return { token: trimmedDb, source: 'db' }
    }
  } catch {
    // 測試或 DB 未初始化時安全退回 process.env
  }

  const envVal = process.env[ENV_VAR_NAMES[platform]]?.trim()
  if (envVal) {
    return { token: envVal, source: 'env' }
  }
  return { token: undefined, source: 'none' }
}

/** 持久化儲存換發後的新 Token 與到期時間。 */
export async function saveRefreshedSocialToken(
  platform: ManagedSocialPlatform,
  params: { accessToken: string; expiresInSeconds?: number | null; nowMs?: number },
): Promise<SocialTokenMeta> {
  const token = params.accessToken.trim()
  if (!token) throw new Error(`Empty refreshed token for ${platform}`)

  const nowMs = params.nowMs ?? Date.now()
  const refreshedAt = new Date(nowMs).toISOString()
  // Meta 長效 token 預設 60 天（5,184,000 秒）
  const expiresSec =
    typeof params.expiresInSeconds === 'number' && Number.isFinite(params.expiresInSeconds) && params.expiresInSeconds > 0
      ? params.expiresInSeconds
      : 60 * 86_400
  const expiresAt = new Date(nowMs + expiresSec * 1000).toISOString()

  await setAgentSetting({
    key: TOKEN_SETTING_KEYS[platform],
    value: token,
    category: 'social',
    label: `${platform} 持久化 Access Token`,
  })
  await setAgentSetting({
    key: EXPIRES_AT_SETTING_KEYS[platform],
    value: expiresAt,
    category: 'social',
    label: `${platform} Token 到期時間`,
  })
  await setAgentSetting({
    key: REFRESHED_AT_SETTING_KEYS[platform],
    value: refreshedAt,
    category: 'social',
    label: `${platform} Token 最後展延時間`,
  })

  return {
    expiresAt,
    lastRefreshedAt: refreshedAt,
    daysRemaining: calcDaysRemaining(expiresAt, nowMs),
  }
}

/** 讀取該平台儲存在 DB 的效期中繼資料。 */
export async function getSocialTokenMeta(platform: ManagedSocialPlatform, nowMs = Date.now()): Promise<SocialTokenMeta> {
  const [expiresAt, lastRefreshedAt] = await Promise.all([
    getAgentSetting(EXPIRES_AT_SETTING_KEYS[platform]).catch(() => null),
    getAgentSetting(REFRESHED_AT_SETTING_KEYS[platform]).catch(() => null),
  ])
  return {
    expiresAt: expiresAt?.trim() || null,
    lastRefreshedAt: lastRefreshedAt?.trim() || null,
    daysRemaining: calcDaysRemaining(expiresAt, nowMs),
  }
}
