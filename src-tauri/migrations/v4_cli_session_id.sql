-- Schema v4: sessions 表添加 cli_session_id 列
-- 存储 CLI 工具的内部 session ID（如 Claude Code 的 UUID），用于 --resume 精确恢复会话

ALTER TABLE sessions ADD COLUMN cli_session_id TEXT;

INSERT INTO schema_version (version, applied_at) VALUES (4, strftime('%s','now') * 1000);
