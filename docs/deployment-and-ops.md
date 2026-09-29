# Azure 部署與維運手冊

本文件提供 Vestential 在 Azure App Service 的部署架構、GitHub Actions 自動化流程、環境變數對應表與常見維運排錯指南。

---

## 1. 部署策略與架構

平台一律採用 **GitHub Actions 自動化 CI/CD** 流程部署至 Azure App Service。

- **繞過雲端 Oryx 建置**：由於 Azure App Service B1 方案記憶體有限（1.75 GB），在雲端直接執行 `npm build` 容易發生記憶體耗盡（OOM 崩潰）。因此採用「**在 GitHub Runner 完成建置並打包相依套件，整包 zipdeploy 上傳**」的策略，徹底解決容器啟動失敗問題。
- **觸發條件**：任何推送到 `main` 分支的提交（`git push origin main`）將自動啟動部署。

---

## 2. GitHub Secrets 與 Azure App Settings 對應表

在 GitHub 倉庫的 **Settings → Secrets and variables → Actions** 設定下列金鑰：

| GitHub Secret 名稱 | 說明與來源 | 對應 Azure App Setting |
| :--- | :--- | :--- |
| `AZURE_CREDENTIALS` | Azure 服務主體 JSON（由 `az ad sp create-for-rbac` 產生） | —（供部署工作流程登入） |
| `OPENAI_API_KEY` | 主要 LLM 服務的金鑰 | `OPENAI_API_KEY` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API Key（Google AI Studio 申請，tier1 備援） | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `FALLBACK_DEEP_LLM_BACKEND_URL` | tier1 推理後端（Groq，`https://api.groq.com/openai/v1`） | `FALLBACK_DEEP_LLM_BACKEND_URL` |
| `FALLBACK_DEEP_LLM_API_KEY` | tier1 推理 API Key（**新 key**，2026-09-23 起用，與 tier2 不同池） | `FALLBACK_DEEP_LLM_API_KEY` |
| `FALLBACK_QUICK_LLM_BACKEND_URL`| tier1 快速模型後端（Groq） | `FALLBACK_QUICK_LLM_BACKEND_URL` |
| `FALLBACK_QUICK_LLM_API_KEY` | tier1 快速模型 API Key（**新 key**，同上） | `FALLBACK_QUICK_LLM_API_KEY` |
| `FALLBACK2_DEEP_LLM_BACKEND_URL` | 第二層備援（tier2）推理模型之 Base URL（保留 qwen 後端） | `FALLBACK2_DEEP_LLM_BACKEND_URL` |
| `FALLBACK2_DEEP_LLM_API_KEY` | 第二層備援推理模型之 API Key | `FALLBACK2_DEEP_LLM_API_KEY` |
| `FALLBACK2_QUICK_LLM_BACKEND_URL` | 第二層備援快速摘要模型之 Base URL | `FALLBACK2_QUICK_LLM_BACKEND_URL` |
| `FALLBACK2_QUICK_LLM_API_KEY` | 第二層備援快速摘要模型之 API Key | `FALLBACK2_QUICK_LLM_API_KEY` |
| `DATABASE_URL` | Azure SQL Server 連線字串（若留空則使用 SQLite） | `DATABASE_URL` |
| `SYNC_TOKEN` | 內部安全更新端點的 Bearer 驗證金鑰（需 ≥16 字元） | `SYNC_TOKEN` |
| `AUTH_SECRET` | 登入 Session JWT 簽章密鑰（由 `openssl rand -base64 32` 產生） | `AUTH_SECRET` |
| `GOOGLE_CLIENT_ID` | Google Cloud Console 申請之用戶端 ID | `GOOGLE_CLIENT_ID` |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console 申請之用戶端密鑰 | `GOOGLE_CLIENT_SECRET` |
| `LINE_CLIENT_ID` | LINE Developers 申請之 Channel ID | `LINE_CLIENT_ID` |
| `LINE_CLIENT_SECRET` | LINE Developers 申請之 Channel Secret | `LINE_CLIENT_SECRET` |
| `SMTP_USER` | 官方發信用帳號 | `SMTP_USER` |
| `SMTP_PASS` | 官方發信用應用程式密碼 | `SMTP_PASS` |
| `NOTIFY_TO` | 市場焦點總覽與異常告警接收信箱 | `NOTIFY_TO` |
| `IG_ACCESS_TOKEN` | Instagram 長效型 token（IGAA，60 天） | `IG_ACCESS_TOKEN` |
| `IG_USER_ID` | Instagram business 帳號 ID | `IG_USER_ID` |
| `THREADS_ACCESS_TOKEN` | Threads 長效型 token（THAA，60 天） | `THREADS_ACCESS_TOKEN` |
| `THREADS_USER_ID` | Threads user ID | `THREADS_USER_ID` |
| `THREADS_APP_ID` | Threads Meta App ID（長效 token 換發用） | `THREADS_APP_ID` |
| `THREADS_APP_SECRET` | Threads Meta App Secret（長效 token 換發用） | `THREADS_APP_SECRET` |
| `FB_ACCESS_TOKEN` | Facebook system user token（EAAL…，長期有效） | `FB_ACCESS_TOKEN` |
| `FB_PAGE_ID` | 粉專 ID（發文時自動由 system user 換出 page token） | `FB_PAGE_ID` |

