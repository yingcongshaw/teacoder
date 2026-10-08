use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project_id: String,
    pub title: Option<String>,
    pub tool_type: String,
    pub profile_id: Option<String>,
    pub color: Option<String>,
    pub thinking_intensity: String,
    pub template_id: Option<String>,
    pub cli_args: Option<String>,
    pub env_vars: Option<String>,
    pub is_running: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub closed_at: Option<i64>,
    pub cli_session_id: Option<String>,
    pub category_id: Option<String>,
    pub llm_provider_id: Option<String>,
    pub model_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    pub project_id: String,
    pub tool_type: String,
    pub title: Option<String>,
    pub profile_id: Option<String>,
    pub color: Option<String>,
    pub thinking_intensity: Option<String>,
    pub template_id: Option<String>,
    pub cli_args: Option<String>,
    pub env_vars: Option<String>,
    pub cli_session_id: Option<String>,
    pub category_id: Option<String>,
    pub llm_provider_id: Option<String>,
    pub model_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionInput {
    pub title: Option<String>,
    pub profile_id: Option<String>,
    pub color: Option<String>,
    pub thinking_intensity: Option<String>,
    pub template_id: Option<String>,
    pub cli_args: Option<String>,
    pub env_vars: Option<String>,
    pub is_running: Option<bool>,
    pub closed_at: Option<i64>,
    pub project_id: Option<String>,
    pub cli_session_id: Option<String>,
    pub category_id: Option<String>,
    pub llm_provider_id: Option<String>,
    pub model_name: Option<String>,
}

fn row_to_session(row: &rusqlite::Row) -> Result<Session, rusqlite::Error> {
    let is_running_int: i64 = row.get(10)?;
    Ok(Session {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        tool_type: row.get(3)?,
        profile_id: row.get(4)?,
        color: row.get(5)?,
        thinking_intensity: row.get(6)?,
        template_id: row.get(7)?,
        cli_args: row.get(8)?,
        env_vars: row.get(9)?,
        is_running: is_running_int != 0,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        closed_at: row.get(13)?,
        cli_session_id: row.get(14)?,
        category_id: row.get(15)?,
        llm_provider_id: row.get(16)?,
        model_name: row.get(17)?,
    })
}

const SESSION_COLUMNS: &str = "id, project_id, title, tool_type, profile_id, color, thinking_intensity, template_id, cli_args, env_vars, is_running, created_at, updated_at, closed_at, cli_session_id, category_id, llm_provider_id, model_name";

pub fn list_sessions(
    db: &AppDatabase,
    project_id: Option<&str>,
) -> Result<Vec<Session>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let sessions = if let Some(pid) = project_id {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {} FROM sessions WHERE project_id = ?1 ORDER BY updated_at DESC",
                SESSION_COLUMNS
            ))
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt
            .query_map([pid], |row| row_to_session(row))
            .map_err(|e| format!("Failed to query sessions: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect sessions: {}", e))?
    } else {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {} FROM sessions ORDER BY updated_at DESC",
                SESSION_COLUMNS
            ))
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt
            .query_map([], |row| row_to_session(row))
            .map_err(|e| format!("Failed to query sessions: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect sessions: {}", e))?
    };

    Ok(sessions)
}

pub fn create_session(db: &AppDatabase, input: CreateSessionInput) -> Result<Session, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let thinking_intensity = input.thinking_intensity.unwrap_or_else(|| "medium".to_string());
    let is_running: i64 = 1;

    conn.execute(
        "INSERT INTO sessions (id, project_id, title, tool_type, profile_id, color, thinking_intensity, template_id, cli_args, env_vars, is_running, created_at, updated_at, cli_session_id, category_id, llm_provider_id, model_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        rusqlite::params![
            id,
            input.project_id,
            input.title,
            input.tool_type,
            input.profile_id,
            input.color,
            thinking_intensity,
            input.template_id,
            input.cli_args,
            input.env_vars,
            is_running,
            now,
            now,
            input.cli_session_id,
            input.category_id,
            input.llm_provider_id,
            input.model_name,
        ],
    )
    .map_err(|e| format!("Failed to insert session: {}", e))?;

    Ok(Session {
        id,
        project_id: input.project_id,
        title: input.title,
        tool_type: input.tool_type,
        profile_id: input.profile_id,
        color: input.color,
        thinking_intensity,
        template_id: input.template_id,
        cli_args: input.cli_args,
        env_vars: input.env_vars,
        is_running: true,
        created_at: now,
        updated_at: now,
        closed_at: None,
        cli_session_id: input.cli_session_id,
        category_id: input.category_id,
        llm_provider_id: input.llm_provider_id,
        model_name: input.model_name,
    })
}

