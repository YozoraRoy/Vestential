# 系統架構與技術手冊

本文件說明 Vestential 的 Monorepo 結構、12-Agent AI 協作引擎、雙層 LLM 備援與雙資料庫持久化機制。

---

## 1. 系統架構總覽

```mermaid
flowchart TB
    User["🌐 使用者瀏覽器<br/>(支援 zh-TW / en / ja)"]

    subgraph Actions["排程與維運 (GitHub Actions)"]
        Cron_MF["sync-market-focus<br/>每 6 小時抓取多來源新聞"]
        Cron_ODD["sync-oddlot<br/>每工作日 15:10 同步零股"]
        Cron_Health["health-report<br/>健康檢查與自動修復"]
        Cron_ARENA["arena-tick + in-process<br/>競技場五階段"]
        Cron_SOCIAL["check-social-tokens<br/>每日 03:30 檢查社群憑證"]
    end

    subgraph Web["核心應用 (Next.js 15 App Router)"]
        MW["Middleware (多語系路由 / Cookie)"]
        Pages["展示層 (/analyze /portfolio /backtest /cycle-entry /odd-lot<br/>/market-focus /agent-arena /admin /stock)"]
        API["API 路由 (OAuth / SSE 串流 / Refresh / Health / Social / Arena)"]
    end

    subgraph CoreEngine["多代理人與模型層"]
        AgentEngine["12-Agent AI 分析引擎<br/>(@stock/ai-engine)"]
        Guard["0.3 秒無效代號熔斷門禁"]
        LLM_Primary["Primary (Google Gemini)"]
        LLM_Fallback["Fallback tier1 (Groq 新 key)"]
        LLM_Fallback2["Fallback tier2 (Groq 舊 key)"]
    end

    subgraph DataLayer["資料與外部服務"]
        DB[("持久化資料庫<br/>Azure SQL Server / SQLite (NFS)")]
        TWSE["TWSE 官方 OpenAPI (TWT53U / t187ap41_L)"]
        NewsSources["財經媒體池 (鉅亨 / 經濟日報 / Yahoo / Google News RSS)"]
        Mail["SMTP 郵件伺服器 (Gmail / 自訂信箱)"]
    end

    User --> MW --> Pages
    Pages --> API
    API --> AgentEngine
    AgentEngine --> Guard
        Guard --> LLM_Primary
        LLM_Primary -.->|連線失敗/限流時自動切換| LLM_Fallback
        LLM_Fallback -.->|仍失敗時切換| LLM_Fallback2
    API --> DB
    Cron_MF -->|Bearer SYNC_TOKEN| API
    Cron_ODD -->|Bearer SYNC_TOKEN| API
    Cron_Health -->|自動修復端點| API
    API --> TWSE
    API --> NewsSources
    API --> Mail
```

---

## 2. Monorepo 工作區分工

專案採用 npm workspaces 架構管理：

| 套件 / 目錄 | 職責說明 |
| :--- | :--- |
| **`apps/web`** | Next.js 15 現代化 Web 前端，採用 App Router、Tailwind CSS 與 Server Actions。 |
| **`packages/ai-engine`** | 12 個專業分析代理人、Prompt 模板、0.3 秒無效標的門禁機制與投資法則引擎。 |
| **`packages/backtest`** | 60 日均線乖離率回測演算法、勝率計算與歷史回測資料快取。 |
| **`packages/cycle-entry`** | 週期進場回測引擎（`rules.ts`／`runSignalBacktest`），供 `/cycle-entry` 與後台使用。 |
| **`packages/database`** | 雙資料庫抽象層（SQLite / Azure SQL）、遷移指令碼與批次同步排程。 |
| **`packages/market-data`** | Yahoo Finance 報表擷取、TWSE 盤後數據清洗與歷史價量快取。 |
| **`packages/core`** | 全域型別定義、設定常數與自訂例外錯誤類別。 |

---

## 3. 12-Agent AI 協作引擎（`/analyze` 僅支援台股）

進入 `/analyze` 進行深度分析時，系統循序啟動 12 個分工代理人，各司其職：