> 註：此外尚有幾個「硬編進 deploy.yml App Settings、不需當 GitHub Secret」的值：

| Azure App Setting | 值說明 |
| :--- | :--- |
| `ADMIN_LINE_USER_IDS` | 後台管理員 LINE user id（逗號分隔） |
| `ADMIN_EMAILS` | 後台管理員 email（逗號分隔） |
| `ARENA_CRON_ENABLED` | `true`＝啟用 in-process 台灣時間競技場排程（主要時鐘） |
| `LLM_DISABLE_THINKING` / `LLM_TIMEOUT_MS` / `LLM_MAX_TOKENS` | LLM 推理參數調校（`true` / `180000` / `8192`） |
| `ANALYZE_MAX_TOKENS` | 分析輸出 token 上限（`2048`） |

> **LLM 互相備援鏈（deploy.yml 硬編，2026-09-23 起）**：主 `google`（`gemini-2.5-flash`，`GOOGLE_GENERATIVE_AI_API_KEY`，支援逗號多 key 輪替）→ tier1 `openai` 相容（`qwen/qwen3.8-27b` 走 Groq，`FALLBACK_*` 新 key）→ tier2 同模型走 Groq（`FALLBACK2_*` 舊 key）。建鏈自動檢查同池（`checkFallbackPoolDiversity`；2026-09-23 前 tier1/tier2 誤用同一 secret 導致備援零保護，見 §5 Q4）。熔斷冷卻：一般 60 秒／確定性壞 10 分鐘，冷卻結束自動重探切回（`packages/ai-engine/src/llm/fallback-client.ts` 的 `FallbackClient`）。

> 註：`AUTH_BASE_URL` 在部署工作流程中已固定為 `https://vestential.com`，無需重複設定。
>
> **生產資料庫（Azure SQL）**：Server `sql-stock-platform.database.windows.net`（canadacentral，Resource Group `rg-yuzora_roy_ai`）、Database `stockdb`。
> 目前階層為 **Basic（5 DTU）／上限 2 GB**（於 2026-09-11 由「Free tier（僅 32 MB）」升級，原因與排除步驟見 §5 Q3）。

---

## 3. 定時自動化排程

系統以 GitHub Actions **10 個 workflow**（皆以台灣時間表示）維持行情、健康狀態與社群發布：

1. **零股行情同步 (`sync-oddlot.yml`)**：
   - 時間：台灣時間每個工作日 **15:10**（TWSE 盤後零股公布後）。
   - 行為：自動呼叫 `POST /api/odd-lot/refresh?date=YYYYMMDD`，透過 `SYNC_TOKEN` 驗證更新最新零股行情。
