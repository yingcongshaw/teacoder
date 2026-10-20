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

// -----------------------------------------------------------------------------
// Claude Code 模型 tier 映射 → 环境变量
// -----------------------------------------------------------------------------

/// Claude Code 五个 tier 的模型名 + 1M 标记。
#[derive(Default, Debug)]
struct ClaudeTierMap {
    sonnet: Option<String>,
    opus: Option<String>,
    haiku: Option<String>,
    fable: Option<String>,
    subagent: Option<String>,
    sonnet1m: bool,
    opus1m: bool,
    haiku1m: bool,
    fable1m: bool,
    subagent1m: bool,
}

fn apply_str(value: &mut Option<String>, raw: &serde_json::Value) {
    if let Some(s) = raw.as_str() {
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            *value = Some(trimmed.to_string());
        }
    }
}

fn apply_bool(flag: &mut bool, raw: &serde_json::Value) {
    if let Some(b) = raw.as_bool() {
        *flag = b;
    }
}

fn parse_claude_tier_map(claude_models: Option<&str>) -> ClaudeTierMap {
    let mut map = ClaudeTierMap::default();
    let Some(raw) = claude_models else {
        return map;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return map;
    };
    let Some(obj) = value.as_object() else {
        return map;
    };
    if let Some(v) = obj.get("sonnet") { apply_str(&mut map.sonnet, v); }
    if let Some(v) = obj.get("opus") { apply_str(&mut map.opus, v); }
    if let Some(v) = obj.get("haiku") { apply_str(&mut map.haiku, v); }
    if let Some(v) = obj.get("fable") { apply_str(&mut map.fable, v); }
    if let Some(v) = obj.get("subagent") { apply_str(&mut map.subagent, v); }
    if let Some(v) = obj.get("sonnet1M") { apply_bool(&mut map.sonnet1m, v); }
    if let Some(v) = obj.get("opus1M") { apply_bool(&mut map.opus1m, v); }
    if let Some(v) = obj.get("haiku1M") { apply_bool(&mut map.haiku1m, v); }
    if let Some(v) = obj.get("fable1M") { apply_bool(&mut map.fable1m, v); }
    if let Some(v) = obj.get("subagent1M") { apply_bool(&mut map.subagent1m, v); }
    map
}

/// 拼接带 1M 后缀的模型名。
fn with_one_m(model: &str, one_m: bool) -> String {
    if one_m {
        format!("{}[1M]", model)
    } else {
        model.to_string()
    }
}

fn push_tier_env(out: &mut Vec<(String, String)>, key: &str, model: Option<String>, one_m: bool) {
    if let Some(m) = model {
        out.push((key.to_string(), with_one_m(&m, one_m)));
    }
}

fn push_tier_name_env(out: &mut Vec<(String, String)>, key: &str, model: Option<String>) {
    if let Some(m) = model {
        out.push((key.to_string(), m));
    }
}

/// Claude Code 模型 tier 映射 → 环境变量列表。
///
/// 输出 10 个环境变量（按以下规则）：
/// - `ANTHROPIC_DEFAULT_{SONNET,OPUS,HAIKU,FABLE}_MODEL`     模型名 + (1M ? "[1M]" : "")
/// - `ANTHROPIC_DEFAULT_{SONNET,OPUS,HAIKU,FABLE}_MODEL_NAME` 模型名（不带后缀）
/// - `ANTHROPIC_MODEL`                                        sonnet + (sonnet1M ? "[1M]" : "")
/// - `CLAUDE_CODE_SUBAGENT_MODEL`                             subagent + (subagent1M ? "[1M]" : "")
///
/// tier 模型名为空时跳过该行。`claude_models` 为 None / 解析失败 / 全空时返回空 Vec。
pub fn compute_claude_tier_env(claude_models: Option<&str>) -> Vec<(String, String)> {
    let map = parse_claude_tier_map(claude_models);
    let mut out = Vec::with_capacity(10);

    push_tier_env(&mut out, "ANTHROPIC_DEFAULT_SONNET_MODEL", map.sonnet.clone(), map.sonnet1m);
    push_tier_name_env(&mut out, "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME", map.sonnet.clone());

    push_tier_env(&mut out, "ANTHROPIC_DEFAULT_OPUS_MODEL", map.opus.clone(), map.opus1m);
    push_tier_name_env(&mut out, "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME", map.opus.clone());

    push_tier_env(&mut out, "ANTHROPIC_DEFAULT_HAIKU_MODEL", map.haiku.clone(), map.haiku1m);
    push_tier_name_env(&mut out, "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME", map.haiku.clone());

    push_tier_env(&mut out, "ANTHROPIC_DEFAULT_FABLE_MODEL", map.fable.clone(), map.fable1m);
    push_tier_name_env(&mut out, "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME", map.fable.clone());

    // ANTHROPIC_MODEL：默认主模型（用 Sonnet）
    if let Some(m) = map.sonnet.clone() {
        out.push(("ANTHROPIC_MODEL".to_string(), with_one_m(&m, map.sonnet1m)));
    }

    push_tier_env(&mut out, "CLAUDE_CODE_SUBAGENT_MODEL", map.subagent, map.subagent1m);

    out
}

#[cfg(test)]
mod tier_env_tests {
    use super::*;

    fn to_map(pairs: &[(&str, &str)]) -> serde_json::Value {
        let mut m = serde_json::Map::new();
        for (k, v) in pairs {
            m.insert(k.to_string(), serde_json::Value::String(v.to_string()));
        }
        serde_json::Value::Object(m)
    }

