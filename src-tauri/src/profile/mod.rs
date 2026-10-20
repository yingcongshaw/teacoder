use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub tool_type: String,
    pub auth_type: String,
    pub base_url: Option<String>,
    pub app_data_root: Option<String>,
    pub color: Option<String>,
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Masked API key (e.g., "***...abc1"), populated from keychain on read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_stored: Option<String>,
    /// Masked OAuth token, populated from keychain on read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth_token_stored: Option<String>,
    /// Masked OAuth refresh token, populated from keychain on read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth_refresh_token_stored: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProfileInput {
    pub name: String,
    pub tool_type: String,
    pub auth_type: String,
    pub base_url: Option<String>,
    pub app_data_root: Option<String>,
    pub color: Option<String>,
    pub description: Option<String>,
    /// Plaintext API key — stored in keychain, never in SQLite.
    pub api_key: Option<String>,
    pub oauth_token: Option<String>,
    pub oauth_refresh_token: Option<String>,
}

pub fn list_profiles(db: &AppDatabase, tool_type: Option<&str>) -> Result<Vec<Profile>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let profiles = if let Some(tt) = tool_type {
        let mut stmt = conn
            .prepare("SELECT id, name, tool_type, auth_type, base_url, app_data_root, color, description, created_at, updated_at FROM profiles WHERE tool_type = ?1")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt
            .query_map([tt], |row| {
                Ok(Profile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    tool_type: row.get(2)?,
                    auth_type: row.get(3)?,
                    base_url: row.get(4)?,
                    app_data_root: row.get(5)?,
                    color: row.get(6)?,
                    description: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                    api_key_stored: None,
                    oauth_token_stored: None,
                    oauth_refresh_token_stored: None,
                })
            })
            .map_err(|e| format!("Failed to query profiles: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect profiles: {}", e))?
    } else {
        let mut stmt = conn
            .prepare("SELECT id, name, tool_type, auth_type, base_url, app_data_root, color, description, created_at, updated_at FROM profiles")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(Profile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    tool_type: row.get(2)?,
                    auth_type: row.get(3)?,
                    base_url: row.get(4)?,
                    app_data_root: row.get(5)?,
                    color: row.get(6)?,
                    description: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                    api_key_stored: None,
                    oauth_token_stored: None,
                    oauth_refresh_token_stored: None,
                })
            })
            .map_err(|e| format!("Failed to query profiles: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect profiles: {}", e))?
    };

    Ok(profiles)
}

pub fn create_profile(db: &AppDatabase, input: CreateProfileInput) -> Result<Profile, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO profiles (id, name, tool_type, auth_type, base_url, app_data_root, color, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            id,
            input.name,
            input.tool_type,
            input.auth_type,
            input.base_url,
            input.app_data_root,
            input.color,
            input.description,
            now,
            now,
        ],
    )
    .map_err(|e| format!("Failed to insert profile: {}", e))?;

    Ok(Profile {
        id,
        name: input.name,
        tool_type: input.tool_type,
        auth_type: input.auth_type,
        base_url: input.base_url,
        app_data_root: input.app_data_root,
        color: input.color,
        description: input.description,
        created_at: now,
        updated_at: now,
        api_key_stored: input.api_key,
        oauth_token_stored: input.oauth_token,
        oauth_refresh_token_stored: input.oauth_refresh_token,
    })
}

pub fn update_profile(
    db: &AppDatabase,
    id: &str,
    updates: serde_json::Value,
) -> Result<Profile, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().timestamp_millis();

    let mut set_clauses: Vec<String> = vec!["updated_at = ?1".to_string()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    let fields = [
        ("name", "name"),
        ("toolType", "tool_type"),
        ("authType", "auth_type"),
        ("baseUrl", "base_url"),
        ("appDataRoot", "app_data_root"),
        ("color", "color"),
        ("description", "description"),
    ];

    for (json_key, db_col) in fields {
        if let Some(val) = updates.get(json_key) {
            set_clauses.push(format!("{} = ?", db_col));
            if val.is_null() {
                params.push(Box::new(Option::<String>::None));
            } else {
                params.push(Box::new(val.as_str().unwrap_or_default().to_string()));
            }
        }
    }

    let sql = format!(
        "UPDATE profiles SET {} WHERE id = ?",
        set_clauses.join(", ")
    );

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut all_refs: Vec<&dyn rusqlite::types::ToSql> = param_refs;
    all_refs.push(&id);

    conn.execute(&sql, all_refs.as_slice())
        .map_err(|e| format!("Failed to update profile: {}", e))?;

    let mut stmt = conn
        .prepare("SELECT id, name, tool_type, auth_type, base_url, app_data_root, color, description, created_at, updated_at FROM profiles WHERE id = ?1")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    stmt.query_row([id], |row| {
        Ok(Profile {
            id: row.get(0)?,
            name: row.get(1)?,
            tool_type: row.get(2)?,
            auth_type: row.get(3)?,
            base_url: row.get(4)?,
            app_data_root: row.get(5)?,
            color: row.get(6)?,
            description: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
            api_key_stored: None,
            oauth_token_stored: None,
            oauth_refresh_token_stored: None,
        })
    })
    .map_err(|e| format!("Failed to fetch updated profile: {}", e))
}

pub fn delete_profile(db: &AppDatabase, id: &str, remove_data: bool) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    if remove_data {
        if let Some(app_data_root) = get_profile_app_data_root(&conn, id)? {
            let path = std::path::Path::new(&app_data_root);
            if path.exists() {
                std::fs::remove_dir_all(path)
                    .map_err(|e| format!("Failed to remove app data: {}", e))?;
            }
        }
    }

    conn.execute("DELETE FROM profiles WHERE id = ?1", [id])
        .map_err(|e| format!("Failed to delete profile: {}", e))?;

    Ok(())
}

fn get_profile_app_data_root(
    conn: &Connection,
    id: &str,
) -> Result<Option<String>, String> {
    match conn.query_row(
        "SELECT app_data_root FROM profiles WHERE id = ?1",
        [id],
        |row| row.get::<_, Option<String>>(0),
    ) {
        Ok(opt) => Ok(opt),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to query profile: {}", e)),
    }
}
