use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    pub path: String,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub color: Option<String>,
}

pub fn list_projects(db: &AppDatabase) -> Result<Vec<Project>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, path, color, created_at, updated_at FROM projects ORDER BY updated_at DESC",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                color: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query projects: {}", e))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect projects: {}", e))
}

pub fn create_project(db: &AppDatabase, input: CreateProjectInput) -> Result<Project, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO projects (id, name, path, color, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, input.name, input.path, input.color, now, now],
    )
    .map_err(|e| {
        if e.to_string().contains("UNIQUE constraint failed: projects.path") {
            format!("项目路径已存在: {}", input.path)
        } else {
            format!("Failed to insert project: {}", e)
        }
    })?;

    Ok(Project {
        id,
        name: input.name,
        path: input.path,
        color: input.color,
        created_at: now,
        updated_at: now,
    })
}

pub fn update_project(
    db: &AppDatabase,
    id: &str,
    input: UpdateProjectInput,
) -> Result<Project, String> {
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

    let sql = format!(
        "UPDATE projects SET {} WHERE id = ?",
        set_clauses.join(", ")
    );

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut all_refs: Vec<&dyn rusqlite::types::ToSql> = param_refs;
    all_refs.push(&id);

    conn.execute(&sql, all_refs.as_slice())
        .map_err(|e| format!("Failed to update project: {}", e))?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, path, color, created_at, updated_at FROM projects WHERE id = ?1",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    stmt.query_row([id], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            color: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })
    .map_err(|e| format!("Failed to fetch updated project: {}", e))
}

pub fn delete_project(db: &AppDatabase, id: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM projects WHERE id = ?1", [id])
        .map_err(|e| format!("Failed to delete project: {}", e))?;

    Ok(())
}
