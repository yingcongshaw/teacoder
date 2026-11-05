-- Schema v19: 开发环境改成通用的「一套环境 + 若干工具」
--
-- 旧表用固定列装 jdk/maven/node，扩到七种语言会变成十几个空列，
-- kind 上的 CHECK 限制也拦着新语言。改成：
--   dev_environments 一行 = 一套环境
--   dev_env_tools 一行 = 环境里的一件工具（版本 + 路径）
-- 旧表改名保留（projects 的外键还指着它），数据搬进新结构。

ALTER TABLE dev_environments RENAME TO dev_environments_legacy;

CREATE TABLE dev_environments (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dev_environments_kind ON dev_environments(kind);

CREATE TABLE dev_env_tools (
    id TEXT PRIMARY KEY,
    env_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    version TEXT,
    path TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (env_id) REFERENCES dev_environments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dev_env_tools_env ON dev_env_tools(env_id);

INSERT INTO dev_environments (id, kind, name, created_at, updated_at)
    SELECT id, kind, name, created_at, updated_at FROM dev_environments_legacy;

INSERT INTO dev_env_tools (id, env_id, tool, version, path, created_at, updated_at)
    SELECT id || '-jdk', id, 'jdk', jdk_version, jdk_path, created_at, updated_at
    FROM dev_environments_legacy WHERE jdk_version IS NOT NULL OR jdk_path IS NOT NULL;

INSERT INTO dev_env_tools (id, env_id, tool, version, path, created_at, updated_at)
    SELECT id || '-maven', id, 'maven', maven_version, maven_path, created_at, updated_at
    FROM dev_environments_legacy WHERE maven_version IS NOT NULL OR maven_path IS NOT NULL;

INSERT INTO dev_env_tools (id, env_id, tool, version, path, created_at, updated_at)
    SELECT id || '-node', id, 'node', node_version, node_path, created_at, updated_at
    FROM dev_environments_legacy WHERE node_version IS NOT NULL OR node_path IS NOT NULL;

-- 项目与环境的绑定改成通用表：一个项目可以同时绑 Java、Python 等多套环境。
CREATE TABLE project_dev_envs (
    project_id TEXT NOT NULL,
    env_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, env_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (env_id) REFERENCES dev_environments(id) ON DELETE CASCADE
);

INSERT INTO project_dev_envs (project_id, env_id, created_at, updated_at)
    SELECT id, java_env_id, created_at, updated_at FROM projects WHERE java_env_id IS NOT NULL;

INSERT INTO project_dev_envs (project_id, env_id, created_at, updated_at)
    SELECT id, node_env_id, created_at, updated_at FROM projects WHERE node_env_id IS NOT NULL;

-- 旧列 java_env_id / node_env_id 只在 v18 之前有意义，绑定关系已经搬进 project_dev_envs。
-- 按约定不删列（禁止 ALTER TABLE 删列），清空值避免别处读到过期的环境绑定。
UPDATE projects SET java_env_id = NULL, node_env_id = NULL;

-- 服务支持「先构建再运行」：C/C++ 这类要先编译出可执行文件才能跑。
ALTER TABLE services ADD COLUMN build_command TEXT;

INSERT INTO schema_version (version, applied_at) VALUES (19, strftime('%s','now') * 1000);
