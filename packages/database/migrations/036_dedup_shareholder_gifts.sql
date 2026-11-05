-- 036_dedup_shareholder_gifts.sql
-- 清理 shareholder_gifts 表中同一 stock_id 的重複冗餘記錄（當同一股票已有具體品名/日期/MOPS資料時，刪除其無效之等待或待公告列）。
DELETE FROM shareholder_gifts
WHERE (meeting_date = '等待' OR gift_name = '待公告' OR gift_name = '-' OR gift_name IS NULL)
  AND stock_id IN (
    SELECT stock_id FROM shareholder_gifts
    WHERE meeting_date != '等待' AND gift_name != '待公告' AND gift_name != '-' AND gift_name IS NOT NULL
  );
