[English](./design-guideline.md) ｜ **繁體中文**

# Vestential 前端設計指南 (Design Guideline)

> 本文是前端視覺與結構的唯一權威。新增頁面／元件時**優先參照這裡**，不要從既有頁面逐頁考古複製 class。
> 對應 skill：`.agents/skills/design-system/SKILL.md`（agent 開新頁面時自動載入）。

---

## 1. 設計 Tokens（來源：`apps/web/src/app/globals.css`）

色彩一律用 CSS 變數，**不得硬編碼色碼**：

| Token | 值 | 用途 |
|---|---|---|
| `--bg-primary` | `#0f1118` | 頁面背景（深底） |
| `--bg-secondary` | `#1a1d2e` | 次一層背景（如收尾帶、hero 底下色塊） |
| `--bg-card` | `#222639` | 卡片／區塊背景 |
| `--text-primary` | `#e8eaf0` | 主要文字、標題 |
| `--text-secondary` | `#9aa0b5` | 次要文字、描述、時間、註腳 |
| `--accent` | `#4f8cff` | 品牌藍：主 CTA、連結、重點強調、AI |
| `--accent-green` | `#34d399` | 正向／成功／零股／獲利 |
| `--accent-red` | `#f87171` | 風險、錯誤、破壞性操作、免責警示 |
| `--accent-violet` | `#a78bfa` | 紫色強調：AI 投資競技場／旗艦功能卡 |

字級 scale（`@theme`，直接 `text-xs/sm/base/lg/xl/2xl/3xl`）：

| Class | 值 | 慣用場合 |
|---|---|---|
| `text-xs` | 0.75rem | 徽章、pill、註腳、元資料 |
| `text-sm` | 0.875rem | 卡片描述、次要文字 |
| `text-base` | 1rem | 正文基準 |
| `text-lg` | 1.125rem | 區塊標題 (H2) |
| `text-xl` | 1.25rem | 頁面內大標題、hero H1（桌面） |
| `text-2xl/3xl` | 1.5/1.875rem | H1 頁首標題、hero H1 |

字型：系統字型（`PingFang TC`/`Noto Sans TC` 等），見 `globals.css` `body`，不需另設。

## 2. 元件詞彙表（複用現有樣式）

| 元件 | 樣式 | 現行出處 |
|---|---|---|
| 頁面容器 | `max-w-5xl mx-auto w-full px-4 py-8 md:py-10`（hub，如首頁/市場焦點/競技場/投資組合）；`max-w-3xl mx-auto px-4 py-16`（閱讀頁，如條款/隱私/About）；`max-w-6xl mx-auto w-full px-4 py-8 md:py-10`（工具/後臺，如 backtest/analyze/cycle-entry/admin）；資料表格頁（odd-lot）用滿版 `w-full px-4 md:px-6 lg:px-8`＋表格 `overflow-x-auto`，欄位多時橫向捲動、不縮容器 | `app/page.tsx`；`app/market-focus/page.tsx`；`app/about/page.tsx`；`app/backtest/page.tsx`；`app/odd-lot/page.tsx`；`components/header.tsx` |
| 卡片 | `bg-[var(--bg-card)] rounded-xl border border-white/5 p-4/5`；hover `hover:border-[var(--accent)]/60 hover:-translate-y-0.5 hover:shadow-[0_10px_34px_rgba(79,140,255,0.16)]` | `app/page.tsx` 功能卡 |
| 元資料 pill | `px-1.5 py-0.5 rounded bg-white/5 border border-white/10` | 首頁新聞來源 |
| 徽章 | `text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]`（如「AI」「開發中」） | 首頁 |
| 主按鈕 (CTA) | `bg-[var(--accent)] text-white font-semibold rounded-xl px-6 py-3 hover:opacity-90 hover:-translate-y-0.5 shadow-[0_8px_24px_rgba(79,140,255,0.25)]` | 首頁 hero |
| 次要按鈕 | `border border-white/15 rounded-xl px-6 py-3 hover:border-[var(--accent)]/60 hover:text-[var(--accent)]` | 首頁 hero |
| 卡內按鈕 | `bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[var(--accent)] text-sm rounded-lg px-3 py-2` | `about/page.tsx` STEP 卡 |
| CTA 文字列 | `inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent)]` + 箭頭位移 | 首頁功能卡 |
| Hero | H1 + 下方漸層小條 `w-16 h-1 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-green)]` + 副標 + 2 按鈕 | 首頁 |
| Section 標題帶 | icon + `text-lg/20 font-bold` H2 + 副標（可加徽章） | 首頁市場焦點 |
| 收尾帶／引文 | `bg-[var(--bg-secondary)]/60 rounded-2xl px-6 py-5 border border-white/5` | 首頁名言帶 |
| 免責框 | `rounded-xl border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/5 px-6 py-5` + 內連 `text-xs text-[var(--accent)]` | `about/page.tsx` 免責 |
| icon 色塊 | `w-11 h-11 rounded-xl flex items-center justify-center` + `bg-[var(--accent)]/15 text-[var(--accent)]`（或 green 版） | 首頁功能卡 |
| 外連箭頭 | `ArrowUpRight` 置右上，source pill 旁 | 首頁新聞卡 |

