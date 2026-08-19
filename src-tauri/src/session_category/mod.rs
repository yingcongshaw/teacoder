use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCategory {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub color: Option<String>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCategoryInput {
    pub project_id: String,
    pub name: String,
    pub color: Option<String>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCategoryInput {
    pub name: Option<String>,
    pub color: Option<String>,
    pub sort_order: Option<i32>,
}

pub fn list_categories(db: &AppDatabase, project_id: Option<&str>) -> Result<Vec<SessionCategory>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    if let Some(pid) = project_id {
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, name, color, sort_order, created_at, updated_at FROM session_categories WHERE project_id = ?1 ORDER BY sort_order ASC, name ASC",
            )
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt
            .query_map([pid], |row| {
                Ok(SessionCategory {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    name: row.get(2)?,
                    color: row.get(3)?,
                    sort_order: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| format!("Failed to query categories: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect categories: {}", e))
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, name, color, sort_order, created_at, updated_at FROM session_categories ORDER BY sort_order ASC, name ASC",
            )
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(SessionCategory {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    name: row.get(2)?,
                    color: row.get(3)?,
                    sort_order: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| format!("Failed to query categories: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect categories: {}", e))
    }
}

pub fn create_category(db: &AppDatabase, input: CreateCategoryInput) -> Result<SessionCategory, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let sort_order = input.sort_order.unwrap_or(0);

    conn.execute(
        "INSERT INTO session_categories (id, project_id, name, color, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, input.project_id, input.name, input.color, sort_order, now, now],
    )
    .map_err(|e| format!("Failed to insert category: {}", e))?;

    Ok(SessionCategory {
        id,
        project_id: input.project_id,
        name: input.name,
        color: input.color,
        sort_order,
        created_at: now,
        updated_at: now,
    })
}

pub fn update_category(
    db: &AppDatabase,
    id: &str,
    input: UpdateCategoryInput,
) -> Result<SessionCategory, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().timestamp_millis();

    let mut set_clauses: Vec<String> = vec!["updated_at = ?1".to_string()];
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

    if let Some(ref name) = input.name {
        set_clauses.push("name = ?".to_string());
        params.push(Box::new(name.clone()));
    }

    if let Some(ref color) = input.color {
        set_clauses.push("color = ?".to_string());
        params.push(Box::new(color.clone()));
    }

    if let Some(sort_order) = input.sort_order {
        set_clauses.push("sort_order = ?".to_string());
        params.push(Box::new(sort_order));
    }

    let sql = format!(
        "UPDATE session_categories SET {} WHERE id = ?",
        set_clauses.join(", ")
    );

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut all_refs: Vec<&dyn rusqlite::types::ToSql> = param_refs;
    all_refs.push(&id);

    conn.execute(&sql, all_refs.as_slice())
        .map_err(|e| format!("Failed to update category: {}", e))?;

    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, name, color, sort_order, created_at, updated_at FROM session_categories WHERE id = ?1",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    stmt.query_row([id], |row| {
        Ok(SessionCategory {
            id: row.get(0)?,
            project_id: row.get(1)?,
            name: row.get(2)?,
            color: row.get(3)?,
            sort_order: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })
    .map_err(|e| format!("Failed to fetch updated category: {}", e))
}

pub fn delete_category(db: &AppDatabase, id: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM session_categories WHERE id = ?1", [id])
        .map_err(|e| format!("Failed to delete category: {}", e))?;

    Ok(())
}
