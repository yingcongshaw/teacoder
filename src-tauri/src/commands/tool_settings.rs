use crate::storage::AppDatabase;
use crate::tool_settings;
use tauri::Emitter;

#[tauri::command]
pub fn get_tool_settings(
    db: tauri::State<AppDatabase>,
    profile_id: String,
) -> Result<Option<tool_settings::ToolSettings>, String> {
    tool_settings::get_tool_settings(&db, &profile_id)
}

#[tauri::command]
pub fn upsert_tool_settings(
    db: tauri::State<AppDatabase>,
    input: tool_settings::CreateToolSettingsInput,
) -> Result<tool_settings::ToolSettings, String> {
    tool_settings::upsert_tool_settings(&db, input)
}

#[tauri::command]
pub fn delete_tool_settings(
    db: tauri::State<AppDatabase>,
    profile_id: String,
) -> Result<(), String> {
    tool_settings::delete_tool_settings(&db, &profile_id)
}
