# AI 工作流實際成本評估（Cost Estimation）

> 價格基準日：2026-10-03（Zen 公開價格表口徑；直接通路同價時不再另列）。
> 幣別 USD／月，台幣以 **1 USD ≈ NT$32** 換算（2026-10-03 銀行即期中間價約 31.85，取整；僅供體感，實際以帳單匯率為準）。
> 除特別註明，token 數為「單次執行」。
> 下次更新觸發：模型調價、Gemini 優惠到期（2026-12-31）、匯率大幅波動、用量級距變化、arena 校準完成。

## 1. 模型價格（opencode 優先）

「opencode 優先」指**走 OpenCode Zen 通路計價**：零加價（at cost，只收刷卡手續費
4.4%＋$0.30／筆，$20 起充，餘額低於 $5 自動加值 $20，可設月上限）。

| 模型 | in／1M | out／1M | 備註 |
|---|---|---|---|
| Big Pickle（Zen 免費） | $0 | $0 | **現況 primary，全站今天實際 $0**；免費 tier 無 SLA，dev 見過 `free tier can only be used from within OpenCode` 403 |
| Claude Sonnet 4.6 | $3 | $15 | 最貴，品質最高；Batch 半價、cache read $0.30（本評估未計入，屬樂觀上限） |
| OpenAI GPT 6.1 Sol | $2 | $10 | ≤272K tokens；超量 $4／$15 |
| Gemini 3.8 Flash | $1.50／$7.50 | 標準價；**優惠價 $0.75／$3.75 只到 2026-12-31，2027 翻倍**，跨年預算用標準價 |

## 2. 各工作流單次用量

等級：**實測**（真機跑過）／**預算**（程式 maxTokens cap 推導）／**粗估**（待校準）。

| 工作流 | in | out | 等級／來源 | 頻率 |
|---|---|---|---|---|
| `/analyze` 一輪（12 節點） | ~20k | ~10k | 實測：#52 真機 2330（4 分析師 in 1656–1756、out 441–1440；Bull／Bear／Trader＋2 deep 外推，±30%） | 用戶觸發（quota：一般 1／天、管理員 3／天） |
| market-focus 一版 | ~20k | ~6k | 預算：filter（cap 1000）＋摘要 ≤6 批×340＋總覽 550 | cron 4 次／天，但有新版閘門，日均約 2 版 |
| arena 一日（平日） | ~70k | ~20k | 粗估：6 slot（簡報 900＋策略師×4＋旁白）＋close 圓桌；**待 §5 校準** | 週一至週五 |
| 社群日更（三平台＋首回覆） | ~6k | ~3k | 預算 | 每日 |
| 電子報 | ~0 | ~0 | 重用總覽，LLM ≈ 0 | 每日一封 |
| 截圖辨識 | vision 另計 | — | 量小（10／天／人），本表不計 | 用戶觸發 |
| cycle-entry／review 類 | 小 | 小 | 預算（200–1200 cap），併零頭 | 排程／用戶觸發 |

單次 `/analyze` 成本：Sonnet **$0.21（約 NT$7）**／Sol $0.14（約 NT$4）／G38 $0.105（約 NT$3，優惠 $0.053）／Pickle $0。

## 3. 月成本試算（三情境，用戶觸發以 /analyze 輪數計，30 天月）

固定排程（market-focus＋arena＋社群）已攤入。

| 情境 | Sonnet 4.6 | GPT 6.1 Sol | Gemini 3.8（優惠價） | Big Pickle |
|---|---|---|---|---|
| 輕（5 輪／天） | ~$55（約 NT$1,760） | ~$36（約 NT$1,150） | ~$27（約 NT$860；優惠 ~$14／約 NT$450） | $0 |
| 中（30 輪／天） | ~$212（約 NT$6,800） | ~$141（約 NT$4,500） | ~$106（約 NT$3,400；優惠 ~$53／約 NT$1,700） | $0 |
| 重（100 輪／天） | ~$653（約 NT$20,900） | ~$435（約 NT$13,900） | ~$326（約 NT$10,400；優惠 ~$168／約 NT$5,400） | $0 |

## 4. 建議：混合配置（重點）

全切 Sonnet 是最貴的答案。引擎 deep／quick 雙鏈已分開（`engine.ts`），換模型只是改 env：

- **quick 10 節點用免費／便宜模型，deep 2 節點（Research／Portfolio Manager）用 Sonnet**
- 輕量情境月成本：$55 → **~$10（約 NT$320）**（單輪 deep 成本 in 7k／out 3k ≈ $0.066／約 NT$2），品質花在刀口上

## 5. 隱藏成本與風險

- **Fallback 爆發 ×2**：429 潮時 primary＋備援兩層都計費（皆成功取數），月結可能比上表高一倍。
- **重試與 backfill**：退避重打、缺文回填（每次 ≤20 則）零星增加，不列主表。
- **Big Pickle 可用性**：免費無 SLA；掛掉時備援鏈接手，屆時按備援模型計費。
- **Gemini 時鐘風險**：2027-01-01 起 $1.50／$7.50，年度預算用標準價。
- **arena 粗估待校準**：用下方 SQL 對一次 `llm_usage_logs` 即轉實測。

## 6. 校準方法（附錄）

生產（或本地）DB 直接跑：

```sql
-- 各 agent 實測平均 token（校準 §2 用）
SELECT agent, model, COUNT(*) AS n,
  ROUND(AVG(promptTokens)) AS avg_in,
  ROUND(AVG(completionTokens)) AS avg_out,
  SUM(totalTokens) AS total
FROM llm_usage_logs
GROUP BY agent, model ORDER BY total DESC;
```

```sql
-- 過去 30 天總 token（對月結帳單）
SELECT SUM(promptTokens) AS in_30d, SUM(completionTokens) AS out_30d,
  SUM(totalTokens) AS total_30d FROM llm_usage_logs
WHERE created_at >= date('now', '-30 days');
```

後台用量儀表板（Issue #45：日報表＋OTPM 視角）可交叉核對；OTPM 配額（Groq 1000）是**速率**上限不是費用上限，別跟本表搞混。
