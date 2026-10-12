-- 030_social_cooldown.sql
-- Issue #62 IG 2207051 冷卻延後重打：social_posts 補冷卻排程欄位。
-- - next_retry_at：首次 deferred 時記「下一個 00 UTC edition」到期時刻（ISO UTC），
--   重打到期才由 00 UTC 執行撿起；重打再失敗（終態）清為 NULL，只剩人工 force。
-- - retry_count：deferred 記次（含首次＋重打），log/DB 可驗。
-- - first_error：保留首次 2207051 根因；error 欄記末次錯誤。
-- - status='deferred' 不需 DDL（TEXT 無 CHECK）；queued 語義由既有 pending 承接。
-- 語法沿 018/024 慣例（SQLite 與 T-SQL 皆相容：不加 COLUMN 關鍵字；
-- TEXT 語義同 NVARCHAR(MAX)，冪等可重跑，runner 遇到 duplicate column 即 skip）。
ALTER TABLE social_posts ADD next_retry_at NVARCHAR(50);
ALTER TABLE social_posts ADD retry_count INTEGER DEFAULT 0;
ALTER TABLE social_posts ADD first_error TEXT;
