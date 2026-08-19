use std::collections::HashMap;
use serde::{Deserialize, Serialize};

use crate::crypto::keychain;
use crate::profile;
use crate::pty::manager::PtyManager;
use crate::pty::ToolType;
use crate::storage::AppDatabase;

#[tauri::command]
pub fn start_session(
    app: tauri::AppHandle,
    pty_manager: tauri::State<PtyManager>,
    db: tauri::State<AppDatabase>,
    tab_id: String,
    tool_type: ToolType,
    work_dir: String,
    profile_id: Option<String>,
    user_env_vars: Option<HashMap<String, String>>,
    cli_args: Option<String>,
    cli_session_id: Option<String>,
) -> Result<(), String> {
    let mut env_vars = HashMap::new();

    if let Some(ref pid) = profile_id {
        // Load profile for data isolation env vars
        let profiles = profile::list_profiles(&db, None)?;
        if let Some(p) = profiles.iter().find(|p| p.id == *pid) {
            if let Some(ref root) = p.app_data_root {
                match p.tool_type.as_str() {
                    "claude" => {
                        env_vars.insert("CLAUDE_CONFIG_DIR".to_string(), root.clone());
                    }
                    "codex" => {
                        env_vars.insert("CODEX_HOME".to_string(), root.clone());
                    }
                    "gemini" => {
                        env_vars.insert("GEMINI_HOME".to_string(), root.clone());
                    }
                    "opencode" => {
                        env_vars.insert("OPENCODE_HOME".to_string(), root.clone());
                    }
                    _ => {}
                }
            }

            // Inject API key from keychain as environment variable
            if p.auth_type == "api_key" {
                if let Ok(Some(api_key)) = keychain::get_secret(pid, "api_key") {
                    match p.tool_type.as_str() {
                        "claude" => {
                            env_vars.insert("ANTHROPIC_API_KEY".to_string(), api_key);
                        }
                        "codex" => {
                            env_vars.insert("OPENAI_API_KEY".to_string(), api_key);
                        }
                        "gemini" => {
                            env_vars.insert("GOOGLE_API_KEY".to_string(), api_key);
                        }
                        "opencode" => {
                            env_vars.insert("OPENCODE_API_KEY".to_string(), api_key);
                        }
                        _ => {}
                    }
                }
            }

            // Inject base URL if configured
            if let Some(ref url) = p.base_url {
                match p.tool_type.as_str() {
                    "claude" => {
                        env_vars.insert("ANTHROPIC_BASE_URL".to_string(), url.clone());
                    }
                    "codex" => {
                        env_vars.insert("OPENAI_BASE_URL".to_string(), url.clone());
                    }
                    _ => {}
                }
            }
        }
    }

    // Merge user-provided env vars (override profile defaults)
    if let Some(user_vars) = user_env_vars {
        for (k, v) in user_vars {
            env_vars.insert(k, v);
        }
    }

    let mut args: Vec<String> = if let Some(json) = cli_args {
        serde_json::from_str(&json).unwrap_or_default()
    } else {
        vec![]
    };

    // Claude Code: 新建会话时注入 --session-id，以便后续 --resume 精确恢复
    // 恢复会话时 cli_args 中已包含 --resume <id>，不需要再注入 --session-id
    if matches!(tool_type, ToolType::Claude) {
        if let Some(ref sid) = cli_session_id {
            let has_session_id = args.iter().any(|a| a == "--session-id");
            let has_resume = args.iter().any(|a| a == "--resume" || a == "-r");
            if !has_session_id && !has_resume {
                args.push("--session-id".to_string());
                args.push(sid.clone());
            }
        }
    }

    pty_manager.start_session(app, tab_id, tool_type, work_dir, env_vars, args)
}

#[tauri::command]
pub fn stop_session(
    pty_manager: tauri::State<PtyManager>,
    tab_id: String,
) -> Result<(), String> {
    pty_manager.stop_session(&tab_id)
}

#[tauri::command]
pub fn write_to_pty(
    pty_manager: tauri::State<PtyManager>,
    tab_id: String,
    data: String,
) -> Result<(), String> {
    pty_manager.write_to_pty(&tab_id, &data)
}

#[tauri::command]
pub fn resize_pty(
    pty_manager: tauri::State<PtyManager>,
    tab_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty_manager.resize_pty(&tab_id, cols, rows)
}

#[derive(Debug, Deserialize)]
pub struct SshTestParams {
    hostname: String,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    identity_file: Option<String>,
}

#[tauri::command]
pub async fn test_ssh_connection(params: SshTestParams) -> Result<String, String> {
    use std::process::Command;

    let port = params.port.unwrap_or(22);
    let username = params.username.as_deref().unwrap_or("root");

    // 构建 ssh 命令进行连接测试
    let user_host = format!("{}@{}", username, params.hostname);

    let mut args = vec![
        user_host,
        "-p".to_string(),
        port.to_string(),
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "ConnectTimeout=5".to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=no".to_string(),
    ];

    // 如果有身份文件，添加它
    if let Some(ref key_file) = params.identity_file {
        if !key_file.is_empty() {
            args.push("-i".to_string());
            args.push(key_file.clone());
            // 公钥认证优先
            args.push("-o".to_string());
            args.push("PreferredAuthentications=publickey".to_string());
        }
    } else if let Some(ref _pwd) = params.password {
        // 如果有密码但不提供身份文件，会话将提示输入密码
        args.push("-o".to_string());
        args.push("PreferredAuthentications=password".to_string());
    }

    let output = Command::new("ssh")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute ssh: {}", e))?;

    if output.status.success() {
        Ok("连接成功".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        // BatchMode 时如果需要密码会直接失败，这是预期的行为
        if stderr.contains("Permission denied") || stdout.contains("Permission denied") {
            Err("认证失败，请检查用户名、密码或密钥".to_string())
        } else if stderr.contains("Connection timed out") || stdout.contains("Connection timed out") {
            Err("连接超时，请检查主机地址和端口".to_string())
        } else if stderr.contains("No route to host") || stdout.contains("No route to host") {
            Err("无法到达主机，请检查网络连接".to_string())
        } else if stderr.contains("Connection refused") || stdout.contains("Connection refused") {
            Err("连接被拒绝，请检查端口是否正确".to_string())
        } else {
            Err(format!("连接失败: {}", if stderr.is_empty() { stdout.to_string() } else { stderr.to_string() }))
        }
    }
}