1. **Market Technical Analyst（技術面分析師）**：計算均線多空排列、KD/RSI 動能與關鍵支撐壓力。
2. **Sentiment Analyst（市場情緒分析師）**：分析社群討論熱度與散戶恐慌/貪婪指標。
3. **News & Macro Analyst（總經與新聞分析師）**：爬梳重大新聞要聞與央行貨幣政策影響。
4. **Fundamentals Analyst（基本面分析師）**：檢視三大財務報表、毛利率、自由現金流與估值位階。
5. **Bull Researcher（多方觀點辯論員）**：挖掘潛在利多題材與獲利爆發點。
6. **Bear Researcher（空方觀點辯論員）**：挖掘潛在利空風險與下行觸發點，與多方進行一輪辯論。
7. **Research Manager（研究主管）**：整合多空觀點，裁定最終評級（買進 / 續抱 / 賣出）。
8. **Trader（交易員）**：制定具體的進場買點、分批加碼點與停損停利價格（schema 欄位多為選填，缺欄不擋主流程）。
9. **Aggressive Analyst（積極風險辯論員）**：風險三方之一，從高風險偏好角度挑戰交易提案。
10. **Conservative Analyst（保守風險辯論員）**：風險三方之一，從低風險偏好角度挑戰交易提案。
11. **Neutral Analyst（中立風險辯論員）**：風險三方之一，從中立角度綜合攻守再平衡。
12. **Portfolio Manager（投資組合經理）**：從整體資產配置與風險分散角度給予最終配置比例。

> **模型分組（engine 實測）**：Bull／Bear／Trader／風險三方（Aggressive／Conservative／Neutral）走 quickLLM；Research Manager／Portfolio Manager 走 deepLLM；其餘分析師（Market／Sentiment／News／Fundamentals）走 quickLLM。

> **0.3 秒無效代號熔斷門禁 (Early-Exit Guard)**：
> 在耗費 LLM 額度之前，系統先於記憶體高速驗證股票代號真實性。若輸入不存在代碼，立即在 0.3 秒內回傳錯誤並提示修正，避免浪費使用者的等待時間與每日配額。
>
> **台股限定門禁（`/analyze` 不支援美股）**：
> `/analyze` 僅接受台股代號（純數字 4~6 碼，可附 `.TW`／`.TWO`，大小寫皆可）。
> 前台先做即時格式驗證（不符不發 API）；`/api/analyze` 後端再做格式驗證（不符回 400，不扣 quota、不建 job）；
> 權證／牛熊證以後端 Yahoo `quoteType` 為準（僅 `EQUITY`／`ETF` 放行，其餘擋，判定在 quota 扣除前）。
> 後端 market-data／ai-engine 的 Yahoo US 讀取能力保留（共用元件，`/portfolio` 仍維持台美雙市場）。

---

## 4. 三層 LLM 備援機制 (Primary / Fallback / Fallback2)

為避免單一模型供應商發生 Rate Limit（429）、逾時或額度耗盡，系統內建**三層熱備援**（`FallbackClient`，熔斷冷卻：一般 60 秒／確定性壞 10 分鐘，冷卻結束自動重探切回）。

### 生產現況鏈（deploy.yml 硬編，2026-09-23 起）
- **主**：`google`（`gemini-2.5-flash`，`GOOGLE_GENERATIVE_AI_API_KEY`，支援逗號多 key 輪替）。
- **備援一**：`openai` 相容（`qwen/qwen3.8-27b` 走 Groq，用 `FALLBACK_*_API_KEY` 新 key）。
- **備援二**：同模型走 Groq，用 `FALLBACK2_*_API_KEY` 舊 key。
- 建鏈時自動檢查同池（`checkFallbackPoolDiversity`，同 model＋同 key 會警告）；主備曾因同 key 同池導致 2026-09-23 早盤 OTPM 連爆（見 `docs/deployment-and-ops.md` §5 Q4），後以新 key 分池解決。

### 模型分組與切換標記（保留）
- **Deep 組（重推理深度決策）**：負責 Research Manager 與 Portfolio Manager。
- **Quick 組（快速數據與情緒摘要）**：負責 Technical、Sentiment、News、Fundamentals、Bull Researcher 與 Trader。
- 切換後自動於分析報告末端標記 `⚠️ 本回覆已自動切換至備援模型：{model}`，並將各 Agent 實際使用的模型名稱與 Token 數精準記錄於資料庫（`llm_usage_logs`，後台用量儀表板見 Issue-B 規劃）。

### Groq OTPM 教訓與錯峰機制
- Groq qwen tier 的 OTPM（每分鐘輸出 token）硬上限 **1000**，按「已用＋本次請求」擋；refresh 整鏈各呼叫掛 max_tokens≈1000，越後面越易爆。`FALLBACK_SAFE_MAX_TOKENS = 1000` 是單次請求上限，不是安全水位。
- 對策（不動靜態參數、不花錢）：pipeline 並發 LLM 改序列＋間隔（尤其總覽前後）；429 退避加 jitter＋縮小 budget 重試（執行期自適應，見 `llm/budget.ts`）；`market_focus.summary_max_tokens` 生產值曾被設 1000（code 預設 450），改參數前先看 OTPM。

---

## 5. 雙資料庫相容與數據持久化 (Data Persistence)

