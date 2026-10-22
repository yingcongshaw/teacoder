use crate::session;
use crate::session::claude_path::{find_session_jsonl_anywhere, resolve_session_jsonl};
use crate::storage::AppDatabase;

/// 检查 Claude Code 在 `<claude_config_dir>/projects/<work_dir>/<cli_session_id>.jsonl`
/// 是否存在。用于"重开 Claude Code tab 之前"判断该会话是否已被用户清理。
///
/// 编码后的目录名对不上时（例如会话是在另一个目录下创建的）退化为按
/// `cli_session_id` 全局反查，避免误判为"会话已删除"而挡掉可恢复的会话。
///
/// 返回 false 的情况：路径解析失败、目录不存在、文件不存在。
/// 调用方按"false → 提示会话被删除"处理。
#[tauri::command]
pub fn claude_jsonl_exists(
    work_dir: String,
    claude_config_dir: Option<String>,
    cli_session_id: String,
) -> bool {
    let found = resolve_session_jsonl(claude_config_dir.as_deref(), &work_dir, &cli_session_id)
        .is_some_and(|path| path.exists());
    found || find_session_jsonl_anywhere(claude_config_dir.as_deref(), &cli_session_id).is_some()
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

/// 读取该 Claude 会话的 transcript 主线（真人输入 / AI 回复 / 工具调用）。
///
/// 返回 `None` 表示 transcript 不存在或无法定位（`cli_session_id` 缺失、
/// 工作目录不匹配等），调用方应据此显示「未找到记录」而不是报错。
#[tauri::command]
pub fn claude_transcript_read(
    work_dir: String,
    claude_config_dir: Option<String>,
    cli_session_id: String,
    limit: Option<usize>,
) -> Option<Vec<session::claude_transcript::TranscriptEntry>> {
    let path = resolve_session_jsonl(claude_config_dir.as_deref(), &work_dir, &cli_session_id)
        .filter(|p| p.exists())
        .or_else(|| find_session_jsonl_anywhere(claude_config_dir.as_deref(), &cli_session_id))?;

    session::claude_transcript::read_transcript(&path, limit.unwrap_or(300)).ok()
}
