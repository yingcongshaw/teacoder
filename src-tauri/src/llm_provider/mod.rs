//! LLM 供应商管理模块：CRUD、软删除、硬删除、默认模型切换。
//!
//! API Key 不存储在 SQLite，统一通过 `crate::crypto::keychain` 写入系统 Keychain。
//!
//! 本模块的 `pub` 类型与函数在本任务（Task 4）尚未接入 IPC 命令层，
//! 故对 lib crate 自身而言属于"未被非测试代码引用"。下一阶段（Task 5）注册 IPC 后会消除。

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

pub mod preset;
pub mod seed;

/// 单个 LLM 供应商的完整视图（含 models）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProvider {
    pub id: String,
    pub name: String,
    pub provider_kind: String,
    pub base_url: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub is_preset: bool,
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
    /// 模型列表（按 sort_order 排序）
    pub models: Vec<LlmProviderModel>,
}

/// 单个供应商下属模型。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderModel {
    pub id: String,
    pub provider_id: String,
    pub model_name: String,
    pub is_default: bool,
    pub sort_order: i64,
    pub created_at: i64,
}

/// 新建供应商的输入。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateLlmProviderInput {
    pub name: String,
    pub provider_kind: String,
    pub base_url: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    /// 模型名列表，按出现顺序作为 sort_order。
    pub models: Vec<String>,
    /// 默认模型名（须在 models 内）；None 则取第一个。
    pub default_model: Option<String>,
    /// API Key（写入 keychain，不入库）。
    pub api_key: Option<String>,
}

/// 更新供应商的输入：所有字段可选，None 表示不修改。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLlmProviderInput {
    pub name: Option<String>,
    pub provider_kind: Option<String>,
    pub base_url: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    /// 提供则全量替换模型列表。
    pub models: Option<Vec<String>>,
    /// 提供则替换默认模型（须在新 models 内）。
    pub default_model: Option<String>,
    pub is_active: Option<bool>,
    /// 提供则覆盖写入 keychain（空字符串视同删除）。
    pub api_key: Option<String>,
}

/// 将单行模型记录解析为 `LlmProviderModel`。
fn row_to_model(row: &rusqlite::Row) -> Result<LlmProviderModel, rusqlite::Error> {
    let is_default: i64 = row.get(3)?;
    Ok(LlmProviderModel {
        id: row.get(0)?,
        provider_id: row.get(1)?,
        model_name: row.get(2)?,
        is_default: is_default != 0,
        sort_order: row.get(4)?,
        created_at: row.get(5)?,
    })
}

/// 加载指定 provider 的全部模型（按 sort_order 升序）。
fn load_models_for(
    conn: &rusqlite::Connection,
    provider_id: &str,
) -> Result<Vec<LlmProviderModel>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, provider_id, model_name, is_default, sort_order, created_at \
             FROM llm_provider_models WHERE provider_id = ?1 ORDER BY sort_order ASC",
        )
        .map_err(|e| format!("准备查询模型失败: {}", e))?;
    let rows = stmt
        .query_map([provider_id], row_to_model)
        .map_err(|e| format!("查询模型失败: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("收集模型失败: {}", e))
}

/// 列出供应商（默认排除已软删除的）。
pub fn list_providers(
    db: &AppDatabase,
    include_inactive: bool,
) -> Result<Vec<LlmProvider>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let sql = if include_inactive {
        "SELECT id, name, provider_kind, base_url, icon, color, is_preset, is_active, created_at, updated_at \
         FROM llm_providers ORDER BY is_preset DESC, name ASC"
    } else {
        "SELECT id, name, provider_kind, base_url, icon, color, is_preset, is_active, created_at, updated_at \
         FROM llm_providers WHERE is_active = 1 ORDER BY is_preset DESC, name ASC"
    };

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("准备查询供应商失败: {}", e))?;

    let providers: Vec<LlmProvider> = stmt
        .query_map([], |row| {
            Ok(LlmProvider {
                id: row.get(0)?,
                name: row.get(1)?,
                provider_kind: row.get(2)?,
                base_url: row.get(3)?,
                icon: row.get(4)?,
                color: row.get(5)?,
                is_preset: row.get::<_, i64>(6)? != 0,
                is_active: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                models: vec![],
            })
        })
        .map_err(|e| format!("查询供应商失败: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("收集供应商失败: {}", e))?;

    // 二次加载 models（数据量小，保持简洁；后续可改 LEFT JOIN）
    let mut result = Vec::with_capacity(providers.len());
    for mut p in providers {
        p.models = load_models_for(&conn, &p.id)?;
        result.push(p);
    }
    Ok(result)
}

/// 按 id 查询单个供应商；不存在返回 Ok(None)。
pub fn get_provider(db: &AppDatabase, id: &str) -> Result<Option<LlmProvider>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, provider_kind, base_url, icon, color, is_preset, is_active, created_at, updated_at \
             FROM llm_providers WHERE id = ?1",
        )
        .map_err(|e| format!("准备查询供应商失败: {}", e))?;

    let provider = stmt
        .query_row([id], |row| {
            Ok(LlmProvider {
                id: row.get(0)?,
                name: row.get(1)?,
                provider_kind: row.get(2)?,
                base_url: row.get(3)?,
                icon: row.get(4)?,
                color: row.get(5)?,
                is_preset: row.get::<_, i64>(6)? != 0,
                is_active: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                models: vec![],
            })
        })
        .ok();

    match provider {
        Some(mut p) => {
            p.models = load_models_for(&conn, &p.id)?;
            Ok(Some(p))
        }
        None => Ok(None),
    }
}

