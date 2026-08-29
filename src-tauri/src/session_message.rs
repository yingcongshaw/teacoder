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
    })
}

pub fn list_session_messages(
    db: &AppDatabase,
    session_id: &str,
) -> Result<Vec<SessionMessage>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, session_id, content, line_index, created_at FROM session_messages WHERE session_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([session_id], |row| row_to_message(row))
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
