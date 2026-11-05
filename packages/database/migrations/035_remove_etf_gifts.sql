-- 035_remove_etf_gifts.sql
-- ETF / 債券 ETF / REITs / ETN 等非普通股標的不會召開股東會，亦絕不發放股東會紀念品。
-- 統一自 shareholder_gifts 與 historical_shareholder_gifts 既有表中徹底清理移除。
DELETE FROM shareholder_gifts
WHERE stock_id LIKE '00%'
   OR stock_id LIKE '01%'
   OR stock_id LIKE '02%'
   OR stock_name LIKE '%ETF%';

DELETE FROM historical_shareholder_gifts
WHERE stock_id LIKE '00%'
   OR stock_id LIKE '01%'
   OR stock_id LIKE '02%'
   OR stock_name LIKE '%ETF%';
