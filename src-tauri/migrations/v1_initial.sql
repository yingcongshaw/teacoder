-- Schema v1: 初始表结构

CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);

CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tool_type TEXT NOT NULL,
    auth_type TEXT NOT NULL,
    base_url TEXT,
    app_data_root TEXT,
    color TEXT,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE cli_tools (
    tool_type TEXT PRIMARY KEY,
    version TEXT,
    path TEXT,
    last_detected_at INTEGER NOT NULL,
    is_available INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE session_costs (
    session_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    tool_type TEXT NOT NULL,
    project_path TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    model TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    last_updated INTEGER NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE pricing_config (
    model TEXT PRIMARY KEY,
    input_price REAL NOT NULL,
    output_price REAL NOT NULL,
    cache_creation_price REAL NOT NULL,
    cache_read_price REAL NOT NULL,
    is_custom INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

INSERT INTO schema_version (version, applied_at) VALUES (1, strftime('%s','now') * 1000);
