use crate::session;
use crate::storage::AppDatabase;

#[tauri::command]
pub fn session_list(
    db: tauri::State<AppDatabase>,
    project_id: Option<String>,
) -> Result<Vec<session::Session>, String> {
    session::list_sessions(&db, project_id.as_deref())
}

#[tauri::command]
pub fn session_create(
    db: tauri::State<AppDatabase>,
    input: session::CreateSessionInput,
) -> Result<session::Session, String> {
    session::create_session(&db, input)
}

#[tauri::command]
pub fn session_update(
    db: tauri::State<AppDatabase>,
    id: String,
    input: session::UpdateSessionInput,
) -> Result<session::Session, String> {
    session::update_session(&db, &id, input)
}

#[tauri::command]
pub fn session_delete(
    db: tauri::State<AppDatabase>,
    id: String,
) -> Result<(), String> {
    session::delete_session(&db, &id)
}
