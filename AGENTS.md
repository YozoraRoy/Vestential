# AGENTS.md — 專案規則

## 跑測試 / 冒煙前：Dev Server 檢查（必做）

任何 QA 驗證、冒煙測試、E2E 之前，**先確認 dev server 狀態**，再決定是否要清理：

### 1. 檢查目前狀態

```powershell
Get-NetTCPConnection -LocalPort 3000,3001 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort, OwningProcess
```

- **只有一台、且跑在 3000** → 乾淨，直接用。
- **3000 + 3001 都有** → 有殘留 server，先清再起：保留「最新起的那台」繼續測，其餘 `Stop-Process -Id <pid> -Force`。
- **兩台都在跑、但你看不出哪台最新** → 全清掉，重起單一台。
- **一台都沒有** → 直接 `npm run dev` 起一台。

> 派 QA 前的完整順序（檢查→起好→確認 Ready→派單）見 `dev-loop.md`「QA 派單
> SOP」；§1 本節是其中第 1 步，由主 agent 執行。

### 2. 清理殘留 server

```powershell
Stop-Process -Id <pid> -Force
```

> 只停 server 本體（`start-server.js` / `next dev` / `npm run dev` chain）即可，不需停系統無關程序。
> 殺掉後隔 1~2 秒再 `Get-NetTCPConnection` 確認 port 已釋放。

### 3. 起單一台 dev server（主 agent／observer 專屬動作）

> **角色限定**：本節「起 server＋等 Ready＋確認 port」只能由**主 agent
> （observer）**執行。subagent（QA）預設禁起 server、禁在此節做任何等待；
> 唯一的例外是 prompt 首行顯式授權自起，且即使授權也只准用 §4 detach 三要素
> （互相引用，不牴觸）。

```powershell
npm run dev
```

- 用輪詢等 `Ready`（不要固定睡 20~30 秒）：每 2 秒讀一次 log，出現 `Ready in` 立即往下走；60 秒沒出現判失敗（重起或降級，不無限等）：
```powershell
$deadline = (Get-Date).AddSeconds(60)
do { Start-Sleep -Seconds 2; $ready = Select-String -Path "$env:TEMP\opencode\devout.log" -Pattern "Ready in" -Quiet } until ($ready -or (Get-Date) -gt $deadline)
if (-not $ready) { throw "dev server 未在 60 秒內 Ready" }
```
- 再用 `Get-NetTCPConnection -LocalPort 3000` 確認只有 3000 在聽。
- **不要同時起第二台**（port 3000 被佔時 Next 會自動改跑 3001，造成「卡住」錯覺）。

### 4. 由 subagent（QA）起 server 時：必須用「完全 detach」方式

> **與 §3 的分工**：§3 的「起 server＋等 Ready＋確認 port」是主 agent
> （observer）的動作；本節是**唯一的 subagent 例外通道**（且須 prompt 首行
> 顯式授權），兩節互相引用、不牴觸。未經授權的 subagent 一律禁起 server。

若把「起 dev server」交給 subagent 處理（如「QA 起、主 agent 觀測」的協作分工），**不要**用 `Start-Process -NoNewWindow`——child 會繼承 console handle，subagent 的 bash tool call 等不到 child 結束，**整個 task 會看似卡住**（實際 server 已起來）。同理**禁止**在 subagent task 內直接跑 `npm run dev`、輪詢 `Ready`（`Get-Content -Wait`／`while` 迴圈等 log／重試 `curl /` 直到通）、或用 `Get-NetTCPConnection` 迴圈等待 port。

務必用完全 detach 的方式，起完立即回傳 pid 就結束：

```powershell
$p = Start-Process -FilePath "powershell" -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-Command","npm run dev" `
  -WorkingDirectory "D:\PG\stock-platform" `
  -RedirectStandardOutput "$env:TEMP\opencode\devout.log" `
  -RedirectStandardError "$env:TEMP\opencode\deverr.log" `
  -WindowStyle Hidden -PassThru
$p.Id   # 立即回傳（實測 ~16ms），不要在此 task 內輪詢 Ready
```

- **三要素**：`-RedirectStandardOutput/-RedirectStandardError`（log 導至暫存檔，不繼承父 console handle）、`-WindowStyle Hidden -PassThru`（detach＋拿 pid）、起完**立即回傳**。
- Ready 確認、port 檢查、路由觀測、停機，全部留給 observer（主 agent）做，QA/起 server 的 agent 不要在 task 內自己輪詢長駐程式。

## 開發鏈路（Issue 驅動）

新功能／修 bug 一律走「GitHub Issue 單一資料源」的 4 階段鏈路，由一鍵指令 `/dev-loop` 觸發（agent 檔：`pm`／`developer`／`qa-verifier`，命令：`dev-loop`）：

