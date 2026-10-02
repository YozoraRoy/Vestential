// 官網對外社群入口（Issue #55）：全站 footer＋about 聯絡段共用，兩處 href 必須一致。
// 顯示文字為品牌名（Threads／Instagram／Facebook），三語系相同，故不佔 i18n key。
// utm 拼接注意：FB 原 URL 已有 `?id=` 參數故用 `&`，其餘用 `?`。
export type SiteSocialKey = 'threads' | 'instagram' | 'facebook'

export interface SiteSocialLink {
  key: SiteSocialKey
  label: string
  href: string
}

export const SITE_SOCIAL_LINKS: SiteSocialLink[] = [
  { key: 'threads', label: 'Threads', href: 'https://www.threads.com/@vestential?utm_source=site' },
  { key: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/vestential/?utm_source=site' },
  { key: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/profile.php?id=61593946847568&utm_source=site' },
]
