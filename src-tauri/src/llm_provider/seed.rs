use crate::storage::AppDatabase;

use super::preset::PRESET_PROVIDERS;

/// 首次启动时 seed 预设供应商。表非空时跳过（幂等）。
///
/// 返回新增的 provider 数量；如果数据库中已有预设供应商，则返回 0。
pub fn seed_preset_providers(db: &AppDatabase) -> Result<usize, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let existing: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM llm_providers WHERE is_preset = 1",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("查询 llm_providers 失败: {}", e))?;

    if existing > 0 {
        return Ok(0);
    }

    let now = chrono::Utc::now().timestamp_millis();
    let mut count = 0;

    for preset in PRESET_PROVIDERS {
        let provider_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO llm_providers (id, name, provider_kind, base_url, icon, color, is_preset, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 1, ?7, ?7)",
            rusqlite::params![
                provider_id,
                preset.name,
                preset.provider_kind,
                preset.base_url,
                preset.icon,
                preset.color,
                now,
            ],
        )
        .map_err(|e| format!("插入预设供应商 {} 失败: {}", preset.name, e))?;

        for (idx, model_name) in preset.models.iter().enumerate() {
            let model_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO llm_provider_models (id, provider_id, model_name, is_default, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    model_id,
                    provider_id,
                    model_name,
                    if idx == 0 { 1 } else { 0 },
                    idx as i64,
                    now,
                ],
            )
            .map_err(|e| format!("插入模型 {} 失败: {}", model_name, e))?;
        }
        count += 1;
    }

    Ok(count)
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
    fn test_seed_inserts_14_providers() {
        let db = make_db();
        let count = seed_preset_providers(&db).unwrap();
        assert_eq!(count, 14);

        let conn = db.conn.lock().unwrap();
        let provider_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM llm_providers", [], |r| r.get(0))
            .unwrap();
        assert_eq!(provider_count, 14, "应插入 14 个供应商");

        let model_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM llm_provider_models", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(model_count > 14, "应至少有 14 个模型，实际: {}", model_count);
    }

    #[test]
    fn test_seed_is_idempotent() {
        let db = make_db();
        assert_eq!(seed_preset_providers(&db).unwrap(), 14);
        assert_eq!(
            seed_preset_providers(&db).unwrap(),
            0,
            "二次调用应返回 0（幂等）"
        );
    }

    #[test]
    fn test_first_model_marked_default() {
        let db = make_db();
        seed_preset_providers(&db).unwrap();
        let conn = db.conn.lock().unwrap();
        let default_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM llm_provider_models WHERE is_default = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            default_count, 14,
            "每个 provider 应有且仅有一个默认模型"
        );
    }
}
