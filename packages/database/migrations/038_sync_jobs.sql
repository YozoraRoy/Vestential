-- 038_sync_jobs.sql
-- 通用「排程背景 job」狀態表（Issue #146）。
-- cycle-entry / market-focus 的背景 job 原本只存在 Node process 記憶體，
-- Azure App Service 重啟或平台搬移 worker 後 job 憑空消失，呼叫端輪詢 status
-- 只會拿到 404 並盲等到 timeout（Issue #144）。
-- 改存 DB：執行中的 job 每 60 秒刷新 updated_at 當心跳，超過門檻即判定
-- 「執行實例已回收」，status 端點回終態 failed 並附原因。
-- Azure SQL 由 getAzurePool() 建表（本檔為 SQLite/migrate 追蹤，且冪等可重跑）。
CREATE TABLE IF NOT EXISTS sync_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type    TEXT    NOT NULL,                      -- cycle-entry | market-focus
  kind        TEXT    NOT NULL,                      -- refresh | dry | publish
  status      TEXT    NOT NULL DEFAULT 'running',    -- running | done | failed
  stage       TEXT,                                  -- pipeline:fetch / backfill / social ...
  count       INTEGER,
  edition_key TEXT,                                  -- editionDate / editionKey
  error       TEXT,
  payload     TEXT,                                  -- JSON：乾跑結果／社群結果
  created_at  TEXT    DEFAULT (datetime('now')),
  updated_at  TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_type_status ON sync_jobs(job_type, status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_updated ON sync_jobs(updated_at);