/// 新建供应商（含 models）。API Key 写入 keychain。
pub fn create_provider(
    db: &AppDatabase,
    input: CreateLlmProviderInput,
) -> Result<LlmProvider, String> {
    let provider_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    // 先在事务外处理 keychain（不属于 SQL 事务范围）
    if let Some(key) = &input.api_key {
        if !key.is_empty() {
            crate::crypto::keychain::store_secret(&provider_id, "api_key", key)
                .map_err(|e| format!("存储 API Key 到 keychain 失败: {}", e))?;
        }
    }

    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("开启事务失败: {}", e))?;

        tx.execute(
            "INSERT INTO llm_providers \
             (id, name, provider_kind, base_url, icon, color, is_preset, is_active, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 1, ?7, ?7)",
            rusqlite::params![
                provider_id,
                input.name,
                input.provider_kind,
                input.base_url,
                input.icon,
                input.color,
                now,
            ],
        )
        .map_err(|e| format!("插入供应商失败: {}", e))?;

        for (idx, model_name) in input.models.iter().enumerate() {
            let model_id = uuid::Uuid::new_v4().to_string();
            let is_default = match &input.default_model {
                Some(d) => d == model_name,
                None => idx == 0,
            };
            tx.execute(
                "INSERT INTO llm_provider_models \
                 (id, provider_id, model_name, is_default, sort_order, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![model_id, provider_id, model_name, is_default as i64, idx as i64, now],
            )
            .map_err(|e| format!("插入模型 {} 失败: {}", model_name, e))?;
        }

        tx.commit()
            .map_err(|e| format!("提交事务失败: {}", e))?;
    }

    get_provider(db, &provider_id)?.ok_or_else(|| "新建的供应商查询不到".to_string())
}

/// 更新供应商。可选更新字段，None 不动。提供 models 则全量替换。
pub fn update_provider(
    db: &AppDatabase,
    id: &str,
    input: UpdateLlmProviderInput,
) -> Result<LlmProvider, String> {
    // keychain 在事务外处理
    if let Some(key) = &input.api_key {
        if key.is_empty() {
            // 空字符串视为删除（容错）
            let _ = crate::crypto::keychain::delete_secret(id, "api_key");
        } else {
            crate::crypto::keychain::store_secret(id, "api_key", key)
                .map_err(|e| format!("存储 API Key 到 keychain 失败: {}", e))?;
        }
    }

    let now = chrono::Utc::now().timestamp_millis();
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("开启事务失败: {}", e))?;

        // 更新基本字段
        let mut sets = vec!["updated_at = ?1".to_string()];
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
        let add_opt = |sets: &mut Vec<String>,
                       params: &mut Vec<Box<dyn rusqlite::types::ToSql>>,
                       col: &str,
                       val: Option<String>| {
            if let Some(v) = val {
                sets.push(format!("{} = ?", col));
                params.push(Box::new(v));
            }
        };
        add_opt(&mut sets, &mut params, "name", input.name.clone());
        add_opt(&mut sets, &mut params, "provider_kind", input.provider_kind.clone());
        add_opt(&mut sets, &mut params, "base_url", input.base_url.clone());
        add_opt(&mut sets, &mut params, "icon", input.icon.clone());
        add_opt(&mut sets, &mut params, "color", input.color.clone());
        if let Some(active) = input.is_active {
            sets.push("is_active = ?".to_string());
            params.push(Box::new(active as i64));
        }

        let sql = format!(
            "UPDATE llm_providers SET {} WHERE id = ?",
            sets.join(", ")
        );
        params.push(Box::new(id.to_string()));

        let refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        tx.execute(&sql, refs.as_slice())
            .map_err(|e| format!("更新供应商失败: {}", e))?;

        // 若提供 models，全量替换
        if let Some(models) = &input.models {
            tx.execute(
                "DELETE FROM llm_provider_models WHERE provider_id = ?1",
                [id],
            )
            .map_err(|e| format!("清除旧模型失败: {}", e))?;

            for (idx, model_name) in models.iter().enumerate() {
                let model_id = uuid::Uuid::new_v4().to_string();
                let is_default = match &input.default_model {
                    Some(d) => d == model_name,
                    None => idx == 0,
                };
                tx.execute(
                    "INSERT INTO llm_provider_models \
                     (id, provider_id, model_name, is_default, sort_order, created_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![model_id, id, model_name, is_default as i64, idx as i64, now],
                )
                .map_err(|e| format!("插入新模型 {} 失败: {}", model_name, e))?;
            }
        }

        tx.commit()
            .map_err(|e| format!("提交事务失败: {}", e))?;
    }

    get_provider(db, id)?.ok_or_else(|| "更新的供应商查询不到".to_string())
}

