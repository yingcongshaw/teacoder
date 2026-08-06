use std::collections::HashMap;

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
    args: Option<Vec<String>>,
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

    let args = args.unwrap_or_default();
    pty_manager.start_session(&app, tab_id, tool_type, work_dir, env_vars, args)
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
