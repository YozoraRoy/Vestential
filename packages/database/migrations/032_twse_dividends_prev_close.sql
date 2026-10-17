-- 032_twse_dividends_prev_close.sql
-- Issue #101：twse_dividends 增 prev_close（除息日昨收＝TWT49U「除權息前收盤價」第 4 欄，元/股）。
-- 用途：逐年已實現殖利率（該年每股現金合計 ÷ 該年最後一次除息日昨收）＝與 Yahoo
-- 「近 5 年平均現金殖利率」同義；缺值（TWT48U 預告列／權息列查無）為 NULL，UI 顯示「—」。
-- 冪等寫法沿 018/024/030 慣例（SQLite 與 T-SQL 皆相容的 ADD 欄；FLOAT 兩端皆 REAL 語義），
-- runner 遇 duplicate column（SQLite）／2705（T-SQL）即 skip → 重跑不壞：
--   SQLite 端另有 db.ts ensure 區塊 guarded ALTER 補建（既有庫）；
--   Azure SQL 端另有 db.ts IF COL_LENGTH('twse_dividends','prev_close') IS NULL ... ADD FLOAT。
ALTER TABLE twse_dividends ADD prev_close FLOAT;
