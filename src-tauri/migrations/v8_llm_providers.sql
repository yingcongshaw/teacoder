-- Schema v8: 引入 LLM 供应商系统

CREATE TABLE llm_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_kind TEXT NOT NULL,
    base_url TEXT,
    icon TEXT,
    color TEXT,
    is_preset INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE llm_provider_models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (provider_id) REFERENCES llm_providers(id) ON DELETE CASCADE
);

CREATE INDEX idx_llm_provider_models_provider
    ON llm_provider_models(provider_id, sort_order);

ALTER TABLE sessions ADD COLUMN llm_provider_id TEXT;
ALTER TABLE sessions ADD COLUMN model_name TEXT;

INSERT INTO schema_version (version, applied_at) VALUES (8, strftime('%s','now') * 1000);
