-- v11: 为 llm_providers 添加 api_key 列
-- 注意：此列从未在 v8 创建，需要补充

ALTER TABLE llm_providers ADD COLUMN api_key TEXT;

INSERT INTO schema_version (version, applied_at) VALUES (11, strftime('%s','now') * 1000);
