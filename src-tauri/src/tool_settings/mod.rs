use crate::storage::AppDatabase;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSettings {
    pub id: String,
    pub profile_id: String,
    pub tool_type: String,
    pub model: Option<String>,
    pub thinking_intensity: Option<String>,
    pub auto_submit: Option<bool>,
    pub custom_instructions: Option<String>,
    pub settings_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateToolSettingsInput {
    pub profile_id: String,
    pub tool_type: String,
    pub model: Option<String>,
    pub thinking_intensity: Option<String>,
    pub auto_submit: Option<bool>,
    pub custom_instructions: Option<String>,
    pub settings_json: Option<String>,
}

pub fn get_tool_settings(db: &AppDatabase, profile_id: &str) -> Result<Option<ToolSettings>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let result = conn.query_row(
        "SELECT id, profile_id, tool_type, model, thinking_intensity, auto_submit, custom_instructions, settings_json, created_at, updated_at FROM tool_settings WHERE profile_id = ?1",
        [profile_id],
        |row| {
            Ok(ToolSettings {
                id: row.get(0)?,
                profile_id: row.get(1)?,
                tool_type: row.get(2)?,
                model: row.get(3)?,
                thinking_intensity: row.get(4)?,
                auto_submit: row.get::<_, Option<i32>>(5)?.map(|v| v != 0),
                custom_instructions: row.get(6)?,
                settings_json: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        },
    );

    match result {
        Ok(settings) => Ok(Some(settings)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to query tool settings: {}", e)),
    }
}

pub fn upsert_tool_settings(
    db: &AppDatabase,
    input: CreateToolSettingsInput,
) -> Result<ToolSettings, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();

    // Check if settings already exist for this profile
    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM tool_settings WHERE profile_id = ?1",
            [&input.profile_id],
            |row| row.get(0),
        )
        .ok();

    let id = existing_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    conn.execute(
        "INSERT INTO tool_settings (id, profile_id, tool_type, model, thinking_intensity, auto_submit, custom_instructions, settings_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT(id) DO UPDATE SET tool_type = ?3, model = ?4, thinking_intensity = ?5, auto_submit = ?6, custom_instructions = ?7, settings_json = ?8, updated_at = ?10",
        rusqlite::params![
            id,
            input.profile_id,
            input.tool_type,
            input.model,
            input.thinking_intensity,
            input.auto_submit.map(|v| if v { 1 } else { 0 }),
            input.custom_instructions,
            input.settings_json,
            now,
            now,
        ],
    )
    .map_err(|e| format!("Failed to upsert tool settings: {}", e))?;

    // If it was an insert, we need to set created_at properly
    if existing_id.is_none() {
        conn.execute(
            "UPDATE tool_settings SET created_at = ?1 WHERE id = ?2",
            rusqlite::params![&now, &id],
        )
        .map_err(|e| format!("Failed to set created_at: {}", e))?;
    }

    Ok(ToolSettings {
        id,
        profile_id: input.profile_id,
        tool_type: input.tool_type,
        model: input.model,
        thinking_intensity: input.thinking_intensity,
        auto_submit: input.auto_submit,
        custom_instructions: input.custom_instructions,
        settings_json: input.settings_json,
        created_at: now,
        updated_at: now,
    })
}

pub fn delete_tool_settings(db: &AppDatabase, profile_id: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM tool_settings WHERE profile_id = ?1",
        [profile_id],
    )
    .map_err(|e| format!("Failed to delete tool settings: {}", e))?;
    Ok(())
}