2. **市場焦點新聞同步 (`sync-market-focus.yml`)**：
   - 時間：**每 6 小時**（`0 */6 * * *`，UTC 00/06/12/18 → 台灣 08/14/20/02）。
   - 行為：抓取鉅亨、經濟日報、Yahoo 股市最新資訊，產生 AI 重點摘要並寄送總覽電子郵件。
3. **健康檢查與自動修復 (`health-report.yml`)**：
   - 時間：每 4 小時輕量檢查，每日台灣時間 08:00 進行完整盤查。
   - 行為：主動診斷各端點狀態，若有異常自動呼叫修復端點，修復無效才向維護人員發送告警信。
4. **台股資料同步 (`sync-data.yml`)**：
   - 時間：每日台灣時間 **02:30**；每週一再加跑一次。
   - 行為：同步股東會紀念品與 MOPS 公告等批次資料（`SYNC_TOKEN` 驗證）。
5. **週期進場掃描 (`sync-cycle-entry.yml`)**：
   - 時間：每個交易日台灣時間 **16:00**。
   - 行為：跑週期進場訊號掃描，產生 `/cycle-entry` 的當日進場標的。
6. **AI 競技場 (`arena-tick.yml`)**：
   - 時間：每個交易日 09:00（premarket）、09:35 / 10:35 / 11:35 / 13:05（四個 slot）、15:30（close）。
   - 行為：驅動 `/agent-arena` 五階段（briefing → 4 agent 決策 → discussion → 裁決 → 排行榜）。為 GH 排程備援，主要時鐘為 in-process 的 `arena-scheduler.ts`（`ARENA_CRON_ENABLED=true`）。
7. **社群 token 健康檢查 (`check-social-tokens.yml`)**：
   - 時間：每日台灣時間 **03:30**。
   - 行為：呼叫 `/api/social/token-health`，檢查 IG/Threads/FB 憑證；異常即寄發告警信（換發步驟見 §6）。
8. **部署 (`deploy.yml`)**：
   - 觸發：任何 push 至 `main` 分支。
   - 行為：GitHub Runner 建置→zipdeploy 至 Azure App Service，並同步 App Settings（含所有社群 token）。
9. **節慶社群發布 (`social-festival.yml`)**：
    - 時間：每日 UTC 00:00（＝台灣 08:00）。
    - 行為：節日當天觸發 `/api/cron/festival` 全自動發賀圖＋貼文（去重 `festival:{id}:{date}`）；非節日回 skipped。另見 `docs/features-guide.md` §8.2。
10. **持倉現價＋除息快取同步 (`sync-portfolio-prices.yml`)**：
    - 時間：每個交易日台灣時間 **16:00**（`0 8 * * 1-5` UTC；假日由 API 內 `isTwseTradingDay` 再擋一次）。
    - 行為：呼叫 `POST /api/portfolio/sync`（`SYNC_TOKEN` 驗證）全掃持倉現價；**順帶更新當年除息快取**（TWSE `TWT48U` 每日 CSV → `twse_dividends` 表，缺檔才抓、同日不重抓）＋**5 年殖利率回填**（`ensureYieldHistoryBackfill`，每輪上限 30 天、斷點續抓；失敗不擋主流程＋告警沿用既有機制）。資料源與當年／5 年殖利率規則見 `docs/features-guide.md` §1.8。

---

## 4. 開發鏈路（Issue 驅動）與自動部署

平台的所有「改動 → 自動驗收 → 自動上線」皆由 GitHub Issue 驅動：**Issue 是規格、驗收與狀態的唯一資料源（single source of truth），`/dev-loop` 是唯一入口，`git push origin main` 只是鏈路末段的一步**。本專案的 agent 定義在 `.opencode/agent/`（`pm`／`developer`／`qa-verifier`）、流程在 `.opencode/command/dev-loop.md`、守則在根目錄 `AGENTS.md`「## 開發鏈路（Issue 驅動）」；本章是給維運／接手者的操作視角。

