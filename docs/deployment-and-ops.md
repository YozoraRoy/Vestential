**English** ｜ [繁體中文](./deployment-and-ops_zh.md)

# Azure Deployment & Ops Guide

This document provides Vestential's deployment architecture on Azure App Service, the GitHub Actions automation flow, the environment-variable mapping table and a troubleshooting guide for common operations issues.

---

## 1. Deployment Strategy and Architecture

The platform is always deployed to Azure App Service through a **GitHub Actions automated CI/CD** flow.

- **Bypassing the cloud Oryx build**: because the Azure App Service B1 plan has limited memory (1.75 GB), running `npm build` directly in the cloud easily runs out of memory (an OOM crash). Therefore we use the strategy of "**complete the build on the GitHub Runner and package the dependencies, then upload the whole package with zipdeploy**", thoroughly solving container startup failures.
- **Trigger**: any commit pushed to the `main` branch (`git push origin main`) starts a deployment automatically.

---

## 2. GitHub Secrets and Azure App Settings Mapping

Set the following keys under **Settings → Secrets and variables → Actions** in the GitHub repository:

| GitHub Secret name | Description and source | Corresponding Azure App Setting |
| :--- | :--- | :--- |
| `AZURE_CREDENTIALS` | Azure service principal JSON (created with `az ad sp create-for-rbac`) | — (used by the deploy workflow to sign in) |
| `OPENAI_API_KEY` | Key of the primary LLM service | `OPENAI_API_KEY` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API Key (applied for in Google AI Studio, tier1 fallback) | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `FALLBACK_DEEP_LLM_BACKEND_URL` | tier1 reasoning backend (Groq, `https://api.groq.com/openai/v1`) | `FALLBACK_DEEP_LLM_BACKEND_URL` |
| `FALLBACK_DEEP_LLM_API_KEY` | tier1 reasoning API Key (**new key**, in use since 2026-09-23, a different pool from tier2) | `FALLBACK_DEEP_LLM_API_KEY` |
| `FALLBACK_QUICK_LLM_BACKEND_URL`| tier1 fast-model backend (Groq) | `FALLBACK_QUICK_LLM_BACKEND_URL` |
| `FALLBACK_QUICK_LLM_API_KEY` | tier1 fast-model API Key (**new key**, as above) | `FALLBACK_QUICK_LLM_API_KEY` |
| `FALLBACK2_DEEP_LLM_BACKEND_URL` | Base URL of the second-tier fallback (tier2) reasoning model (the qwen backend is retained) | `FALLBACK2_DEEP_LLM_BACKEND_URL` |
| `FALLBACK2_DEEP_LLM_API_KEY` | API Key of the second-tier fallback reasoning model | `FALLBACK2_DEEP_LLM_API_KEY` |
| `FALLBACK2_QUICK_LLM_BACKEND_URL` | Base URL of the second-tier fallback fast-summary model | `FALLBACK2_QUICK_LLM_BACKEND_URL` |
| `FALLBACK2_QUICK_LLM_API_KEY` | API Key of the second-tier fallback fast-summary model | `FALLBACK2_QUICK_LLM_API_KEY` |
| `DATABASE_URL` | Azure SQL Server connection string (SQLite is used if left empty) | `DATABASE_URL` |
| `SYNC_TOKEN` | Bearer authentication key for the internal secure update endpoints (must be ≥16 characters) | `SYNC_TOKEN` |
| `AUTH_SECRET` | Signing key for the login session JWT (generated with `openssl rand -base64 32`) | `AUTH_SECRET` |
| `GOOGLE_CLIENT_ID` | Client ID applied for in Google Cloud Console | `GOOGLE_CLIENT_ID` |
| `GOOGLE_CLIENT_SECRET` | Client secret applied for in Google Cloud Console | `GOOGLE_CLIENT_SECRET` |
| `LINE_CLIENT_ID` | Channel ID applied for in LINE Developers | `LINE_CLIENT_ID` |
| `LINE_CLIENT_SECRET` | Channel Secret applied for in LINE Developers | `LINE_CLIENT_SECRET` |
| `SMTP_USER` | Official sending account | `SMTP_USER` |
| `SMTP_PASS` | App password for official sending | `SMTP_PASS` |
| `NOTIFY_TO` | Mailbox receiving the market focus digest and anomaly alerts | `NOTIFY_TO` |
| `IG_ACCESS_TOKEN` | Instagram long-lived token (IGAA, 60 days) | `IG_ACCESS_TOKEN` |
| `IG_USER_ID` | Instagram business account ID | `IG_USER_ID` |
| `THREADS_ACCESS_TOKEN` | Threads long-lived token (THAA, 60 days) | `THREADS_ACCESS_TOKEN` |
| `THREADS_USER_ID` | Threads user ID | `THREADS_USER_ID` |
| `THREADS_APP_ID` | Threads Meta App ID (for long-lived token exchange) | `THREADS_APP_ID` |
| `THREADS_APP_SECRET` | Threads Meta App Secret (for long-lived token exchange) | `THREADS_APP_SECRET` |
| `FB_ACCESS_TOKEN` | Facebook system user token (EAAL…, long-lived) | `FB_ACCESS_TOKEN` |
| `FB_PAGE_ID` | Page ID (the page token is automatically exchanged from the system user when posting) | `FB_PAGE_ID` |

