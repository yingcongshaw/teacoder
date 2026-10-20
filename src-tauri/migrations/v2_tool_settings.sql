-- Schema v2: Add tool-specific settings table

CREATE TABLE tool_settings (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    tool_type TEXT NOT NULL,
    -- Claude Code specific
    model TEXT,
    thinking_intensity TEXT DEFAULT 'medium',
    auto_submit INTEGER DEFAULT 0,
    custom_instructions TEXT,
    -- Generic tool settings (JSON for extensibility)
    settings_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

INSERT INTO schema_version (version, applied_at) VALUES (2, strftime('%s','now') * 1000);
