**English** ｜ [繁體中文](./design-guideline_zh.md)

# Vestential Front-End Design Guideline (Design Guideline)

> This document is the sole authority on front-end visuals and structure. When adding a page/component, **refer here first**; do not copy classes page by page by digging through existing pages.
> Corresponding skill: `.agents/skills/design-system/SKILL.md` (loaded automatically when an agent opens a new page).

---

## 1. Design Tokens (source: `apps/web/src/app/globals.css`)

Always use CSS variables for colours, and **never hard-code colour codes**:

| Token | Value | Purpose |
|---|---|---|
| `--bg-primary` | `#0f1118` | Page background (dark base) |
| `--bg-secondary` | `#1a1d2e` | The next background layer (such as the closing band or the colour block under the hero) |
| `--bg-card` | `#222639` | Card/block background |
| `--text-primary` | `#e8eaf0` | Primary text, headings |
| `--text-secondary` | `#9aa0b5` | Secondary text, descriptions, times, footnotes |
| `--accent` | `#4f8cff` | Brand blue: primary CTA, links, key emphasis, AI |
| `--accent-green` | `#34d399` | Positive/success/odd-lot/profit |
| `--accent-red` | `#f87171` | Risk, errors, destructive actions, disclaimer warnings |
| `--accent-violet` | `#a78bfa` | Violet emphasis: the AI Agent Arena / flagship feature card |

Typography scale (`@theme`, using `text-xs/sm/base/lg/xl/2xl/3xl` directly):

| Class | Value | Typical use |
|---|---|---|
| `text-xs` | 0.75rem | Badges, pills, footnotes, metadata |
| `text-sm` | 0.875rem | Card descriptions, secondary text |
| `text-base` | 1rem | Body baseline |
| `text-lg` | 1.125rem | Section headings (H2) |
| `text-xl` | 1.25rem | Large headings within a page, hero H1 (desktop) |
| `text-2xl/3xl` | 1.5/1.875rem | Page-top H1 headings, hero H1 |

Fonts: system fonts (`PingFang TC`/`Noto Sans TC` etc.), see `body` in `globals.css`; no separate setup is needed.

## 2. Component Vocabulary (reusing existing styles)

| Component | Style | Current source |
|---|---|---|
| Page container | `max-w-5xl mx-auto w-full px-4 py-8 md:py-10` (hub, such as home/market focus/arena/portfolio); `max-w-3xl mx-auto px-4 py-16` (reading pages, such as terms/privacy/About); `max-w-6xl mx-auto w-full px-4 py-8 md:py-10` (tools/admin, such as backtest/analyze/cycle-entry/admin); the data-table page (odd-lot) uses a full-width `w-full px-4 md:px-6 lg:px-8` + a table `overflow-x-auto`, scrolling horizontally rather than shrinking the container when there are many columns | `app/page.tsx`; `app/market-focus/page.tsx`; `app/about/page.tsx`; `app/backtest/page.tsx`; `app/odd-lot/page.tsx`; `components/header.tsx` |
| Card | `bg-[var(--bg-card)] rounded-xl border border-white/5 p-4/5`; hover `hover:border-[var(--accent)]/60 hover:-translate-y-0.5 hover:shadow-[0_10px_34px_rgba(79,140,255,0.16)]` | `app/page.tsx` feature cards |
| Metadata pill | `px-1.5 py-0.5 rounded bg-white/5 border border-white/10` | Home page news source |
| Badge | `text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-[var(--text-secondary)]` (such as "AI", "in development") | Home page |
| Primary button (CTA) | `bg-[var(--accent)] text-white font-semibold rounded-xl px-6 py-3 hover:opacity-90 hover:-translate-y-0.5 shadow-[0_8px_24px_rgba(79,140,255,0.25)]` | Home page hero |
| Secondary button | `border border-white/15 rounded-xl px-6 py-3 hover:border-[var(--accent)]/60 hover:text-[var(--accent)]` | Home page hero |
| In-card button | `bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[var(--accent)] text-sm rounded-lg px-3 py-2` | `about/page.tsx` STEP cards |
| CTA text row | `inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent)]` + arrow shift | Home page feature cards |
| Hero | H1 + a small gradient bar underneath `w-16 h-1 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-green)]` + subtitle + 2 buttons | Home page |
| Section heading band | icon + `text-lg/20 font-bold` H2 + subtitle (a badge may be added) | Home page market focus |
| Closing band/quotation | `bg-[var(--bg-secondary)]/60 rounded-2xl px-6 py-5 border border-white/5` | Home page quote band |
| Disclaimer box | `rounded-xl border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/5 px-6 py-5` + an inline `text-xs text-[var(--accent)]` | `about/page.tsx` disclaimer |
| Icon colour block | `w-11 h-11 rounded-xl flex items-center justify-center` + `bg-[var(--accent)]/15 text-[var(--accent)]` (or the green version) | Home page feature cards |
| External-link arrow | `ArrowUpRight` placed at the top right, next to the source pill | Home page news cards |

> In-development/not-yet-open features: the card gets `opacity-80 select-none` + an "in development" badge, and **no clickable link**.

## 3. Layout Conventions

- Heading hierarchy: a page may have **only one `<h1>`**; sections use `<h2>` (with `id` + `aria-labelledby`); card titles include an H level.
- Spacing rhythm: `mb-10~14` between sections; `gap-4 md:gap-5` between cards.
- Responsive: 1 column on mobile → `sm:grid-cols-2` → `lg:grid-cols-3`.
- Three languages: all UI strings go into the i18n dict (define in `dictionary-types.ts` first, then fill in zh-TW/en/ja); **content-type data (such as news) is not translated**.

## 4. New Page SOP

1. Decide the container: reading/explanation pages `max-w-3xl`; hub/content pages `max-w-5xl` (such as market focus, where the news list uses `lg:grid-cols-2`); tools/admin `max-w-6xl`; data-table pages (many columns) use a full-width container + a table `overflow-x-auto`, to avoid layout breakage.
2. Compose per §2: Hero (if any) → section heading band → card grid → closing band/disclaimer.
3. i18n: add the key in `dictionary-types.ts` → fill in the three languages (leave a note for untranslated ones rather than leaving it in the code).
4. SEO: `generateMetadata` (`title`/`description`/`buildAlternates(locale, route)`/OG/twitter); JSON-LD `@graph` (shared WebSite/Organization + WebPage + a data-type ItemList); add the route to `publicPaths` in `sitemap.ts`.
5. Verification: contrast (`--text-secondary` on a dark background ≥ 3.5:1, used below that only for supplementary text), `aria-label`/`aria-labelledby`, and no layout breakage on mobile.

## 5. Locale and SEO Conventions

- `getDict()`/`getLocale()` (`@/i18n/server`); `localizePath(locale, route)` produces the regional path; `buildAlternates(locale, route)` produces canonical + hreflang.
- Add `openGraph` + `twitter:card` to the metadata (the home page already has them, so copy them for new pages).
- Dynamic OG image: the whole site shares `app/opengraph-image.tsx` (`next/og`), so new pages do not need their own image.

## 6. Usable but Avoided (not present in this project)

- Do not add UI libraries beyond a CSS framework (Tailwind only).
- Do not use image assets/image libraries beyond what `next/image` requires.
- Do not override tokens with an inline `style`; special brand gradients are only for the hero and the OG image.
