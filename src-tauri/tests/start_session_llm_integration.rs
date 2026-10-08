//! start_session LLM 注入组合验证（集成测试）
//!
//! 验证 env_vars 合并顺序：Profile → LLM Provider → user_env_vars，
//! 后者覆盖前者。最终注入 PTY 的 HashMap 必须满足以下不变量：
//! 1. user_env_vars 显式提供的 key 覆盖 Provider 注入；
//! 2. user_env_vars 未提供的 key，保留 Provider 注入值；
//! 3. Provider 未注入的 key，user_env_vars 仍然生效。
//!
//! 本测试通过 `#[path]` 复用 `llm_provider/env_inject.rs` 的源码
//! （因 `llm_provider` 模块在 lib 中为私有，集成测试无法通过 crate root 导入）。
//! 该源码不被本测试复制，仅以模块形式被测试二进制重新编译。

#[path = "../src/llm_provider/env_inject.rs"]
mod env_inject;

use std::collections::HashMap;

/// 模拟 IPC 层 env_vars 组合逻辑（Profile → Provider → user_env_vars）。
///
/// - `profile_env`：Profile 层已有的 env（如 Profile 自带的 ANTHROPIC_API_KEY 占位）
/// - `provider_inj`：`compute_injection` 输出
/// - `user_env_vars`：用户在 NewSessionModal 中显式填写的 env
///
/// 合并规则：按 `profile_env → provider_inj → user_env_vars` 顺序插入 HashMap，
/// 后者覆盖前者。
fn compose_env(
    profile_env: HashMap<String, String>,
    provider_inj: env_inject::EnvInjection,
    user_env_vars: HashMap<String, String>,
) -> HashMap<String, String> {
    let mut env = profile_env;
    if let Some((k, v)) = provider_inj.api_key_var {
        env.insert(k, v);
    }
    if let Some((k, v)) = provider_inj.base_url_var {
        env.insert(k, v);
    }
    for (k, v) in user_env_vars {
        env.insert(k, v);
    }
    env
}

#[test]
fn test_user_env_vars_override_provider() {
    // 场景：Provider 注入了 ANTHROPIC_API_KEY，但用户在 NewSessionModal 中手动指定了另一个 key。
    // 期望：最终 env 以用户值为准。
    let profile_env = HashMap::new();
    let provider_inj = env_inject::compute_injection(
        "claude",
        "anthropic",
        Some("provider-key"),
        Some("https://provider.url"),
        None,
    );
    let mut user_env_vars = HashMap::new();
    user_env_vars.insert("ANTHROPIC_API_KEY".to_string(), "user-key".to_string());

    let env = compose_env(profile_env, provider_inj, user_env_vars);

    assert_eq!(
        env.get("ANTHROPIC_API_KEY"),
        Some(&"user-key".to_string()),
        "user_env_vars 应覆盖 Provider 注入的 ANTHROPIC_API_KEY"
    );
    assert_eq!(
        env.get("ANTHROPIC_BASE_URL"),
        Some(&"https://provider.url".to_string()),
        "user_env_vars 未覆盖的 key，应保留 Provider 注入值"
    );
}

#[test]
fn test_provider_base_url_not_overridden_when_user_env_empty() {
    // 场景：Provider 注入了 base_url，但 user_env_vars 完全为空（用户没填）。
    // 期望：Provider 注入的所有 key 都保留。
    let profile_env = HashMap::new();
    let provider_inj = env_inject::compute_injection(
        "codex",
        "openai",
        Some("sk-openai-x"),
        Some("https://api.openai.com/v1"),
        Some("gpt-4o"),
    );
    let user_env_vars = HashMap::new();

    let env = compose_env(profile_env, provider_inj, user_env_vars);

    assert_eq!(env.get("OPENAI_API_KEY"), Some(&"sk-openai-x".to_string()));
    assert_eq!(
        env.get("OPENAI_BASE_URL"),
        Some(&"https://api.openai.com/v1".to_string())
    );
    assert_eq!(env.len(), 2, "只应有 2 个 env vars，未引入额外变量");
}

#[test]
fn test_compute_injection_merges_with_user_env_cleanly() {
    // 场景：Profile 已含占位 env → Provider 注入覆盖之 → user_env_vars 再覆盖部分 key。
    // 验证三源混合后 env 内容。
    let mut profile_env = HashMap::new();
    profile_env.insert(
        "ANTHROPIC_API_KEY".to_string(),
        "profile-default-placeholder".to_string(),
    );
    profile_env.insert(
        "ANTHROPIC_BASE_URL".to_string(),
        "https://profile-default.url".to_string(),
    );

    let provider_inj = env_inject::compute_injection(
        "claude",
        "anthropic",
        Some("provider-key-xyz"),
        Some("https://api.anthropic.com"),
        Some("claude-sonnet-4"),
    );

    let mut user_env_vars = HashMap::new();
    // 用户只覆盖 api_key，不覆盖 base_url
    user_env_vars.insert("ANTHROPIC_API_KEY".to_string(), "user-final-key".to_string());
    // 用户额外注入一个 Profile 和 Provider 都没有的 key
    user_env_vars.insert("CUSTOM_FLAG".to_string(), "1".to_string());

    let env = compose_env(profile_env, provider_inj, user_env_vars);

    // API Key: user > provider > profile，最终是 user
    assert_eq!(
        env.get("ANTHROPIC_API_KEY"),
        Some(&"user-final-key".to_string()),
        "API Key 链路：Profile 占位 → Provider 覆盖 → user 覆盖，最终为 user"
    );
    // Base URL: user 未覆盖，Provider 注入覆盖了 Profile
    assert_eq!(
        env.get("ANTHROPIC_BASE_URL"),
        Some(&"https://api.anthropic.com".to_string()),
        "Base URL: Profile 被 Provider 覆盖，user 未触碰"
    );
    // 用户自定义 key 透传
    assert_eq!(
        env.get("CUSTOM_FLAG"),
        Some(&"1".to_string()),
        "用户额外注入的 key 应保留"
    );
    // 总数：API Key + Base URL + CUSTOM_FLAG = 3
    assert_eq!(env.len(), 3, "env 中只应有 3 个 key，不多不少");
}