### 4.1 目標與理念

一句話：**任何功能改動或 bug 修復，都先開成一份可執行、可驗收的 Issue 規格，由 `/dev-loop` 一站走完「開規格 → 實作 → 驗收 → 自動部署 → 生產驗證 → 關閉」，全程以 Issue body + comments 留痕，本地不另存規格／驗收報告**。維運者「grep 一個 issue number」就能重現整段交付軌跡。

### 4.2 Issue 為單一資料源：樣板與 Label 狀態機

每個開發 Issue 的 body 固定含五段（由 `pm` agent 依樣板產出）：

| 章節 | 用途 |
| :--- | :--- |
| `## 目標` | 一句話＋解決什麼問題 |
| `## 範圍` | In-scope / Out-of-scope 條列 |
| `## 副作用鏈` | UI → API route → lib/DB 函式 → 寫表／寄信／觸發 cron，附 `file_path:line` |
| `## ACCEPTANCE` | `- [ ]` 可驗收清單，是「完成」的唯一定義（developer 實作、qa-verifier 打勾共用同一份） |
| `## 風險 / 待確認` | 風險與需使用者決定的點；資料不足處標「待確認」 |

**Label 狀態機**（目前僅 5 個 `status/*` label；一次只應有一個 `status/*` 掛在 issue 上）：

| Label | 意義 | 誰設 | 何時設 |
| :--- | :--- | :--- | :--- |
| `status/spec` | 規格已建立，等待實作 | pm（主 agent 委派） | P0 開規格 Issue 時 |
| `status/in-dev` | 開發進行中 | developer | P1 開始實作時（同時移除 `status/spec`／`status/needs-fix`） |
| `status/needs-fix` | 驗收未過，待修改 | qa-verifier | P2 驗收出現 FAIL 時（→ 回到 P1；改完重設 `status/in-dev`） |
| `status/qa-pass` | 驗收全 PASS，准予上線 | qa-verifier（P2）／主 agent（P3 確認） | P2 全 PASS 時 |
| `status/released` | 已上線 | dev-loop 主 agent | P4 生產驗證通過、`gh issue close` 前設定 |

狀態流：`status/spec` → `status/in-dev` → `status/needs-fix` ⇄ `status/in-dev` → `status/qa-pass` → `status/released`（close）。

### 4.3 `/dev-loop` 一站鏈路（P0 → P4）

`/dev-loop`（agent: build）接受 `$ARGUMENTS`，**兩種輸入**：

- **純數字＝既有 issue number**：`gh issue view <N> --comments` 讀現況，接續未完成階段（修復迴圈、補驗收都走這條）。
- **其他文字＝功能描述**：先委派 `pm` 開一張含 `status/spec` 的規格 Issue，拿回 `#<N>` 再繼續。

四階段分工與產出：

| 階段 | 誰做 | 產出 | 如何進下一步 |
| :--- | :--- | :--- | :--- |
| **P0 規格** | pm（唯讀，`edit: deny`） | Issue body 含完整 `## ACCEPTANCE`，掛 `status/spec` | 回傳 issue#，交 P1 |
| **P1 實作** | developer（`edit: allow`） | 依 ACCEPTANCE 實作；必跑 `npm run typecheck`＋`npm run lint`＋build；comment 貼逐條勾選結果 | 三項 self-check 全過 → 報「P1 完成」，交 P2 |
| **P2 驗收** | qa-verifier（唯讀，`REALM=local`） | 依 ACCEPTANCE 逐項驗證，產 PASS/FAIL matrix 貼 issue comment | **全 PASS** → 交 P3；**有 FAIL** → 設 `status/needs-fix` 回 P1 修，修完重設 `status/in-dev` 再重 P2，直到全 PASS |
| **P3 自動上線** | dev-loop 主 agent | 設 `status/qa-pass`（移除 `status/needs-fix`）→ 只 stage 本次相關檔案 → commit（message 含 `Closes #<N>`）→ `git push origin main` → 用 `gh run list`／`gh run watch` 觀測 deploy | push 觸發 deploy.yml（見 4.4）；部署成功 → 交 P4 |
| **P4 生產驗證** | qa-verifier（`REALM=production`） | curl 生產 URL 驗證 ACCEPTANCE（含 DB／信件／cron 副作用，能驗才驗，否則標 UNVERIFIED） | 通過 → `status/released`＋`gh issue close --reason completed`；未過 → 回 P1 修，重跑 P3/P4 |

