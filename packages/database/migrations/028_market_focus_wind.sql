-- 028_market_focus_wind.sql
-- Issue #49 川普風向燈：新表 market_focus_wind（direction / note / related_urls / generated_at）。
-- 只新增表，不動現有表（market_focus / market_focus_meta 皆不碰）。
-- 冪等多語系寫法：
-- SQLite 端由 db.ts ensure 區塊以 CREATE TABLE IF NOT EXISTS 補建（見既有慣例）；
-- Azure SQL 端由 db.ts per-table 獨立守衛補建；本檔供 migrate 追蹤（SQLite）使用。
CREATE TABLE IF NOT EXISTS market_focus_wind (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL DEFAULT 'none',
  note TEXT,
  related_urls TEXT,
  generated_at TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_market_focus_wind_generated ON market_focus_wind(generated_at);
