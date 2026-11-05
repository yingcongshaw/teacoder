-- Schema v17: 开发环境配置
--
-- 一条记录代表一套工具链。kind='java' 的记录填 jdk_* / maven_*，
-- kind='node' 的记录填 node_*；允许只填一半（自动识别会产出「仅 Maven」这类记录）。

CREATE TABLE IF NOT EXISTS dev_environments (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('java', 'node')),
    name TEXT NOT NULL,
    jdk_version TEXT,
    jdk_path TEXT,
    maven_version TEXT,
    maven_path TEXT,
    node_version TEXT,
    node_path TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dev_environments_kind ON dev_environments(kind);

-- 项目绑定两条环境：一条 Java 环境、一条 Node 环境。
-- 环境被删除时项目侧置空，不连带删项目。
ALTER TABLE projects ADD COLUMN java_env_id TEXT REFERENCES dev_environments(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN node_env_id TEXT REFERENCES dev_environments(id) ON DELETE SET NULL;

INSERT INTO schema_version (version, applied_at) VALUES (17, strftime('%s','now') * 1000);