    #[test]
    fn test_none_returns_empty() {
        assert!(compute_claude_tier_env(None).is_empty());
    }

    #[test]
    fn test_invalid_json_returns_empty() {
        assert!(compute_claude_tier_env(Some("not-json")).is_empty());
    }

    #[test]
    fn test_all_tiers_no_one_m() {
        let json = to_map(&[
            ("sonnet", "sonnet-model"),
            ("opus", "opus-model"),
            ("haiku", "haiku-model"),
            ("fable", "fable-model"),
            ("subagent", "subagent-model"),
        ])
        .to_string();
        let envs = compute_claude_tier_env(Some(&json));
        assert_eq!(envs.len(), 10);
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(), "sonnet-model".to_string())));
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(), "opus-model".to_string())));
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(), "haiku-model".to_string())));
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_FABLE_MODEL".to_string(), "fable-model".to_string())));
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_SONNET_MODEL_NAME".to_string(), "sonnet-model".to_string())));
        // ANTHROPIC_MODEL 默认 = sonnet
        assert!(envs.contains(&("ANTHROPIC_MODEL".to_string(), "sonnet-model".to_string())));
        // subagent
        assert!(envs.contains(&("CLAUDE_CODE_SUBAGENT_MODEL".to_string(), "subagent-model".to_string())));
    }

    #[test]
    fn test_all_tiers_with_one_m() {
        let mut obj = serde_json::Map::new();
        obj.insert("sonnet".to_string(), serde_json::json!("M"));
        obj.insert("opus".to_string(), serde_json::json!("M"));
        obj.insert("haiku".to_string(), serde_json::json!("M"));
        obj.insert("fable".to_string(), serde_json::json!("M"));
        obj.insert("subagent".to_string(), serde_json::json!("M"));
        obj.insert("sonnet1M".to_string(), serde_json::json!(true));
        obj.insert("opus1M".to_string(), serde_json::json!(true));
        obj.insert("haiku1M".to_string(), serde_json::json!(true));
        obj.insert("fable1M".to_string(), serde_json::json!(true));
        obj.insert("subagent1M".to_string(), serde_json::json!(true));
        let json = serde_json::Value::Object(obj).to_string();

        let envs = compute_claude_tier_env(Some(&json));
        assert_eq!(envs.len(), 10);
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(), "M[1M]".to_string())));
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(), "M[1M]".to_string())));
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(), "M[1M]".to_string())));
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_FABLE_MODEL".to_string(), "M[1M]".to_string())));
        // _MODEL_NAME 不带后缀
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_SONNET_MODEL_NAME".to_string(), "M".to_string())));
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_OPUS_MODEL_NAME".to_string(), "M".to_string())));
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME".to_string(), "M".to_string())));
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_FABLE_MODEL_NAME".to_string(), "M".to_string())));
        // ANTHROPIC_MODEL 默认 = sonnet（含 [1M]）
        assert!(envs.contains(&("ANTHROPIC_MODEL".to_string(), "M[1M]".to_string())));
        assert!(envs.contains(&("CLAUDE_CODE_SUBAGENT_MODEL".to_string(), "M[1M]".to_string())));
    }

    #[test]
    fn test_mixed_one_m_flags() {
        // sonnet1M=true, opus1M=false, haiku1M 缺失（视为 false）
        let mut obj = serde_json::Map::new();
        obj.insert("sonnet".to_string(), serde_json::json!("S"));
        obj.insert("opus".to_string(), serde_json::json!("O"));
        obj.insert("haiku".to_string(), serde_json::json!("H"));
        obj.insert("sonnet1M".to_string(), serde_json::json!(true));
        obj.insert("opus1M".to_string(), serde_json::json!(false));
        let json = serde_json::Value::Object(obj).to_string();

        let envs = compute_claude_tier_env(Some(&json));
        // 只有 sonnet/opus/haiku 三个 tier → 3 个 _MODEL + 3 个 _MODEL_NAME + ANTHROPIC_MODEL = 7 个
        assert_eq!(envs.len(), 7);
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(), "S[1M]".to_string())));
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(), "O".to_string())));
        assert!(envs.contains(&("ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(), "H".to_string())));
        assert!(envs.contains(&("ANTHROPIC_MODEL".to_string(), "S[1M]".to_string())));
    }

    #[test]
    fn test_empty_model_values_are_skipped() {
        let mut obj = serde_json::Map::new();
        obj.insert("sonnet".to_string(), serde_json::json!(""));
        obj.insert("opus".to_string(), serde_json::json!("   "));
        // haiku 缺失
        let json = serde_json::Value::Object(obj).to_string();
        let envs = compute_claude_tier_env(Some(&json));
        assert!(envs.is_empty(), "所有 tier 模型名空时应返回空");
    }

    #[test]
    fn test_extra_unknown_keys_are_ignored() {
        // 包含污染数据中的索引键与未知字段
        let mut obj = serde_json::Map::new();
        obj.insert("sonnet".to_string(), serde_json::json!("S"));
        obj.insert("0".to_string(), serde_json::json!("{"));
        obj.insert("fable".to_string(), serde_json::json!("x"));
        obj.insert("unknown".to_string(), serde_json::json!("y"));
        let json = serde_json::Value::Object(obj).to_string();
        let envs = compute_claude_tier_env(Some(&json));
        // 只有 sonnet + fable 两个模型字段，ANTHROPIC_MODEL = sonnet
        assert_eq!(envs.len(), 5);
    }
}