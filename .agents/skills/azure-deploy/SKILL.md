---
name: azure-deploy
description: |
  Azure App Service 部署技能 (stock-platform 專案專用)。
  適用時機：當用戶要求「部署到 Azure」、「上線」、「佈署」、「推到線上」、「deploy」等指令時使用。
  本技能包含：根本原因診斷、GitHub Actions 部署流程、常見錯誤修復手冊。
---

# Azure App Service 部署技能

## 專案基本資訊

| 項目 | 值 |
|------|-----|
| 專案路徑 | `d:\PG\stock-platform` |
| Resource Group | `rg-yuzora_roy_ai` |
| App Name | `stock-platform-roy` |
| App Service Plan | `asp-stock-platform` (B1, Linux) |
| Azure SQL Server | `sql-stock-platform`（canadacentral） |
| Azure SQL Database | `stockdb`（**Basic / 5 DTU / 2 GB**，2026-09-11 由 Free 32 MB 升級） |
| Node Runtime | `NODE:20-lts` |
| 訂閱 ID | `c1a88666-9a4e-4a0f-8335-2b6191c4f38c` |
| 線上 URL | `https://stock-platform-roy.azurewebsites.net` |

---

## 部署策略總覽

> 本專案**一律透過 GitHub Actions（git runner）自動部署**，本機不再提供手動部署腳本。

| 方式 | 用途 | 觸發 |
|------|------|------|
| 🥇 **GitHub Actions 自動部署** | 唯一部署方式 | `git push origin main` |

## 核心部署策略 (為什麼這樣做)

### 架構決策：Self-Contained Zip 部署（禁用 Oryx Build）

**問題根源**：Azure B1 方案 RAM 只有 1.75GB，如果在雲端執行 `npm install`，往往因超時（230秒限制）導致容器啟動失敗，出現 `sh: 1: next: not found (exit code 127)`。

**解決方案**：在 CI Runner（GitHub Actions）完整建置 + 打包所有 `node_modules`，直接上傳一個「可即時執行」的完整 Zip 包，雲端一律不執行 npm install（`ENABLE_ORYX_BUILD=false`）。

### GitHub Actions 自動部署

Workflow 檔：`.github/workflows/deploy.yml`（`push` 到 `main` 觸發）。

**CI 流程**：
1. `actions/checkout@v4` + `actions/setup-node@v4` (Node 20)
2. `npm ci` → `npm run local-build`
3. 準備 standalone 輸出（`.next/standalone`）
4. `zip -r deploy.zip`（standalone + static）
5. `azure/login@v2`（需 `AZURE_CREDENTIALS` secret）
6. `az webapp config appsettings set`（設定所有環境變數）
7. Kudu `POST /api/zipdeploy?clean=true` 上傳部署
8. 健康檢查輪詢 `https://stock-platform-roy.azurewebsites.net/`

**需要設定的 GitHub Secrets**（Repository → Settings → Secrets and variables → Actions）：
- `AZURE_CREDENTIALS`：Azure Service Principal JSON（`az ad sp create-for-rbac --name stock-platform-roy-gha --role contributor --scopes /subscriptions/<sub> --sdk-auth`）
- `OPENAI_API_KEY`：OpenCode AI API Key
- `FALLBACK_DEEP_LLM_BACKEND_URL` / `FALLBACK_DEEP_LLM_API_KEY`：備援（deep 組）免費 API 參數（可留空沿用 primary）
- `FALLBACK_QUICK_LLM_BACKEND_URL` / `FALLBACK_QUICK_LLM_API_KEY`：備援（quick 組）免費 API 參數（可留空沿用 primary）
- `DATABASE_URL`：SQL Server 連線字串
- `SYNC_TOKEN`：行情 refresh 端點（`POST /api/odd-lot/refresh`）授權用的 Bearer Token（`openssl rand -hex 32`，需 ≥16 字元）。用於每日 `sync-oddlot.yml`（台灣時間 15:10 更新盤後零股）與手動排程。未設定 ⇒ 排程 refresh 會回 401。

**部署確認**：`gh run list` / `gh run watch <id>`，或 GitHub Actions 頁面。

> 除 `deploy.yml` 外還有兩個常態排程 Workflow：`sync-data.yml`（台灣 02:30 同步紀念品 gift+MOPS）與 `sync-oddlot.yml`（台灣 15:10 同步盤後零股行情）。推送 `main` 即會帶入新的/修改的 Workflow 檔並自動註冊排程。