> Note: the following are **optional env vars (not hard-coded in deploy.yml; the code default applies if unset)**; add them in Azure App Settings only when there is a concern about Meta rate limiting:
>
> | Azure App Setting | Default value | Description |
> | :--- | :--- | :--- |
> | `META_PACE_MS` | `5000` | Milliseconds of staggering between Meta Graph API calls (`graphFetch` in `social-publish.ts`, read by `getMetaPaceMs`) |
> | `META_RETRY_MAX_ATTEMPTS` | `3` | Maximum backoff retries for transient errors (5xx/Graph code -1/Fatal/`is_transient`) |

> Note: there are also a few values that are "hard-coded into deploy.yml App Settings and do not need to be GitHub Secrets":

| Azure App Setting | Value description |
| :--- | :--- |
| `ADMIN_LINE_USER_IDS` | Admin console LINE user ids (comma-separated) |
| `ADMIN_EMAILS` | Admin console emails (comma-separated) |
| `ARENA_CRON_ENABLED` | `true` = enable the in-process Taiwan-time arena schedule (the main clock) |
| `LLM_DISABLE_THINKING` / `LLM_TIMEOUT_MS` / `LLM_MAX_TOKENS` | LLM reasoning parameter tuning (`true` / `180000` / `8192`) |
| `ANALYZE_MAX_TOKENS` | Analysis output token cap (`2048`) |

> **LLM mutual fallback chain (hard-coded in deploy.yml, since 2026-09-23)**: primary `google` (`gemini-2.5-flash`, `GOOGLE_GENERATIVE_AI_API_KEY`, supports comma-separated multi-key rotation) → tier1 `openai`-compatible (`qwen/qwen3.8-27b` via Groq, new `FALLBACK_*` key) → tier2 the same model via Groq (old `FALLBACK2_*` key). Building the chain automatically checks pool diversity (`checkFallbackPoolDiversity`; before 2026-09-23 tier1/tier2 mistakenly used the same secret, leaving the fallback with zero protection, see §5 Q4). Circuit-breaker cooldown: 60 seconds for ordinary cases / 10 minutes for a deterministic failure, with automatic re-probing and switching back when the cooldown ends (`FallbackClient` in `packages/ai-engine/src/llm/fallback-client.ts`).

> Note: `AUTH_BASE_URL` is already fixed to `https://vestential.com` in the deploy workflow, so there is no need to set it again.
>
> **Production database (Azure SQL)**: Server `sql-stock-platform.database.windows.net` (canadacentral, Resource Group `rg-yuzora_roy_ai`), Database `stockdb`.
> The current tier is **Basic (5 DTU) / 2 GB cap** (upgraded on 2026-09-11 from the "Free tier (only 32 MB)"; for the reason and the remediation steps see §5 Q3).

---

## 3. Scheduled Automation

The system uses **12 GitHub Actions workflows** (8 scheduled jobs + 1 manual backfill + 2 deploy + 1 static gate; **market-focus scheduling now lives in an Azure Logic App**, so `sync-market-focus.yml` no longer carries a cron; all times are given in Taiwan time) to keep quotes, health status and social publishing running:

1. **Odd-lot quote sync (`sync-oddlot.yml`)**:
   - Time: **15:10** Taiwan time on every weekday (after the TWSE publishes post-close odd-lot data).
   - Behaviour: automatically calls `POST /api/odd-lot/refresh?date=YYYYMMDD` and updates the latest odd-lot quotes, authenticated with `SYNC_TOKEN`.
2. **Market focus news sync (`sync-market-focus.yml`)**:
   - Schedule: **Azure Logic App** `logic-market-focus-scheduler` at **01:00 / 09:00 / 13:00 / 19:00** Taiwan time (the GitHub cron was removed; `sync-market-focus.yml` remains `workflow_dispatch`-only for manual backfills). See §3.1.
   - Behaviour: fetches the latest information from cnyes, Economic Daily News and Yahoo Finance, produces AI key-point summaries and sends the digest email. **Only the 09:00 run sends the daily newsletter** (send window 08:00–13:59; the 01:00 run only refreshes the page, and 13:00 acts as the fallback send). If the 09:00 refresh produces no new edition, it still sends the latest unsent edition (the daily/edition guards keep it to one email per day).
3. **Health check and auto repair (`health-report.yml`)**:
   - Time: a lightweight check every 4 hours, with a full inspection at 08:00 Taiwan time daily.
   - Behaviour: proactively diagnoses the status of each endpoint; on an anomaly it automatically calls the repair endpoint, and only if the repair fails does it send an alert email to the maintainers.
