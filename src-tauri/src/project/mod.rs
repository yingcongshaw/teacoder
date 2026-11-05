use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color: Option<String>,
    /// 项目绑定的开发环境。一个项目可以同时绑 Java、Python、Go 多套环境，
    /// 绑定的环境决定这个项目跑起来时能看到哪些工具。
    pub dev_env_ids: Vec<String>,
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
    #[serde(default)]
    pub dev_env_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub color: Option<String>,
    /// None 表示不修改绑定；Some(空数组) 表示清空所有绑定。
    pub dev_env_ids: Option<Vec<String>>,
}

const PROJECT_COLUMNS: &str = "id, name, path, color, created_at, updated_at, sort_order";

fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        color: row.get(3)?,
        dev_env_ids: Vec::new(),
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        sort_order: row.get(6)?,
    })
}

/// 项目与环境是多对多：一个项目绑多套环境，一套环境也能被多个项目用。
fn load_project_env_ids(conn: &rusqlite::Connection) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare("SELECT project_id, env_id FROM project_dev_envs ORDER BY created_at ASC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| format!("Failed to query project dev envs: {}", e))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect project dev envs: {}", e))
}

fn attach_env_ids(projects: &mut [Project], bindings: Vec<(String, String)>) {
    for (project_id, env_id) in bindings {
        if let Some(project) = projects.iter_mut().find(|p| p.id == project_id) {
            project.dev_env_ids.push(env_id);
        }
    }
}

/// 一个环境类别里最多只能绑一套：同 kind 的环境只保留传入列表末位的那套。
/// 保留末位是因为绑定按创建时间升序读取，末位即最新的一套，
/// 与运行时 `list_project_envs` 取最新环境的顺序一致。
fn dedupe_env_ids_by_kind(conn: &rusqlite::Connection, env_ids: &[String]) -> Vec<String> {
    let mut kinds: Vec<Option<String>> = Vec::with_capacity(env_ids.len());
    let mut last_of_kind: HashMap<String, usize> = HashMap::new();

    for (index, env_id) in env_ids.iter().enumerate() {
        let kind = conn
            .query_row(
                "SELECT kind FROM dev_environments WHERE id = ?1",
                [env_id],
                |row| row.get::<_, String>(0),
            )
            .ok();
        if let Some(ref k) = kind {
            last_of_kind.insert(k.clone(), index);
        }
        kinds.push(kind);
    }

    let mut result = Vec::with_capacity(env_ids.len());
    for (index, (env_id, kind)) in env_ids.iter().zip(kinds).enumerate() {
        match kind {
            // 认不出 kind 的环境 id 原样放过，交给外键约束报错
            None => result.push(env_id.clone()),
            Some(k) => {
                if last_of_kind.get(&k) == Some(&index) {
                    result.push(env_id.clone());
                }
            }
        }
    }
    result
}

pub fn list_projects(db: &AppDatabase) -> Result<Vec<Project>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM projects ORDER BY sort_order ASC, updated_at DESC",
            PROJECT_COLUMNS
        ))
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let mut projects = stmt
        .query_map([], row_to_project)
        .map_err(|e| format!("Failed to query projects: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect projects: {}", e))?;

    attach_env_ids(&mut projects, load_project_env_ids(&conn)?);

    Ok(projects)
}

