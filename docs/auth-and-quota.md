**English** ｜ [繁體中文](./auth-and-quota_zh.md)

# Auth & Quota Guide

This document explains Vestential's OAuth third-party sign-in setup steps, the JWT session security mechanism and users' daily free allowance management.

---

## 1. Sign-in Architecture and Security Mechanism

This platform does not build its own account/password system; it uses OAuth 2.0 third-party sign-in throughout (Google and LINE) and stores none of the user's login passwords:

- **Session management**: after a successful sign-in, an encrypted JWT is issued with `AUTH_SECRET` and stored in an HTTP-only, Secure Cookie, blocking XSS theft.
- **Database records**: in the `users` table the system records only the identifier provided by the third party (`provider` + `provider_id`), the display name and the email (if the authorization provides it).

---

## 2. OAuth Application and Environment Setup

### 2.1 Google Sign-in Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
3. For the application type, choose **Web application**.
4. Set the **authorized redirect URI**:
   - Local development: `http://localhost:3000/api/auth/callback/google`
   - Online production environment: `https://vestential.com/api/auth/callback/google`
5. After creating it, obtain `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### 2.2 LINE Sign-in Setup
1. Go to [LINE Developers Console](https://developers.line.biz/).
2. Create a Provider and add a **LINE Login Channel**.
3. On the Channel settings page, enable web sign-in support and set the **Callback URL**:
   - Online production environment: `https://vestential.com/api/auth/callback/line`
   > Note: LINE officially forbids entering `localhost` as the Callback URL. To test the sign-in flow locally, use the dedicated development endpoint `/api/auth/dev-login` instead.
4. Obtain `LINE_CLIENT_ID` (Channel ID) and `LINE_CLIENT_SECRET` (Channel Secret).

### 2.3 Generating the AUTH_SECRET Key
Run the following command to generate a random, high-strength Base64 key:
```bash
openssl rand -base64 32
```
Put the result into the local `.env.local` or the deployed `AUTH_SECRET`. Never commit this key directly to the repository.

---

## 3. User Quota Policy (Quota Policy)

To prevent heavy resource abuse while still serving ordinary investors' daily research needs, the platform defines a three-tier quota protection mechanism (since #44, AI analysis has become tiered: **1 time/day for regular users, 3 times/day for admins**, determined by `lib/auth.ts getDailyAnalysisLimit(isAdminUser→3／一般→1)`; `auth/me` returns the tiered `max`, and the 429 copy spells out the tiering):

| Feature | Applies to | Free allowance cap | Reset cycle | Record table |
| :--- | :--- | :--- | :--- | :--- |
| **12-Agent AI deep analysis (`/analyze`, Taiwan-stock symbols only)** | Signed-in users | **1 time** per day for regular users / **3 times** per day for admins | Taiwan time midnight 00:00 | `analysis_quota` |
| **Portfolio P&L AI investment advice (`/portfolio`)**| Signed-in users | Shares the tiered quota above (1 for regular / 3 for admins) | Taiwan time midnight 00:00 | `analysis_quota` |
| **Portfolio risk AI summary (`/portfolio` risk page)** | Signed-in users | Shares the tiered quota above (the remaining X/Y is shown next to the button; a failure does not deduct) | Taiwan time midnight 00:00 | `analysis_quota` |
| **Trading journal AI review (`/journal`; the nav entry has been removed but the direct URL still works)** | Signed-in users | Shares the tiered quota above (monthly stats are free to view, only the review deducts; the button is disabled with fewer than 5 trades) | Taiwan time midnight 00:00 | `analysis_quota` |
| **Overall holdings history review (`/portfolio` history section)** | Signed-in users | Shares the tiered quota above (stats are free to view, only the review deducts; the button is disabled with fewer than 5 trades) | Taiwan time midnight 00:00 | `analysis_quota` |
| **Broker-screenshot AI image recognition (`/portfolio`)** | Signed-in users | **10 times** per day | Taiwan time midnight 00:00 | `recognition_usage` |
| **Custom holdings P&L calculator (`/portfolio`)** | Guest without login / signed-in users | Unlimited | — | `portfolio_records` |
| **MA-deviation and cycle-entry model backtest (`/backtest`, `/cycle-entry`)** | All users | Unlimited | — | Anonymous counts only |
| **Odd-lot quotes and gift intelligence (`/odd-lot`)** | All users | Unlimited | — | — |

---

## 4. Quota Reset and Exception Handling

- **Time-zone standard**: all quota calculations are based on the **Asia/Taipei (UTC+8)** calendar day, and reset automatically at midnight each day.
- **Over-quota response**: when the day's quota is used up, the API returns `429 Too Many Requests`, and the front end clearly states the tiered allowance ("1 time/day for regular users, 3 times/day for admins; used X/Y"), keeping the system running smoothly.
- **Refund on failure**: if an analysis fails technically midway (any agent fails, the SSE is interrupted), the system automatically refunds the quota deducted for that run (`refundAnalysisQuota`, idempotent per user + quotaDate and refunded only once; resuming/running on does not deduct in the first place and does not refund again).
- **Analysis records are public**: the historical analysis records (`GET /api/analysis-records`) are a public API that can be read even without logging in; only "creating a new analysis" requires login and deducts quota.
- **System calls do not consume personal allowance**: social copy, first-reply questions and the market digest produced by schedules go through the system LLM chain and do not deduct the user's tiered quota.
