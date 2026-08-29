-- Schema v7: 添加 app_settings 表用于存储应用级设置

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

INSERT INTO schema_version (version, applied_at) VALUES (7, strftime('%s','now') * 1000);