**FAIL 迴圈（重點）**：P2 只要有任一 FAIL，Issue label 就會回到 `status/needs-fix`，流程回縮到 P1 重修，**不會有任何「雖然有 FAIL 但先上線」的例外路徑**。P4 未過同理整段重跑。因此「P2/P4 全 PASS」是唯一能走到 push 的門票。

### 4.4 自動部署與上線原則

- **觸發**：`/dev-loop` P3 的 `git push origin main` 會觸發 `.github/workflows/deploy.yml`（任何 push 到 `main` 都會觸發，不限 dev-loop；但**常態出貨路徑只有 dev-loop**）。deploy.yml 在 GitHub Runner 完成 `local-build` 產出 standalone，zipdeploy 至 Azure App Service 並同步全部 App Settings（詳見 §1、§2、§3.8）。
- **「驗收後才 close」原則**：Issue 只在 **P4 生產驗證通過後**才由主 agent 標 `status/released` 並 close。換言之，一個 open 的 `status/*` Issue 若已 merge 上線，代表它卡在 P4 或等待處理中——關閉狀態＝生產已驗證，不是「PR 合併了就算完」。
- **Issue 標題不需手動列版本**：版本／上線與否由 **label（`status/released`）＋ close 時機** 表達；`git log` 內 `Closes #<N>` 建立 commit ↔ issue 的雙向可溯性。標題保持功能語意即可，不要塞日期或版本號。

### 4.5 gh CLI 操作速查（Windows PowerShell）

Windows 下多行 body 一律**先寫到 `$env:TEMP\opencode\*.md` 再餵 `--body-file`**，避免引號／多行跳脫問題：

```powershell
# 1) 開規格 Issue（P0，pm）
gh issue create --repo YozoraRoy/vestential `
  --title "<功能標題>" --body-file "$env:TEMP\opencode\spec.md" --label status/spec

# 2) 讀 Issue 規格＋留言（P0/P1 起手式）
gh issue view <N> --repo YozoraRoy/vestential --comments

# 3) 設 label：開始實作（P1，developer）
gh issue edit <N> --repo YozoraRoy/vestential `
  --add-label status/in-dev --remove-label status/spec,status/needs-fix

# 4) 貼 self-check／QA matrix comment（P1/P2/P4，先寫 temp 檔）
Set-Content -LiteralPath "$env:TEMP\opencode\qa.md" -Value "<matrix 內容>" -Encoding UTF8
gh issue comment <N> --repo YozoraRoy/vestential --body-file "$env:TEMP\opencode\qa.md"

# 5) 驗收全過後升 qa-pass（P2 收尾 / P3 起手）
gh issue edit <N> --repo YozoraRoy/vestential `
  --add-label status/qa-pass --remove-label status/needs-fix

# 6) 觀測部署 run（P3；不要輪詢網頁，用 gh）
gh run list --repo YozoraRoy/vestential --workflow deploy.yml --limit 5
gh run watch <run-id> --repo YozoraRoy/vestential

