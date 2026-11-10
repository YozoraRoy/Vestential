/**
 * 社群發布平台單一開關（2026-11 起只留 Threads）。
 *
 * 目的：Instagram／Facebook 的「發布」與「Token 偵測」全部停止，
 * 只保留 Threads；IG／FB 的發布實作與 DB 型別仍保留（不接線），
 * 日後要恢復只要改這裡（後台 UI 需一併還原）。
 */
import type { SocialPostPlatform } from '@stock/database'

export const ACTIVE_SOCIAL_PLATFORMS = ['threads'] as const satisfies readonly SocialPostPlatform[]

export type ActiveSocialPlatform = (typeof ACTIVE_SOCIAL_PLATFORMS)[number]

/** 是否為目前啟用的社群平台（用於 API 過濾，避免手動指定 IG／FB 仍被執行）。 */
export function isActiveSocialPlatform(p: string): p is ActiveSocialPlatform {
  return (ACTIVE_SOCIAL_PLATFORMS as readonly string[]).includes(p)
}
