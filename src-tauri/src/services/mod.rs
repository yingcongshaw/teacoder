use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

pub mod detector;
pub mod runtime;

/// 服务类型：java（Spring Boot 模块）、node（Node 脚本）、command（用户手填）。
pub const KIND_JAVA: &str = "java";
pub const KIND_NODE: &str = "node";
pub const KIND_COMMAND: &str = "command";

/// 识别来源：自动识别 / 手工添加。
pub const SOURCE_DETECTED: &str = "detected";
pub const SOURCE_MANUAL: &str = "manual";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub kind: String,
    pub command: String,
    pub working_dir: String,
    pub source: String,
    pub fingerprint: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateServiceInput {
    pub project_id: String,
    pub name: String,
    pub kind: Option<String>,
    pub command: String,
    pub working_dir: Option<String>,
}

/// 识别结果统计。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectServicesResult {
    pub created: Vec<Service>,
    pub skipped: usize,
}

const SERVICE_COLUMNS: &str = "id, project_id, name, kind, command, working_dir, source, fingerprint, created_at, updated_at";

/// 服务的去重指纹。
///
/// 只用 kind + 工作目录 + 命令，不掺环境 —— 命令里存的是裸程序名，
/// 换一套 JDK 不会让同一个模块变成两条服务。
pub fn fingerprint(kind: &str, working_dir: &str, command: &str) -> String {
    format!("{}|{}|{}", kind, working_dir, command)
}

fn row_to_service(row: &rusqlite::Row<'_>) -> rusqlite::Result<Service> {
    Ok(Service {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        kind: row.get(3)?,
        command: row.get(4)?,
        working_dir: row.get(5)?,
        source: row.get(6)?,
        fingerprint: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

pub fn list_services(
    db: &AppDatabase,
    project_id: Option<&str>,
) -> Result<Vec<Service>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match project_id {
        Some(pid) => (
            format!(
                "SELECT {} FROM services WHERE project_id = ?1 ORDER BY created_at ASC",
                SERVICE_COLUMNS
            ),
            vec![Box::new(pid.to_string())],
        ),
        None => (
            format!(
                "SELECT {} FROM services ORDER BY project_id ASC, created_at ASC",
                SERVICE_COLUMNS
            ),
            vec![],
        ),
    };

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let rows = stmt
        .query_map(param_refs.as_slice(), row_to_service)
        .map_err(|e| format!("Failed to query services: {}", e))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect services: {}", e))
}

pub fn get_service(db: &AppDatabase, id: &str) -> Result<Service, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM services WHERE id = ?1",
            SERVICE_COLUMNS
        ))
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    stmt.query_row([id], row_to_service)
        .map_err(|e| format!("Failed to fetch service: {}", e))
}

pub fn create_service(db: &AppDatabase, input: CreateServiceInput) -> Result<Service, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let kind = input.kind.unwrap_or_else(|| KIND_COMMAND.to_string());
    let source = SOURCE_MANUAL;
    let working_dir = input.working_dir.unwrap_or_default();
    let fp = fingerprint(&kind, &working_dir, &input.command);

    conn.execute(
        "INSERT INTO services (id, project_id, name, kind, command, working_dir, source, fingerprint, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            id,
            input.project_id,
            input.name,
            kind,
            input.command,
            working_dir,
            source,
            fp,
            now,
            now
        ],
    )
    .map_err(|e| format!("Failed to insert service: {}", e))?;

    Ok(Service {
        id,
        project_id: input.project_id,
        name: input.name,
        kind,
        command: input.command,
        working_dir,
        source: source.to_string(),
        fingerprint: fp,
        created_at: now,
        updated_at: now,
    })
}

/// 删服务前先停掉正在跑的进程 —— 行没了用户就再也停不掉它。
pub fn delete_service(db: &AppDatabase, id: &str) -> Result<(), String> {
    let _ = runtime::stop_service(id);

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM services WHERE id = ?1", [id])
        .map_err(|e| format!("Failed to delete service: {}", e))?;
    Ok(())
}

