**English** ｜ [繁體中文](./ai-cost-estimation_zh.md)

# Actual AI Workflow Cost Estimation (Cost Estimation)

> Price basis date: 2026-10-03 (Zen public price list basis; where the direct channel is the same price it is not listed separately).
> Currency USD/month; TWD converted at **1 USD ≈ NT$32** (the bank mid-market rate on 2026-10-03 was about 31.85, rounded; for a rough feel only, the actual bill rate prevails).
> Unless stated otherwise, token counts are "per single run".
> Next update triggers: model price changes, the Gemini discount expiring (2026-12-31), large exchange-rate swings, a change in the usage tier, arena calibration completing.

## 1. Model Prices (opencode first)

"opencode first" means **pricing through the OpenCode Zen channel**: zero markup (at cost, only a 4.4% card processing fee
+ $0.30 per transaction, top-up from $20, auto top-up of $20 when the balance falls below $5, with an optional monthly cap).

| Model | in/1M | out/1M | Notes |
|---|---|---|---|
| Big Pickle (Zen free) | $0 | $0 | **Currently the primary; the whole site actually costs $0 today**; the free tier has no SLA, and dev has seen the 403 `free tier can only be used from within OpenCode` |
| Claude Sonnet 4.6 | $3 | $15 | The most expensive, the highest quality; Batch is half price, cache read $0.30 (not counted in this estimate, so it is an optimistic upper bound) |
| OpenAI GPT 6.1 Sol | $2 | $10 | ≤272K tokens; over that, $4/$15 |
| Gemini 3.8 Flash | $1.50／$7.50 | Standard price; the **discounted price $0.75/$3.75 lasts only until 2026-12-31 and doubles in 2027**, so use the standard price for a budget spanning the new year |

## 2. Per-run Usage by Workflow

Grade: **measured** (actually run on a real machine) / **budget** (derived from the program's maxTokens cap) / **rough estimate** (pending calibration).

| Workflow | in | out | Grade/source | Frequency |
|---|---|---|---|---|
| One `/analyze` round (12 nodes) | ~20k | ~10k | Measured: #52 real machine on 2330 (the 4 analysts in 1656–1756, out 441–1440; Bull/Bear/Trader + the 2 deep ones extrapolated, ±30%) | User-triggered (quota: 1/day for regular users, 3/day for admins) |
| One market-focus edition | ~20k | ~6k | Budget: filter (cap 1000) + summaries ≤6 batches×340 + digest 550 | cron 4 times/day, but with a new-edition gate, about 2 editions per day on average |
| One arena day (weekday) | ~70k | ~20k | Rough estimate: 6 slots (briefing 900 + 4 strategists + narration) + the close round table; **the per-agent per-call duration log is now live (Issue #80), so the §6 SQL turns this into a measured value** | Monday to Friday |
| Social daily update (three platforms + first reply) | ~6k | ~3k | Budget | Daily |
| Newsletter | ~0 | ~0 | Reuses the digest, LLM ≈ 0 | One per day |
| Screenshot recognition | vision counted separately | — | Small volume (10/day/person), not counted in this table | User-triggered |
| cycle-entry/review type | Small | Small | Budget (200–1200 cap), absorbed as rounding | Scheduled/user-triggered |

Cost of one `/analyze`: Sonnet **$0.21 (about NT$7)** / Sol $0.14 (about NT$4) / G38 $0.105 (about NT$3, $0.053 discounted) / Pickle $0.

## 3. Monthly Cost Estimate (three scenarios; user-triggered counted as /analyze rounds, over a 30-day month)

Fixed schedules (market-focus + arena + social) are already amortised in.

| Scenario | Sonnet 4.6 | GPT 6.1 Sol | Gemini 3.8 (discounted) | Big Pickle |
|---|---|---|---|---|
| Light (5 rounds/day) | ~$55 (about NT$1,760) | ~$36 (about NT$1,150) | ~$27 (about NT$860; ~$14 discounted / about NT$450) | $0 |
| Medium (30 rounds/day) | ~$212 (about NT$6,800) | ~$141 (about NT$4,500) | ~$106 (about NT$3,400; ~$53 discounted / about NT$1,700) | $0 |
| Heavy (100 rounds/day) | ~$653 (about NT$20,900) | ~$435 (about NT$13,900) | ~$326 (about NT$10,400; ~$168 discounted / about NT$5,400) | $0 |

## 4. Recommendation: A Mixed Configuration (Key Point)

Switching everything to Sonnet is the most expensive answer. The engine's deep/quick dual chains are already separate (`engine.ts`), so changing models is just changing env:

- **Use a free/cheap model for the 10 quick nodes, and Sonnet for the 2 deep nodes (Research/Portfolio Manager)**
- Monthly cost in the light scenario: $55 → **~$10 (about NT$320)** (the deep cost for a single round is in 7k/out 3k ≈ $0.066 / about NT$2), spending the quality where it matters most

## 5. Hidden Costs and Risks

- **Fallback blow-up ×2**: during a 429 wave both the primary and the fallback tiers are billed (both successfully obtain data), so the monthly total can be double the table above.
- **Retries and backfill**: backoff re-calls and missing-article backfill (≤20 items each time) add sporadic cost and are not listed in the main table.
- **Big Pickle availability**: free with no SLA; when it goes down the fallback chain takes over, and the fallback model is billed at that point.
- **The Gemini clock risk**: from 2027-01-01 it is $1.50/$7.50, so use the standard price for the annual budget.
- **The arena rough estimate needs calibration**: run the SQL below once against `llm_usage_logs` to turn it into a measured value.

## 6. Calibration Method (Appendix)

Run directly against the production (or local) DB:

```sql
-- measured average tokens per agent (for calibrating §2)
SELECT agent, model, COUNT(*) AS n,
  ROUND(AVG(promptTokens)) AS avg_in,
  ROUND(AVG(completionTokens)) AS avg_out,
  SUM(totalTokens) AS total
FROM llm_usage_logs
GROUP BY agent, model ORDER BY total DESC;
```

```sql
-- total tokens over the past 30 days (to match the monthly bill)
SELECT SUM(promptTokens) AS in_30d, SUM(completionTokens) AS out_30d,
  SUM(totalTokens) AS total_30d FROM llm_usage_logs
WHERE created_at >= date('now', '-30 days');
```

The admin usage dashboard (Issue #45: daily report + OTPM view) can be cross-checked against this; the OTPM quota (Groq 1000) is a **rate** cap, not a cost cap, so do not confuse it with this table.
