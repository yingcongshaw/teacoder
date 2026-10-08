//! LLM 供应商 IPC 命令：CRUD、软删除、硬删除、默认模型切换、内置预设查询。
//!
//! 全部为薄包装，调用 [`crate::llm_provider`] 中已实现的业务函数。

use tauri::State;

use crate::llm_provider::{
    self, preset::PresetProviderView, CreateLlmProviderInput, LlmProvider, UpdateLlmProviderInput,
};
use crate::storage::AppDatabase;

/// 列出全部供应商。`include_inactive=false` 时仅返回启用的。
#[tauri::command]
pub fn llm_provider_list(
    db: State<AppDatabase>,
    include_inactive: Option<bool>,
) -> Result<Vec<LlmProvider>, String> {
    llm_provider::list_providers(&db, include_inactive.unwrap_or(false))
}

/// 按 id 查询单个供应商；不存在返回 `Ok(None)`。
#[tauri::command]
pub fn llm_provider_get(
    db: State<AppDatabase>,
    id: String,
) -> Result<Option<LlmProvider>, String> {
    llm_provider::get_provider(&db, &id)
}

/// 新建供应商（含 models）。API Key 写入 keychain，不入库。
#[tauri::command]
pub fn llm_provider_create(
    db: State<AppDatabase>,
    input: CreateLlmProviderInput,
) -> Result<LlmProvider, String> {
    llm_provider::create_provider(&db, input)
}

/// 更新供应商。字段为 `None` 表示不修改；提供 `models` 则全量替换。
#[tauri::command]
pub fn llm_provider_update(
    db: State<AppDatabase>,
    id: String,
    input: UpdateLlmProviderInput,
) -> Result<LlmProvider, String> {
    llm_provider::update_provider(&db, &id, input)
}

/// 软删除：将 `is_active` 置为 0。
#[tauri::command]
pub fn llm_provider_delete(db: State<AppDatabase>, id: String) -> Result<(), String> {
    llm_provider::delete_provider(&db, &id)
}

/// 硬删除：仅允许非预设且无会话引用的供应商。
#[tauri::command]
pub fn llm_provider_hard_delete(db: State<AppDatabase>, id: String) -> Result<(), String> {
    llm_provider::hard_delete_provider(&db, &id)
}

/// 设置某 provider 的默认模型（同时取消同 provider 下其它模型的默认）。
#[tauri::command]
pub fn llm_provider_set_default_model(
    db: State<AppDatabase>,
    provider_id: String,
    model_id: String,
) -> Result<(), String> {
    llm_provider::set_default_model(&db, &provider_id, &model_id)
}

/// 返回程序内置的全部预设 LLM 供应商模板（无需 DB）。
#[tauri::command]
pub fn llm_provider_list_presets() -> Result<Vec<PresetProviderView>, String> {
    Ok(llm_provider::preset::PRESET_PROVIDERS
        .iter()
        .map(|p| PresetProviderView {
            name: p.name.to_string(),
            provider_kind: p.provider_kind.to_string(),
            base_url: p.base_url.to_string(),
            icon: p.icon.to_string(),
            color: p.color.to_string(),
            models: p.models.iter().map(|s| s.to_string()).collect(),
        })
        .collect())
}
