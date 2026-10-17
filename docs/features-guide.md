**English** ｜ [繁體中文](./features-guide_zh.md)

# Core Features & Module Guide

This guide explains in detail the operating principles, algorithm design and operational details of each feature module on the Vestential platform.

---

## 1. 💰 Portfolio P&L and AI Investment Advice (`/portfolio`)

### 1.1 Multi-market Holdings Management
- **Both Taiwan and US stocks supported**: for Taiwan stocks, entering a plain numeric symbol automatically identifies listed/OTC (`.TW` / `.TWO`); for US stocks, entering the symbol reads the quote directly. (This section, `/portfolio`, still keeps both markets; `/analyze` only supports Taiwan stocks, see §9 for details.)
- **Automatic and manual pricing**: the system automatically connects to the latest intraday quotes and computes holding cost, current market value, unrealized P&L and total return (`totalReturn`; since #44 it has become the **bare price spread** = market value − cost, no longer including dividends — a one-time basis change for history). Users can also manually override the current price to run scenario estimates. The dividend input/display column has been removed entirely (the DB column is kept and written as 0); yield is instead presented from the TWSE authoritative source in two columns, "current year / 5-year average" (the former Yahoo "yield (reference)" column was retired in #94, see §1.8).
- **After-tax net P&L shown side by side (`computeNetPnL`; `computePnL` uses the bare price spread throughout: `totalReturn = unrealizedPnl`, `yieldOnCost` fixed at 0)**: the calculator page and the record detail simultaneously show the bare P&L and the after-tax net P&L + a three-line breakdown (buy fee / sell fee / securities transaction tax) + a formula footnote. Rules: fee rate 0.1425% × discount (default 60% of list, adjustable via the admin `portfolio.fee_discount`), charged once each on buy and sell, rounded up to NT$20 when below NT$20; the securities transaction tax is deducted on sale (Taiwan stocks 0.3%, ETFs 0.1%, US stocks 0). Taiwan ETFs are determined heuristically by "symbol starting with 00" (the page notes possible misjudgement). Backtests/risk continue to use bare values and are unaffected.

### 1.2 📷 Broker-screenshot AI Recognition Batch Import
- **Multi-image support and specs**: supports uploading directly, or dragging and dropping, holdings screenshots or statements from the apps of major brokers (PNG/JPG format, single file ≤10MB).
- **Multi-model Vision recognition**: the backend calls a vision-capable LLM (Google Gemini or an OpenAI-compatible endpoint) and parses several stocks' market, symbol, share count, purchase cost and current price from the screenshot in one pass.
- **Immediate correction of omissions**: if a symbol cannot be recognized because of resolution or font, the first column of the UI shows a "sync" button; clicking it lets you pick the correct instrument from the built-in Taiwan-stock local database and fuzzy search, and automatically fills in the live quote.
- **Independent anti-abuse quota**: image recognition offers an independent free quota of **10 times per day** (recorded in the `recognition_usage` table) so that the high-cost Vision API is not maliciously exhausted.

### 1.3 Advice from the 5 Great Investment Rules
Integrating the following investment schools, it produces `BUY`, `HOLD`, `SELL` or `AVOID` advice:
1. **Buffett value investing**: reviews the company's moat, free cash flow and margin of safety.
2. **Growth-stock investing**: assesses revenue YoY growth, industry position and P/E expansion potential.
3. **Dividend defensive investing**: focuses on consecutive years of dividend payments and the stability of the cash yield.
4. **Momentum trend investing**: refers to moving-average alignment and mid-term relative strength.
5. **Balanced allocation**: provides rebalancing warnings based on the industry concentration of the overall holdings.

### 1.4 🔓 No-login Guest Mode and the 120-bit Claim Code
- **Ready to use without login**: when not logged in, an independent workspace is created via a browser HttpOnly signed cookie (`vest_guest`); all holdings and custom P&L are stored in complete local isolation, and database records are tagged with `guest_uid`.
- **Cross-device claim code**: a guest can generate with one click a set of **120-bit random claim code** (the database stores only the SHA-256 hash, and the redemption side has an IP rate limit). Entering that code on another phone or computer safely recovers the holdings records, and after logging in it can also be bound seamlessly to a formal account.

### 1.5 Holdings Records Table View + Edit/Delete
- **Card | table dual view**: the records section header lets you switch; on desktop (`md` and above) the table is the default on first visit, mobile stays on cards; the preference is stored in `localStorage` (`portfolio-records-view`) and reused after re-entering following a switch.
- **All columns + sorting**: rating / name / symbol / shares / cost / current price / total cost / market value / unrealized / return rate / current-year yield / 5-year average yield / net P&L / created time (14 data columns) + an always-visible action column (horizontal scroll; since #94 the "yield reference" column has been removed, going from the original 15 columns to 14); the name / unrealized / return rate / current-year yield / 5-year average yield / created time headers can be clicked to toggle ascending/descending (pure front end); a row can be expanded to see the AI summary and the full report.
- **Edit modal**: each record can be edited (market / symbol / shares / cost / current price / strategy, pre-filled + reusing the create validation; since #44 the dividend column is removed and updates always write 0), solving the need to correct a record when image recognition cost is 0; restricted to the owner (`id + user_id` scope, 404 for others, 401 when not logged in).
- **Delete + double-click guard**: a delete button per record (second confirmation); both "create all" and per-record creation have an in-flight guard (a ref blocks re-entry + disabled + a "creating" label), so rapid clicks send only once.

### 1.6 Portfolio Risk Dashboard + Stress Test + AI Summary
- **Concentration overview**: the weight % of each instrument, Top-1 / Top-3 share, and grouping share by industry (total 100% ±0.1%; industry classification prefers the Yahoo sector → built-in mapping → uncategorized; Taiwan and US are grouped by currency and never mixed).
- **Three-scenario estimate**: the market falls 10% / 20%, and the largest held industry plunges 30%; each outputs the portfolio loss amount + % (pure holdings × decline arithmetic, reproducible by hand; instruments with missing data are marked "not included in the estimate" rather than filled with 0). Empty positions / a single holding show an empty state, with no error and no NaN.
- **AI risk summary**: a descriptive summary (no forecasts, no buy/sell advice, speak-human-tw) + disclaimer + data timestamp; shares the tiered quota with analyze (#44: 1/day for regular users, 3/day for admins, with the remaining X/Y shown next to the button); on failure it degrades to showing only the numbers table.
- **Summary retention**: the state is lifted to the page level + cached in `localStorage` (key = date + holdings snapshot); it is reused when it is the same day and the holdings have not changed, otherwise the user is prompted to press again; it is not reused across days.
- **Summary row**: the fourth card is "total investment cost" (Σ cost_basis for Taiwan + US; it replaced the former US unrealized card because that was always $0 when there were no holdings, while the US detail remains inside the table rows).

### 1.7 Trading Journal (`/journal`)
- **CRUD + monthly stats**: date / instrument / direction / entry and exit price / shares / reason / whether the stop-loss was followed; monthly stats (count / win rate / average gain and loss / largest drawdown trade) are consistent with the detail totals; writing is not possible when not logged in (redirect to login preserving the return path).
- **AI review**: Top-3 discipline issues + references to concrete trades (only quoting the original text, no speculation, no prediction of future buy/sell points); blocked with a prompt to record first when fewer than 5 trades; the review deducts from the shared tiered quota (#44: 1/day for regular users, 3/day for admins; the stats table is free to view). (The nav entry has been removed, but going directly to `/journal` still works, see #44.)

### 1.8 Current-year Yield + 5-year Average Yield (TWSE authoritative source; #44 replaced manual dividend entry, #95 fixed the basis)
- **Current-year yield (YTD basis, Taiwan stocks only)**: formula `current-year yield = total cash per share ex-dividend this year ÷ current price ×100%`, where the numerator counts only cash dividends with `ex_date ≤ today` (**those announced but not yet ex-dividend are not counted**, to avoid counting money that will only be paid in the future as part of this year). It is consistent with a hand calculation of this year's `twse_dividends` summed over `ex_date ≤ today`; US stocks have no authoritative source, so it shows —.
- **5-year average yield**: formula `5-year average = (average of the per-share totals across the 5 complete years up to last year) ÷ current price ×100%`, with the window being `(Y-5)..(Y-1)` (e.g. 2026 = 2021~2025), **excluding the current year** (the current year is only YTD and is less than a year, so including it would understate the average). Missing years (no cache for the whole year) are neither filled with 0 nor counted in the average, and the UI adds a "years incomplete" note; an incomplete year set on cold start is expected.
- **Three data sources (all official TWSE, no third party)**:
  1. `TWT48U` ex-rights/ex-dividend preview table (daily CSV): the real-time source accumulated day by day for the current year, stored in `twse_dividends` (`ensureTodayDividends`, not re-fetched on the same day).
  2. `TWT49U` ex-rights/ex-dividend calculation result table (month-range JSON): the source for historical backfill (month granularity since #90).
  3. `t187ap45_L` listed dividend distribution table (OpenAPI): the official **exact cash dividend**, used to overwrite rights/rights-and-dividend stocks (see below). A single file is 2.47 MB (471 KB transferred after undici's automatic gzip), the fetch timeout is `T187AP45_FETCH_TIMEOUT_MS = 120 seconds` (#95 P4: measured in the cross-region Azure Canada Central, it times out every time after 20 seconds; the upper bound is constrained by the sync workflow's `--max-time 240`); when the fetch fails it degrades to applying only the TWT49U dividend rows and not overwriting the rights-and-dividend rows (best-effort, it does not block the main flow).
- **More precise cash-dividend parsing (#95)**: for rows in TWT49U where `right/dividend == dividend` (pure ex-dividend), the `right value + dividend value` is taken (column 6, truncated to 6 decimal places); the `right value + dividend value` of `right/rights-and-dividend` rows includes the **value of stock distributions** (measured: 1773 WUS Printed Circuit on 2025-06-13 was pushed to 27.25 = cash + stock value), so it is no longer written as a cash dividend. Rights-and-dividend rows are instead overwritten with the official `t187ap45_L`: the official value = "cash dividend distributed from earnings + cash distributed from the legal reserve + cash distributed from capital surplus", matched by "closest value with error ≤ `OFFICIAL_VALUE_TOLERANCE` (0.005) first" (measured: 3416 Transtek 2026-06-30: TWT49U 5.095945 → official 5.1), otherwise falling back to "board resolution date ≤ ex_date, gap ≤ 180 days, closest"; pure `right` rows (ex-rights, no cash) are never given the official value.
- **Trade-off for rights-and-dividend stocks (known limitation)**: the official table only provides the current dividend year of the "latest published table" (measured: the table published in 2026-10 contains only years 114/115), and ETFs (0056/00919 etc.) are also not in the table; therefore **for rights-and-dividend stocks in 2021~2024, when no official value can be found, no derived value is written** and the UI shows `—` (better missing than wrong). Quantified impact: after backfilling the whole window, about 59~86 distorted rows per year are deleted, of which about 59~77 symbol-years per year (about 8% of instruments) have no cash row at all for that year and show `—`; 2026 has only 10 rows (mostly ones the official table can overwrite).
- **Removal of old derived rows**: during backfill, an existing DB value is deleted only if it ≈ the derived value (`previous close − reference price after dividend deduction`, tolerance 0.0005) (`deleteTwseDividendIfMatches`), ensuring that accurate TWT48U rows (`UNIQUE(symbol, ex_date)`) are not mistakenly deleted.
- **Backfill mechanism (lazy + capped + resumable)**: `ensureYieldHistoryBackfill` (`lib/twse-dividends.ts`) fills the backfill window NEW→OLD at **month granularity**, the window starting at `(Y-5)-01` up to the current month (`YIELD_BACKFILL_YEARS = 6`; the 5-year average needs 5 complete years, so the backfill fetches one extra year); **each round is capped at 6 months** (`YIELD_BACKFILL_MAX_MONTHS_PER_RUN = 6`).
- **Coverage determination (corrected in #95)**: a month is no longer considered covered just because "the DB has any record for it" (the daily cache only went live on 2026-09-25, and 2026-09 had only a few records yet was judged covered → the gap was never filled); instead it is recorded in `agent_settings.twse_dividends.covered_months` (a `'YYYY-MM'` JSON array, keeping at most 120 months), and **a month is marked only when the whole-month TWT49U fetch succeeds and actually writes** (`writeDividendsMonthPlan(plan, { dryRun: false })` returns `ok:true`) (#95 P2: the old version failed to pass dry-run off → a silent no-op that was still marked covered = a permanent data hole); the resumable fetch advances based on this and does not spin forever. The trigger timing follows the existing ones: the sync button + the daily schedule as a side task (best-effort, it does not block the main flow; the read path `/dividends` is read-only and does not trigger it).
- **One-off data repair endpoint (#95)**: `/api/admin/dividends/repair` (`POST`, `Authorization: Bearer <SYNC_TOKEN>`) lets you proactively fill existing gaps after release; `dryRun` defaults to `true` (calculate only, no writes) and `from` / `to` (`YYYY-MM`) can be given to specify a range; each segment takes `limit` months from the newest month of `[from,to]` backwards, and for the whole window you should walk back segment by segment using `to` (`next_month` is not a progress cursor); see "One-off data repair endpoint" in `docs/deployment-and-ops.md`.
- **The reference yield has been retired (#94)**: the former Yahoo `dividendYield`-series fallback reference column was removed entirely because `v11 quoteSummary` always returned 404 and in production it was always "no data yet" (the table went from 15 columns to 14); manual sync also no longer hits Yahoo fundamentals for each symbol. The manual dividend entry column has been removed, the DB column is kept and always written as 0.
- **Column question-mark explanations**: the headers of the current-year yield / 5-year average yield / net P&L columns all have a `?` (following the admin Help style, opening on hover + tap on mobile), showing the definition + source + limitations in three languages (including the YTD basis, the exclusion of future ex-dividends, and the 5-year window excluding the current year).
- **Reason when no data**: on non-trading days / when the day's cache has not been synced / when TWSE has no announcement, a reason line is shown below the records section (not blank, and not an error or crash).
- **Update timing**: the "sync current prices" button and the daily schedule update the ex-dividend cache as a side task (fetch only when the current year is missing + backfill the 6-year window, without re-fetching on the same day; a TWSE timeout or malformed response does not blow up the main flow, and the degraded display + alerting follow the existing mechanism).

---

## 2. 🎁 Odd-Lot Quotes and Shareholder-Meeting Gift Intelligence (`/odd-lot`)

### 2.1 Direct Post-Close Connection to the Official TWSE OpenAPI
- Directly connects to the Taiwan Stock Exchange's official OpenAPI (`TWT53U`), covering post-close odd-lot trading data for over a thousand listed and OTC stocks in Taiwan.
- Clearly labels the "post-close odd-lot" trading date and matching time (published by the TWSE at about 15:00 each day), thoroughly distinguishing it from intraday odd-lot and ordinary whole-share trading.

### 2.2 Two Dimensions: Trade Price and Amount
- The UI precisely separates **`💵 price per share`** (e.g. NT$ 25.60) from **`💰 total trade amount`** (e.g. NT$ 664 thousand), so that users do not mistake a whole batch's total amount for a single-share quote.

### 2.3 Filtering by the 7 Gift Categories
The system automatically classifies gifts into the following 7 categories by their attributes, with one-click tag switching:
1. **eGift electronic gift cards**: convenience-store electronic merchandise cards, coffee vouchers, SMS redemption vouchers.
2. **Convenience-store physical vouchers**: 7-Eleven and FamilyMart physical merchandise cards or pickup vouchers.
3. **Home and kitchen**: heat-insulating placemats, stainless-steel thermos cups, food-storage containers, rapid cookers.
4. **Cleaning and care**: hand wash, bath gift sets, soap sets.
5. **3C and lifestyle accessories**: folding umbrellas, flashlights, charging cables, everyday hand tools.
6. **To be announced / other**: still awaiting a board resolution, or special gifts.
7. **No gift**: instruments the official announcement says will not distribute a gift.

### 2.4 The Last 5 Years' Distribution History with Official Date Cross-Validation
- **Last 5 years' distribution history**: clicking the "last 5 years 📜" button next to a stock calls the fast `GET /api/gifts/history?stock_id=XXXX` endpoint, and a popup lists the name and value of each year's gift from 2022 to 2026.
- **Smart estimation of the last buying date**: automatically estimates the "60 days before the annual shareholders' meeting, the share transfer register is closed" deadline under the Securities and Exchange Act, automatically skipping national holidays and weekends when the market is closed, and marks the precise first trading day.
- **Two-source, two-dimensional verification**: cross-checks the Market Observation Post System (MOPS), the TWSE listed-company meeting schedule (`t187ap41_L`) and third-party intelligence, and shows a "✅ verified", "⚠️ date mismatch" or "🚨 gift conflict" status badge based on date and content.

---

## 3. 📉 MA-Deviation Model Backtest (`/backtest`)

### 3.1 The 60-Day MA (MA60, the quarterly line) Deviation Algorithm
It uses the 60-day moving average (the quarterly line), which has the highest win rate for long-term swing trading, as the core entry filter:
- **Deviation formula**: `deviation = (closing price − MA60) / MA60 × 100%`
- When the closing price falls below the quarterly line by the specified threshold (e.g. -4%, -8%, -12%), the algorithm judges that it is in an oversold range and enters at the opening of the next trading day.
- The system scans each negative deviation threshold one by one, and computes the number of entries, win rate, average holding days and profit/loss ratio within historical periods of 1 to 15 years, automatically deriving the best entry point.

### 3.2 One-Click Strategy Style Presets
- **🚀 Short-term swing**: holds 40 days, target profit +8%, stop loss -5%, backtests the last 5 years.
- **📊 Mid-term swing**: holds 120 days, target profit +15%, stop loss -8%, backtests the last 10 years.
- **🏛️ Long-term cycle (default)**: holds 252 days, target profit +25%, stop loss -12%, backtests the last 15 years.

### 3.3 Bidirectional Search by Symbol and Chinese Name
- Supports instant search by symbol (e.g. `2330`, `0050`) or by Chinese keyword (e.g. "台積電", "元大台灣50").
- The search integrates the local memory store with Yahoo Finance as a fallback, dynamically identifying the instrument's name, market and current price.

### 3.4 Market-wide Top-20 Volume Quick Launcher
Clicking the "Top 20 volume" button quickly loads the market's most actively traded stocks:
- Supports four time spans: **today, this week, this month, this quarter**.
- The data sources connect directly to the TWSE `STOCK_DAY_ALL` and the historical `MI_INDEX`; clicking any instrument immediately fills in the symbol and starts a backtest.

### 3.5 Idea Flow + Backtest AI Interpretation (Trading-Strategy Loop)
- **One-click idea backtest**: each row of the Top 20 can jump with parameters (`?symbol=&preset=`), and the backtest page fills them in automatically (`runWithPreset` shared). The header link of the cycle-entry modal has been changed to an **external Yahoo Finance quote link** (`tw.stock.yahoo.com/quote/{symbol}.TW`, `.TWO` for OTC, opening in a new page; Issue #81) — because the entry engines on the two sides differ and the win rates can never match, removing the internal link eliminates the confusion at the source; the lab funnel is carried by the large card at the bottom of the cycle-entry page.
- **AI interpretation section**: shown after running any instrument; the win rate / number of trades / average days and other figures are all injected from the engine JSON and displayed as-is (including a collapsible JSON comparison section), and the LLM only writes the textual interpretation, with `BACKTEST_INTERPRET_SYSTEM_PROMPT` explicitly forbidding made-up numbers; pure computation does not deduct quota, and the backtest engine itself is untouched.

---

## 4. 📰 AI Market Focus (`/market-focus`)

### 4.1 Multi-source News Pool
No longer limited to a single news outlet, the system crawls three major financial channels in parallel:
1. **cnyes**: focused on real-time Taiwan-stock market action, FX moves and international roundups.
2. **Economic Daily News**: focused on headline stories and major industry and economic news via RSS.
3. **Yahoo Finance Taiwan**: aggregates the Taiwan-stock real-time news RSS from mainstream sources such as CNA, UBN and China Times.

On the backend it performs asynchronous deduplication via normalized headline features and URL fingerprints, and strictly filters to keep only news published **within the last 2 days**, building a deep candidate pool of 50~60 stories.

### 4.2 AI Plain-Language Per-Story Summaries (`speak-human-tw`)
- **Full-text fetching**: for the selected key stories it goes deep into the original URL to fetch the real body text (respecting each site's `robots.txt`). **Issue #83 degraded successfully**: a 180-second timeout in the crawl stage no longer fails the whole batch — unsettled articles are recorded as `content=null` and processing continues (the summary stage has a no-full-text fallback), and the edition still ships; `pendingDomains` (such as `tw.news.yahoo.com`, which blocks crawlers long-term) are logged to Azure logs for conviction.
- **Strict de-AI-flavouring**: the prompt follows the `speak-human-tw` guidelines — the first sentence states the objective figures and the factual event, it explains the real impact on the industry chain, forbids filler words and preaching, and distils 100~180 characters of essence per story.
- **Split architecture (Option A)**:
  - **Home page (`/`)**: shows the most core **6 selected stories**, keeping the home page's load speed and minimal layout.
  - **Dedicated page (`/market-focus`)**: expands to **10 balanced stories**, fully covering the three major blocks of "semiconductors/AI tech", "traditional industries/finance/green energy" and "macroeconomics and exchange rates/interest rates".

### 4.3 Daily Email Digest and Anomaly Alerts
- One "today's market focus digest" email per day goes mainly straight to **subscribers** (subscribed at `/market-focus#subscribe`, one-click unsubscribe), and admins receive the same digest at the same time.
- If the crawler fails or the LLM falls back to a degraded output, an alert email is automatically sent to admins, making it easy to stay on top of system status at any time.

### 4.4 News → Market Impact Structuring (Trading-Strategy Loop)
- The selection and summary produce the impact fields in the same LLM call (without adding quota consumption): `impact_direction` (bullish/bearish/neutral), `scope` (affected group), `horizon` (short/mid/long), `action` / `affected_sectors` / `related_symbols` (which can link back to a backtest instrument), passed through by migration 021 + save/get.
- The market focus cards share the same news object with `/analyze`'s News Analyst / Trader.
- **Trump wind indicator**: the daily digest carries `trump_wind` (bullish/bearish/neutral/none, produced by `lib/market-focus.ts` in the same LLM call as the selection and summary, without adding quota; TTS/email/social only read the summary and are unaffected).
- **Adjustable TTS speed**: the digest narration bar (`MarketFocusTtsBar`) supports play/pause/replay + speed adjustment (default 1×) and accent switching (auto/Taiwan/Hong Kong).

---

## 5. 🩺 Health Self-Check and Auto-Repair Mechanism (`/api/health`)

- **Read-only health check (`GET /api/health`)**: periodically checks the market focus's news count and timestamps, the comparison of the odd-lot data's last trading day, the database connection quality and the key environment variables.
- **Auto-repair endpoint (`POST /api/health/repair`)**: called automatically by GitHub Actions when an anomaly is detected (authenticated with `SYNC_TOKEN`), automatically triggering a re-fetch and update. It has a 10-minute throttle and a 6-hour alert cooldown, eliminating repeated emails.

---

## 6. 🔄 Cycle Entry (`/cycle-entry`)

- **Positioning**: the "timing" layer above the MA-deviation backtest (§3 `/backtest`) — it scans the whole market for instruments that have "reached a suitable entry point", helping judge the buying point. Rule definition (unambiguous version, Issue #86): R1 · pullback in place = 15%~40% drawdown from the 52-week highest close and the close at least 1% above the 52-week lowest close (inclusive) (highs and lows measured on closes); R2 · above the moving averages = the close is simultaneously above the 20/60-day moving averages (a state condition); threshold score ≥3 and including R1 or R2; entry at the next day's opening price, +8%/-5%/40 days, settled at the close of day 40 on expiry (neither win nor loss counted), and if both are touched on the same day it counts as a stop loss.
- **Calculation engine**: `packages/cycle-entry` (`rules.ts` / `runSignalBacktest`); backtest and real-time detection use the same rule set.
- **Data update**: `sync-cycle-entry.yml` runs the scan at 16:00 Taiwan time every trading day, producing the day's list of entry instruments.
- **Per-stock detail**: `/api/cycle-entry/detail` returns the last year's OHLCV and a per-signal backtest (`runSignalBacktestDetail`) and today's rule evaluation (`evaluateLastBar`); clicking an instrument opens `CycleEntryDetailModal` to inspect the chart and the reasons. The modal header is an external Yahoo Finance quote link (Issue #81) and no longer links back to the backtest lab.
- **List interaction (Issue #82)**: the win rate is an independent sortable column (the header button toggles high→low / low→high, default high→low, with nulls sinking to the bottom; card mode sorts the same way); the header's "?" explanation now opens downwards, avoiding clipping by `overflow-x-auto` (see the exception note in §1 of `docs/ui-table-checklist.md`).
- **Home page entry**: the home page feature card "instruments that have reached a suitable entry point" goes straight in.

---

## 7. ⚔️ AI Agent Arena (`/agent-arena`)

- **Personas**: 4 AI agents with fixed personalities that compete daily in trading decisions using real Taiwan-stock data and appear on the leaderboard:
  Old Sock Grandpa (conservative long-term), Young Stock God A-Hu (high turnover), Dividend Landlady (yield), Zen Balance Granny (stock-bond balance).
- **Five-stage flow (Taiwan time)**:
  1. `premarket 09:00` briefing (market briefing)
  2. `slot0~3` (09:35 / 10:35 / 11:35 / 13:05) each agent makes a decision (buy/sell/hold + reasons + confidence)
  3. `close 15:30` discussion (mutual evaluation) → ruling → update the ranking and performance
- **Scheduling**: the main clock is the in-process `arena-scheduler.ts` (`ARENA_CRON_ENABLED=true`), with `arena-tick.yml` as the GitHub fallback.
- **Universe**: the dynamic market-cap **top 200** (`fetchTopMarketCapUniverse` defaults to topN=200) + an ETF pool (`DEFAULT_ARENA_ETF_UNIVERSE`, about 67 instruments, replaceable via the `ARENA_ETF_UNIVERSE` env); on failure it falls back to `DEFAULT_ARENA_UNIVERSE`.
- **Starting capital**: all agents start with **NT$500,000** (`initial_capital` DEFAULT, migration 023; since #27 existing ones have all been topped up, and the old NT$200,000 regime no longer exists); the copy is synced across three languages.
- **Parameter overrides**: the admin `/admin/arena` can change `arena.slippage` (default 0.003), `arena.system_prompt` and so on, taking precedence over the code defaults.
- **Capital and heartbeat disclosure**: the leaderboard page discloses each agent's remaining cash and dividend credits (dividends inside the authoritative `twse_dividends` window are credited automatically); the tick status endpoint includes a heartbeat/staleness judgment (running but with `updated_at` older than the watchdog is treated as stale, and the fallback tick takes over). **Issue #80**: the slot-stage decide is limited to concurrent execution (`ARENA_SLOT_CONCURRENCY` default 3) + a 150-second timeout per agent (HOLD + error and continue); the watchdog became a sliding idle (reset only when the engine makes progress) + a hard total time limit of 25 minutes (`ARENA_TICK_HARD_CAP_MIN`).
- **Data display**: the admin provides a decision timeline (briefing/discussion/each agent's decisions and reasons), so the full daily process can be reviewed.

---

## 8. 🔐 Admin Console and Social Editor (`/admin`)

### 8.1 Admin Guard and Pages
- Entering `/admin/*` requires passing `isAdminUser` (`lib/auth.ts`): matching either `ADMIN_LINE_USER_IDS` (LINE user id) or `ADMIN_EMAILS` (login email) makes you an admin, otherwise you are redirected to login.
- 8 sub-pages: overview (summary + status checks), market focus (manual trigger/view), cycle entry (scan records), social editor (dry-run + auto posting), arena (inspection + manual tick), usage, settings (agent parameter settings), subscribers.

### 8.2 Social Editor (IG / Threads / FB)
- **Platforms**: Instagram (IGAA long-lived token), Threads (THAA), Facebook Page (system user token). All three platforms post automatically.
- **Card styles**: `ai` (full AI-mascot card, **default**), `classic` (information card), `meme` (meme); set globally by `social.card_style`, and can also be specified per platform during a dry run.
- **Dry run**: triggering from the admin generates copy for the three platforms + a card preview (base64) without actually publishing.
- **Auto-posting rules**: checked every 6 hours each day (`social-trigger.ts`); it publishes only when `hasNewEdition` (a new market focus edition) is true and it has not already been posted, and writes to `social_posts` for deduplication.
- **Festival editor**: a separate festival calendar (`lib/festival-calendar.ts`, with confirmed values for Mid-Autumn 2024–2026 and estimated ones pending confirmation for 2027–2028; the time zone is always Asia/Taipei); on the festival day at 08:00 (Taipei) `social-festival.yml` (daily at 00:00 UTC) triggers fully automatic posting of the greeting image + post, with the deduplication key `festival:{id}:{YYYY-MM-DD}`; the site-wide top banner is shown only on that day and automatically restored the next day.
- **First reply asking Meta AI**: after the main post is published, a question is automatically posted via a Threads self-reply (`reply_to_id`) + a second IG comment (the first keeps the traffic-guidance role); the question is generated by the LLM rotating through four categories based on the current edition's content (value investing/news/risk/sentiment), with a fixed question bank as fallback; the toggle `social.reply_tag_metaai` has three states (`on` = the version that @-mentions meta.ai / `editor` = a question from the editor without the tag / `off` = do not post) — because Taiwan does not have @meta.ai open, the **default is `editor`**, and once it opens it will be switched to `on` after dry-run verification.
- **FB special flow**: a system user token cannot post directly, so the system first calls `/me/accounts` to exchange it for the page token of the corresponding `FB_PAGE_ID` and then publishes.
- **Meta call protection**: all Meta Graph API calls go through the unified `graphFetch` exit — staggering between calls (`META_PACE_MS`, default 5 seconds), and backoff retries for transient errors (HTTP 5xx / Graph code -1 / Fatal message / `is_transient`) (`Retry-After` preferred, otherwise exponential backoff + jitter, at most `META_RETRY_MAX_ATTEMPTS` = 3 times); after exhaustion, the alert email states the HTTP status + Graph code + the number of retries already made.
- **Credential health**: `check-social-tokens.yml` checks `GET /api/social/token-health` daily at 03:30 and alerts when it becomes invalid; for the renewal steps see §5 of `docs/deployment-and-ops.md`.

### 8.3 Database Cleanup Protection
- When the `market-focus` job finishes successfully it fire-and-forget runs `cleanupMarketFocusLogs(7)` (keeping the last 7 days) and `cleanupSocialCardImages(30)` (keeping the last 30 editions' cards), avoiding accumulation in Azure SQL.

---

## 9. 🤖 AI Stock Analysis (`/analyze`, Taiwan stocks only)

- **12-node flow**: four analysts Market/Sentiment/News/Fundamentals → one round of Bull/Bear debate → Research Manager ruling → Trader's structured proposal (most schema fields are optional, and a missing field does not block the main flow) → the risk trio (Aggressive/Conservative/Neutral) each speaks once → Portfolio Manager's final decision; Bull/Bear/Trader/the risk trio use quickLLM, while Research/Portfolio Manager use deepLLM (as measured in the engine).

- **Scope**: `/analyze` accepts only Taiwan-stock symbols (plain digits, **4~6 characters**, optionally with `.TW` / `.TWO`, either case); US symbols (such as AAPL / SPCX), `2330.US`, symbols containing letters and digits of 3 characters or fewer are all rejected. `/portfolio` still keeps both the Taiwan and US markets and is unaffected.
- **Two-layer gatekeeping (before quota deduction)**: real-time format validation in the front end (no API call) + format validation in the backend `/api/analyze` (returns 400, without deducting `analysis_quota` or creating an `analysis_jobs` entry); warrants/bull-bear certificates are judged by the backend Yahoo `quoteType` (only `EQUITY`/`ETF` pass, the rest are blocked, without deducting quota, creating a job or writing `analysis_records`).
- **Presentation**: the result badge is only stock/etf/index; existing historical analysis records (including US tickers) are kept and shown as-is, and only new US analyses are blocked.
- **Strategy-loop output (trading-strategy loop)**: the Market Analyst prompt requires support/resistance ranges + invalidation conditions; the Trader report is a structured block (entry range / stop-loss price / invalidation conditions / scaling advice / per-trade position cap % + a risk disclaimer sentence, in three languages); the interpretation is completed in the same quota call as the main report, without adding free allowance.
