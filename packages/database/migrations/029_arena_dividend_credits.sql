-- 029_arena_dividend_credits.sql
-- Issue #54：競技場現金股利入帳去重表（close 結算冪等守衛）。
-- 一位 agent 同一檔、同一除息日只發一次：UNIQUE(agent_id, symbol, ex_date)。
-- 冪等多語系寫法：
-- SQLite 端由 db.ts ensure 區塊以 CREATE TABLE IF NOT EXISTS 補建（見既有慣例）；
-- Azure SQL 端由 db.ts per-table 獨立守衛補建；本檔供 migrate 追蹤（SQLite）使用。
-- 語法沿 026 慣例（SQLite 與 T-SQL 皆相容；TEXT 語義同 NVARCHAR；UNIQUE 防重發冪等）。
CREATE TABLE IF NOT EXISTS arena_dividend_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  ex_date TEXT NOT NULL,
  shares REAL NOT NULL,
  amount REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  UNIQUE (agent_id, symbol, ex_date)
);
CREATE INDEX IF NOT EXISTS idx_arena_dividend_credits_agent ON arena_dividend_credits(agent_id);
CREATE INDEX IF NOT EXISTS idx_arena_dividend_credits_symbol_ex ON arena_dividend_credits(symbol, ex_date);
