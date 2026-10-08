use std::collections::HashMap;
use serde::Deserialize;

use crate::crypto::keychain;
use crate::profile;
use crate::pty::manager::PtyManager;
use crate::pty::ToolType;
use crate::storage::AppDatabase;

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri 命令参数由 IPC schema 决定，无法拆分
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
    llm_provider_id: Option<String>,
    model_name: Option<String>,
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

    // LLM Provider 注入（Profile 之后、user_env_vars 之前）；
    // 强制要求：若 provider 需要 API Key 但 keychain 中缺失则报错，不静默忽略。
    // 不兼容组合（如 claude × openai）由 compute_injection 返回空注入，调用方不报错。
    if let Some(ref lpid) = llm_provider_id {
        if let Some(provider) = crate::llm_provider::get_provider(&db, lpid)? {
            if !provider.is_active {
                return Err(format!(
                    "LLM 供应商「{}」已停用，请重新选择",
                    provider.name
                ));
            }

            let api_key = crate::crypto::keychain::get_secret(lpid, "api_key")
                .map_err(|e| format!("读取 API Key 失败: {}", e))?
                .unwrap_or_default();

            let tool_str = match tool_type {
                ToolType::Claude => "claude",
                ToolType::Codex => "codex",
                ToolType::Gemini => "gemini",
                ToolType::OpenCode => "opencode",
                ToolType::Terminal | ToolType::Ssh => "",
            };

            let inj = crate::llm_provider::env_inject::compute_injection(
                tool_str,
                &provider.provider_kind,
                if api_key.is_empty() {
                    None
                } else {
                    Some(&api_key)
                },
                provider.base_url.as_deref(),
                model_name.as_deref(),
            );

            // API Key：compute_injection 在 (tool, provider_kind) 合法且 key 非空时才返回 Some。
            // 此处再次显式校验 api_key_var 是否存在 → 缺失则报错（避免静默放过）。
            if inj.api_key_var.is_none() && !api_key.is_empty() {
                // 合法组合下 api_key 非空却未注入 → kind 不匹配 tool_type
                // 不报错也不注入（compute_injection 已经返回 None）。
            }
            if let Some((name, value)) = inj.api_key_var {
                env_vars.insert(name, value);
            } else if !api_key.is_empty() {
                // api_key 非空但 compute_injection 因不兼容未产出 → 静默忽略（设计选择）
            } else if api_key.is_empty() && !tool_str.is_empty() {
                // tool 合法但 key 缺失：除 opencode 外，要求必须有 API Key
                // opencode 不强制（与 compute_injection 矩阵对齐）
                if !matches!(tool_type, ToolType::OpenCode) {
                    return Err(format!(
                        "LLM 供应商「{}」未配置 API Key",
                        provider.name
                    ));
                }
            }

            if let Some((name, value)) = inj.base_url_var {
                env_vars.insert(name, value);
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

    // LLM Provider model 参数追加（Claude/Codex/Gemini 通过 --model <name>）；
    // OpenCode 的 model 由其配置文件管理，不通过 --model 注入。
    // 仅在 args 尚未包含 --model 时追加，避免覆盖用户显式传值。
    if let Some(ref _lpid) = llm_provider_id {
        if let Some(ref m) = model_name {
            if !m.is_empty()
                && matches!(tool_type, ToolType::Claude | ToolType::Codex | ToolType::Gemini)
                && !args.iter().any(|a| a == "--model")
            {
                args.push("--model".to_string());
                args.push(m.clone());
            }
        }
    }

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