### 關鍵設定

```
ENABLE_ORYX_BUILD=false           # 禁止 Azure 雲端重新 npm install
SCM_DO_BUILD_DURING_DEPLOYMENT=false  # 禁止雲端 SCM 建置觸發
WEBSITES_ENABLE_APP_SERVICE_STORAGE=true  # 開啟 /home 的持久化 NFS 掛載
DATABASE_PATH=/home/data/stock.db # SQLite 儲存在持久化目錄，不隨部署覆蓋消失
```

---

## 完整部署流程 (SOP)

### GitHub Actions 自動部署

```bash
cd d:\PG\stock-platform
git add .
git commit -m "描述本次變更"
git push origin main    # ← 觸發 .github/workflows/deploy.yml
```

**確認部署**：
```bash
gh run list --repo YozoraRoy/vestential --limit 3
gh run watch <run-id> --repo YozoraRoy/vestential --exit-status
```
或到 GitHub → Actions → Deploy to Azure 頁面查看。成功需約 8-9 分鐘。

**部署成功後線上驗證**：`https://stock-platform-roy.azurewebsites.net` 回應 200，且 `/api/diag` 或 `/api/analysis-records` 正常。

---

## 常見錯誤診斷手冊

### ❌ 錯誤 1：`sh: 1: next: not found (exit code 127)`

**症狀**：網站顯示 Application Error。日誌中有 `next: not found`。

**原因**：上傳的 Zip 沒有包含 `node_modules/.bin/next`，或 standalone 輸出不完整。

**修復步驟**：
1. 確認 `deploy.yml` 的打包命令正確包含 `apps/web/.next/standalone` 與 static 資源。
2. 確認 `package.json` 有 `start` script 指向 standalone server.js。
3. 重新推送 main 觸發部署。

---

### ❌ 錯誤 2：SSL EOF Error / SCM 上傳失敗

**症狀**：
```
HTTPSConnectionPool(host='stock-platform-roy.scm.azurewebsites.net', port=443): Max retries exceeded... SSLEOFError
```

**原因**：Azure 正在重啟容器，同時進行部署操作，觸發 SCM 衝突。

**修復步驟**：
1. 等待 60 秒讓 Azure 穩定。
2. 重新推送 main 觸發部署（或重新執行 workflow）。

---

### ❌ 錯誤 3：歷史分析記錄消失（每次部署都清空）

**症狀**：`/analyze` 的歷史列表永遠是空的。

**原因**：SQLite 儲存在 `wwwroot` 下，每次 Zip 部署都會被覆蓋清空。

**修復方案**（已實作）：
- 在 `packages/database/src/db.ts` 中改為讀取 `process.env.DATABASE_PATH`
- 在 Azure App Settings 設定 `DATABASE_PATH=/home/data/stock.db`
- `/home` 掛載在 Azure 的持久化 NFS 上，不受部署影響

---

### ❌ 錯誤 4：`Building the app...` 超過 900 秒後 Build failed

**症狀**：部署時 Polling 狀態長時間停在 `Building the app...`，最終顯示 Build failed。

**原因**：`ENABLE_ORYX_BUILD` 沒有設為 false，Azure 嘗試在雲端執行 `npm install`，B1 方案記憶體不足超時。

**修復步驟**：
```powershell
az webapp config appsettings set --name stock-platform-roy --resource-group rg-yuzora_roy_ai --settings `
  ENABLE_ORYX_BUILD=false `
  SCM_DO_BUILD_DURING_DEPLOYMENT=false
```
然後重新觸發部署。

---

### ❌ 錯誤 5：資料庫容量爆掉（`size quota` / refresh 失敗）

**症狀**：收到「Vestential 系統異常通知」email，內容為 `The database 'stockdb' has reached its size quota. Partition or delete data...`，某個 refresh 寫入失敗；或 `az sql db list-usages` 顯示 `database_size` 已逼近 `Limit`。

**根因**：`stockdb` 曾是 **Azure SQL Free tier（上限僅 32 MB）**。資料量累積後任何 INSERT 都會失敗。

**修復步驟**：
1. 先確認現況（唯讀，控制層指令不用 DB 登入）：
   ```powershell
   az sql db list --resource-group rg-yuzora_roy_ai --server sql-stock-platform --output table
   az sql db list-usages --resource-group rg-yuzora_roy_ai --server sql-stock-platform --name stockdb --output table
   ```
