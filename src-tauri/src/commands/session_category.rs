use crate::session_category;
use crate::storage::AppDatabase;

#[tauri::command]
pub fn category_list(
    db: tauri::State<AppDatabase>,
    project_id: Option<String>,
) -> Result<Vec<session_category::SessionCategory>, String> {
    session_category::list_categories(&db, project_id.as_deref())
}

#[tauri::command]
pub fn category_create(
    db: tauri::State<AppDatabase>,
    input: session_category::CreateCategoryInput,
) -> Result<session_category::SessionCategory, String> {
    session_category::create_category(&db, input)
}

#[tauri::command]
pub fn category_update(
    db: tauri::State<AppDatabase>,
    id: String,
    input: session_category::UpdateCategoryInput,
) -> Result<session_category::SessionCategory, String> {
    session_category::update_category(&db, &id, input)
}

#[tauri::command]
pub fn category_delete(
    db: tauri::State<AppDatabase>,
    id: String,
) -> Result<(), String> {
    session_category::delete_category(&db, &id)
}