本平台同時支援輕量級本機開發與高可用雲端環境：

- **本機開發與輕量佈署**：使用 SQLite（資料庫檔案預設位於 `stock.db` 或 Azure 永久儲存區 `/home/data/stock.db`）。
- **正式雲端生產環境**：設定 `DATABASE_URL` 後自動啟用 Azure SQL Server 連線池。生產庫為 `stockdb`（Server `sql-stock-platform`，**Basic / 5 DTU / 2 GB**）；用量監控與容量排錯見 `docs/deployment-and-ops.md` §4 Q3。
- **防抹除保護 (Data Loss Prevention)**：所有資料表均透過 SQL 遷移檔案管理（`packages/database/migrations`），啟動時採 `IF NOT EXISTS` 或 `ALTER` 增量升級，絕不重置或清空已存在的用戶持股紀錄與分析歷史。

---

## 6. 國際化多語系與 SEO

- **Next.js 15 Middleware 路由**：全面支援 **繁體中文 (`zh-TW`)**、**英文 (`en`)** 與 **日文 (`ja`)**。透過 Cookie 與 Accept-Language 自動判定偏好，並保持無跳轉切換。
- **動態 Sitemap 與中繼資料**：動態產生 `sitemap.xml` 與 `robots.txt`，對外宣示所有語系的 canonical 與 alternate 連結，符合現代搜尋引擎最佳化標準。

---

## 7. 2026-09 新增模組（概要）

以下模組於 2026-09 陸續上線，細節與操作規範見 `docs/features-guide.md` §6~§8：

### 7.1 AI 競技場 (`/agent-arena`)
- 4 隻固定角色 agent 每日依台灣時間五階段角逐票選：premarket 09:00（briefing）→ slot 0~3（09:35/10:35/11:35/13:05 決策）→ 15:30（discussion + 裁決 + 排行榜）。
- 主要時鐘為 **in-process** 的 `apps/web/src/lib/arena-scheduler.ts`（`ARENA_CRON_ENABLED=true`），GH Actions `arena-tick.yml` 為備援。
- 股票池：動態市值**前 200**＋ETF 池（`DEFAULT_ARENA_ETF_UNIVERSE`，`ARENA_ETF_UNIVERSE` 可代換）；失敗兜底 `DEFAULT_ARENA_UNIVERSE`。
- 新 agent 起始資金 **NT$500,000**（#27 起全體補足 50 萬，既有已追溯）；後台可覆寫滑價等參數（預設 `0.003`）。
- 資料表：`arena_agents`、`arena_rounds`、`arena_agent_actions`、`arena_round_summaries`、`arena_intraday_prices`、`arena_decision_logs`、`arena_market_briefings`、`arena_discussions`。

### 7.2 社群小編（IG / Threads / FB）
- 每日盤後自動生成三平台文案＋圖卡，經去重與 `hasNewEdition` 門檻後自動發文。
- 圖卡三種風格（`ai` / `classic` / `meme`），**預設 `ai`（AI 吉祥物全圖卡）**；後台可乾跑預覽。
- 發布邏輯在 `apps/web/src/lib/social-trigger.ts`＋`social-publish.ts`；憑證與換發維運見 `docs/deployment-and-ops.md` §5。
- 節慶小編（獨立日期表＋節日 08:00 全自動＋站內當日橫幅）與首回覆問 Meta AI（自回覆＋IG 第二則留言，台灣未開放故預設 editor 降級版）見 `docs/features-guide.md` §8.2。

### 7.3 週期進場 (`/cycle-entry`)
- 以季線乖離演算法為基礎的週期進場模型掃描，`sync-cycle-entry.yml` 每個交易日 16:00 更新；計算引擎在 `packages/cycle-entry`。

### 7.4 後台管理 (`/admin`)
- 獨立管理後台（`admin/layout.tsx` 守衛＋側欄），8 個子頁：總覽、市場焦點、週期進場、社群小編、競技場、使用量、設定、訂閱者。
- 守衛邏輯為 `lib/auth.ts` 的 `isAdminUser`（`ADMIN_LINE_USER_IDS` / `ADMIN_EMAILS` 判定）。

### 7.5 交易策略閉環＋風險＋日誌（2026-09 下旬）
- 策略閉環：點子一鍵回測、新聞影響結構化、回測 AI 解讀（數字引擎注入禁自創）、Trader 結構化；quota 不新增。
- 組合風險：集中度＋三情境＋AI 總結（共用 quota）；交易日誌 `/journal`：CRUD＋月統計＋AI 覆盤。
- 持股紀錄卡片｜表格雙檢視（桌機預設表格）；試算頁含稅費淨損益並列。細節見 `docs/features-guide.md` §1、§3~§4、§9。