pub fn update_session(
    db: &AppDatabase,
    id: &str,
    input: UpdateSessionInput,
) -> Result<Session, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().timestamp_millis();

    let mut set_clauses: Vec<String> = vec!["updated_at = ?1".to_string()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(ref title) = input.title {
        set_clauses.push("title = ?".to_string());
        params.push(Box::new(title.clone()));
    }

    if let Some(ref profile_id) = input.profile_id {
        set_clauses.push("profile_id = ?".to_string());
        params.push(Box::new(profile_id.clone()));
    }

    if let Some(ref color) = input.color {
        set_clauses.push("color = ?".to_string());
        params.push(Box::new(color.clone()));
    }

    if let Some(ref thinking_intensity) = input.thinking_intensity {
        set_clauses.push("thinking_intensity = ?".to_string());
        params.push(Box::new(thinking_intensity.clone()));
    }

    if let Some(ref template_id) = input.template_id {
        set_clauses.push("template_id = ?".to_string());
        params.push(Box::new(template_id.clone()));
    }

    if let Some(ref cli_args) = input.cli_args {
        set_clauses.push("cli_args = ?".to_string());
        params.push(Box::new(cli_args.clone()));
    }

    if let Some(ref env_vars) = input.env_vars {
        set_clauses.push("env_vars = ?".to_string());
        params.push(Box::new(env_vars.clone()));
    }

    if let Some(is_running) = input.is_running {
        set_clauses.push("is_running = ?".to_string());
        params.push(Box::new(is_running as i64));
    }

    if let Some(closed_at) = input.closed_at {
        if closed_at == 0 {
            set_clauses.push("closed_at = NULL".to_string());
        } else {
            set_clauses.push("closed_at = ?".to_string());
            params.push(Box::new(closed_at));
        }
    }

    if let Some(ref project_id) = input.project_id {
        set_clauses.push("project_id = ?".to_string());
        params.push(Box::new(project_id.clone()));
    }

    if let Some(ref cli_session_id) = input.cli_session_id {
        set_clauses.push("cli_session_id = ?".to_string());
        params.push(Box::new(cli_session_id.clone()));
    }

    if let Some(ref category_id) = input.category_id {
        if category_id.is_empty() {
            set_clauses.push("category_id = NULL".to_string());
        } else {
            set_clauses.push("category_id = ?".to_string());
            params.push(Box::new(category_id.clone()));
        }
    }

    if let Some(ref llm_provider_id) = input.llm_provider_id {
        set_clauses.push("llm_provider_id = ?".to_string());
        params.push(Box::new(llm_provider_id.clone()));
    }

    if let Some(ref model_name) = input.model_name {
        set_clauses.push("model_name = ?".to_string());
        params.push(Box::new(model_name.clone()));
    }

    let sql = format!(
        "UPDATE sessions SET {} WHERE id = ?",
        set_clauses.join(", ")
    );

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut all_refs: Vec<&dyn rusqlite::types::ToSql> = param_refs;
    all_refs.push(&id);

    conn.execute(&sql, all_refs.as_slice())
        .map_err(|e| format!("Failed to update session: {}", e))?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM sessions WHERE id = ?1",
            SESSION_COLUMNS
        ))
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    stmt.query_row([id], |row| row_to_session(row))
        .map_err(|e| format!("Failed to fetch updated session: {}", e))
}

pub fn delete_session(db: &AppDatabase, id: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM sessions WHERE id = ?1", [id])
        .map_err(|e| format!("Failed to delete session: {}", e))?;

    Ok(())
}

pub fn reset_all_running(db: &AppDatabase) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "UPDATE sessions SET is_running = 0, closed_at = ?1 WHERE is_running = 1",
        [now],
    )
    .map_err(|e| format!("Failed to reset running sessions: {}", e))?;

    Ok(())
}
