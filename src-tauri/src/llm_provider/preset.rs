/// 预设供应商模板（程序内置，首次启动时 seed）
#[derive(Debug, Clone)]
pub struct PresetProvider {
    pub name: &'static str,
    pub provider_kind: &'static str,
    pub base_url: &'static str,
    pub icon: &'static str,
    pub color: &'static str,
    pub models: &'static [&'static str],
}

/// 程序内置的全部预设 LLM 供应商模板，共 14 项。
///
/// 首次启动或用户主动重置时，由 [`seed`](crate::llm_provider::seed) 模块写入数据库。
pub const PRESET_PROVIDERS: &[PresetProvider] = &[
    PresetProvider {
        name: "Anthropic",
        provider_kind: "anthropic",
        base_url: "https://api.anthropic.com",
        icon: "anthropic",
        color: "#D97757",
        models: &[
            "claude-opus-4-20250514",
            "claude-sonnet-4-20250514",
            "claude-haiku-4-20250514",
        ],
    },
    PresetProvider {
        name: "OpenAI",
        provider_kind: "openai",
        base_url: "https://api.openai.com/v1",
        icon: "openai",
        color: "#10A37F",
        models: &["gpt-4o", "gpt-4-turbo", "o1", "o1-mini"],
    },
    PresetProvider {
        name: "Google AI Studio",
        provider_kind: "google",
        base_url: "https://generativelanguage.googleapis.com/v1beta",
        icon: "google",
        color: "#4285F4",
        models: &["gemini-2.0-pro-exp", "gemini-2.0-flash-exp"],
    },
    PresetProvider {
        name: "DeepSeek",
        provider_kind: "openai",
        base_url: "https://api.deepseek.com/v1",
        icon: "deepseek",
        color: "#1E88E5",
        models: &["deepseek-chat", "deepseek-reasoner"],
    },
    PresetProvider {
        name: "GLM 智谱",
        provider_kind: "openai",
        base_url: "https://open.bigmodel.cn/api/paas/v4",
        icon: "zhipu",
        color: "#3F51B5",
        models: &["glm-4-plus", "glm-4-air", "glm-4-flash"],
    },
    PresetProvider {
        name: "Kimi 月之暗面",
        provider_kind: "openai",
        base_url: "https://api.moonshot.cn/v1",
        icon: "moonshot",
        color: "#1A1A1A",
        models: &["moonshot-v1-128k", "moonshot-v1-32k"],
    },
    PresetProvider {
        name: "Qwen 通义千问",
        provider_kind: "openai",
        base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        icon: "alibaba",
        color: "#FF6A00",
        models: &["qwen-max", "qwen-plus", "qwen-turbo"],
    },
    PresetProvider {
        name: "SiliconFlow 硅基流动",
        provider_kind: "openai",
        base_url: "https://api.siliconflow.cn/v1",
        icon: "siliconflow",
        color: "#7B61FF",
        models: &[
            "Qwen/Qwen2.5-72B-Instruct",
            "deepseek-ai/DeepSeek-V3",
        ],
    },
    PresetProvider {
        name: "豆包 Doubao",
        provider_kind: "openai",
        base_url: "https://ark.cn-beijing.volces.com/api/v3",
        icon: "doubao",
        color: "#0066FF",
        models: &["doubao-pro-32k", "doubao-lite-32k"],
    },
    PresetProvider {
        name: "Hunyuan 混元",
        provider_kind: "openai",
        base_url: "https://api.hunyuan.cloud.tencent.com/v1",
        icon: "tencent",
        color: "#0052D9",
        models: &["hunyuan-pro", "hunyuan-standard"],
    },
    PresetProvider {
        name: "零一万物 Yi",
        provider_kind: "openai",
        base_url: "https://api.lingyiwanwu.com/v1",
        icon: "yi",
        color: "#FF4D4F",
        models: &["yi-large", "yi-medium"],
    },
    PresetProvider {
        name: "百川 Baichuan",
        provider_kind: "openai",
        base_url: "https://api.baichuan-ai.com/v1",
        icon: "baichuan",
        color: "#2D8CF0",
        models: &["Baichuan4", "Baichuan3-Turbo"],
    },
    PresetProvider {
        name: "MiniMax",
        provider_kind: "anthropic",
        base_url: "https://api.MiniMax.chat/anthropic",
        icon: "MiniMax",
        color: "#FF6B6B",
        models: &["MiniMax-Text-01", "MiniMax-Text-01-250415"],
    },
    PresetProvider {
        name: "OpenRouter",
        provider_kind: "openai",
        base_url: "https://openrouter.ai/api/v1",
        icon: "openrouter",
        color: "#5E5EE6",
        models: &["anthropic/claude-sonnet-4", "openai/gpt-4o"],
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_preset_count_is_14() {
        assert_eq!(PRESET_PROVIDERS.len(), 14);
    }

    #[test]
    fn test_preset_kinds_are_valid() {
        let valid_kinds = ["anthropic", "openai", "google", "custom"];
        for p in PRESET_PROVIDERS {
            assert!(
                valid_kinds.contains(&p.provider_kind),
                "预设 {} 的 provider_kind={} 不合法",
                p.name,
                p.provider_kind
            );
        }
    }

    #[test]
    fn test_preset_base_urls_look_like_urls() {
        for p in PRESET_PROVIDERS {
            assert!(
                p.base_url.starts_with("http://") || p.base_url.starts_with("https://"),
                "预设 {} 的 base_url={} 不是合法 URL",
                p.name,
                p.base_url
            );
        }
    }

    #[test]
    fn test_preset_models_non_empty() {
        for p in PRESET_PROVIDERS {
            assert!(
                !p.models.is_empty(),
                "预设 {} 必须至少有一个默认模型",
                p.name
            );
        }
    }
}