# 7) 生產驗證通過後標 released 並關閉（P4 收尾）
gh issue edit <N> --repo YozoraRoy/vestential --add-label status/released
gh issue close <N> --repo YozoraRoy/vestential --reason completed
```

> PowerShell 細節：`Set-Content ... -Encoding UTF8` 會存成 UTF-8（含 BOM）——gh 讀取無礙，可放心使用；here-string `@" ... "@` 適合組多行的 body。

### 4.6 維運／協作紀律提醒

- **developer 不 commit、不 push**：程式碼一律由 dev-loop 主 agent 在 P3 統一 commit＋push；任何人看到 developer 直接 push 即為違規（會跳過 `Closes #N` 與 label 門禁）。
- **QA 全 PASS 才能 merge 上線**：typecheck／lint／build 是靜態門檻，P2 的 ACCEPTANCE 逐項驗證才是實質門檻；任一 FAIL 就得回 P1，沒有例外。
- **「待確認」擋路要停**：P0–P4 任一環節遇到規格模糊、ACCEPTANCE 無法達成、或 production 驗證無法進行，一律在 issue comment 標「待確認」並**停下來問使用者**，不擅自改範圍、不自行假設。
- **QA 驗證的環境規則**：local smoke 需要 dev server 時依 AGENTS.md §4 用完全 detach 方式起（`Start-Process -RedirectStandardOutput/-RedirectStandardError -WindowStyle Hidden -PassThru`），Ready／port／停機由 observer（主 agent）負責；`curl`／PowerShell 呼叫一律短 timeout。

---

## 5. 常見維運問題與排除方法

### Q1：推送後網站出現 502 Bad Gateway 或 503 Service Unavailable？
- **原因**：Node 服務正在重啟中，或相依套件啟動階段異常。
- **排除步驟**：
  1. 等待 30~60 秒，容器通常在部署完成後需片刻熱機。
  2. 使用 Azure CLI 查看即時日誌：
     ```bash
     az webapp log tail --name stock-platform-roy --resource-group rg-yuzora_roy_ai
     ```
  3. 檢視是否有缺漏的環境變數（特別是 `AUTH_SECRET` 或 `OPENAI_API_KEY`）。

### Q2：本地開發 Port 3000 被佔用卡住？
- **原因**：前次除錯未正常終止 Node 程序。
- **排除步驟**（遵循 `AGENTS.md` 規則）：
  ```powershell
  Get-NetTCPConnection -LocalPort 3000,3001 -State Listen -ErrorAction SilentlyContinue |
    Select-Object LocalPort, OwningProcess
  Stop-Process -Id <pid> -Force
  npm run dev
  ```

