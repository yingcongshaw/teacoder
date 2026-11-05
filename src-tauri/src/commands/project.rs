use crate::project;
use crate::storage::AppDatabase;

#[tauri::command]
pub fn project_list(db: tauri::State<AppDatabase>) -> Result<Vec<project::Project>, String> {
    project::list_projects(&db)
}

#[tauri::command]
pub fn project_create(
    db: tauri::State<AppDatabase>,
    input: project::CreateProjectInput,
) -> Result<project::Project, String> {
    project::create_project(&db, input)
}

#[tauri::command]
pub fn project_update(
    db: tauri::State<AppDatabase>,
    id: String,
    input: project::UpdateProjectInput,
) -> Result<project::Project, String> {
    project::update_project(&db, &id, input)
}

#[tauri::command]
pub fn project_delete(
    db: tauri::State<AppDatabase>,
    id: String,
) -> Result<(), String> {
    // 先停服务：行删了之后用户就再也找不到那个进程了
    crate::services::runtime::stop_project_services(&id);
    project::delete_project(&db, &id)
}

#[tauri::command]
pub fn project_reorder(
    db: tauri::State<AppDatabase>,
    ids: Vec<String>,
) -> Result<(), String> {
    project::reorder_projects(&db, ids)
}