4. **Taiwan-stock data sync (`sync-data.yml`)**:
   - Time: **02:30** Taiwan time daily; it additionally runs once every Monday.
   - Behaviour: syncs batch data such as shareholder-meeting gifts and MOPS announcements (authenticated with `SYNC_TOKEN`).
5. **Cycle entry scan (`sync-cycle-entry.yml`)**:
   - Time: **16:00** Taiwan time on every trading day.
   - Behaviour: runs the cycle-entry signal scan, producing the day's entry instruments for `/cycle-entry`.
6. **AI Agent Arena (`arena-tick.yml`)**:
   - Time: 09:00 (premarket), 09:35 / 10:35 / 11:35 / 13:05 (the four slots) and 15:30 (close) on every trading day.
   - Behaviour: drives the five `/agent-arena` stages (briefing → 4 agent decisions → discussion → ruling → leaderboard). This is the GitHub schedule fallback; the main clock is the in-process `arena-scheduler.ts` (`ARENA_CRON_ENABLED=true`).
7. **Social token health check (`check-social-tokens.yml`)**:
   - Time: **03:30** Taiwan time daily.
   - Behaviour: calls `/api/social/token-health` to check the IG/Threads/FB credentials; on an anomaly it sends an alert email immediately (for the renewal steps see §6).
8. **Deploy (`deploy.yml`)**:
   - Trigger: any push to the `main` branch.
   - Behaviour: build on the GitHub Runner → zipdeploy to Azure App Service, and sync the App Settings (including all social tokens).
9. **Festival social publishing (`social-festival.yml`)**:
    - Time: daily at UTC 00:00 (= 08:00 Taiwan time).
    - Behaviour: on the festival day it triggers `/api/cron/festival` to fully automatically post the greeting image + message (deduplication `festival:{id}:{date}`); on non-festival days it returns skipped. See also §8.2 of `docs/features-guide.md`.
