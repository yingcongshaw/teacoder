-- Schema v3: 添加 projects 和 sessions 表

CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    color TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT,
    tool_type TEXT NOT NULL,
    profile_id TEXT,
    color TEXT,
    thinking_intensity TEXT DEFAULT 'medium',
    template_id TEXT,
    cli_args TEXT,
    env_vars TEXT,
    is_running INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 从 session_costs 提取去重 project_path 生成 projects 记录
-- 跳过空值，name 暂用 project_path，后续应用层修正为路径最后一段
INSERT INTO projects (id, name, path, created_at, updated_at)
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
    project_path,
    project_path,
    strftime('%s','now') * 1000,
    strftime('%s','now') * 1000
FROM (
    SELECT DISTINCT project_path
    FROM session_costs
    WHERE project_path IS NOT NULL AND project_path != ''
);

INSERT INTO schema_version (version, applied_at) VALUES (3, strftime('%s','now') * 1000);