pub fn create_project(db: &AppDatabase, input: CreateProjectInput) -> Result<Project, String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    // 新项目追加到列表末尾
    let next_sort_order: i32 = tx
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to compute project sort_order: {}", e))?;

    tx.execute(
        "INSERT INTO projects (id, name, path, color, created_at, updated_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            id,
            input.name,
            input.path,
            input.color,
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

    let env_ids = dedupe_env_ids_by_kind(&tx, &input.dev_env_ids);
    for env_id in &env_ids {
        tx.execute(
            "INSERT OR IGNORE INTO project_dev_envs (project_id, env_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![id, env_id, now, now],
        )
        .map_err(|e| format!("Failed to bind project dev env: {}", e))?;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit project: {}", e))?;

    Ok(Project {
        id,
        name: input.name,
        path: input.path,
        color: input.color,
        dev_env_ids: env_ids,
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
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().timestamp_millis();

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

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

    let sql = format!("UPDATE projects SET {} WHERE id = ?", set_clauses.join(", "));
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut all_refs: Vec<&dyn rusqlite::types::ToSql> = param_refs;
    all_refs.push(&id);

    tx.execute(&sql, all_refs.as_slice())
        .map_err(|e| format!("Failed to update project: {}", e))?;

    // 环境绑定：字段缺失时保持原值不动，传了就全量替换
    if let Some(env_ids) = &input.dev_env_ids {
        let env_ids = dedupe_env_ids_by_kind(&tx, env_ids);
        tx.execute("DELETE FROM project_dev_envs WHERE project_id = ?1", [id])
            .map_err(|e| format!("Failed to clear project dev envs: {}", e))?;

        for env_id in &env_ids {
            tx.execute(
                "INSERT OR IGNORE INTO project_dev_envs (project_id, env_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![id, env_id, now, now],
            )
            .map_err(|e| format!("Failed to bind project dev env: {}", e))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit project update: {}", e))?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM projects WHERE id = ?1",
            PROJECT_COLUMNS
        ))
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let mut project = stmt
        .query_row([id], row_to_project)
        .map_err(|e| format!("Failed to fetch updated project: {}", e))?;

    project.dev_env_ids = load_project_env_ids(&conn)?
        .into_iter()
        .filter(|(project_id, _)| project_id == id)
        .map(|(_, env_id)| env_id)
        .collect();

    Ok(project)
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
        let python_id = insert_env(&db, "python", "python-1");

        let project = create_project(
            &db,
            CreateProjectInput {
                name: "demo".to_string(),
                path: "/work/demo".to_string(),
                color: None,
                dev_env_ids: vec![java_id.clone(), python_id.clone()],
            },
        )
        .expect("创建项目");

        assert_eq!(project.dev_env_ids.len(), 2);
        assert!(project.dev_env_ids.contains(&java_id));
        assert!(project.dev_env_ids.contains(&python_id));

        let listed = list_projects(&db).expect("查询项目");
        assert_eq!(listed[0].dev_env_ids.len(), 2);
    }

    #[test]
    fn same_kind_environments_keep_only_the_last_one() {
        let db = test_db();
        let java_21 = insert_env(&db, "java", "java-21");
        let java_25 = insert_env(&db, "java", "java-25");
        let node_22 = insert_env(&db, "node", "node-22");

        let project = create_project(
            &db,
            CreateProjectInput {
                name: "demo".to_string(),
                path: "/work/demo".to_string(),
                color: None,
                dev_env_ids: vec![java_21.clone(), node_22.clone(), java_25.clone()],
            },
        )
        .expect("创建项目");

        // 同一类别只留一套，且留的是列表里靠后的那套
        assert_eq!(project.dev_env_ids, vec![node_22.clone(), java_25.clone()]);

        let listed = list_projects(&db).expect("查询项目");
        assert_eq!(listed[0].dev_env_ids.len(), 2);
        assert!(!listed[0].dev_env_ids.contains(&java_21));
        assert!(listed[0].dev_env_ids.contains(&java_25));
        assert!(listed[0].dev_env_ids.contains(&node_22));
    }

    #[test]
    fn update_without_env_field_keeps_binding() {
        let db = test_db();
        let java_id = insert_env(&db, "java", "java-1");

        let project = create_project(
            &db,
            CreateProjectInput {
                name: "demo".to_string(),
                path: "/work/demo".to_string(),
                color: None,
                dev_env_ids: vec![java_id.clone()],
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
                dev_env_ids: None,
            },
        )
        .expect("更新项目");

        assert_eq!(updated.name, "demo2");
        assert_eq!(updated.dev_env_ids, vec![java_id]);
    }

    #[test]
    fn update_with_empty_env_list_clears_binding() {
        let db = test_db();
        let java_id = insert_env(&db, "java", "java-1");
        let node_id = insert_env(&db, "node", "node-1");

        let project = create_project(
            &db,
            CreateProjectInput {
                name: "demo".to_string(),
                path: "/work/demo".to_string(),
                color: None,
                dev_env_ids: vec![java_id.clone(), node_id.clone()],
            },
        )
        .expect("创建项目");

        let updated = update_project(
            &db,
            &project.id,
            UpdateProjectInput {
                name: None,
                color: None,
                dev_env_ids: Some(Vec::new()),
            },
        )
        .expect("更新项目");

        assert!(updated.dev_env_ids.is_empty());
    }
}
