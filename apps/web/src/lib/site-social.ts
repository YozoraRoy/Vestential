// 官網對外社群入口（Issue #55）：全站 footer＋about 聯絡段共用，兩處 href 必須一致。
// 2026-11 起只留 Threads（Instagram／Facebook 已停止發布與 token 偵測）。
// 顯示文字為品牌名，三語系相同，故不佔 i18n key。
export type SiteSocialKey = 'threads'

export interface SiteSocialLink {
  key: SiteSocialKey
  label: string
  href: string
}

export const SITE_SOCIAL_LINKS: SiteSocialLink[] = [
  { key: 'threads', label: 'Threads', href: 'https://www.threads.com/@vestential?utm_source=site' },
]
