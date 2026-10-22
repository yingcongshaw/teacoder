-- Schema v14: session_messages 表添加敏感标记字段
-- 用于标记用户消息里的密码/PIN/passphrase 等敏感内容,前端已记录的、未及拦截的,
-- 或被命中抑制的衍生残条。
-- 0 = 普通,1 = 敏感。后端 UI 渲染时按 is_sensitive 决定原文/脱敏显示。

ALTER TABLE session_messages ADD COLUMN is_sensitive INTEGER NOT NULL DEFAULT 0;

INSERT INTO schema_version (version, applied_at) VALUES (14, strftime('%s','now') * 1000);