> 開發中／未開放功能：卡 `opacity-80 select-none` + 「開發中」徽章，**不放可點的連結**。

## 3. 版面慣例

- 標題層級：一頁**只允許一個 `<h1>`**；區塊用 `<h2>`（帶 `id`＋`aria-labelledby`）；卡片標題含 H 層級。
- 間距節奏：區塊間 `mb-10~14`；卡間 `gap-4 md:gap-5`。
- 回應式：行動版 1 欄 → `sm:grid-cols-2` → `lg:grid-cols-3`。
- 三語：所有 UI 字串進 i18n dict（`dictionary-types.ts` 先定義，再補 zh-TW/en/ja），**內容類資料（如新聞）不翻譯**。

## 4. 新增頁面 SOP

1. 決定容器：閱讀/說明頁 `max-w-3xl`；hub/內容頁 `max-w-5xl`（如市場焦點，新聞清單用 `lg:grid-cols-2`）；工具/後臺 `max-w-6xl`；資料表格頁（欄位多）用滿版容器＋表格 `overflow-x-auto`，避免跑版。
2. 依 §2 組合：Hero（若有）→ Section 標題帶 → 卡片網格 → 收尾帶/免責。
3. i18n：`dictionary-types.ts` 加 key → 三語補值（未翻譯留註記不留在 code）。
4. SEO：`generateMetadata`（`title`/`description`/`buildAlternates(locale, route)`/OG/twitter）；JSON-LD `@graph`（WebSite/Organization 共用 + WebPage + 資料型 ItemList）；`sitemap.ts` `publicPaths` 加路由。
5. 驗證：contrast（`--text-secondary` 於深底 ≥ 3.5:1 以下僅用於輔助）、`aria-label`/`aria-labelledby`、行動版不破版。

## 5. 語系與 SEO 慣例

- `getDict()`／`getLocale()`（`@/i18n/server`）；`localizePath(locale, route)` 產生地區路徑；`buildAlternates(locale, route)` 產 canonical + hreflang。
- metadata 加 `openGraph` + `twitter:card`（首頁已開之，新頁照抄）。
- 動態 OG 圖：全站共用 `app/opengraph-image.tsx`（`next/og`），新頁不需要自己的圖。

## 6. 可用但避免的（本專案沒有的）

- 不引 CSS framework 以外的 UI 庫（Tailwind only）。
- 不用 `next/image` 需求外的圖片資源／圖庫。
- 不以 inline `style` 覆蓋 token；特殊品牌漸層僅 hero 與 OG 圖。