-- 037_llm_usage_project.sql
-- 擴充 llm_usage_logs 表：增加 project 所屬專案、cost_twd 預估花費與 execution_ms 執行耗時
-- 支援跨專案（TravelPlan / Vestential / VM System）統一中控用量歸因。
-- 冪等寫法：T-SQL 與 SQLite 雙端相容。
ALTER TABLE llm_usage_logs ADD project NVARCHAR(50) DEFAULT 'vestential';
ALTER TABLE llm_usage_logs ADD cost_twd FLOAT DEFAULT 0.0;
ALTER TABLE llm_usage_logs ADD execution_ms INTEGER DEFAULT 0;
