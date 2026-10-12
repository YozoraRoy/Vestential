-- 031_dca_plans.sql
-- Issue #69 零股存股試算所：計畫儲存獨立表 dca_plans（不混入 portfolio_records 真實持倉）。
-- 「計畫 vs 實際」對帳才乾淨；/portfolio 列表與損益零污染；訪客以 guest_uid 隔離
-- （沿 portfolio_records 訪客模式；user_id＝0 表訪客）。
-- 冪等多語系寫法：
-- SQLite 端由 db.ts ensure 區塊以 CREATE TABLE IF NOT EXISTS 補建（見既有慣例）；
-- Azure SQL 端由 db.ts per-table 獨立守衛補建；本檔供 migrate 追蹤（SQLite）使用。
CREATE TABLE IF NOT EXISTS dca_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 0,
  guest_uid TEXT,
  symbol TEXT NOT NULL,
  symbol_name TEXT,
  monthly_amount REAL NOT NULL,
  years INTEGER NOT NULL,
  dividend_mode TEXT NOT NULL DEFAULT 'reinvest',
  include_fees INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_dca_plans_user ON dca_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_dca_plans_guest ON dca_plans(guest_uid);
