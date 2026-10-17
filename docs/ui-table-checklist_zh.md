[English](./ui-table-checklist.md) ｜ **繁體中文**

# UI 表格檢查清單（Issue #75 SOP）

新增／改動任何表格（前台＋後台＋信件榜單）時，逐項勾選。違反任一項即退回。

## 1. 排序
- 可排序欄用 `<th aria-sort>`＋內嵌 `<button>`（範例：`app/chip-radar/page.tsx` `SortTh`）。
- 當前欄 `aria-sort="ascending|descending"`，其餘 `"none"`；表頭有 ▲▼ 指示（作用中高亮）。
- 預設順序＝資料源順序（chip：佔比↓＝引擎 `ratioPct desc`＝API＝信件；穩定排序，重新整理不亂跳）。**例外**：cycle-entry 列表預設勝率↓（Issue #82 使用者指定；表頭按鈕可切換，null 沉底）——此例外不得擴散，新表仍以資料源順序為預設。
- 排序只重排主列；展開列（colSpan 明細）不受影響。
- 手機 360px：表格包 `overflow-x-auto`＋`min-w`，不橫向溢出到頁面。

## 2. 字級（全站統一）
- 表頭列：`text-sm font-semibold`；內文（table 層級）：`text-[13px]`；數字欄保留 `tabular-nums`。
- **不要手寫 class**：一律經 `lib/table-typography.ts` 的 `tableClass(typo, extra[, v1])`／`headTrClass(typo, extra[, v1])`＋`useTableTypography()` 取值，v1/v2 分支只收斂在該檔。
- 舊字級還原（後台切 v1 用）：預設表 `text-sm`／表頭 `text-xs`；特例表傳第三參數（portfolio 辨識表 `text-xs`、backtest 嵌表 `text-xs`、ex-dividend 明細表 `text-[11px]`、原無字級的 thead tr 傳 `''`）。
- 後台開關：`agent_settings: ui.table_typography`（v2 預設／v1 舊制），`後台 Agent 設定 → 介面顯示` 可調；前台經公開端點 `GET /api/ui-config` 讀取，下次載入即生效、免改碼。
- `risk-panel` 無 thead 略過；其他 18 表（admin×6、backtest 主＋嵌、portfolio 主＋辨識、arena-view×2、analysis-card、cycle modal、cycle view、odd-lot-view、chip、ex-dividend 明細）皆已接線。

## 3. Loading
- 禁裸「載入中…」：一律用共用 `components/table-skeleton.tsx`（spinner＋5 列 pulse，沿 `odd-lot/loading.tsx` 視覺），`aria-busy`＋`aria-live="polite"`。
- 不得各頁自寫 skeleton（有新需求先擴充共用元件）。

## 4. 信站一致（榜單類）
- 信內四要素缺一不可：門檻行（後台值，如連買／賣天數＋佔比％）／「依佔比排序」註／前 20 截斷註明／快照聲明「寄送時快照（asOf），若已隔日重算以網站即時為準」。
- 站上頁首資料時間文案與信對齊（chip：`資料時間：X（盤後初值；上市；未含融資）`）。
- 趨勢軸僅站上有 → 站上須註明「信內無，點列展開」類語意；信內不畫趨勢軸。

## 5. 佔位欄禁令
- 全同值佔位欄（如「未含融資」）**禁止成欄**：刪 th／td、修 colSpan、說明放註腳；API 欄位保留給第二期（如 `margin_available`、`marginNote`）不動。
- 第二期接源前，`diverge` 永 false 不得掛標籤。

## 6. 免責四件套（榜單／統計頁頁尾＋信尾）
1. 統計方法（一行：資料源＋公式，如法人＝外資合計＋投信；佔比＝|淨超×收盤|／成交額）。
2. 「統計訊號非投資建議」。
3. 覆蓋範圍（上市為主；上櫃／自營商／融資券未含要明說）。
4. 服務條款連結（站上連 `/terms`，信內附完整 URL＋退訂）。
