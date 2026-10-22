use serde::{Deserialize, Serialize};
use crate::storage::AppDatabase;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessage {
    pub id: String,
    pub session_id: String,
    pub content: String,
    pub line_index: i64,
    pub created_at: i64,
    pub is_sensitive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionMessageInput {
    pub session_id: String,
    pub content: String,
    pub line_index: i64,
}

fn row_to_message(row: &rusqlite::Row) -> Result<SessionMessage, rusqlite::Error> {
    Ok(SessionMessage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        content: row.get(2)?,
        line_index: row.get(3)?,
        created_at: row.get(4)?,
        // SQLite 没有原生 BOOL,以 INTEGER 0/1 存储,rusqlite 直接 get<bool>
        is_sensitive: row.get(5)?,
    })
}

pub fn list_session_messages(
    db: &AppDatabase,
    session_id: &str,
) -> Result<Vec<SessionMessage>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, session_id, content, line_index, created_at, is_sensitive FROM session_messages WHERE session_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([session_id], row_to_message)
        .map_err(|e| format!("Failed to query messages: {}", e))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect messages: {}", e))
}

pub fn create_session_message(
    db: &AppDatabase,
    input: CreateSessionMessageInput,
) -> Result<SessionMessage, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    // is_sensitive 走 DEFAULT 0 —— 新建消息默认为普通,后续由用户/匹配器决定。
    conn.execute(
        "INSERT INTO session_messages (id, session_id, content, line_index, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, input.session_id, input.content, input.line_index, now],
    )
    .map_err(|e| format!("Failed to insert message: {}", e))?;

    Ok(SessionMessage {
        id,
        session_id: input.session_id,
        content: input.content,
        line_index: input.line_index,
        created_at: now,
        is_sensitive: false,
    })
}

pub fn delete_session_messages(
    db: &AppDatabase,
    session_id: &str,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM session_messages WHERE session_id = ?1",
        [session_id],
    )
    .map_err(|e| format!("Failed to delete messages: {}", e))?;

    Ok(())
}

/// 标记/取消标记一条消息的敏感属性。
/// 仅为 UX 遮罩（前端按 is_sensitive 决定是否脱敏显示），content 仍留 DB 里供真正删除路径擦除。
pub fn set_sensitive(
    db: &AppDatabase,
    id: &str,
    value: bool,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE session_messages SET is_sensitive = ?1 WHERE id = ?2",
        rusqlite::params![value as i64, id],
    )
    .map_err(|e| format!("Failed to update message: {}", e))?;

    Ok(())
}

/// 单条真擦除。
pub fn delete_one(
    db: &AppDatabase,
    id: &str,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM session_messages WHERE id = ?1",
        [id],
    )
    .map_err(|e| format!("Failed to delete message: {}", e))?;

    Ok(())
}

/// 整 session 范围内批量擦除所有已标记敏感的消息。
/// 返回受影响行数,前端可据此展示 "已擦除 N 条"。
pub fn delete_sensitive(
    db: &AppDatabase,
    session_id: &str,
) -> Result<usize, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let n = conn
        .execute(
            "DELETE FROM session_messages WHERE session_id = ?1 AND is_sensitive = 1",
            [session_id],
        )
        .map_err(|e| format!("Failed to delete sensitive messages: {}", e))?;

    Ok(n)
}
