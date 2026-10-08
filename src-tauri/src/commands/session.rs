use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

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
) -> Result<PathBuf, String> {
    let base = match claude_config_dir {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => dirs::home_dir()
            .ok_or_else(|| "Failed to resolve home directory".to_string())?
            .join(".claude"),
    };
    Ok(base.join("projects").join(encode_project_dir_name(work_dir)))
}

fn mtime_ms(path: &Path) -> Option<i64> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?;
    mtime.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
}

/// 在 Claude Code 的项目目录下，扫描 mtime 不晚于 `before_ts_ms` 的最近 `.jsonl` 会话文件，
/// 返回其 UUID（文件名去掉 `.jsonl` 后缀）。找不到则返回 None。
///
/// 调用场景：关闭 Claude Code 标签前一刻调用，确保重开后能 `--resume` 到刚才的会话，
/// 即使 `/clear` 等压缩操作未改变 session ID。
#[tauri::command]
pub fn find_latest_claude_session(
    work_dir: String,
    claude_config_dir: Option<String>,
    before_ts_ms: i64,
) -> Result<Option<String>, String> {
    let dir = resolve_claude_projects_dir(claude_config_dir.as_deref(), &work_dir)?;
    if !dir.exists() {
        return Ok(None);
    }

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read dir {}: {}", dir.display(), e))?;

    let mut best: Option<(i64, String)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        // 防御：UUID 文件名长度固定 36，仅匹配以避免误扫到子目录（罕见但可能）
        if stem.len() != 36 || stem.chars().filter(|c| *c == '-').count() != 4 {
            continue;
        }
        let Some(ts) = mtime_ms(&path) else {
            continue;
        };
        if ts > before_ts_ms {
            continue;
        }
        match &best {
            Some((cur, _)) if *cur >= ts => {}
            _ => best = Some((ts, stem.to_string())),
        }
    }

    Ok(best.map(|(_, uuid)| uuid))
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
