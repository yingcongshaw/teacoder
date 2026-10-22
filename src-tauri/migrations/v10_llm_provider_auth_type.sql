-- v10: 为 llm_providers 添加 auth_type 字段
-- 用于区分 API Key 认证和 OAuth 认证

ALTER TABLE llm_providers ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'api_key' CHECK (auth_type IN ('api_key', 'oauth'));

INSERT INTO schema_version (version, applied_at) VALUES (10, strftime('%s','now') * 1000);