/// 软删除：将 is_active 置为 0。
pub fn delete_provider(db: &AppDatabase, id: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();
    let updated = conn
        .execute(
            "UPDATE llm_providers SET is_active = 0, updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, id],
        )
        .map_err(|e| format!("软删除供应商失败: {}", e))?;
    if updated == 0 {
        return Err(format!("供应商 {} 不存在", id));
    }
    Ok(())
}

/// 硬删除：仅允许删除非预设且无会话引用的供应商，同时清理 keychain。
pub fn hard_delete_provider(db: &AppDatabase, id: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let is_preset: i64 = conn
        .query_row(
            "SELECT is_preset FROM llm_providers WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| format!("查询供应商失败: {}", e))?;
    if is_preset != 0 {
        return Err("预设供应商不可硬删除".to_string());
    }

    let refs: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE llm_provider_id = ?1",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| format!("查询会话引用失败: {}", e))?;
    if refs > 0 {
        return Err(format!("供应商被 {} 个会话引用，无法硬删除", refs));
    }

    conn.execute("DELETE FROM llm_providers WHERE id = ?1", [id])
        .map_err(|e| format!("硬删除供应商失败: {}", e))?;

    // 清理 keychain（错误打到 stderr，但不阻塞删除）
    if let Err(e) = crate::crypto::keychain::delete_secret(id, "api_key") {
        eprintln!("[llm_provider] 清理 keychain 失败: {}", e);
    }

    Ok(())
}

/// 设置某 provider 的默认模型（同时取消同 provider 下其它模型的默认）。
pub fn set_default_model(
    db: &AppDatabase,
    provider_id: &str,
    model_id: &str,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let belongs: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM llm_provider_models WHERE id = ?1 AND provider_id = ?2)",
            rusqlite::params![model_id, provider_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("验证模型归属失败: {}", e))?;
    if !belongs {
        return Err("模型不属于该供应商".to_string());
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("开启事务失败: {}", e))?;
    tx.execute(
        "UPDATE llm_provider_models SET is_default = 0 WHERE provider_id = ?1",
        [provider_id],
    )
    .map_err(|e| format!("取消旧默认模型失败: {}", e))?;
    tx.execute(
        "UPDATE llm_provider_models SET is_default = 1 WHERE id = ?1",
        [model_id],
    )
    .map_err(|e| format!("设置新默认模型失败: {}", e))?;
    tx.commit()
        .map_err(|e| format!("提交事务失败: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::sync::Mutex;

    fn make_db() -> AppDatabase {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("../../migrations/v1_initial.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/v2_tool_settings.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/v3_projects.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/v4_cli_session_id.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/v5_session_categories.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/v6_session_messages.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/v7_app_settings.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/v8_llm_providers.sql"))
            .unwrap();
        AppDatabase {
            conn: Mutex::new(conn),
        }
    }

    #[test]
    fn test_list_providers_excludes_inactive_by_default() {
        let db = make_db();
        seed::seed_preset_providers(&db).unwrap();
        let providers = list_providers(&db, false).unwrap();
        assert_eq!(providers.len(), 14);
        assert!(providers.iter().all(|p| p.is_active));
        // 预设优先 + name 升序
        assert_eq!(providers[0].name, "Anthropic");
    }

    #[test]
    fn test_get_provider_returns_none_for_missing() {
        let db = make_db();
        let result = get_provider(&db, "non-existent-id").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_create_provider_persists_models() {
        let db = make_db();
        let input = CreateLlmProviderInput {
            name: "Test Provider".into(),
            provider_kind: "openai".into(),
            base_url: Some("https://test.example.com/v1".into()),
            icon: Some("test".into()),
            color: Some("#FF0000".into()),
            models: vec!["model-a".into(), "model-b".into()],
            default_model: Some("model-a".into()),
            api_key: None,
        };
        let created = create_provider(&db, input).unwrap();
        assert_eq!(created.models.len(), 2);
        let default = created
            .models
            .iter()
            .find(|m| m.model_name == "model-a")
            .expect("应能找到 model-a");
        assert!(default.is_default, "model-a 应被标记为默认");
        assert!(!created.is_preset, "新建供应商不应为预设");
        assert!(created.is_active);
    }

    #[test]
    fn test_update_provider_replaces_models() {
        let db = make_db();
        let input = CreateLlmProviderInput {
            name: "P".into(),
            provider_kind: "anthropic".into(),
            base_url: None,
            icon: None,
            color: None,
            models: vec!["old-1".into()],
            default_model: None,
            api_key: None,
        };
        let created = create_provider(&db, input).unwrap();
        let update = UpdateLlmProviderInput {
            models: Some(vec!["new-1".into(), "new-2".into()]),
            default_model: Some("new-2".into()),
            ..Default::default()
        };
        let updated = update_provider(&db, &created.id, update).unwrap();
        assert_eq!(updated.models.len(), 2);
        let names: Vec<&str> = updated
            .models
            .iter()
            .map(|m| m.model_name.as_str())
            .collect();
        assert!(names.contains(&"new-1") && names.contains(&"new-2"));
        let new_default = updated
            .models
            .iter()
            .find(|m| m.model_name == "new-2")
            .expect("应能找到 new-2");
        assert!(new_default.is_default, "new-2 应被标记为默认");
    }

    #[test]
    fn test_delete_provider_soft_deletes() {
        let db = make_db();
        let input = CreateLlmProviderInput {
            name: "P".into(),
            provider_kind: "openai".into(),
            base_url: None,
            icon: None,
            color: None,
            models: vec!["m".into()],
            default_model: None,
            api_key: None,
        };
        let created = create_provider(&db, input).unwrap();
        delete_provider(&db, &created.id).unwrap();
        let listed = list_providers(&db, false).unwrap();
        assert!(!listed.iter().any(|p| p.id == created.id));
        let listed_inactive = list_providers(&db, true).unwrap();
        let deleted = listed_inactive
            .iter()
            .find(|p| p.id == created.id)
            .expect("include_inactive=true 时应能查到");
        assert!(!deleted.is_active);
    }

    #[test]
    fn test_set_default_model_only_one_default() {
        let db = make_db();
        seed::seed_preset_providers(&db).unwrap();
        // 取第一个 provider 的前两个 model
        let providers = list_providers(&db, false).unwrap();
        let p = &providers[0];
        assert!(p.models.len() >= 2, "预设 provider 应至少两个模型");
        let m0 = &p.models[0];
        let m1 = &p.models[1];

        set_default_model(&db, &p.id, &m1.id).unwrap();

        let after = get_provider(&db, &p.id).unwrap().unwrap();
        let defaults: Vec<&str> = after
            .models
            .iter()
            .filter(|m| m.is_default)
            .map(|m| m.model_name.as_str())
            .collect();
        assert_eq!(defaults.len(), 1, "应恰好一个默认模型");
        assert_eq!(defaults[0], m1.model_name);
        // m0 不再是默认
        assert!(!after.models.iter().find(|m| m.id == m0.id).unwrap().is_default);
    }

    #[test]
    fn test_hard_delete_preset_fails() {
        let db = make_db();
        seed::seed_preset_providers(&db).unwrap();
        let providers = list_providers(&db, false).unwrap();
        let preset = &providers[0];
        assert!(preset.is_preset);
        let result = hard_delete_provider(&db, &preset.id);
        assert!(result.is_err(), "硬删除预设应报错");
        // 数据库中仍然存在
        let after = get_provider(&db, &preset.id).unwrap();
        assert!(after.is_some());
    }
}
