-- Schema v18: 服务定义
--
-- 服务是「一个项目里能跑起来的东西」：Spring Boot 模块、Node 脚本，或用户手工添加的命令。
-- 运行状态（pid / 启动时间）是运行时事实，不入库，放内存注册表。
-- fingerprint 用于「服务识别」的幂等：同项目下同一条命令只留一份。

CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    command TEXT NOT NULL,
    working_dir TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('detected', 'manual')),
    fingerprint TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_services_fingerprint
    ON services(project_id, fingerprint);

INSERT INTO schema_version (version, applied_at) VALUES (18, strftime('%s','now') * 1000);
