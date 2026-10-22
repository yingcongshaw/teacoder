-- Schema v13: sessions 表添加 Claude 模型 tier 映射字段
-- claude_models 存 JSON：{ "sonnet": "<model>", "opus": "<model>", "haiku": "<model>",
--                          "fable": "<model>", "subagent": "<model>", "*1M": true }
-- 由前端 serializeClaudeModels() 产出，pty 启动时经 compute_claude_tier_env()
-- 转成 ANTHROPIC_DEFAULT_*_MODEL[_NAME] / ANTHROPIC_MODEL / CLAUDE_CODE_SUBAGENT_MODEL。
-- 只在 1M 标记为 true 时才写入该键。

ALTER TABLE sessions ADD COLUMN claude_models TEXT;

INSERT INTO schema_version (version, applied_at) VALUES (13, strftime('%s','now') * 1000);