```
P0 pm（唯讀）  →  P1 developer（實作）  →  P2 qa-verifier（驗收）  →  P3 自動上線  →  P4 生產驗證
開 Issue 規格     依 ACCEPTANCE 實作        依 ACCEPTANCE 驗證        commit+push       驗生產後 close
status/spec       含 typecheck/lint/build   PASS/FAIL matrix        Closes #N → deploy
```

### Issue 樣板與 Labels

- Issue body 固定含：`## 目標`／`## 範圍`／`## 副作用鏈`（UI→API→lib/DB→信件/cron）／`## ACCEPTANCE`（`- [ ]` 可驗收清單）／`## 風險/待確認`。
- Label 狀態機：`status/spec` → `status/in-dev` → `status/needs-fix` ⇄ `status/in-dev` → `status/qa-pass` → `status/released`（close）。
- 規格與驗收報告**只放 Issue**（body + comments），不落本地檔。

### 分工與紀律

- **pm**：`edit: deny`，只能 `gh issue create/edit/view/comment`；回傳 issue#。
- **developer**：`edit: allow`；以 ACCEPTANCE 為完成定義；完工必跑 `npm run typecheck`＋`npm run lint`＋build；**不 commit／不 push**（收尾由 dev-loop 主 agent 統一處理）。
- **qa-verifier**：`edit: deny`；依 Issue ACCEPTANCE 逐項驗證，產 PASS/FAIL matrix 貼 issue comment；dev server 預設由主 agent 事先起好（`dev-loop.md`「QA 派單 SOP」），QA 僅在 prompt 首行顯式授權時才准用 §4 detach 三要素自起；curl／Invoke-WebRequest／Invoke-RestMethod 一律帶顯式短 timeout（`curl --max-time 10`、`-TimeoutSec 10～15`），無 timeout 參數的驗證步驟視為不合格。
- **dev-loop 收尾（主 agent）**：QA 全 PASS → commit（message 含 `Closes #<N>`）→ `git push origin main`（觸發 deploy.yml）→ 觀測部署 → 生產驗證通過後 `gh issue close <N>`。
- **deploy 延後驗**：push 成功即算 P3 完成，不用盲睡等部署；把 deploy run id 寫進 Issue comment 追蹤，下次互動時再驗 P4（`gh run view <id>` 一眼判定）。想同步等也行：用 `gh run watch` 帶 timeout 取代固定 `Start-Sleep 360`。
- 途中遇到「待確認」擋路：停下來問使用者，不擅自改範圍。

### QA 分級（PM 判定，主 agent／使用者只能升級不能降級）

簡單功能不必每次都完整 QA。PM 在 P0 規格 body 加一行 `QA-Level: full / quick / skip`＋一句理由；dev-loop 照等級走：

| 等級 | 適用 | P2 | P4 |
| :--- | :--- | :--- | :--- |
| `full`（預設） | 一般功能／修 bug | 完整 runtime 驗收（dev server＋matrix） | 照常 |
| `quick` | 純文案／i18n／單檔小修且有測試覆蓋／設定預設值／純展示改動（單頁 UI、靜態可驗） | 靜態＋smoke：typecheck＋lint＋diff 核對＋相關單測重跑，不需 dev server | 照常（生產 curl 便宜） |
| `skip` | docs／註解／不影響 runtime 的檔案 | 跳過（P1 self-check 即放行） | 照常 |

- **紅線**：涉 DB migration／授權／quota／金流／排程邏輯，一律 `full`，PM 不得標 quick／skip。
- **只能升級**：主 agent 或使用者可把等級往上調（quick→full），不可往下調；有疑慮就升級。
- `skip` 也要走 P3／P4（deploy 本身驗 build，生產 curl 驗存活）。

## 重要教訓

- node dev server 用完必須清乾淨。之前曾殘留兩台（3000/3001 各一），新起的 server 因 3000 被佔自動改跑 3001，讓測試誤以為「卡住」。
- QA 驗證時給顯式短 timeout（`curl --max-time 10`、`-TimeoutSec 10～15`），`curl`/powershell 呼叫太容易卡住；無 timeout 參數的驗證步驟視為不合格。
- subagent 起長駐程式必須 detach（見 §4）；起完立即回傳 pid，由 observer 負責 Ready／port／停機，分工才不會卡。
- QA task 時間預算 25–30 分鐘，超時由主 agent 取消重派（重派前清殘留 server）；QA 超時／失聯改走降級驗收（typecheck＋lint＋diff 核對放行，runtime 標 UNVERIFIED），詳見 `dev-loop.md`「QA 派單 SOP」與「降級驗收」。