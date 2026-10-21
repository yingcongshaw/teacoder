use crate::session;
use crate::session::claude_path::resolve_session_jsonl;
use crate::storage::AppDatabase;

/// 检查 Claude Code 在 `<claude_config_dir>/projects/<work_dir>/<cli_session_id>.jsonl`
/// 是否存在。用于"重开 Claude Code tab 之前"判断该会话是否已被用户清理。
///
/// 返回 false 的情况：路径解析失败、目录不存在、文件不存在。
/// 调用方按"false → 提示会话被删除"处理。
#[tauri::command]
pub fn claude_jsonl_exists(
    work_dir: String,
    claude_config_dir: Option<String>,
    cli_session_id: String,
) -> bool {
    resolve_session_jsonl(claude_config_dir.as_deref(), &work_dir, &cli_session_id)
        .is_some_and(|path| path.exists())
}

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
