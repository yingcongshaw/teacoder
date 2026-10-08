/// LLM 环境变量与 CLI 参数注入的计算结果。
///
/// 字段全部为 `Option` / `Vec`，便于在不兼容组合（kind mismatch）下整体返回空。
/// 环境变量名作为字面量（API Key 环境变量名是常量），值使用 `String` 以避免生命周期约束。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct EnvInjection {
    /// `(env var 名, 值)`；不适用或未提供时为 `None`。
    pub api_key_var: Option<(String, String)>,
    /// `(env var 名, 值)`；不适用或未提供时为 `None`。
    pub base_url_var: Option<(String, String)>,
    /// 需追加到 CLI args 的 `--model <name>` 段（仅当 model 非空）。
    pub model_args: Vec<String>,
}

/// 根据 `(tool_type, provider_kind, auth_type)` 计算 LLM 环境变量注入规则。
///
/// 注入矩阵（合法组合）：
/// - `(claude, anthropic, api_key)` → `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL`
/// - `(claude, anthropic, oauth)`  → `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`
/// - `(codex, openai, api_key)`   → `OPENAI_API_KEY` + `OPENAI_BASE_URL`
/// - `(gemini, google, api_key)`  → `GOOGLE_API_KEY` + `GOOGLE_BASE_URL`
/// - `(opencode, _, api_key)`     → `OPENCODE_API_KEY`（无 base_url env）
///
/// 其它组合（如 `claude × openai`）一律返回全 `None` / 空 `Vec`，由调用方自行处理。
///
/// `api_key` / `base_url` / `model` 任何一个为 `None` 或空字符串，对应字段均为 `None` / 空。
pub fn compute_injection(
    tool_type: &str,
    provider_kind: &str,
    auth_type: &str,
    api_key: Option<&str>,
    oauth_token: Option<&str>,
    base_url: Option<&str>,
    model: Option<&str>,
) -> EnvInjection {
    // 根据 auth_type 决定注入哪个 token 环境变量
    let token_var_name = match (tool_type, provider_kind, auth_type) {
        ("claude", "anthropic", "oauth") => Some("ANTHROPIC_AUTH_TOKEN"),
        ("claude", "anthropic", _) => Some("ANTHROPIC_API_KEY"),
        ("codex", "openai", _) => Some("OPENAI_API_KEY"),
        ("gemini", "google", _) => Some("GOOGLE_API_KEY"),
        ("opencode", _, _) => Some("OPENCODE_API_KEY"),
        _ => None,
    };

    let base_url_name = match (tool_type, provider_kind) {
        ("claude", "anthropic") => Some("ANTHROPIC_BASE_URL"),
        ("codex", "openai") => Some("OPENAI_BASE_URL"),
        ("gemini", "google") => Some("GOOGLE_BASE_URL"),
        _ => None,
    };

    // 不兼容组合（如 claude × openai）一律返回空注入。
    if token_var_name.is_none() {
        return EnvInjection {
            api_key_var: None,
            base_url_var: None,
            model_args: vec![],
        };
    }

    // 根据 auth_type 选择要注入的凭证
    let token_value = if auth_type == "oauth" {
        oauth_token.map(str::trim).filter(|s| !s.is_empty())
    } else {
        api_key.map(str::trim).filter(|s| !s.is_empty())
    };
    let base_url_trimmed = base_url.map(str::trim).filter(|s| !s.is_empty());
    let model_trimmed = model.map(str::trim).filter(|s| !s.is_empty());

    EnvInjection {
        api_key_var: token_var_name
            .zip(token_value)
            .map(|(n, v)| (n.to_string(), v.to_string())),
        base_url_var: base_url_name
            .zip(base_url_trimmed)
            .map(|(n, v)| (n.to_string(), v.to_string())),
        model_args: match model_trimmed {
            Some(m) => vec!["--model".to_string(), m.to_string()],
            None => vec![],
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claude_anthropic_api_key_env() {
        let inj = compute_injection(
            "claude",
            "anthropic",
            "api_key",
            Some("sk-test"),
            None,
            Some("https://api.anthropic.com"),
            Some("claude-sonnet-4"),
        );
        assert_eq!(
            inj.api_key_var,
            Some(("ANTHROPIC_API_KEY".to_string(), "sk-test".to_string()))
        );
        assert_eq!(
            inj.base_url_var,
            Some((
                "ANTHROPIC_BASE_URL".to_string(),
                "https://api.anthropic.com".to_string()
            ))
        );
        assert_eq!(inj.model_args, vec!["--model", "claude-sonnet-4"]);
    }

    #[test]
    fn test_claude_anthropic_oauth_env() {
        let inj = compute_injection(
            "claude",
            "anthropic",
            "oauth",
            None,
            Some("oauth-token-abc"),
            Some("https://api.anthropic.com"),
            Some("claude-sonnet-4"),
        );
        assert_eq!(
            inj.api_key_var,
            Some(("ANTHROPIC_AUTH_TOKEN".to_string(), "oauth-token-abc".to_string()))
        );
    }

    #[test]
    fn test_codex_openai_env() {
        let inj = compute_injection(
            "codex",
            "openai",
            "api_key",
            Some("sk-x"),
            None,
            Some("https://api.openai.com/v1"),
            Some("gpt-4o"),
        );
        assert_eq!(
            inj.api_key_var,
            Some(("OPENAI_API_KEY".to_string(), "sk-x".to_string()))
        );
        assert_eq!(
            inj.base_url_var,
            Some((
                "OPENAI_BASE_URL".to_string(),
                "https://api.openai.com/v1".to_string()
            ))
        );
        assert_eq!(inj.model_args, vec!["--model", "gpt-4o"]);
    }

    #[test]
    fn test_gemini_google_env() {
        let inj = compute_injection(
            "gemini",
            "google",
            "api_key",
            Some("gkey"),
            None,
            Some("https://generativelanguage.googleapis.com/v1beta"),
            Some("gemini-2.0-pro"),
        );
        assert_eq!(
            inj.api_key_var,
            Some(("GOOGLE_API_KEY".to_string(), "gkey".to_string()))
        );
        assert_eq!(
            inj.base_url_var,
            Some((
                "GOOGLE_BASE_URL".to_string(),
                "https://generativelanguage.googleapis.com/v1beta".to_string()
            ))
        );
        assert!(inj.model_args.contains(&"--model".to_string()));
    }

    #[test]
    fn test_kind_mismatch_returns_empty() {
        // claude × openai 不兼容
        let inj = compute_injection(
            "claude",
            "openai",
            "api_key",
            Some("k"),
            None,
            Some("u"),
            Some("m"),
        );
        assert_eq!(inj.api_key_var, None);
        assert_eq!(inj.base_url_var, None);
        assert!(inj.model_args.is_empty());
    }

    #[test]
    fn test_opencode_has_no_base_url_var() {
        let inj = compute_injection(
            "opencode",
            "openai",
            "api_key",
            Some("ok"),
            None,
            Some("https://example.com"),
            Some("model-x"),
        );
        assert_eq!(
            inj.api_key_var,
            Some(("OPENCODE_API_KEY".to_string(), "ok".to_string()))
        );
        assert_eq!(inj.base_url_var, None);
        assert_eq!(inj.model_args, vec!["--model", "model-x"]);
    }

    #[test]
    fn test_empty_inputs_are_omitted() {
        let inj = compute_injection("claude", "anthropic", "api_key", Some(""), None, None, Some(""));
        assert_eq!(inj.api_key_var, None);
        assert_eq!(inj.base_url_var, None);
        assert!(inj.model_args.is_empty());
    }
}