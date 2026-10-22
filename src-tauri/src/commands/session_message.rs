use crate::session_message::{self, CreateSessionMessageInput, SessionMessage};
use crate::storage::AppDatabase;
use tauri::State;

#[tauri::command]
pub fn session_message_list(
    db: State<AppDatabase>,
    session_id: String,
) -> Result<Vec<SessionMessage>, String> {
    session_message::list_session_messages(&db, &session_id)
}

#[tauri::command]
pub fn session_message_create(
    db: State<AppDatabase>,
    input: CreateSessionMessageInput,
) -> Result<SessionMessage, String> {
    session_message::create_session_message(&db, input)
}

#[tauri::command]
pub fn session_message_delete(
    db: State<AppDatabase>,
    session_id: String,
) -> Result<(), String> {
    session_message::delete_session_messages(&db, &session_id)
}

/// 标记/取消标记单条消息的敏感属性。false → 取消标记（恢复显示原文）。
#[tauri::command]
pub fn session_message_mark_sensitive(
    db: State<AppDatabase>,
    id: String,
    is_sensitive: bool,
) -> Result<(), String> {
    session_message::set_sensitive(&db, &id, is_sensitive)
}

/// 单条真擦除,DB 行彻底删除。
#[tauri::command]
pub fn session_message_delete_one(
    db: State<AppDatabase>,
    id: String,
) -> Result<(), String> {
    session_message::delete_one(&db, &id)
}

/// 当前 session 下所有已标记敏感的消息批量删除,返回受影响行数。
#[tauri::command]
pub fn session_message_delete_sensitive(
    db: State<AppDatabase>,
    session_id: String,
) -> Result<usize, String> {
    session_message::delete_sensitive(&db, &session_id)
}
