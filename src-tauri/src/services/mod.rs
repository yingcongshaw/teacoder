use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

pub mod detector;
pub mod ports;
pub mod runtime;

/// 服务类型：java（Spring Boot 模块）、node（Node 脚本）、command（用户手填），
/// 以及 dotnet / python / rust / go / cpp 各语言的项目。
pub const KIND_JAVA: &str = "java";
pub const KIND_NODE: &str = "node";
pub const KIND_DOTNET: &str = "dotnet";
pub const KIND_PYTHON: &str = "python";
pub const KIND_RUST: &str = "rust";
pub const KIND_GO: &str = "go";
pub const KIND_CPP: &str = "cpp";
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
    /// 先构建再运行的命令。C/C++ 这类要先编译出可执行文件才能跑。
    pub build_command: Option<String>,
    /// 构建产物的基名。Java 取 pom 的 artifactId，C/C++ 取可执行文件名。
    pub artifact_id: Option<String>,
    /// 产物所在子目录，相对工作目录。Java 是 target。
    pub artifact_dir: Option<String>,
    /// 入口类全限定名。
    pub main_class: Option<String>,
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
    pub build_command: Option<String>,
    pub artifact_id: Option<String>,
    pub artifact_dir: Option<String>,
    pub main_class: Option<String>,
}

/// 识别结果统计。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectServicesResult {
    pub created: Vec<Service>,
    /// 已有服务被更新了多少条（识别规则变了，命令与产物信息跟着改）。
    pub updated: usize,
    /// 完全重复、一条都不用动的条数。
    pub skipped: usize,
}

const SERVICE_COLUMNS: &str = "id, project_id, name, kind, command, working_dir, build_command, artifact_id, artifact_dir, main_class, source, fingerprint, created_at, updated_at";

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
        build_command: row.get(6)?,
        artifact_id: row.get(7)?,
        artifact_dir: row.get(8)?,
        main_class: row.get(9)?,
        source: row.get(10)?,
        fingerprint: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
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

/// 项目的根目录。
pub fn project_path(db: &AppDatabase, project_id: &str) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT path FROM projects WHERE id = ?1")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;
    stmt.query_row([project_id], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to query project path: {}", e))
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
        "INSERT INTO services (id, project_id, name, kind, command, working_dir, build_command, artifact_id, artifact_dir, main_class, source, fingerprint, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        rusqlite::params![
            id,
            input.project_id,
            input.name,
            kind,
            input.command,
            working_dir,
            input.build_command,
            input.artifact_id,
            input.artifact_dir,
            input.main_class,
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
        build_command: input.build_command,
        artifact_id: input.artifact_id,
        artifact_dir: input.artifact_dir,
        main_class: input.main_class,
        source: source.to_string(),
        fingerprint: fp,
        created_at: now,
        updated_at: now,
    })
}

/// 改服务名称。
///
/// 只动名字，启动命令之类的都不碰 —— 名字是给人看的，
/// 识别出来的服务名往往是目录名，跟用户习惯的名字对不上。
pub fn rename_service(db: &AppDatabase, id: &str, name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("服务名称不能为空".to_string());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();
    let changed = conn
        .execute(
            "UPDATE services SET name = ?2, updated_at = ?3 WHERE id = ?1",
            rusqlite::params![id, trimmed, now],
        )
        .map_err(|e| format!("Failed to rename service: {}", e))?;
    if changed == 0 {
        return Err("服务不存在".to_string());
    }
    Ok(())
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
/// project_id 为 None 时识别全部项目。识别结果只增不改 —— 已存在的条目跳过，
/// 同工程重认一次只更新命令，不会凭空多出一条。
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

    let mut existing = list_services(db, None)?;
    let mut created = Vec::new();
    let mut updated = 0usize;
    let mut skipped = 0usize;

    for (pid, path) in projects {
        let envs = crate::dev_env::list_project_envs(db, &pid)?;

        let detected = detector::detect_services(std::path::Path::new(&path), &envs);

        for d in detected {
            // 同一个工程重认一次只更新命令：识别规则变了（比如从 mvn spring-boot:run
            // 换成打 jar 再跑）时，不该在列表里留下两条。
            //
            // 认的是「同一个工程」：Java 看 artifactId（一个模块一个），
            // 其余语言没有产物标识，就退回看命令 —— 同一目录里可能有多个
            // 入口（manage.py 与 main.py），光看目录会把它们认成同一个。
            let same_unit = existing.iter().find(|s| {
                s.project_id == pid
                    && s.source == SOURCE_DETECTED
                    && s.kind == d.kind
                    && s.working_dir == d.working_dir
                    && s.artifact_id == d.artifact_id
                    && (d.artifact_id.is_some() || s.command == d.command)
            });
            if let Some(old) = same_unit {
                if update_detected(db, &old.id, &d)? {
                    updated += 1;
                } else {
                    skipped += 1;
                }
                continue;
            }

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
                build_command: d.build_command,
                artifact_id: d.artifact_id,
                artifact_dir: d.artifact_dir,
                main_class: d.main_class,
            };
            let saved = insert_detected(db, input, &fp)?;
            created.push(saved.clone());
            // 新建的也要进候选池 —— 同一批里若还有候选指向同一个工程，
            // 得走更新而不是再插一条。
            existing.push(saved);
        }
    }

    Ok(DetectServicesResult {
        created,
        updated,
        skipped,
    })
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
        "INSERT INTO services (id, project_id, name, kind, command, working_dir, build_command, artifact_id, artifact_dir, main_class, source, fingerprint, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        rusqlite::params![
            id,
            input.project_id,
            input.name,
            kind,
            input.command,
            working_dir,
            input.build_command,
            input.artifact_id,
            input.artifact_dir,
            input.main_class,
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
        build_command: input.build_command,
        artifact_id: input.artifact_id,
        artifact_dir: input.artifact_dir,
        main_class: input.main_class,
        source: SOURCE_DETECTED.to_string(),
        fingerprint: fp.to_string(),
        created_at: now,
        updated_at: now,
    })
}

