-- v12: 为 llm_providers 添加 oauth_token 列
-- 与 api_key 一样 Base64 编码后存储，避免依赖系统 keychain（Linux 跨平台稳定性）

ALTER TABLE llm_providers ADD COLUMN oauth_token TEXT;

INSERT INTO schema_version (version, applied_at) VALUES (12, strftime('%s','now') * 1000);