10. **Holding prices + ex-dividend cache sync (`sync-portfolio-prices.yml`)**:
    - Time: **16:00** Taiwan time on every trading day (`0 8 * * 1-5` UTC; holidays are blocked once more inside the API by `isTwseTradingDay`).
    - Behaviour: calls `POST /api/portfolio/sync` (authenticated with `SYNC_TOKEN`) to sweep all holding prices; **it also updates the current-year ex-dividend cache as a side task** (TWSE `TWT48U` daily CSV → the `twse_dividends` table, fetched only when missing and not re-fetched on the same day) **plus the yield history backfill** (`ensureYieldHistoryBackfill`, since #95 a 6-year window starting at `(Y-5)-01`, capped at 6 months per run, with backfilled months recorded in `agent_settings.twse_dividends.covered_months` and resumable; a failure does not block the main flow and alerting follows the existing mechanism). For the data sources and the current-year (YTD) / 5-year average (the 5 complete years up to last year) rules see §1.8 of `docs/features-guide.md`.

### 3.1 Market-focus scheduler (Azure Logic App)

GitHub Actions `schedule` is best-effort: measured over 2026-10-21/22, the four market-focus triggers started **1.5–4.8 hours late** (e.g. the 23:00Z run fired at 00:31–01:24Z), so the "07:00 edition" actually arrived at 08:30–09:30. Scheduling therefore moved to a dedicated Azure Logic App:

- **Resource**: `logic-market-focus-scheduler` (Consumption) in `rg-yuzora_roy_ai`.
- **Recurrence**: `01:00 / 09:00 / 13:00 / 19:00` `Taipei Standard Time` (one workflow, four hours).
- **Flow**: `POST {siteBaseUrl}/api/market-focus/refresh` (Bearer `SYNC_TOKEN`, `retryPolicy` 3 × 30 s) → poll `/api/market-focus/refresh/status?jobId=…` every 30 s for up to 30 min → on `failed` / timeout, `POST /api/market-focus/alert` (the app sends the amber alert email through the existing Gmail pipeline).
- **Safety net**: Azure Monitor metric alert `alert-market-focus-scheduler-failed` (`RunsFailed > 0`, action group `ag-market-focus-scheduler`) emails even when the app itself is unreachable.
- **Daily email window**: `sendMarketFocusSummary` only sends between **08:00–13:59 TW** (`apps/web/src/lib/newsletter-window.ts`). This prevents the 01:00 run from claiming `email.last_sent_date` and making the 09:00 run skip as a duplicate. Manual admin publish bypasses the window but still respects the daily/edition dedupe.
- **IaC**: `infra/market-focus-scheduler.bicep` + `infra/market-focus-workflow.definition.json`. Deploy with the `Deploy market-focus scheduler (Logic App)` workflow (`workflow_dispatch`, `run_kind=refresh|dry`), or locally:

```powershell
az deployment group create -g rg-yuzora_roy_ai `
  -f infra/market-focus-scheduler.bicep `
  -p syncToken="$env:SYNC_TOKEN" siteBaseUrl="https://vestential.com" runKind=refresh
```

- **Dry test**: deploy with `runKind=dry` (or run the workflow with `run_kind=dry`); the job previews only — no DB write, no email, no social post.
- **Rollback**: re-enable the cron in `sync-market-focus.yml` and disable the Logic App via `az resource update --ids <logicAppId> --set properties.state=Disabled` (or the portal).

**One-off data repair endpoint (for `SYNC_TOKEN` ops; Issue #95)**: `POST /api/admin/dividends/repair`

- With the new TWT49U parsing (taking `right value + dividend value` for dividend rows) + the official `t187ap45_L`, it re-fetches historical months, overwrites erroneous rows and deletes the rights-and-dividend rows produced by "price-spread derivation"; `dryRun` defaults to `true` (returning only the estimated counts).
- It processes `limit` months at a time (1..12). **Note that `next_month` is merely "the month after this segment", not a progress cursor**: each segment takes `limit` months from the newest month of the `[from,to]` range backwards (re-running always yields the same result = idempotent), so for the full 70-month window you must **walk back segment by segment using `to`** (putting the previous segment's `next_month` into `to`); measured, 5 segments × `limit:12` covers the whole window (a single month of TWT49U takes about 1.5 seconds; the official table `t187ap45_L` is 2.47 MB, about 6 seconds of gzip transfer locally and **40~60 seconds across regions (Azure Canada Central)**, hence `T187AP45_FETCH_TIMEOUT_MS = 120 seconds`, which would have timed out every time at the pre-#95-P4 value of 20 seconds).
- #95 P2 fix: `writeDividendsMonthPlan` no longer has a dry-run default (it always takes `dryRun` explicitly), and only `dryRun:false` actually upserts/deletes; `covered_months` counts only months that were "actually marked successfully".

```powershell
# 1) Inventory (read-only): counts per year + covered/uncovered months
curl.exe -s --max-time 60 -X POST "https://vestential.com/api/admin/dividends/repair" `
  -H "Authorization: Bearer $env:SYNC_TOKEN" -H "Content-Type: application/json" `
  -d '{"action":"assess"}'

# 2) Preview (read-only): the write/delete plan for the newest 6 months in the window
curl.exe -s --max-time 120 -X POST "https://vestential.com/api/admin/dividends/repair" `
  -H "Authorization: Bearer $env:SYNC_TOKEN" -H "Content-Type: application/json" `
  -d '{"action":"repair","limit":6}'

# 3) Execute: only writes with dryRun:false (idempotent, can be re-run)
curl.exe -s --max-time 300 -X POST "https://vestential.com/api/admin/dividends/repair" `
  -H "Authorization: Bearer $env:SYNC_TOKEN" -H "Content-Type: application/json" `
  -d '{"action":"repair","dryRun":false,"limit":12}'

# Whole window (70 months) walking back segment by segment: put the previous segment's next_month into to, repeating until next_month is null
curl.exe -s --max-time 300 -X POST "https://vestential.com/api/admin/dividends/repair" `
  -H "Authorization: Bearer $env:SYNC_TOKEN" -H "Content-Type: application/json" `
  -d '{"action":"repair","dryRun":false,"limit":12,"to":"2025-10"}'

# A specific range can also be given (e.g. 2026-01~2026-09)
curl.exe -s --max-time 300 -X POST "https://vestential.com/api/admin/dividends/repair" `
  -H "Authorization: Bearer $env:SYNC_TOKEN" -H "Content-Type: application/json" `
  -d '{"action":"repair","dryRun":false,"from":"2026-01","to":"2026-09","limit":12}'
```

- Expected output (measured data within the window): `would_write`/`written` are the number of upserts in that segment, `would_delete`/`deleted` are the number of derived rows deleted (for the full 70-month window 2021~2026: `written` totals **6,283**, `official_overrides` **146**, `failed_months` 0; deletion is non-zero only when the DB already holds old derived rows, measured as 0 on an empty table, with a full-window cap of about 446 rows), `covered_months` is the number of months of "covered months ∪ months actually marked successfully in this segment" (70 for the full window), and `marked_months` is the number of months actually marked successfully in this segment (the old version falsely reported `covered.size + processed month count`).
11. **Static gate (`typecheck.yml`, to catch escapes, Issue #68)**:
    - Trigger: push to `main` **for code changes only** (since Issue #109 a push that changes only `.md` files is skipped via `paths-ignore: '**/*.md'`, the same policy as `deploy.yml`; a mixed push that also touches code still runs) + all pull_requests.
    - Behaviour: first build the dependency workspaces (core→market-data→database→ai-engine, to avoid a stale dist) and then run the full `npm run typecheck`; `NODE_OPTIONS=--max-old-space-size=6144` (web tsc needs about 6 GB, see §5 Q5).

---

## 4. Development Loop (Issue-driven) and Auto Deploy

Every "change → automatic acceptance → automatic release" on the platform is driven by GitHub Issues: **the Issue is the single source of truth for the spec, the acceptance and the status; `/dev-loop` is the only entry point, and `git push origin main` is just one step at the end of the chain**. In this project the agents are defined in `.opencode/agent/` (`pm`/`developer`/`qa-verifier`), the flow is in `.opencode/command/dev-loop.md`, and the rules are in the root `AGENTS.md` under "## 開發鏈路（Issue 驅動）"; this chapter is the operator's/next maintainer's view of it.

### 4.1 Goal and Philosophy

In one sentence: **any feature change or bug fix is first opened as an executable, verifiable Issue spec, and `/dev-loop` walks through "open spec → implement → accept → auto deploy → production verification → close" in one stop, leaving a trail entirely in the Issue body + comments, with no separate spec/acceptance report stored locally**. An operator can reproduce the whole delivery trail with "grep one issue number".

### 4.2 The Issue as the Single Source of Truth: Template and Label State Machine

Every development Issue's body always contains five sections (produced by the `pm` agent from the template):

| Section | Purpose |
| :--- | :--- |
| `## 目標` | One sentence + what problem it solves |
| `## 範圍` | In-scope / out-of-scope bullet list |
| `## 副作用鏈` | UI → API route → lib/DB function → table write / email send / cron trigger, with `file_path:line` |
| `## ACCEPTANCE` | A `- [ ]` verifiable checklist that is the sole definition of "done" (shared by the developer implementing and the qa-verifier ticking it off) |
| `## 風險 / 待確認` | Risks and points needing a user decision; places with insufficient data are marked "pending confirmation" |

**Label state machine** (currently only 5 `status/*` labels; only one `status/*` should be attached to an issue at a time):

| Label | Meaning | Who sets it | When |
| :--- | :--- | :--- | :--- |
| `status/spec` | Spec created, awaiting implementation | pm (delegated by the main agent) | At P0 when opening the spec Issue |
| `status/in-dev` | Development in progress | developer | At P1 when starting implementation (also removing `status/spec`/`status/needs-fix`) |
| `status/needs-fix` | Acceptance failed, needs changes | qa-verifier | At P2 when a FAIL appears (→ back to P1; after fixing, reset `status/in-dev`) |
| `status/qa-pass` | All acceptance PASS, approved for release | qa-verifier (P2) / main agent (P3 confirmation) | At P2 when everything PASSes |
| `status/released` | Released | dev-loop main agent | After P4 production verification passes, before `gh issue close` |

State flow: `status/spec` → `status/in-dev` → `status/needs-fix` ⇄ `status/in-dev` → `status/qa-pass` → `status/released` (close).

### 4.3 The `/dev-loop` One-stop Chain (P0 → P4)

`/dev-loop` (agent: build) takes `$ARGUMENTS`, with **two kinds of input**:

- **Plain digits = an existing issue number**: `gh issue view <N> --comments` reads the current state and continues the unfinished stage (both the fix loop and supplementary acceptance go this way).
- **Any other text = a feature description**: first delegate to `pm` to open a spec Issue with `status/spec`, get `#<N>` back and then continue.

The four stages' division of labour and outputs:

| Stage | Who | Output | How to move on |
| :--- | :--- | :--- | :--- |
| **P0 Spec** | pm (read-only, `edit: deny`) | Issue body with a complete `## ACCEPTANCE`, tagged `status/spec` | Return the issue#, hand to P1 |
| **P1 Implementation** | developer (`edit: allow`) | Implement per ACCEPTANCE; must run `npm run typecheck` + `npm run lint` + build; paste the per-item tick results as a comment | All three self-checks pass → report "P1 done", hand to P2 |
| **P2 Acceptance** | qa-verifier (read-only, `REALM=local`) | Verify each ACCEPTANCE item, produce a PASS/FAIL matrix and paste it as an issue comment | **All PASS** → hand to P3; **any FAIL** → set `status/needs-fix` and go back to P1 to fix, then reset `status/in-dev` and redo P2 until all PASS |
| **P3 Auto release** | dev-loop main agent | Set `status/qa-pass` (removing `status/needs-fix`) → stage only the files relevant to this change → commit (message containing `Closes #<N>`) → `git push origin main` → watch the deploy with `gh run list`/`gh run watch` | The push triggers deploy.yml (see 4.4); deploy succeeds → hand to P4 |
| **P4 Production verification** | qa-verifier (`REALM=production`) | curl the production URL to verify the ACCEPTANCE (including DB/email/cron side effects, verifying what can be verified, otherwise marking UNVERIFIED) | Passed → `status/released` + `gh issue close --reason completed`; failed → back to P1 to fix and re-run P3/P4 |

**The FAIL loop (key point)**: if any single item FAILs at P2, the Issue label returns to `status/needs-fix` and the flow rolls back to P1 for a rework; **there is no exceptional path of "there are FAILs but let's ship anyway"**. Likewise, if P4 fails the whole chain re-runs. So "P2/P4 all PASS" is the only ticket that gets you to a push.

### 4.4 Auto Deploy and Release Principles

- **Trigger**: the `git push origin main` of `/dev-loop` P3 triggers `.github/workflows/deploy.yml` (any push to `main` triggers it, not just dev-loop; but **the only normal shipping path is dev-loop**). deploy.yml completes `local-build` on the GitHub Runner to produce the standalone output, zipdeploys to Azure App Service and syncs all App Settings (for details see §1, §2 and §3.8).
- **The "only close after acceptance" principle**: an Issue is marked `status/released` and closed by the main agent only **after P4 production verification passes**. In other words, if an open `status/*` Issue has already been merged and released, it means it is stuck at P4 or awaiting handling — a closed state means production has been verified, not "the PR was merged so it's done".
- **Issue titles do not need a manual version**: the version / whether it has shipped is expressed by the **label (`status/released`) + the closing time**; `Closes #<N>` in `git log` establishes bidirectional traceability between commit and issue. Keep the title functionally descriptive and do not stuff in a date or version number.

### 4.5 gh CLI Quick Reference (Windows PowerShell)

On Windows, always **write a multi-line body to `$env:TEMP\opencode\*.md` first and then feed it via `--body-file`**, to avoid quoting/multi-line escaping problems:

```powershell
# 1) Open a spec Issue (P0, pm)
gh issue create --repo YozoraRoy/vestential `
  --title "<feature title>" --body-file "$env:TEMP\opencode\spec.md" --label status/spec

# 2) Read the Issue spec + comments (the starting move for P0/P1)
gh issue view <N> --repo YozoraRoy/vestential --comments

# 3) Set the label: start implementing (P1, developer)
gh issue edit <N> --repo YozoraRoy/vestential `
  --add-label status/in-dev --remove-label status/spec,status/needs-fix

# 4) Paste a self-check/QA matrix comment (P1/P2/P4; write a temp file first)
Set-Content -LiteralPath "$env:TEMP\opencode\qa.md" -Value "<matrix content>" -Encoding UTF8
gh issue comment <N> --repo YozoraRoy/vestential --body-file "$env:TEMP\opencode\qa.md"

# 5) After all acceptance passes, promote to qa-pass (P2 wrap-up / P3 start)
gh issue edit <N> --repo YozoraRoy/vestential `
  --add-label status/qa-pass --remove-label status/needs-fix

# 6) Watch the deploy run (P3; do not poll a web page, use gh)
gh run list --repo YozoraRoy/vestential --workflow deploy.yml --limit 5
gh run watch <run-id> --repo YozoraRoy/vestential

# 7) After production verification passes, tag released and close (P4 wrap-up)
gh issue edit <N> --repo YozoraRoy/vestential --add-label status/released
gh issue close <N> --repo YozoraRoy/vestential --reason completed
```

> PowerShell detail: `Set-Content ... -Encoding UTF8` saves as UTF-8 (with a BOM) — gh reads it fine, so it is safe to use; a here-string `@" ... "@` is convenient for assembling a multi-line body.

### 4.6 Ops/Collaboration Discipline Reminders

- **The developer does not commit or push**: all code is committed + pushed by the dev-loop main agent at P3; anyone seeing the developer push directly is a violation of the rules (it would skip `Closes #N` and the label gatekeeping).
- **Only all-PASS QA can merge and ship**: typecheck/lint/build are the static thresholds, while P2's item-by-item ACCEPTANCE verification is the substantive one; any FAIL means going back to P1, with no exception.
- **A "pending confirmation" blocker must stop the flow**: at any point from P0 to P4, if the spec is ambiguous, the ACCEPTANCE cannot be met, or production verification cannot be carried out, mark "pending confirmation" in an issue comment and **stop to ask the user**, without changing the scope on your own or making assumptions.
- **Environment rules for QA verification**: when a local smoke test needs a dev server, start it with the fully detached method per AGENTS.md §4 (`Start-Process -RedirectStandardOutput/-RedirectStandardError -WindowStyle Hidden -PassThru`), with Ready/port/shutdown handled by the observer (main agent); `curl`/PowerShell calls always use a short timeout.
- **When Start-Process hangs while starting the server**: switch to the AGENTS.md §3b WMI fallback (`Invoke-CimMethod Win32_Process Create` to start `npm run dev`, which is not a tool-shell child process and will not be killed along with it); do not retry the same trick.

---

## 5. Common Ops Issues and Remediation

### Q1: After a push, the site shows 502 Bad Gateway or 503 Service Unavailable?
- **Cause**: the Node service is restarting, or a dependency is abnormal during the startup phase.
- **Remediation steps**:
  1. Wait 30~60 seconds; the container usually needs a moment to warm up after deployment completes.
  2. Use the Azure CLI to view live logs:
     ```bash
     az webapp log tail --name stock-platform-roy --resource-group rg-yuzora_roy_ai
     ```
  3. Check whether any environment variable is missing (especially `AUTH_SECRET` or `OPENAI_API_KEY`).

### Q2: Local development stuck because port 3000 is occupied?
- **Cause**: a Node process from a previous debugging session was not terminated properly.
- **Remediation steps** (following the `AGENTS.md` rules):
  ```powershell
  Get-NetTCPConnection -LocalPort 3000,3001 -State Listen -ErrorAction SilentlyContinue |
    Select-Object LocalPort, OwningProcess
  Stop-Process -Id <pid> -Force
  npm run dev
  ```

### Q3: Receiving a "database size quota" anomaly notice, or a failing refresh?
- **Symptom**: an email alert contains `The database 'stockdb' has reached its size quota. Partition or delete data...`, and a particular scheduled refresh (such as `sync-data.yml` / `sync-market-focus.yml`) fails to write.
- **Cause**: the production Azure SQL `stockdb` used to be on the **Free tier (only a 32 MB cap)**, so once there was a bit more data an INSERT would hit the hard cap.
- **Immediate remediation** (keeping all data; upgrading the tier is enough to lift the capacity limit):
  ```powershell
  az sql db list-usages --resource-group rg-yuzora_roy_ai --server sql-stock-platform --name stockdb
  az sql db update --resource-group rg-yuzora_roy_ai --server sql-stock-platform --name stockdb `
    --edition Basic --capacity 5 --max-size 2GB
  ```
- **Monitoring usage**: you can run `node scripts/diag-size.mjs` (under `packages/database`, a read-only listing of the DB size, each table's usage and row counts; `DATABASE_URL` and a whitelisted IP are required to connect).
- **Firewall caution**: Azure SQL denies all IPs by default. Before diagnosing a connection you need to add a firewall rule for the source IP in the portal/CLI and delete it after use; **never** open the whole internet range (`0.0.0.0/0`).
- **Long-term approach**: Basic 2 GB is very ample for this platform's current data volume; if it grows further in the future, consider serverless (auto-pause when idle) or adding retention cleanup for large tables (images / analysis records).

### Q4: Receiving an "LLM daily digest fallback" alert (Groq OTPM 429)?
- **Symptom**: the alert email says `Rate limit reached ... OTPM: Limit 1000, Used ~800, Requested 1000`, and the daily digest is presented with degraded headline concatenation.
- **Cause**: the Groq qwen tier's hard OTPM cap is 1000 and it is enforced as "already used + this request"; if the production DB value of `market_focus.summary_max_tokens` is 1000 (the code default is 450, adjustable in the admin — check the admin setting value first), and the earlier calls in the pipeline have already burnt ~800, then 1000 blows up the moment it arrives. Also check whether the primary and the fallback share the same key and pool (that was the case before 2026-09-23 and has since been split).
- **Remediation**: look at the error detail of that `sync-market-focus` run on GitHub; query `llm_usage_logs` (`getLlmUsageReport`) to reconstruct the per-minute usage peaks; confirm the deployed tier1/tier2 use different secrets.
- **Long term**: staggering + backoff are already built in (without changing static parameters); once the usage dashboard (planned as Issue-B) ships you can see the minute-level level directly; if it still blows up frequently, consider tuning parameters or upgrading the Groq Dev Tier.

### Q5: Local `npm run typecheck` reports TS2305 (missing member in `@stock/database`) or OOM exit 134?
- **Symptom**: `apps/web` reports `Module "@stock/database" has no exported member deleteOddLotByDate / listOddLotDateCounts` (Issue #68, after commit 5a41d65); or `tsc --noEmit` is terminated by the OOM killer (exit 134).
- **Cause**: a stale dist — the source function bodies exist (`packages/database/src/fetchers/twse-odd-lot.ts`), but what `apps/web` resolves through `@stock/database` is the gitignored tsup output (`packages/database/dist/`), and a too-old local dist breaks the chain; also, `apps/web` tsc needs about 6 GB of heap and the default heap is not enough.
- **Remediation**:
  1. Rebuilding solves it: after `npm run build --workspace=packages/database`, `grep deleteOddLotByDate packages/database/dist/index.js` should hit, and web tsc then has zero TS2305.
  2. No manual work normally: the root `npm run typecheck` first runs `pretypecheck` to automatically rebuild the dependency workspaces (core→market-data→database→ai-engine); running web alone also builds database first via `apps/web`'s `pretypecheck`.
  3. OOM: `apps/web`'s `typecheck` is already pinned to `node --max-old-space-size=6144`, so just run it; CI (`typecheck.yml`) sets the same `NODE_OPTIONS`.
- **Long term**: `typecheck.yml` (push to main + PR) builds the dependencies first and then typechecks everything, stopping this class of broken chain before merge; production deployment goes through `deploy.yml`'s `local-build` (building database before web) and is unaffected.

### Q6: A scheduled trigger hits curl exit 28 (no response at all for 60 seconds)?
- **Symptom**: e.g. the trigger step of `sync-market-focus.yml` gives `Process completed with exit code 28` (HTTP 000, not even reaching the route's first line).
- **Cause**: the trigger timing collided with an Azure deployment restart window (2026-10-15 instance: the deploy restarted the App at about 10:39–10:40, and the trigger at 10:40:37 landed right in the window). The route itself is designed to return a jobId in seconds and cannot possibly take 60 seconds — exit 28 means "the App was not listening at that moment".
- **Remediation**: after the deployment completes (`gh run watch <deploy-id>` success + about 2 minutes of propagation), just manually re-run once with `workflow_dispatch`; the next run of the same schedule will also run by itself, so no code change is needed. Also note that a 4~5 hour delay of the GH schedule is a known phenomenon — the scheduled time is not the actual trigger time, so to judge a collision you should look at the timelines of the two runs.

### Q7: market-focus fails with `[stage=crawl] timeout after 180s ... pendingDomains=[...]`?
- **Symptom**: the job times out in the crawl stage, with an accompanying list of unsettled domains (such as `tw.news.yahoo.com`, which blocks crawlers long-term).
- **Cause**: that domain's article pages hang for the Azure crawler (even 10s × 2 retries are exhausted). `pendingDomains` is the evidence that convicts it (the observation format of Issue #63).
- **Remediation**: since Issue #83 the crawl timeout has been successfully degraded (pending articles continue with `content=null`, and the edition still ships), so this class of failure should no longer appear; if it does, first check whether it is a **non-crawl stage** (a failure as usual is normal) or a new domain, and then decide on switching sources / lowering the weight (a separate matter).

---

## 6. Social Credential (IG / Threads / Facebook) Operations

`check-social-tokens.yml` calls `/api/social/token-health` daily at 03:30 Taiwan time to check the three platforms' credentials, and if any is invalid it attaches an alert to the health-check reply. **Once a token expires, social auto-posting (`social-publish.ts`) and the card uploads of dry-run previews will both fail.**

> Festival posting and the first-reply question reuse the same set of credentials and the deduplication table (`social_posts`), and are operated the same way; for the feature details see §8.2 of `docs/features-guide.md`.

### 6.1 The Three Token Lifetimes at a Glance

| Platform | Type | Lifetime | Where to obtain |
| :--- | :--- | :--- | :--- |
| Instagram | Long-lived IGAA | 60 days | Meta App (`ib_exchange_token` exchange) |
| Threads | Long-lived THAA | 60 days | Meta App (`exchange_token` exchange) |
| Facebook Page | system user token (`EAAL…`) | Long-lived | Meta Business Suite → System Users |

> FB posting flow: internally the system uses the system user token to call `/me/accounts` and automatically exchanges it for the page token dedicated to the Page (`resolveFbPageToken`, automatically matching `FB_PAGE_ID`). When renewing, make sure the new system user **has been granted permission to that Page**, otherwise it will return "FB cannot find the Page".

### 6.2 Renewal SOP

1. **Receive the alert** → check in the Meta Graph API Explorer / Business Suite which token has become invalid:
   - IG: `GET https://graph.facebook.com/{ig-user-id}?fields=id,username&access_token={IG_ACCESS_TOKEN}` returning `error` means it is invalid.
   - Threads: verify the same way with the user id corresponding to the THAA.
   - FB: `GET https://graph.facebook.com/me/accounts?access_token={FB_ACCESS_TOKEN}` returning 190/`invalid token` means it is invalid.
2. **Re-issue** (long-lived token exchange for each platform, requiring `THREADS_APP_ID`/`THREADS_APP_SECRET`/Meta App permission):
   - IG: after obtaining a new short-lived access token, use `grant_type=fb_exchange_token` to exchange it for a 60-day IGAA.
   - Threads: exchange it for a 60-day THAA the same way as IG.
   - FB: generate a new system user token in Business Suite → System Users (and confirm the Page has been assigned).
3. **Update the GitHub Secrets**: `IG_ACCESS_TOKEN`/`THREADS_ACCESS_TOKEN`/`FB_ACCESS_TOKEN` (and update `IG_USER_ID`/`FB_PAGE_ID` too if they have changed).
4. **Redeploy**: push any change or manually re-run `deploy.yml` so the GH Secrets are synced into Azure App Settings.
5. **Verify**: start a local `npm run dev` and call `/api/social/token-health` (with `Authorization: Bearer $SYNC_TOKEN`), which should return `200`; or wait for the 03:30 workflow the next day to confirm automatically.
