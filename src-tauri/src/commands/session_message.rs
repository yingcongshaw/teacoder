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
