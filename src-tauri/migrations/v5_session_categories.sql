-- Schema v5: 添加 session_categories 表

CREATE TABLE session_categories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- sessions 表添加 category_id 字段（NULL = 无分类，直接属于项目）
ALTER TABLE sessions ADD COLUMN category_id TEXT REFERENCES session_categories(id) ON DELETE SET NULL;

INSERT INTO schema_version (version, applied_at) VALUES (5, strftime('%s','now') * 1000);
