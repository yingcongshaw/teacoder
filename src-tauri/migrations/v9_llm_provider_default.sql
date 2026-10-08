-- Schema v9: 为 llm_providers 表添加 is_default 列（全局默认供应商标记）

ALTER TABLE llm_providers ADD COLUMN is_default INTEGER DEFAULT 0;

-- 将现有的第一个预设供应商设为默认
UPDATE llm_providers SET is_default = 1 WHERE id = (
    SELECT id FROM llm_providers WHERE is_preset = 1 ORDER BY created_at ASC LIMIT 1
);

INSERT INTO schema_version (version, applied_at) VALUES (9, strftime('%s','now') * 1000);
