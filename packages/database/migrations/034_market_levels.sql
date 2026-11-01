-- 034_market_levels.sql
-- Issue #74 大盤水位儀表板：加權指數 PER/PBR/殖利率歷史分位與水位燈號表。
-- trade_date 主鍵（'YYYY-MM-DD'），保證每日排程冪等（重複寫入為 upsert，不長重複列）。
-- level_status 五段燈號：'extreme_cold' | 'cold' | 'fair' | 'warm' | 'overheated'。
-- 語法相容 SQLite 與 Azure SQL（T-SQL）。
CREATE TABLE IF NOT EXISTS market_levels (
  trade_date           TEXT PRIMARY KEY,
  taiex                REAL,
  pe_ratio             REAL,
  pb_ratio             REAL,
  dividend_yield       REAL,
  pe_percentile        REAL,
  pb_percentile        REAL,
  composite_percentile REAL,
  level_status         TEXT,
  updated_at           TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_market_levels_trade_date ON market_levels(trade_date DESC);
