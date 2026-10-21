use std::path::PathBuf;

/// Claude Code 将工作目录路径编码为项目目录名的规则：
/// 把路径分隔符 `/`（或 Windows 上的 `\`）替换为 `-`。例如 `/work/proj` → `-work-proj`。
pub fn encode_project_dir_name(work_dir: &str) -> String {
    let normalized = work_dir.replace('\\', "/");
    normalized.replace('/', "-")
}

/// 解析 Claude Code 的项目目录 `<base>/projects/<encoded_work_dir>`。
/// `claude_config_dir` 为空或缺失时回落到 `~/.claude`。
pub fn resolve_claude_projects_dir(claude_config_dir: Option<&str>, work_dir: &str) -> Option<PathBuf> {
    let base = match claude_config_dir {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => dirs::home_dir()?.join(".claude"),
    };
    Some(base.join("projects").join(encode_project_dir_name(work_dir)))
}

/// 解析单个会话的 Claude 会话文件 `<projects_dir>/<cli_session_id>.jsonl`。
pub fn resolve_session_jsonl(
    claude_config_dir: Option<&str>,
    work_dir: &str,
    cli_session_id: &str,
) -> Option<PathBuf> {
    let dir = resolve_claude_projects_dir(claude_config_dir, work_dir)?;
    Some(dir.join(format!("{cli_session_id}.jsonl")))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{encode_project_dir_name, resolve_session_jsonl};

    #[test]
    fn encode_unix_path() {
        assert_eq!(
            encode_project_dir_name("/work/CodingTea/proj"),
            "-work-CodingTea-proj"
        );
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

    #[test]
    fn jsonl_path_uses_explicit_config_dir() {
        let path = resolve_session_jsonl(Some("/custom/cfg"), "/work/proj", "abc")
            .expect("显式 config_dir 不依赖 home 目录");
        assert_eq!(
            path,
            PathBuf::from("/custom/cfg/projects/-work-proj/abc.jsonl")
        );
    }
}
