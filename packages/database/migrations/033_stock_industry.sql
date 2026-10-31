-- 033_stock_industry.sql
-- Issue #121 零股頁「板塊」篩選：TWSE 官方產業別（openapi t187ap03_L）落地表。
-- 一檔股票一列（stock_id 主鍵 ⇒ 重複同步為 upsert，不會長重複列）；
-- industry_code 為證交所產業別代碼（2 碼，如 24），industry_name 為官方中文名
-- （如「半導體業」）；ETF／債券 ETF／存託憑證等非公司代號以 industry_name 存
-- 「ETF」「債券 ETF」「存託憑證」，未歸類者為 NULL（前端顯示「—」）。
-- market 目前固定 'TWSE'（來源僅上市），updated_at 為同步時的 ISO 時間字串。
-- 冪等多語系寫法（沿 031 慣例）：
-- SQLite 端由 db.ts ensure 區塊以 CREATE TABLE IF NOT EXISTS 補建；
-- Azure SQL 端由 db.ts per-table 獨立守衛補建；本檔供 migrate 追蹤使用。
CREATE TABLE IF NOT EXISTS stock_industry (
  stock_id TEXT PRIMARY KEY,
  industry_code TEXT,
  industry_name TEXT,
  market TEXT,
  updated_at TEXT
);
