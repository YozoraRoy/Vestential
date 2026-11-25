-- 040_analysis_records_owner_soft_delete.sql
-- Issue #198：analysis_records 支援建立者歸因（user_id）與軟刪除（deleted_at / deleted_by）。
-- 冪等寫法：T-SQL 與 SQLite 雙端相容。
ALTER TABLE analysis_records ADD user_id INT NULL;
ALTER TABLE analysis_records ADD deleted_at NVARCHAR(40) NULL;
ALTER TABLE analysis_records ADD deleted_by INT NULL;
