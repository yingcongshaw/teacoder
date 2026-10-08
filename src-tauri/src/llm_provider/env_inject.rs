/// LLM 环境变量与 CLI 参数注入的计算结果。
///
/// 字段全部为 `Option` / `Vec`，便于在不兼容组合（kind mismatch）下整体返回空。
/// 环境变量名作为字面量（API Key 环境变量名是常量），值使用 `String` 以避免生命周期约束。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvInjection {
    /// `(env var 名, 值)`；不适用或未提供时为 `None`。
    pub api_key_var: Option<(String, String)>,
    /// `(env var 名, 值)`；不适用或未提供时为 `None`。
    pub base_url_var: Option<(String, String)>,
    /// 需追加到 CLI args 的 `--model <name>` 段（仅当 model 非空）。
    pub model_args: Vec<String>,
}

/// 根据 `(tool_type, provider_kind)` 计算 LLM 环境变量注入规则。
///
/// 注入矩阵（合法组合）：
/// - `(claude, anthropic)` → `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL`
/// - `(codex, openai)`    → `OPENAI_API_KEY` + `OPENAI_BASE_URL`
/// - `(gemini, google)`   → `GOOGLE_API_KEY` + `GOOGLE_BASE_URL`
/// - `(opencode, _)`      → `OPENCODE_API_KEY`（无 base_url env）
///
/// 其它组合（如 `claude × openai`）一律返回全 `None` / 空 `Vec`，由调用方自行处理。
///
/// `api_key` / `base_url` / `model` 任何一个为 `None` 或空字符串，对应字段均为 `None` / 空。
pub fn compute_injection(
    tool_type: &str,
    provider_kind: &str,
    api_key: Option<&str>,
    base_url: Option<&str>,
    model: Option<&str>,
) -> EnvInjection {
    let (api_key_name, base_url_name) = match (tool_type, provider_kind) {
        ("claude", "anthropic") => (Some("ANTHROPIC_API_KEY"), Some("ANTHROPIC_BASE_URL")),
        ("codex", "openai") => (Some("OPENAI_API_KEY"), Some("OPENAI_BASE_URL")),
        ("gemini", "google") => (Some("GOOGLE_API_KEY"), Some("GOOGLE_BASE_URL")),
        ("opencode", _) => (Some("OPENCODE_API_KEY"), None),
        _ => (None, None),
    };

    // 不兼容组合（如 claude × openai）一律返回空注入。
    if api_key_name.is_none() {
        return EnvInjection {
            api_key_var: None,
            base_url_var: None,
            model_args: vec![],
        };
    }

    let api_key_trimmed = api_key.map(str::trim).filter(|s| !s.is_empty());
    let base_url_trimmed = base_url.map(str::trim).filter(|s| !s.is_empty());
    let model_trimmed = model.map(str::trim).filter(|s| !s.is_empty());

    EnvInjection {
        api_key_var: api_key_name
            .zip(api_key_trimmed)
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
    fn test_claude_anthropic_env() {
        let inj = compute_injection(
            "claude",
            "anthropic",
            Some("sk-test"),
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
    fn test_codex_openai_env() {
        let inj = compute_injection(
            "codex",
            "openai",
            Some("sk-x"),
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
            Some("gkey"),
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
            Some("k"),
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
            Some("ok"),
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
        let inj = compute_injection("claude", "anthropic", Some(""), None, Some(""));
        assert_eq!(inj.api_key_var, None);
        assert_eq!(inj.base_url_var, None);
        assert!(inj.model_args.is_empty());
    }
}