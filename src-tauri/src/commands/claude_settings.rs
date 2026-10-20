//! 清理 Claude Code settings.json 的 env 字段。
//!
//! 每次 PTY 启动 Claude Code 前调用，避免用户在 ~/.claude/settings.json
//! 中手动配置的 env 与 TeaCoder 自动注入冲突。
//!
//! best-effort 设计：任何 IO/JSON 解析失败均返回 Ok，不阻塞 PTY 启动。
//! 仅当确实存在 `env` 字段时才回写文件，避免无意义的磁盘写入。

use std::fs;
use std::path::PathBuf;

use serde_json::Value;

const SETTINGS_FILE: &str = "settings.json";

/// 解析 Claude Code 配置目录：优先用 Profile.app_data_root，否则 ~/.claude。
fn resolve_claude_dir(claude_config_dir: Option<&str>) -> Result<PathBuf, String> {
    match claude_config_dir {
        Some(dir) if !dir.is_empty() => Ok(PathBuf::from(dir)),
        _ => dirs::home_dir()
            .ok_or_else(|| "Failed to resolve home directory".to_string())
            .map(|h| h.join(".claude")),
    }
}

/// 清理 Claude Code settings.json 的 env 字段。
///
/// 路径由 `claude_config_dir` 决定：
/// - `Some(dir)` 且非空：使用 Profile.app_data_root 覆盖的目录
/// - `None` 或空字符串：使用 `~/.claude`
///
/// 返回值：
/// - 文件不存在、读失败、JSON 解析失败：返回 `Ok(())`（best-effort）
/// - 文件存在且含 `env` 字段：删除并写回，序列化失败或写失败返回 `Err`
pub fn clean_claude_settings_env(claude_config_dir: Option<&str>) -> Result<(), String> {
    let dir = resolve_claude_dir(claude_config_dir)?;
    let path = dir.join(SETTINGS_FILE);
    if !path.exists() {
        return Ok(());
    }

    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return Ok(()),
    };
    let mut value: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };

    let Some(obj) = value.as_object_mut() else {
        return Ok(());
    };
    if obj.remove("env").is_none() {
        return Ok(());
    }

    let serialized = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("Failed to serialize settings.json: {}", e))?;
    fs::write(&path, serialized)
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// 临时目录辅助：返回 (path, guard)
    fn temp_dir(tag: &str) -> (PathBuf, impl Drop) {
        let base = std::env::temp_dir().join(format!(
            "teacoder-claude-settings-{}-{}",
            tag,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        struct Guard(PathBuf);
        impl Drop for Guard {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        (base.clone(), Guard(base))
    }

    #[test]
    fn test_no_settings_file_is_ok() {
        let (dir, _g) = temp_dir("missing");
        let result = clean_claude_settings_env(Some(dir.to_str().unwrap()));
        assert!(result.is_ok(), "文件不存在应静默成功");
    }

    #[test]
    fn test_settings_without_env_is_unchanged() {
        let (dir, _g) = temp_dir("no-env");
        let path = dir.join(SETTINGS_FILE);
        let original = serde_json::json!({
            "permissions": { "allow": ["Bash"] }
        });
        let original_str = serde_json::to_string_pretty(&original).unwrap();
        fs::write(&path, &original_str).unwrap();

        clean_claude_settings_env(Some(dir.to_str().unwrap())).unwrap();

        let after = fs::read_to_string(&path).unwrap();
        // 内容应保持不变（无 env 字段 → 不写回）
        assert_eq!(after, original_str);
    }

    #[test]
    fn test_settings_with_env_is_cleaned() {
        let (dir, _g) = temp_dir("has-env");
        let path = dir.join(SETTINGS_FILE);
        let mut env_map = HashMap::new();
        env_map.insert("FOO".to_string(), "bar".to_string());
        let before = serde_json::json!({
            "permissions": { "allow": ["Bash"] },
            "env": env_map,
        });
        fs::write(&path, serde_json::to_string_pretty(&before).unwrap()).unwrap();

        clean_claude_settings_env(Some(dir.to_str().unwrap())).unwrap();

        let after_str = fs::read_to_string(&path).unwrap();
        let after: Value = serde_json::from_str(&after_str).unwrap();
        // env 字段已被删除
        assert!(after.get("env").is_none(), "env 字段应被删除");
        // 其他字段保留
        assert_eq!(
            after.get("permissions").unwrap().get("allow").unwrap()[0],
            "Bash"
        );
    }

    #[test]
    fn test_malformed_json_is_ok() {
        let (dir, _g) = temp_dir("malformed");
        let path = dir.join(SETTINGS_FILE);
        fs::write(&path, "{not valid json").unwrap();

        let result = clean_claude_settings_env(Some(dir.to_str().unwrap()));
        assert!(result.is_ok(), "JSON 解析失败应静默成功");
    }

    #[test]
    fn test_non_object_root_is_ok() {
        let (dir, _g) = temp_dir("non-object");
        let path = dir.join(SETTINGS_FILE);
        fs::write(&path, "[1, 2, 3]").unwrap();

        let result = clean_claude_settings_env(Some(dir.to_str().unwrap()));
        assert!(result.is_ok(), "根节点非对象应静默成功");
    }

    #[test]
    fn test_default_home_dir_path() {
        // None 时应解析到 ~/.claude，不报错（即便文件不存在）
        let result = clean_claude_settings_env(None);
        assert!(result.is_ok());
    }
}
