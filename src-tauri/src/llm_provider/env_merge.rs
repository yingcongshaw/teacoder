//! LLM Provider 启动 env 组合：Profile → Provider → user_env_vars，后者覆盖前者。
//!
//! 由 `commands::pty::start_session` 与集成测试共享，确保生产代码与测试的合并顺序一致。

use std::collections::HashMap;

use super::env_inject::EnvInjection;

/// 按 Profile → Provider → user_env_vars 顺序合并 env vars，后者覆盖前者。
///
/// - `profile_env`：Profile 层已累积的 env（如 `CLAUDE_CONFIG_DIR`、`ANTHROPIC_API_KEY` 占位等）
/// - `provider_inj`：`compute_injection` 输出（API Key / Base URL）
/// - `user_env_vars`：用户在 NewSessionModal 中显式填写的 env（最终覆盖）
///
/// # 认证冲突处理
/// `ANTHROPIC_API_KEY` 与 `ANTHROPIC_AUTH_TOKEN` 互斥，同时设置会导致 Claude Code 警告。
/// 检测到此类冲突时，优先使用 `*_API_KEY` 版本（用户显式配置），移除 `*_AUTH_TOKEN`。
pub fn compose_env(
    profile_env: HashMap<String, String>,
    provider_inj: EnvInjection,
    user_env_vars: HashMap<String, String>,
) -> HashMap<String, String> {
    let mut env = profile_env;
    if let Some((k, v)) = provider_inj.api_key_var {
        // ANTHROPIC_API_KEY 与 ANTHROPIC_AUTH_TOKEN 互斥，移除 AUTH_TOKEN
        if k == "ANTHROPIC_API_KEY" {
            env.remove("ANTHROPIC_AUTH_TOKEN");
        }
        env.insert(k, v);
    }
    if let Some((k, v)) = provider_inj.base_url_var {
        env.insert(k, v);
    }
    for (k, v) in user_env_vars {
        // 用户显式设置 API_KEY 时，同样移除对应的 AUTH_TOKEN
        if k == "ANTHROPIC_API_KEY" {
            env.remove("ANTHROPIC_AUTH_TOKEN");
        }
        // 用户显式设置 AUTH_TOKEN 时，移除对应的 API_KEY
        if k == "ANTHROPIC_AUTH_TOKEN" {
            env.remove("ANTHROPIC_API_KEY");
        }
        env.insert(k, v);
    }
    env
}
