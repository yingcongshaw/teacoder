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
    /// 侧边栏展示序号,越小越靠前。只由 reorder_projects 写入。
    pub sort_order: i32,
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

const PROJECT_COLUMNS: &str = "id, name, path, color, created_at, updated_at, sort_order";

pub fn list_projects(db: &AppDatabase) -> Result<Vec<Project>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM projects ORDER BY sort_order ASC, updated_at DESC",
            PROJECT_COLUMNS
        ))
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
                sort_order: row.get(6)?,
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

    // 新项目追加到列表末尾
    let next_sort_order: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to compute project sort_order: {}", e))?;

    conn.execute(
        "INSERT INTO projects (id, name, path, color, created_at, updated_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, input.name, input.path, input.color, now, now, next_sort_order],
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
        sort_order: next_sort_order,
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
        .prepare(&format!(
            "SELECT {} FROM projects WHERE id = ?1",
            PROJECT_COLUMNS
        ))
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    stmt.query_row([id], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            color: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            sort_order: row.get(6)?,
        })
    })
    .map_err(|e| format!("Failed to fetch updated project: {}", e))
}

/// 按调用方给定的顺序重写项目排序号。调用方需把完整顺序传进来、从 0 连续编号。
/// 不刷新 `updated_at` —— 排序是纯展示位,项目不该因为被换个位置就"看起来刚被编辑过"。
pub fn reorder_projects(db: &AppDatabase, ids: Vec<String>) -> Result<(), String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    {
        let mut stmt = tx
            .prepare("UPDATE projects SET sort_order = ?2 WHERE id = ?1")
            .map_err(|e| format!("Failed to prepare reorder statement: {}", e))?;

        for (index, id) in ids.iter().enumerate() {
            stmt.execute(rusqlite::params![id, index as i32])
                .map_err(|e| format!("Failed to reorder project {}: {}", id, e))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit project reorder: {}", e))
}

pub fn delete_project(db: &AppDatabase, id: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM projects WHERE id = ?1", [id])
        .map_err(|e| format!("Failed to delete project: {}", e))?;

    Ok(())
}