2. 升級階層立即止血（不刪任何資料）：
   ```powershell
   az sql db update --resource-group rg-yuzora_roy_ai --server sql-stock-platform --name stockdb `
     --edition Basic --capacity 5 --max-size 2GB
   ```
3. 細看各表佔用（需 DB 登入 + 白名單 IP）：
   ```powershell
   cd packages/database; node scripts/diag-size.mjs
   ```
4. 如需從本機連線：先在 Azure portal / CLI 加**單一來源 IP** 防火牆規則（用完即刪），不要開放全網段。

> 註：`apps/web/.env.azure` 的 `DATABASE_URL` 是**本機專用**（gitignored）的生產 Azure SQL 連線字串。實際有效值以 App Service 環境變數為準；若出現 `Login failed for user 'royadmin'`，用下列指令從 App Service 取回並覆寫（**勿把值貼進 issue／commit／log**）：
>
> ```powershell
> az webapp config appsettings list --name stock-platform-roy `
>   --resource-group rg-yuzora_roy_ai -o json |
>   ConvertFrom-Json | Where-Object name -eq 'DATABASE_URL' | Select-Object -ExpandProperty value
> ```
>
> 取得後以單行 `DATABASE_URL=<值>` 覆寫 `apps/web/.env.azure`（保留首行註解），再以 `node packages/database/scripts/diag-size.mjs` 驗證（應跑出 DATABASE SIZE／TOP TABLES 三張表）。
> 前提：本機已 `az login`，且 Azure SQL 防火牆已放行目前 IP（見上一節第 4 點，用完即刪）。

---

## 環境變數清單 (完整)

| 變數名 | 值 | 用途 |
|--------|-----|------|
| `LLM_PROVIDER` | `openai` | AI 引擎使用的 Provider |
| `OPENAI_API_KEY` | `sk-xxx...` | OpenCode AI API Key |
| `LLM_BACKEND_URL` | `https://opencode.ai/zen/v1` | OpenCode API Endpoint |
| `DEEP_THINK_MODEL` | `big-pickle` | 深度思考 Agent 模型 |
| `QUICK_THINK_MODEL` | `big-pickle` | 快速思考 Agent 模型 |
| `FALLBACK_LLM_PROVIDER` | `openai` | Fallback Provider（OpenAI-compatible） |
| `FALLBACK_DEEP_THINK_MODEL` | `qwen/qwen3.8-27b` | Fallback 深度模型（Groq） |
| `FALLBACK_DEEP_LLM_BACKEND_URL` | `https://api.groq.com/openai/v1` | Fallback（deep 組）baseUrl |
| `FALLBACK_DEEP_LLM_API_KEY` | `gsk_...` | Fallback（deep 組）apiKey |
| `FALLBACK_QUICK_THINK_MODEL` | `qwen/qwen3.8-27b` | Fallback 快速模型（Groq） |
| `FALLBACK_QUICK_LLM_BACKEND_URL` | `https://api.groq.com/openai/v1` | Fallback（quick 組）baseUrl |
| `FALLBACK_QUICK_LLM_API_KEY` | `gsk_...` | Fallback（quick 組）apiKey |
| `LLM_TEMPERATURE` | `0.7` | LLM 溫度設定 |
| `LLM_DISABLE_THINKING` | `true` | 停用推理鏈（big-pickle 會把 token 全燒在 reasoning 導致空回應） |
| `LLM_TIMEOUT_MS` | `180000` | LLM 呼叫逾時毫秒數 |
| `LLM_MAX_TOKENS` | `8192` | LLM 最大輸出 token 數 |
| `DATABASE_URL` | `Server=...` | SQL Server 連線字串（GitHub Secret） |
| `NPM_RUN_BUILD` | `false` | 禁止雲端建置 |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` | 禁止 SCM 建置 |
| `ENABLE_ORYX_BUILD` | `false` | 禁止 Oryx 建置 |
| `WEBSITES_ENABLE_APP_SERVICE_STORAGE` | `true` | 啟用 /home 持久化 |
| `DATABASE_PATH` | `/home/data/stock.db` | SQLite 持久化路徑 |

---

## 關鍵注意事項

> [!IMPORTANT]
> **上線前必須先在本地測試**
> 每次部署前必須在本地執行完整的 e2e 測試，不可盲目上傳。

> [!NOTE]
> **部署一律走 git runner**
> 本機不再提供手動部署（`deploy.ps1` 已移除），所有部署透過 `git push origin main` 觸發 GitHub Actions。
