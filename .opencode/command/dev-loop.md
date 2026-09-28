---
description: 開發鏈路一鍵流水線 — PM 規格 → Developer 實作 → QA 驗收 → 自動 commit/push/deploy → 生產驗證 → 關閉 Issue。用法：`/dev-loop <issue# 或 功能描述>`。
agent: build
---

你將執行 Vestential 的 Issue 驅動開發鏈路。`$ARGUMENTS` 內是 **issue number** 或**功能描述**，依此走完下列階段。用 `task` tool 委派子 agent（`pm`／`developer`／`qa-verifier`），全程以 GitHub Issue 為單一資料源。

## 輸入判讀

- `$ARGUMENTS` 為純數字 → 既有 Issue：`gh issue view <N> --repo YozoraRoy/vestential --comments` 讀現況，接續未完成階段。
- 其餘文字 → 功能描述：先委派 `pm` 開規格 Issue（含 `status/spec` label），拿回 `#<N>`。

## 階段（依序執行）

1. **P0 規格（pm）**：委派 `task(subagent_type="pm")`（傳 issue# 或功能描述）→ 確保證 Issue body 含 `## ACCEPTANCE` 清單。
2. **P1 實作（developer）**：委派 `task(subagent_type="developer")`（傳 issue#）→ 收回完成度自評（typecheck/lint/build + ACCEPTANCE 勾選）。
3. **P2 驗收（qa-verifier）**：先完成下文 `## QA 派單 SOP（防卡死）` 的 port
   檢查＋起好單一台＋確認 Ready，再委派 `task(subagent_type="qa-verifier")`
   （傳 issue#，`REALM=local`）→ 收回 PASS/FAIL matrix。
   - 出現 FAIL → `gh issue edit <N> --add-label status/needs-fix` → 回到 P1 修 → 重 P2，**直到全 PASS**。
   - QA 超時／失聯 → 走 `## 降級驗收`，不得無限等待。
4. **P3 自動上線**（本 agent 親自做）：
   - `gh issue edit <N> --add-label status/qa-pass --remove-label status/needs-fix`
   - 檢查 `git status`／`git diff`，只 stage 本次功能相關檔案；commit message 以 repo 現行風格描述並含 `Closes #<N>`；`git push origin main`（將觸發 `.github/workflows/deploy.yml`）。
   - 觀測 GitHub 部署（`gh run list`／`gh run watch`），等成功或失敗判定。
5. **P4 生產驗證（qa-verifier）**：委派 `task(subagent_type="qa-verifier")`（傳 issue#，`REALM=production`）→ 驗生產環境。
   - 通過 → `gh issue edit <N> --add-label status/released` 並 `gh issue close <N> --reason completed`。
   - 未過 → 回 P1 修 → 重跑 P3/P4。

## 執行紀律

- 每一階段結束給出一行狀態（issue#、完成/卡住、產物）。
- QA 的 local smoke 需要 dev server 時，**預設由你（主 agent／observer）事先
  起好並確認 Ready 再派單**，QA prompt 預設寫明禁起 server（含 base URL）。
  只有 prompt 首行顯式授權「允許自起 server」的例外，QA 才可用
  `AGENTS.md` §4 detach 三要素起 server；**Ready／port 檢查／停機永遠由你負責**，
  不在 QA task 內輪詢長駐程式。
- curl/powershell 呼叫一律給顯式短 timeout（`curl --max-time 10`、
  `Invoke-WebRequest`／`Invoke-RestMethod -TimeoutSec 10～15`）；觀測 deploy
  時用 `gh` 而非輪詢網頁。
- 上游 agent 回報「待確認」而擋路 → 停下來向使用者提問，不要擅自改範圍。
- 全部完成後回報：`Closes #<N>`、QA matrix 摘要、deploy run 結果、生產驗證結果。

## QA 派單 SOP（防卡死 — Issue #13）

派 QA（P2 local smoke）前，主 agent 依序完成（細節見 `AGENTS.md` §1／§3／§4）：

1. **檢查 port**（`AGENTS.md` §1）：`Get-NetTCPConnection -LocalPort 3000,3001`
   確認狀態，有殘留先清（`Stop-Process -Id <pid> -Force`，隔 1~2 秒復查 port
   已釋放）。
2. **起好單一台**（`AGENTS.md` §3）：只起一台、確認 log 出現 `Ready` 且只有
   3000 在聽。
3. **派單 prompt 預設禁起 server**：在 QA prompt 內寫明「不要起 server，直接
   用 <base URL> 驗收」並給 base URL。僅在特殊情況（如主 agent 無法先起
   server）才走例外：**在 prompt 首行顯式授權**「允許自起 server（限
   `AGENTS.md` §4 detach 三要素，起完立即回傳 pid，禁輪詢 Ready）」。
4. **時間預算 25–30 分鐘**：QA task 設 25–30 分鐘預算；超時主 agent 可直接
   取消 task、重派。**重派前先清理殘留 server**（`Stop-Process`＋port 復查，
   見 `AGENTS.md` §1–§2），再回到步驟 1 重走。

### QA 派單留痕（監控：派了沒、有沒有回來）
- **派單當下**：主 agent 立刻在 Issue 貼一行 `QA dispatched（task id＋時間＋預算）`——沒有這行＝沒派，一查 Issue timeline 就知道。
- **QA 回來**：matrix comment 必須回應派單行（同一 task id）；有派單行、30 分鐘沒 matrix＝卡住／失聯，走超時處置。
- 主 agent 每階段的一行狀態必須含 task id 或 issue#comment，不寫自由發揮。

## 降級驗收（QA 超時／失聯時）

- QA 超時／失聯時，主 agent 不無限等待，改以**靜態驗收**即放行進入後續階段：
  `npm run typecheck` ＋ `npm run lint` ＋ ACCEPTANCE diff 核對（逐條確認實作
  diff 覆蓋 ACCEPTANCE 條目）。
- 所有 runtime 驗證項目一律標 **`UNVERIFIED` 並註明「降級驗收（靜態通過，
  runtime 未驗）」**，不得謊報 `PASS`；欠缺的 runtime 覆蓋留待下一個 QA
   （P4 生產驗證）補強。