### Q3：收到「資料庫 size quota」異常通知或 refresh 失敗？
- **症狀**：電子郵件告警出現 `The database 'stockdb' has reached its size quota. Partition or delete data...`，特定排程 refresh（如 `sync-data.yml` / `sync-market-focus.yml`）寫入失敗。
- **原因**：生產 Azure SQL `stockdb` 曾為 **Free tier（上限僅 32 MB）**，資料一多 INSERT 即撞硬上限。
- **立即排除**（保留所有資料，升級階層即可解除容量限制）：
  ```powershell
  az sql db list-usages --resource-group rg-yuzora_roy_ai --server sql-stock-platform --name stockdb
  az sql db update --resource-group rg-yuzora_roy_ai --server sql-stock-platform --name stockdb `
    --edition Basic --capacity 5 --max-size 2GB
  ```
- **監控用量**：可執行 `node scripts/diag-size.mjs`（`packages/database` 下，唯讀列出 DB 大小、各表佔用與行數；需 `DATABASE_URL` 與白名單 IP 才能連線）。
- **防火牆注意**：Azure SQL 預設拒絕所有 IP。診斷連線前需在 portal / CLI 新增來源 IP 的防火牆規則，用完即刪；**切勿**開放整個網際網路範圍（`0.0.0.0/0`）。
- **長期對策**：Basic 2 GB 對本平台目前資料量十分充裕；若未來再成長，可考慮 serverless（閒置自動暫停）或對大表（圖檔／分析紀錄）加保留期清理。

### Q4：收到「LLM 每日總覽回退」告警（Groq OTPM 429）？
- **症狀**：告警信 `Rate limit reached ... OTPM: Limit 1000, Used ~800, Requested 1000`，每日總覽以降級標題拼接呈現。
- **原因**：Groq qwen tier OTPM 硬上限 1000 且按「已用＋本次請求」擋；`market_focus.summary_max_tokens` 生產 DB 值若為 1000（code 預設 450，後台可調——先檢查後台設定值），加上 pipeline 前段呼叫已燒 ~800，1000 一進就爆。另查主備是否同 key 同池（2026-09-23 前即如此，已分池）。
- **排除**：到 GitHub 該次 `sync-market-focus` run 看錯誤明細；查 `llm_usage_logs`（`getLlmUsageReport`）還原每分鐘用量尖峰；確認 deploy 的 tier1/tier2 用不同 secret。
- **長期**：錯峰＋退避已內建（不動靜態參數）；用量儀表板（Issue-B 規劃）上線後可直接看分鐘級水位；仍頻繁爆再考慮調參或升級 Groq Dev Tier。

---

## 6. 社群憑證（IG / Threads / Facebook）維運

`check-social-tokens.yml` 每日台灣時間 03:30 呼叫 `/api/social/token-health` 檢查三平台憑證，任一失效即在健康檢查回信通知中夾帶告警。**Token 一旦過期，社群自動發文（`social-publish.ts`）與乾跑預覽的圖卡上傳都會失敗。**

> 節慶發文與首回覆提問沿用同一套憑證與去重表（`social_posts`），維運方式相同，功能細節見 `docs/features-guide.md` §8.2。

### 6.1 三種 token 壽命一覽

| 平台 | 型態 | 效期 | 取得管道 |
| :--- | :--- | :--- | :--- |
| Instagram | 長效 IGAA | 60 天 | Meta App（`ib_exchange_token` 換發） |
| Threads | 長效 THAA | 60 天 | Meta App（`exchange_token` 換發） |
| Facebook 粉專 | system user token（`EAAL…`） | 長期 | Meta Business Suite → System Users |

> FB 發文流程：系統內用 system user token 呼叫 `/me/accounts` 自動換出粉專專用 page token（`resolveFbPageToken`，自動配對 `FB_PAGE_ID`）。換發時須確保新 system user **有指派該粉專權限**，否則會回「FB 找不到粉專」。

### 6.2 換發 SOP

1. **收到告警** → 到 Meta Graph API Explorer / Business Suite 確認是哪筆 token 失效：
   - IG：`GET https://graph.facebook.com/{ig-user-id}?fields=id,username&access_token={IG_ACCESS_TOKEN}` 回 `error` 即失效。
   - Threads：同上以 THAA 對應的 user id 驗證。
   - FB：`GET https://graph.facebook.com/me/accounts?access_token={FB_ACCESS_TOKEN}` 回 190/`invalid token` 即失效。
2. **重新換發**（各平台長效 token 換發，需 `THREADS_APP_ID`／`THREADS_APP_SECRET`／Meta App 權限）：
   - IG：取得新的短效 access token 後，用 `grant_type=fb_exchange_token` 換出 60 天 IGAA。
   - Threads：同 IG 方式換出 60 天 THAA。
   - FB：在 Business Suite → System Users 內 generate 新的 system user token（並確認已指派粉專）。
3. **更新 GitHub Secrets**：`IG_ACCESS_TOKEN`／`THREADS_ACCESS_TOKEN`／`FB_ACCESS_TOKEN`（如 `IG_USER_ID`／`FB_PAGE_ID` 有變也一併更新）。
4. **重新部署**：push 任一變更或手動 rerun `deploy.yml`，讓 GH Secrets 同步進 Azure App Settings。
5. **驗證**：起本地 `npm run dev`，呼叫 `/api/social/token-health`（帶 `Authorization: Bearer $SYNC_TOKEN`）應回 `200`；或等隔日 03:30 workflow 自動確認。
