-- Schema v6: 添加 session_messages 表存储用户消息历史
CREATE TABLE session_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    content TEXT NOT NULL,
    line_index INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_session_messages_session_id ON session_messages(session_id);
CREATE INDEX idx_session_messages_created_at ON session_messages(created_at);

INSERT INTO schema_version (version, applied_at) VALUES (6, strftime('%s','now') * 1000);
