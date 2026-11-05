use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: Option<String>,
    /// 项目绑定的 Java 环境（JDK + Maven 一组）
    pub java_env_id: Option<String>,
    /// 项目绑定的 Node 环境
    pub node_env_id: Option<String>,
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
    pub java_env_id: Option<String>,
    pub node_env_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub color: Option<String>,
    /// 双层 Option：外层 None 表示不修改，Some(None) 表示清空绑定。
    /// serde 默认把 JSON 的 null 也解成外层 None，必须配 double_option
    /// 才能区分「字段缺失」与「字段为 null」。
    #[serde(default, deserialize_with = "double_option")]
    pub java_env_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub node_env_id: Option<Option<String>>,
}

/// serde 对 `Option<Option<T>>` 的 null 会走 `visit_none`，与「字段缺失」不可区分。
/// 包一层把 null 映射成 Some(None)，default 兜住缺失的字段。
fn double_option<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    serde::Deserialize::deserialize(de).map(Some)
}

const PROJECT_COLUMNS: &str =
    "id, name, path, color, java_env_id, node_env_id, created_at, updated_at, sort_order";

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
                java_env_id: row.get(4)?,
                node_env_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                sort_order: row.get(8)?,
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
        "INSERT INTO projects (id, name, path, color, java_env_id, node_env_id, created_at, updated_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            id,
            input.name,
            input.path,
            input.color,
            input.java_env_id,
            input.node_env_id,
            now,
            now,
            next_sort_order
        ],
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
        java_env_id: input.java_env_id,
        node_env_id: input.node_env_id,
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

    // 环境绑定：Some(None) 显式置空，None 保持原值不动
    if let Some(v) = input.java_env_id {
        set_clauses.push("java_env_id = ?".to_string());
        params.push(Box::new(v));
    }

    if let Some(v) = input.node_env_id {
        set_clauses.push("node_env_id = ?".to_string());
        params.push(Box::new(v));
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
            java_env_id: row.get(4)?,
            node_env_id: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
            sort_order: row.get(8)?,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::AppDatabase;
    use std::sync::Mutex;

    fn test_db() -> AppDatabase {
        let conn = rusqlite::Connection::open_in_memory().expect("打开内存数据库");
        let db = AppDatabase {
            conn: Mutex::new(conn),
        };
        db.run_migrations().expect("执行迁移");
        db
    }

    /// 建一条开发环境，返回它的 id
    fn insert_env(db: &AppDatabase, kind: &str, name: &str) -> String {
        let conn = db.conn.lock().expect("锁");
        let id = format!("{kind}-{name}");
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO dev_environments (id, kind, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![id, kind, name, now, now],
        )
        .expect("插入开发环境");
        id
    }

    #[test]
    fn project_keeps_bound_environments() {
        let db = test_db();
        let java_id = insert_env(&db, "java", "java-1");
        let node_id = insert_env(&db, "node", "node-1");

        let project = create_project(
            &db,
            CreateProjectInput {
                name: "demo".to_string(),
                path: "/work/demo".to_string(),
                color: None,
                java_env_id: Some(java_id.clone()),
                node_env_id: Some(node_id.clone()),
            },
        )
        .expect("创建项目");

        assert_eq!(project.java_env_id.as_deref(), Some(java_id.as_str()));
        assert_eq!(project.node_env_id.as_deref(), Some(node_id.as_str()));
    }

    #[test]
    fn update_without_env_fields_keeps_binding() {
        let db = test_db();
        let java_id = insert_env(&db, "java", "java-1");

        let project = create_project(
            &db,
            CreateProjectInput {
                name: "demo".to_string(),
                path: "/work/demo".to_string(),
                color: None,
                java_env_id: Some(java_id.clone()),
                node_env_id: None,
            },
        )
        .expect("创建项目");

        // 只改名字：环境绑定不该被动到
        let updated = update_project(
            &db,
            &project.id,
            UpdateProjectInput {
                name: Some("demo2".to_string()),
                color: None,
                java_env_id: None,
                node_env_id: None,
            },
        )
        .expect("更新项目");

        assert_eq!(updated.name, "demo2");
        assert_eq!(updated.java_env_id.as_deref(), Some(java_id.as_str()));
    }

    #[test]
    fn update_with_null_env_clears_binding() {
        let db = test_db();
        let java_id = insert_env(&db, "java", "java-1");
        let node_id = insert_env(&db, "node", "node-1");

        let project = create_project(
            &db,
            CreateProjectInput {
                name: "demo".to_string(),
                path: "/work/demo".to_string(),
                color: None,
                java_env_id: Some(java_id.clone()),
                node_env_id: Some(node_id.clone()),
            },
        )
        .expect("创建项目");

        let updated = update_project(
            &db,
            &project.id,
            UpdateProjectInput {
                name: None,
                color: None,
                java_env_id: Some(None),
                node_env_id: Some(None),
            },
        )
        .expect("更新项目");

        assert!(updated.java_env_id.is_none());
        assert!(updated.node_env_id.is_none());
    }
}