/// 更新识别出来的服务。名字不动 —— 用户改过的名字不该被识别覆盖回去。
///
/// 返回是否真的改了内容 —— 识别结果没变时不该算成「更新」。
fn update_detected(
    db: &AppDatabase,
    id: &str,
    d: &detector::DetectedService,
) -> Result<bool, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let unchanged: bool = conn
        .query_row(
            "SELECT command = ?2 AND build_command IS ?3 AND artifact_id IS ?4 AND artifact_dir IS ?5 AND main_class IS ?6 FROM services WHERE id = ?1",
            rusqlite::params![
                id,
                d.command,
                d.build_command,
                d.artifact_id,
                d.artifact_dir,
                d.main_class
            ],
            |row| row.get::<_, bool>(0),
        )
        .unwrap_or(false);
    if unchanged {
        return Ok(false);
    }

    let now = chrono::Utc::now().timestamp_millis();
    let fp = fingerprint(&d.kind, &d.working_dir, &d.command);

    conn.execute(
        "UPDATE services SET command = ?2, build_command = ?3, artifact_id = ?4, artifact_dir = ?5, main_class = ?6, fingerprint = ?7, updated_at = ?8 WHERE id = ?1",
        rusqlite::params![
            id,
            d.command,
            d.build_command,
            d.artifact_id,
            d.artifact_dir,
            d.main_class,
            fp,
            now
        ],
    )
    .map_err(|e| format!("Failed to update detected service: {}", e))?;
    Ok(true)
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

    /// 改名只动名字，命令与指纹都不该变 —— 指纹变了会被识别当成新服务。
    #[test]
    fn rename_service_only_changes_the_name() {
        let db = test_db();
        insert_project(&db, "p1", "/tmp/demo");
        let svc = create_service(
            &db,
            CreateServiceInput {
                project_id: "p1".to_string(),
                name: "原名".to_string(),
                kind: None,
                command: "python main.py".to_string(),
                working_dir: None,
                build_command: None,
                artifact_id: None,
                artifact_dir: None,
                main_class: None,
            },
        )
        .expect("建服务");

        rename_service(&db, &svc.id, "  新名字  ").expect("改名");

        let after = get_service(&db, &svc.id).expect("回查");
        assert_eq!(after.name, "新名字");
        assert_eq!(after.command, svc.command);
        assert_eq!(after.fingerprint, svc.fingerprint);

        assert!(rename_service(&db, &svc.id, "   ").is_err(), "空名要报错");
        assert!(rename_service(&db, "不存在的服务", "x").is_err());
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
                build_command: None,
                artifact_id: None,
                artifact_dir: None,
                main_class: None,
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
                tools: vec![crate::dev_env::DevTool {
                    tool: crate::dev_env::TOOL_NODE.to_string(),
                    version: Some("22.0.0".to_string()),
                    path: Some("/usr/bin/node".to_string()),
                }],
            },
        )
        .expect("创建 Node 环境");

        {
            let conn = db.conn.lock().expect("锁");
            conn.execute(
                "INSERT INTO project_dev_envs (project_id, env_id, created_at, updated_at) VALUES ('p1', ?1, 1, 1)",
                [&node_env.id],
            )
            .expect("绑定 Node 环境");
        }

        let detected = detector::detect_services(&dir, std::slice::from_ref(&node_env));
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

    /// Java 模块重认一次只更新，不该在列表里留下两条 ——
    /// 识别规则变了（命令、产物信息）也要更新到原来那条上。
    #[test]
    fn redetect_updates_the_same_java_service() {
        let db = test_db();

        let dir = std::env::temp_dir().join(format!("teacoder-svc-{}", uuid::Uuid::new_v4()));
        let module = dir.join("demo");
        std::fs::create_dir_all(module.join("src/main/java/com/demo")).expect("建目录");
        std::fs::write(
            module.join("pom.xml"),
            r#"<project>
  <artifactId>demo-service</artifactId>
  <dependencies>
    <dependency>
      <artifactId>spring-boot-starter</artifactId>
    </dependency>
  </dependencies>
</project>"#,
        )
        .expect("写 pom");
        std::fs::write(
            module.join("src/main/java/com/demo/DemoApplication.java"),
            "package com.demo;\npublic class DemoApplication {\n  public static void main(String[] args) {}\n}\n",
        )
        .expect("写入口类");

        insert_project(&db, "p1", dir.to_string_lossy().as_ref());

        let java_env = crate::dev_env::create_dev_environment(
            &db,
            crate::dev_env::SaveDevEnvironmentInput {
                kind: crate::dev_env::KIND_JAVA.to_string(),
                name: "Java".to_string(),
                tools: vec![
                    crate::dev_env::DevTool {
                        tool: crate::dev_env::TOOL_JDK.to_string(),
                        version: Some("21.0.2".to_string()),
                        path: Some("/opt/jdk21".to_string()),
                    },
                    crate::dev_env::DevTool {
                        tool: crate::dev_env::TOOL_MAVEN.to_string(),
                        version: Some("3.9.11".to_string()),
                        path: Some("/opt/maven".to_string()),
                    },
                ],
            },
        )
        .expect("创建 Java 环境");

        {
            let conn = db.conn.lock().expect("锁");
            conn.execute(
                "INSERT INTO project_dev_envs (project_id, env_id, created_at, updated_at) VALUES ('p1', ?1, 1, 1)",
                [&java_env.id],
            )
            .expect("绑定 Java 环境");
        }

        let first = detect_and_persist_services(&db, Some("p1")).expect("首次识别");
        assert_eq!(first.created.len(), 1);
        assert_eq!(first.created[0].name, "demo-service");
        assert_eq!(first.created[0].artifact_id.as_deref(), Some("demo-service"));
        assert_eq!(first.created[0].artifact_dir.as_deref(), Some("target"));
        assert_eq!(
            first.created[0].command,
            format!("java -jar {}", crate::services::detector::ARTIFACT_PLACEHOLDER)
        );

        // 用户改过名字后重认，名字不该被覆盖回去
        rename_service(&db, &first.created[0].id, "我的服务").expect("改名");

        let second = detect_and_persist_services(&db, Some("p1")).expect("再次识别");
        assert_eq!(second.created.len(), 0, "重认不该多出一条");

        let all = list_services(&db, Some("p1")).expect("查询服务");
        assert_eq!(all.len(), 1, "重认后仍应只有一条");
        assert_eq!(all[0].name, "我的服务");

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
                build_command: None,
                artifact_id: None,
                artifact_dir: None,
                main_class: None,
            },
        )
        .expect("创建服务");

        crate::project::delete_project(&db, "p1").expect("删除项目");
        assert!(list_services(&db, None).expect("查询服务").is_empty());
    }

    /// C/C++ 服务要先构建再运行：构建命令要跟着服务一起入库。
    /// 假环境条目：只用来放行检测门控，不依赖这台机器装没装对应工具。
    fn fake_env(kind: &str, tool: &str, path: &str) -> crate::dev_env::DevEnvironment {
        crate::dev_env::DevEnvironment {
            id: format!("{kind}-env"),
            kind: kind.to_string(),
            name: kind.to_string(),
            tools: vec![crate::dev_env::DevTool {
                tool: tool.to_string(),
                version: Some("1.0".to_string()),
                path: Some(path.to_string()),
            }],
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn detects_python_go_rust_and_dotnet_services() {
        let root = std::env::temp_dir().join(format!("teacoder-multi-{}", uuid::Uuid::new_v4()));

        let py = root.join("django-site");
        std::fs::create_dir_all(&py).expect("建目录");
        std::fs::write(py.join("manage.py"), "import django\n").expect("写 manage.py");

        let go = root.join("go-app");
        std::fs::create_dir_all(&go).expect("建目录");
        std::fs::write(go.join("main.go"), "package main\nfunc main() {}\n").expect("写 main.go");

        let rs = root.join("rust-app");
        std::fs::create_dir_all(rs.join("src")).expect("建目录");
        std::fs::write(rs.join("Cargo.toml"), "[package]\nname = \"rust-app\"\n").expect("写 Cargo.toml");
        std::fs::write(rs.join("src").join("main.rs"), "fn main() {}\n").expect("写 main.rs");

        let net = root.join("net-app");
        std::fs::create_dir_all(&net).expect("建目录");
        std::fs::write(
            net.join("net-app.csproj"),
            "<Project Sdk=\"Microsoft.NET.Sdk.Web\"></Project>",
        )
        .expect("写 csproj");

        let envs = vec![
            fake_env(crate::dev_env::KIND_PYTHON, crate::dev_env::TOOL_PYTHON, "/usr/bin/python3"),
            fake_env(crate::dev_env::KIND_GO, crate::dev_env::TOOL_GO, "/usr/local/go"),
            fake_env(crate::dev_env::KIND_RUST, crate::dev_env::TOOL_CARGO, "/root/.cargo/bin/cargo"),
            fake_env(crate::dev_env::KIND_DOTNET, crate::dev_env::TOOL_DOTNET, "/usr/share/dotnet/dotnet"),
        ];

        let detected = detector::detect_services(&root, &envs);

        let find = |kind: &str| {
            detected
                .iter()
                .find(|d| d.kind == kind)
                .map(|d| (d.name.clone(), d.command.clone()))
        };

        assert_eq!(
            find(KIND_PYTHON),
            Some((
                "django-site".to_string(),
                "python manage.py runserver".to_string()
            ))
        );
        assert_eq!(
            find(KIND_GO),
            Some(("go-app".to_string(), "go run .".to_string()))
        );
        assert_eq!(
            find(KIND_RUST),
            Some(("rust-app".to_string(), "cargo run".to_string()))
        );
        let dotnet = find(KIND_DOTNET).expect("应识别出 .NET 服务");
        assert_eq!(dotnet.0, "net-app");
        assert!(dotnet.1.starts_with("dotnet run --project"));

        std::fs::remove_dir_all(&root).ok();
    }

    /// .NET Framework 老项目没有 Sdk 属性，只能让 MSBuild 编译。
    #[test]
    fn detects_dotnet_framework_project_with_msbuild() {
        let root = std::env::temp_dir().join(format!("teacoder-netfx-{}", uuid::Uuid::new_v4()));
        let dir = root.join("legacy-app");
        std::fs::create_dir_all(&dir).expect("建目录");
        let project = dir.join("legacy-app.csproj");
        std::fs::write(
            &project,
            "<Project ToolsVersion=\"15.0\"><PropertyGroup><TargetFrameworkVersion>v4.7.2</TargetFrameworkVersion></PropertyGroup></Project>",
        )
        .expect("写 csproj");

        let envs = vec![fake_env(
            crate::dev_env::KIND_DOTNET,
            crate::dev_env::TOOL_MSBUILD,
            "/usr/bin/msbuild",
        )];

        let detected = detector::detect_services(&root, &envs);
        let svc = detected
            .iter()
            .find(|d| d.kind == KIND_DOTNET)
            .expect("应识别出 .NET Framework 服务");

        assert_eq!(svc.name, "legacy-app");
        let build = svc.build_command.as_deref().expect("应带构建命令");
        // 命令里写小写的 msbuild —— 运行时按程序名找环境里的那件工具
        assert!(build.starts_with("msbuild "), "构建命令应为：{build}");
        assert!(build.contains("legacy-app.csproj"));
        assert!(svc.command.contains("legacy-app"));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn detects_cpp_service_with_build_command() {
        let dir = std::env::temp_dir().join(format!("teacoder-cpp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("建临时目录");
        std::fs::write(
            dir.join("CMakeLists.txt"),
            "cmake_minimum_required(VERSION 3.10)\nproject(demo)\nadd_executable(demo main.c)\n",
        )
        .expect("写 CMakeLists.txt");

        // 用假的环境条目放行构建工具检测，别依赖这台机器上装没装 cmake
        let cpp_env = crate::dev_env::DevEnvironment {
            id: "cpp-env".to_string(),
            kind: crate::dev_env::KIND_CPP.to_string(),
            name: "C++".to_string(),
            tools: vec![
                crate::dev_env::DevTool {
                    tool: crate::dev_env::TOOL_CMAKE.to_string(),
                    version: Some("3.25".to_string()),
                    path: Some("/usr/bin/cmake".to_string()),
                },
                crate::dev_env::DevTool {
                    tool: crate::dev_env::TOOL_CC.to_string(),
                    version: Some("12.0".to_string()),
                    path: Some("/usr/bin/gcc".to_string()),
                },
            ],
            created_at: 0,
            updated_at: 0,
        };

        let detected = detector::detect_services(&dir, &[cpp_env]);
        let svc = detected
            .iter()
            .find(|d| d.kind == KIND_CPP)
            .expect("应识别出 C/C++ 服务");

        assert_eq!(svc.name, "demo");
        assert_eq!(
            svc.build_command.as_deref(),
            Some("cmake -S . -B build"),
            "C/C++ 服务必须带构建命令"
        );

        std::fs::remove_dir_all(&dir).ok();
    }
}
