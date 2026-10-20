use std::path::PathBuf;

use crate::session;
use crate::storage::AppDatabase;

/// Claude Code 将工作目录路径编码为目录名的规则：
/// 把路径分隔符 `/`（或 Windows 上的 `\`）替换为 `-`。例如 `/work/proj` → `-work-proj`。
fn encode_project_dir_name(work_dir: &str) -> String {
    let normalized = work_dir.replace('\\', "/");
    normalized.replace('/', "-")
}

fn resolve_claude_projects_dir(
    claude_config_dir: Option<&str>,
    work_dir: &str,
) -> Option<PathBuf> {
    let base = match claude_config_dir {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => dirs::home_dir()?.join(".claude"),
    };
    Some(base.join("projects").join(encode_project_dir_name(work_dir)))
}

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
    let Some(dir) = resolve_claude_projects_dir(claude_config_dir.as_deref(), &work_dir) else {
        return false;
    };
    dir.join(format!("{cli_session_id}.jsonl")).exists()
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

#[cfg(test)]
mod tests {
    use super::encode_project_dir_name;

    #[test]
    fn encode_unix_path() {
        assert_eq!(encode_project_dir_name("/work/CodingTea/proj"), "-work-CodingTea-proj");
    }

    #[test]
    fn encode_windows_path() {
        assert_eq!(
            encode_project_dir_name("C:\\Users\\me\\proj"),
            "C:-Users-me-proj"
        );
    }

    #[test]
    fn encode_root() {
        assert_eq!(encode_project_dir_name("/"), "-");
    }
}
