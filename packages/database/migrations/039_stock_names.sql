-- 039_stock_names.sql
-- 全站統一股票多語系名稱主檔（Issue #190）。
-- 儲存 symbol（正規化去 .TW/.TWO 之代號）對應之繁中、英文、日文名稱與市場別，
-- 避免各頁零散查詢僅含部分標的之 odd_lot_trades / shareholder_gifts 導致 ETF 退回 Yahoo 英文名。
CREATE TABLE IF NOT EXISTS stock_names (
  symbol     TEXT PRIMARY KEY,
  name_zh    TEXT,
  name_en    TEXT,
  name_ja    TEXT,
  market     TEXT NOT NULL DEFAULT 'TW',
  source     TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_names_market ON stock_names(market);
