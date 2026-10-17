**English** ｜ [繁體中文](./ui-table-checklist_zh.md)

# UI Table Checklist (Issue #75 SOP)

When adding or changing any table (front end + admin + email leaderboards), tick each item off. Violating any item means it is rejected.

## 1. Sorting
- Sortable columns use `<th aria-sort>` + an inline `<button>` (example: `SortTh` in `app/chip-radar/page.tsx`).
- The current column gets `aria-sort="ascending|descending"` and the rest `"none"`; the header has a ▲▼ indicator (highlighted when active).
- Default order = data-source order (chip: share ↓ = engine `ratioPct desc` = API = email; a stable sort, so refreshing does not jump around). **Exception**: the cycle-entry list defaults to win rate ↓ (specified by the user in Issue #82; the header button can toggle it and nulls sink to the bottom) — this exception must not spread, and new tables still default to data-source order.
- Sorting only reorders the main rows; expanded rows (colSpan details) are unaffected.
- Mobile 360px: wrap the table in `overflow-x-auto` + `min-w`, without horizontal overflow onto the page.

## 2. Typography (unified site-wide)
- Header row: `text-sm font-semibold`; body (at the table level): `text-[13px]`; numeric columns keep `tabular-nums`.
- **Do not hand-write classes**: always obtain values through `tableClass(typo, extra[, v1])` / `headTrClass(typo, extra[, v1])` in `lib/table-typography.ts` plus `useTableTypography()`, so the v1/v2 branching is confined to that file.
- Legacy typography restoration (used when the admin switches to v1): default table `text-sm` / header `text-xs`; special-case tables pass a third argument (the portfolio recognition table `text-xs`, the backtest embedded table `text-xs`, the ex-dividend detail table `text-[11px]`, and thead tr with no typography originally passes `''`).
- Admin toggle: `agent_settings: ui.table_typography` (v2 default / v1 legacy), adjustable under `後台 Agent 設定 → 介面顯示`; the front end reads it via the public endpoint `GET /api/ui-config`, and it takes effect on the next load without a code change.
- `risk-panel` has no thead and is skipped; the other 18 tables (admin×6, backtest main + embedded, portfolio main + recognition, arena-view×2, analysis-card, cycle modal, cycle view, odd-lot-view, chip, ex-dividend detail) are all wired up.

## 3. Loading
- No bare "Loading…": always use the shared `components/table-skeleton.tsx` (spinner + 5 pulse rows, following the `odd-lot/loading.tsx` visuals), with `aria-busy` + `aria-live="polite"`.
- Pages must not write their own skeleton (extend the shared component first if there is a new need).

## 4. Site-Email Consistency (leaderboard type)
- All four elements must be present in the email: the threshold line (the admin value, e.g. consecutive buy/sell days + share %) / a note that it is "sorted by share" / a note about truncation to the top 20 / a snapshot statement "a snapshot at send time (asOf); if recomputed the next day, the live site prevails".
- The data-time copy in the site's page header must align with the email (chip: `資料時間：X（盤後初值；上市；未含融資）`).
- The trend axis exists only on the site → the site must note wording such as "not in the email, click the row to expand"; the email does not draw a trend axis.

## 5. Placeholder-Column Ban
- A whole column with a single repeated value (such as "未含融資") is **forbidden as a column**: delete the th/td, fix the colSpan, and put the explanation in a footnote; the API fields are kept for phase two (such as `margin_available`, `marginNote`) and left untouched.
- Before phase two is wired to a source, `diverge` is always false and must not be given a tag.

## 6. The Disclaimer Four-Piece Set (leaderboard/statistics page footer + email footer)
1. The statistics method (one line: data source + formula, e.g. institutional investors = foreign investors combined + investment trusts; share = |net over-buy × closing price| / turnover).
2. "Statistical signals are not investment advice".
3. Coverage (mainly listed; if OTC / proprietary traders / margin trading are not included, say so explicitly).
4. A terms-of-service link (the site links `/terms`; the email includes the full URL + unsubscribe).