/// 识别项目里能跑的服务并入库。
///
/// project_id 为 None 时识别全部项目。只增不减 —— 已存在的指纹跳过。
pub fn detect_and_persist_services(
    db: &AppDatabase,
    project_id: Option<&str>,
) -> Result<DetectServicesResult, String> {
    let projects: Vec<(String, String)> = match project_id {
        Some(pid) => {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare("SELECT id, path FROM projects WHERE id = ?1")
                .map_err(|e| format!("Failed to prepare query: {}", e))?;
            let rows = stmt
                .query_map([pid], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                .map_err(|e| format!("Failed to query project: {}", e))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to collect project: {}", e))?
        }
        None => {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare("SELECT id, path FROM projects ORDER BY sort_order ASC")
                .map_err(|e| format!("Failed to prepare query: {}", e))?;
            let rows = stmt
                .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                .map_err(|e| format!("Failed to query projects: {}", e))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to collect projects: {}", e))?
        }
    };

    let existing = list_services(db, None)?;
    let mut created = Vec::new();
    let mut skipped = 0usize;

    for (pid, path) in projects {
        let java_env = {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare("SELECT java_env_id, node_env_id FROM projects WHERE id = ?1")
                .map_err(|e| format!("Failed to prepare query: {}", e))?;
            stmt.query_row([&pid], |row| {
                Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|e| format!("Failed to query project env: {}", e))?
        };

        let (java_env, node_env) = crate::dev_env::load_project_envs(
            db,
            java_env.0.as_deref(),
            java_env.1.as_deref(),
        )?;

        let detected = detector::detect_services(
            std::path::Path::new(&path),
            java_env.as_ref(),
            node_env.as_ref(),
        );

        for d in detected {
            let fp = fingerprint(&d.kind, &d.working_dir, &d.command);
            if existing.iter().any(|s| s.project_id == pid && s.fingerprint == fp) {
                skipped += 1;
                continue;
            }

            let input = CreateServiceInput {
                project_id: pid.clone(),
                name: d.name,
                kind: Some(d.kind),
                command: d.command,
                working_dir: Some(d.working_dir),
            };
            let saved = insert_detected(db, input, &fp)?;
            created.push(saved);
        }
    }

    Ok(DetectServicesResult { created, skipped })
}

/// 写入一条识别出来的服务。source 固定为 detected。
fn insert_detected(
    db: &AppDatabase,
    input: CreateServiceInput,
    fp: &str,
) -> Result<Service, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let kind = input.kind.unwrap_or_else(|| KIND_COMMAND.to_string());
    let working_dir = input.working_dir.unwrap_or_default();

    conn.execute(
        "INSERT INTO services (id, project_id, name, kind, command, working_dir, source, fingerprint, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            id,
            input.project_id,
            input.name,
            kind,
            input.command,
            working_dir,
            SOURCE_DETECTED,
            fp,
            now,
            now
        ],
    )
    .map_err(|e| format!("Failed to insert detected service: {}", e))?;

    Ok(Service {
        id,
        project_id: input.project_id,
        name: input.name,
        kind,
        command: input.command,
        working_dir,
        source: SOURCE_DETECTED.to_string(),
        fingerprint: fp.to_string(),
        created_at: now,
        updated_at: now,
    })
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

    fn insert_project(db: &AppDatabase, id: &str, path: &str) {
        let conn = db.conn.lock().expect("锁");
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO projects (id, name, path, created_at, updated_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
            rusqlite::params![id, "项目", path, now, now],
        )
        .expect("插入项目");
    }

    #[test]
    fn fingerprint_ignores_environment() {
        // 命令里存的是裸程序名，换一套 JDK 不该让同一个模块变成两条服务
        let a = fingerprint(KIND_JAVA, "/work/app", "mvn spring-boot:run");
        let b = fingerprint(KIND_JAVA, "/work/app", "mvn spring-boot:run");
        assert_eq!(a, b);

        let c = fingerprint(KIND_JAVA, "/work/app", "mvn spring-boot:run -Dx=1");
        assert_ne!(a, c);
    }

    #[test]
    fn create_and_list_service_scoped_by_project() {
        let db = test_db();
        insert_project(&db, "p1", "/work/one");
        insert_project(&db, "p2", "/work/two");

        create_service(
            &db,
            CreateServiceInput {
                project_id: "p1".to_string(),
                name: "用户服务".to_string(),
                kind: Some(KIND_COMMAND.to_string()),
                command: "npm run start".to_string(),
                working_dir: Some("/work/one".to_string()),
            },
        )
        .expect("创建服务");

        let only_p1 = list_services(&db, Some("p1")).expect("按项目查询");
        assert_eq!(only_p1.len(), 1);
        assert_eq!(only_p1[0].name, "用户服务");
        assert_eq!(only_p1[0].source, SOURCE_MANUAL);

        let all = list_services(&db, None).expect("查询全部");
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn detect_skips_services_already_present() {
        let db = test_db();

        let dir = std::env::temp_dir().join(format!("teacoder-svc-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("建临时目录");
        std::fs::write(
            dir.join("package.json"),
            r#"{"name":"demo","scripts":{"start":"node index.js"}}"#,
        )
        .expect("写 package.json");

        insert_project(&db, "p1", dir.to_string_lossy().as_ref());

        let node_env = crate::dev_env::create_dev_environment(
            &db,
            crate::dev_env::SaveDevEnvironmentInput {
                kind: crate::dev_env::KIND_NODE.to_string(),
                name: "Node".to_string(),
                jdk_version: None,
                jdk_path: None,
                maven_version: None,
                maven_path: None,
                node_version: Some("22.0.0".to_string()),
                node_path: Some("/usr/bin/node".to_string()),
            },
        )
        .expect("创建 Node 环境");

        {
            let conn = db.conn.lock().expect("锁");
            conn.execute(
                "UPDATE projects SET node_env_id = ?1 WHERE id = 'p1'",
                [&node_env.id],
            )
            .expect("绑定 Node 环境");
        }

        let detected = detector::detect_services(&dir, None, Some(&node_env));
        assert!(
            detected.iter().any(|d| d.name == "demo:start"),
            "应识别出 demo:start，实际：{detected:?}"
        );

        // 落库一次，再识别应当全部跳过
        let first = detect_and_persist_services(&db, Some("p1")).expect("首次识别");
        assert_eq!(first.created.len(), detected.len());

        let second = detect_and_persist_services(&db, Some("p1")).expect("再次识别");
        assert_eq!(second.created.len(), 0);
        assert!(second.skipped > 0);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn deleting_project_cascades_to_services() {
        let db = test_db();
        insert_project(&db, "p1", "/work/one");

        create_service(
            &db,
            CreateServiceInput {
                project_id: "p1".to_string(),
                name: "svc".to_string(),
                kind: None,
                command: "node index.js".to_string(),
                working_dir: None,
            },
        )
        .expect("创建服务");

        crate::project::delete_project(&db, "p1").expect("删除项目");
        assert!(list_services(&db, None).expect("查询服务").is_empty());
    }
}
