# 身分驗證與配額規範手冊

本文件說明 Vestential 的 OAuth 第三方登入設定步驟、JWT Session 安全機制與使用者每日免費額度管理。

---

## 1. 登入架構與安全機制

本平台不自建帳號密碼系統，全數採用 OAuth 2.0 第三方登入（Google 與 LINE），不儲存使用者之任何登入密碼：

- **Session 管理**：登入成功後以 `AUTH_SECRET` 簽發加密之 JWT，存放於 HTTP-only、Secure Cookie 中，阻絕 XSS 竊取。
- **資料庫紀錄**：系統於 `users` 資料表僅記錄第三方提供之識別碼（`provider` + `provider_id`）、顯示名稱與電子郵件（若授權提供）。

---

## 2. OAuth 申請與環境設定

### 2.1 Google 登入設定
1. 進入 [Google Cloud Console](https://console.cloud.google.com/)。
2. 進入 **APIs & Services → Credentials → Create Credentials → OAuth client ID**。
3. 應用程式類型選擇 **Web application**。
4. **已授權的重新導向 URI** 設定：
   - 本機開發：`http://localhost:3000/api/auth/callback/google`
   - 線上正式環境：`https://vestential.com/api/auth/callback/google`
5. 建立後取得 `GOOGLE_CLIENT_ID` 與 `GOOGLE_CLIENT_SECRET`。

### 2.2 LINE 登入設定
1. 進入 [LINE Developers Console](https://developers.line.biz/)。
2. 建立 Provider 並新增 **LINE Login Channel**。
3. 在 Channel 設定頁開啟 Web 登入支援，並設定 **Callback URL**：
   - 線上正式環境：`https://vestential.com/api/auth/callback/line`
   > 注意：LINE 官方禁止填寫 `localhost` 作為 Callback URL。本機測試登入流程請改用專屬開發端點 `/api/auth/dev-login`。
4. 取得 `LINE_CLIENT_ID`（Channel ID）與 `LINE_CLIENT_SECRET`（Channel Secret）。

### 2.3 AUTH_SECRET 密鑰產生
執行下列指令產生隨機的高強度 Base64 密鑰：
```bash
openssl rand -base64 32
```
將結果填入本機 `.env.local` 或部署端之 `AUTH_SECRET`。切勿將此密鑰直接提交至程式庫。

---

## 3. 使用者配額體系 (Quota Policy)

為防止資源遭到大量濫用，並兼顧一般投資人的日常研究需求，平台設定三層配額保護機制（#44 起 AI 分析改為分級制：**一般使用者每日 1 次／管理員每日 3 次**，由 `lib/auth.ts getDailyAnalysisLimit(isAdminUser→3／一般→1)` 判定；`auth/me` 回傳分級 `max`，429 文案寫清分級）：

| 功能項目 | 適用對象 | 免費額度上限 | 重置週期 | 紀錄資料表 |
| :--- | :--- | :--- | :--- | :--- |
| **12-Agent AI 深度分析 (`/analyze`，僅限台股代號)** | 登入使用者 | 一般每日 **1 次**／管理員每日 **3 次** | 台灣時間午夜 00:00 | `analysis_quota` |
| **個人損益 AI 投資建議 (`/portfolio`)**| 登入使用者 | 與上方共用分級額度（一般 1／管理員 3） | 台灣時間午夜 00:00 | `analysis_quota` |
| **組合風險 AI 總結 (`/portfolio` 風險頁)** | 登入使用者 | 與上方共用分級額度（按鈕旁顯示剩餘 X/Y；失敗不扣） | 台灣時間午夜 00:00 | `analysis_quota` |
| **交易日誌 AI 覆盤 (`/journal`，導覽入口已移除，直連仍可進入）** | 登入使用者 | 與上方共用分級額度（月統計免費看，僅覆盤扣次；未滿 5 筆不給按） | 台灣時間午夜 00:00 | `analysis_quota` |
| **持倉歷史整體覆盤 (`/portfolio` 歷史區）** | 登入使用者 | 與上方共用分級額度（統計免費看，僅覆盤扣次；未滿 5 筆不給按） | 台灣時間午夜 00:00 | `analysis_quota` |
| **券商截圖 AI 圖片辨識 (`/portfolio`)** | 登入使用者 | 每日 **10 次** | 台灣時間午夜 00:00 | `recognition_usage` |
| **自訂持股損益試算 (`/portfolio`)** | 免登入訪客 / 登入者 | 無限制 | — | `portfolio_records` |
| **季線乖離與週期進場模型回測 (`/backtest`、`/cycle-entry`)** | 全體使用者 | 無限制 | — | 僅匿名統計次數 |
| **零股行情與紀念品情報 (`/odd-lot`)** | 全體使用者 | 無限制 | — | — |

---

## 4. 額度重置與例外處理

- **時區標準**：所有配額計算一律以 **Asia/Taipei（UTC+8）** 日曆日為基準，每日午夜自動歸零。
- **超額回應**：當日配額用罄時，API 回傳 `429 Too Many Requests`，前端介面將清楚提示分級額度（「一般每日 1 次／管理員每日 3 次；已用 X/Y」），保障系統平穩運作。
- **失敗退款**：分析中途因技術性失敗（任一 agent 失敗、SSE 中斷）時，系統自動退回本次扣除的配額（`refundAnalysisQuota`，同 user＋quotaDate 冪等只退一次；續跑／resume 本不扣額，不重複退）。
- **分析紀錄公開**：歷史分析紀錄（`GET /api/analysis-records`）為公開 API，未登入也可讀取；僅「新建分析」需登入並扣配額。
- **系統呼叫不佔用個人額度**：排程產生的社群文案／首回覆提問／市場總覽走系統 LLM 鏈，不扣使用者分級額度。
