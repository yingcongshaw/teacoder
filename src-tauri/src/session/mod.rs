use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

pub(crate) mod claude_path;
pub mod claude_transcript;
pub mod dedupe;
mod ssh_secret;

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
    pub claude_models: Option<String>,
    /// 同级(同项目同分类)内的展示序号,越小越靠前。只由 reorder_sessions 写入。
    pub sort_order: i32,
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
    pub claude_models: Option<String>,
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
    pub claude_models: Option<String>,
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
        // 唯一读出收口点：list_sessions 与 update_session 都经由这里，
        // 因此跨 IPC 的 cli_args 恒为明文。
        cli_args: ssh_secret::decode_cli_args(&row.get::<_, String>(3)?, row.get(8)?),
        env_vars: row.get(9)?,
        is_running: is_running_int != 0,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        closed_at: row.get(13)?,
        cli_session_id: row.get(14)?,
        category_id: row.get(15)?,
        llm_provider_id: row.get(16)?,
        model_name: row.get(17)?,
        claude_models: row.get(18)?,
        sort_order: row.get(19)?,
    })
}

const SESSION_COLUMNS: &str = "id, project_id, title, tool_type, profile_id, color, thinking_intensity, template_id, cli_args, env_vars, is_running, created_at, updated_at, closed_at, cli_session_id, category_id, llm_provider_id, model_name, claude_models, sort_order";

/// 按 id 取单个会话。
///
/// 走 [`row_to_session`] 因而与 `list_sessions` 同一口径：`cli_args` 里的 SSH
/// 密码已被解回明文。这让文件传输能在后端直接取到连接参数，前端无需参与，
/// 因此也无需改动 `ssh_secret` 的模块可见性。
pub fn find_session(db: &AppDatabase, id: &str) -> Result<Option<Session>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM sessions WHERE id = ?1",
            SESSION_COLUMNS
        ))
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    match stmt.query_row([id], row_to_session) {
        Ok(session) => Ok(Some(session)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to query session: {}", e)),
    }
}

pub fn list_sessions(
    db: &AppDatabase,
    project_id: Option<&str>,
) -> Result<Vec<Session>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let sessions = if let Some(pid) = project_id {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {} FROM sessions WHERE project_id = ?1 ORDER BY sort_order ASC, updated_at DESC",
                SESSION_COLUMNS
            ))
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt
            .query_map([pid], row_to_session)
            .map_err(|e| format!("Failed to query sessions: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect sessions: {}", e))?
    } else {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {} FROM sessions ORDER BY sort_order ASC, updated_at DESC",
                SESSION_COLUMNS
            ))
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt
            .query_map([], row_to_session)
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
    let stored_cli_args = ssh_secret::encode_cli_args(&input.tool_type, input.cli_args.clone());

    // 新会话追加到同级末尾。COALESCE 让未分类(NULL 或空串)归入同一组,与列表排序
    // 和迁移回填的口径保持一致 —— 三处任一不一致,拖到项目根目录的会话就会算错位置。
    let next_sort_order: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM sessions \
             WHERE project_id = ?1 AND COALESCE(category_id, '') = COALESCE(?2, '')",
            rusqlite::params![input.project_id, input.category_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to compute session sort_order: {}", e))?;

    conn.execute(
        "INSERT INTO sessions (id, project_id, title, tool_type, profile_id, color, thinking_intensity, template_id, cli_args, env_vars, is_running, created_at, updated_at, cli_session_id, category_id, llm_provider_id, model_name, claude_models, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        rusqlite::params![
            id,
            input.project_id,
            input.title,
            input.tool_type,
            input.profile_id,
            input.color,
            thinking_intensity,
            input.template_id,
            stored_cli_args,
            input.env_vars,
            is_running,
            now,
            now,
            input.cli_session_id,
            input.category_id,
            input.llm_provider_id,
            input.model_name,
            input.claude_models,
            next_sort_order,
        ],
    )
    .map_err(|e| format!("Failed to insert session: {}", e))?;

    // 先于 struct 字面量算好：那里 tool_type 字段会 move 掉 input.tool_type
    let returned_cli_args = ssh_secret::decode_cli_args(&input.tool_type, stored_cli_args);

    Ok(Session {
        id,
        project_id: input.project_id,
        title: input.title,
        tool_type: input.tool_type,
        profile_id: input.profile_id,
        color: input.color,
        thinking_intensity,
        template_id: input.template_id,
        cli_args: returned_cli_args,
        env_vars: input.env_vars,
        is_running: true,
        created_at: now,
        updated_at: now,
        closed_at: None,
        cli_session_id: input.cli_session_id,
        category_id: input.category_id,
        llm_provider_id: input.llm_provider_id,
        model_name: input.model_name,
        claude_models: input.claude_models,
        sort_order: next_sort_order,
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
        // UpdateSessionInput 不带 tool_type（会话工具类型在创建后不可改），
        // 编码与否取决于它，所以先从行里取出来。
        let tool_type: String = conn
            .query_row("SELECT tool_type FROM sessions WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .map_err(|e| format!("Failed to read session tool_type: {}", e))?;
        set_clauses.push("cli_args = ?".to_string());
        params.push(Box::new(ssh_secret::encode_cli_args(
            &tool_type,
            Some(cli_args.clone()),
        )));
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

    if let Some(ref claude_models) = input.claude_models {
        if claude_models.is_empty() {
            set_clauses.push("claude_models = NULL".to_string());
        } else {
            set_clauses.push("claude_models = ?".to_string());
            params.push(Box::new(claude_models.clone()));
        }
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

    stmt.query_row([id], row_to_session)
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

/// 一条会话的重排指令:改归属 + 定序号。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMove {
    pub id: String,
    /// None 表示原地不动(调用方只想改排序时可以不传)。
    pub project_id: Option<String>,
    /// None 表示移到项目根目录(未分类)。
    pub category_id: Option<String>,
    pub sort_order: i32,
}

/// 按调用方给定的顺序重写会话的归属与排序号。
///
/// 调用方负责把受影响的分组(拖动时的源组与目标组)**完整**传进来,每组从 0 开始
/// 连续编号,这样不会有重复值也不会留空洞;不在列表里的会话保持原样。
///
/// 有意不刷新 `updated_at`:排序是纯展示位,会话不该因为被换个位置就"看起来刚被
/// 用过"。也刻意不经过 `update_session` —— 那条路会 stop/start 运行中会话的 PTY,
/// 拖一次断一次上下文。
pub fn reorder_sessions(db: &AppDatabase, moves: Vec<SessionMove>) -> Result<(), String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    {
        // project_id 不传就保持原项目,COALESCE 让"不传"和"传了同一个值"都能命中
        let mut stmt = tx
            .prepare(
                "UPDATE sessions SET \
                   project_id = COALESCE(?2, project_id), \
                   category_id = ?3, \
                   sort_order = ?4 \
                 WHERE id = ?1",
            )
            .map_err(|e| format!("Failed to prepare reorder statement: {}", e))?;

        for m in &moves {
            stmt.execute(rusqlite::params![m.id, m.project_id, m.category_id, m.sort_order])
                .map_err(|e| format!("Failed to reorder session {}: {}", m.id, e))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit session reorder: {}", e))
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::sync::Mutex;

    use rusqlite::Connection;

    use crate::storage::AppDatabase;

    /// 按版本号升序跑真实迁移脚本，而不是抄一份 DDL 进测试 ——
    /// 后者会随 schema 演进而静默失真，让 `SESSION_COLUMNS` 的列下标错位测不出来。
    fn migration_files() -> Vec<(u32, std::path::PathBuf)> {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("migrations");
        let mut entries: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|ext| ext == "sql"))
            .map(|e| {
                let version: u32 = e
                    .file_name()
                    .to_string_lossy()
                    .strip_prefix('v')
                    .and_then(|s| s.split('_').next())
                    .and_then(|s| s.parse().ok())
                    .expect("迁移文件名应以 v<N>_ 开头");
                (version, e.path())
            })
            .collect();
        entries.sort_by_key(|(version, _)| *version);
        entries
    }

    pub fn test_db() -> AppDatabase {
        test_db_at_version(u32::MAX)
    }

    /// 只跑到指定版本（含）为止。验证某个后续迁移在**存量数据**上的效果时必须用它：
    /// 直接跑全量的话表是空的，回填语句里那些针对真实数据分支一条也走不到。
    pub fn test_db_at_version(max_version: u32) -> AppDatabase {
        let conn = Connection::open_in_memory().unwrap();

        for (version, path) in migration_files() {
            if version > max_version {
                continue;
            }
            let sql = std::fs::read_to_string(&path).unwrap();
            conn.execute_batch(&sql)
                .unwrap_or_else(|e| panic!("迁移 v{version} 执行失败: {e}"));
        }

        AppDatabase {
            conn: Mutex::new(conn),
        }
    }

    /// 在已有数据的库上补跑一个版本的迁移。
    pub fn apply_migration(db: &AppDatabase, version: u32) {
        let path = migration_files()
            .into_iter()
            .find(|(v, _)| *v == version)
            .map(|(_, p)| p)
            .expect("找不到该版本迁移");
        let sql = std::fs::read_to_string(&path).unwrap();
        db.conn
            .lock()
            .unwrap()
            .execute_batch(&sql)
            .unwrap_or_else(|e| panic!("迁移 v{version} 执行失败: {e}"));
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{apply_migration, test_db, test_db_at_version};
    use super::{
        create_session, list_sessions, reorder_sessions, update_session, CreateSessionInput,
        SessionMove, UpdateSessionInput,
    };
    use crate::storage::AppDatabase;

    fn test_db_with_project() -> AppDatabase {
        let db = test_db();
        let now = chrono::Utc::now().timestamp_millis();
        db.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ('p1', 'P', '/tmp/p1', ?1, ?1)",
                [now],
            )
            .unwrap();
        db
    }

    fn plain_input(project_id: &str, category_id: Option<&str>) -> CreateSessionInput {
        CreateSessionInput {
            project_id: project_id.to_string(),
            tool_type: "claude".to_string(),
            title: None,
            profile_id: None,
            color: None,
            thinking_intensity: None,
            template_id: None,
            cli_args: None,
            env_vars: None,
            cli_session_id: None,
            category_id: category_id.map(|s| s.to_string()),
            llm_provider_id: None,
            model_name: None,
            claude_models: None,
        }
    }

    fn make_category(db: &AppDatabase, id: &str) {
        let now = chrono::Utc::now().timestamp_millis();
        db.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO session_categories (id, project_id, name, color, sort_order, created_at, updated_at) \
                 VALUES (?1, 'p1', ?1, NULL, 0, ?2, ?2)",
                rusqlite::params![id, now],
            )
            .unwrap();
    }

    fn sorted_ids(db: &AppDatabase, category_id: Option<&str>) -> Vec<String> {
        list_sessions(db, Some("p1"))
            .unwrap()
            .into_iter()
            .filter(|s| s.category_id.as_deref() == category_id)
            .map(|s| s.id)
            .collect()
    }

    fn ssh_input(password: &str) -> CreateSessionInput {
        CreateSessionInput {
            project_id: "p1".to_string(),
            tool_type: "ssh".to_string(),
            title: Some("SSH".to_string()),
            profile_id: None,
            color: None,
            thinking_intensity: None,
            template_id: None,
            cli_args: Some(format!(
                r#"{{"hostname":"10.0.0.1","port":22,"username":"root","password":"{password}","identityFile":""}}"#
            )),
            env_vars: None,
            cli_session_id: None,
            category_id: None,
            llm_provider_id: None,
            model_name: None,
            claude_models: None,
        }
    }

    fn password_of(args: &Option<String>) -> String {
        let raw = args.as_deref().expect("cli_args 应存在");
        let v: serde_json::Value = serde_json::from_str(raw).unwrap();
        v["password"].as_str().unwrap().to_string()
    }

    /// 绕过 `row_to_session` 直取原始列，验证落库形态
    fn raw_password(db: &AppDatabase, id: &str) -> String {
        let conn = db.conn.lock().unwrap();
        let raw: String = conn
            .query_row("SELECT cli_args FROM sessions WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap();
        password_of(&Some(raw))
    }

    #[test]
    fn create_session_encodes_password_in_db_and_returns_plaintext() {
        let db = test_db_with_project();
        let created = create_session(&db, ssh_input("P@ssw0rd")).unwrap();

        let stored = raw_password(&db, &created.id);
        assert!(
            stored.starts_with("b64:"),
            "SQLite 里不应出现明文密码，实际存了: {stored}"
        );
        assert_eq!(password_of(&created.cli_args), "P@ssw0rd");
    }

    #[test]
    fn list_sessions_returns_plaintext_password() {
        let db = test_db_with_project();
        create_session(&db, ssh_input("P@ssw0rd")).unwrap();

        let listed = list_sessions(&db, Some("p1")).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(password_of(&listed[0].cli_args), "P@ssw0rd");
    }

    #[test]
    fn update_session_reencodes_and_reads_back_plaintext() {
        let db = test_db_with_project();
        let created = create_session(&db, ssh_input("old")).unwrap();

        let input = ssh_input("new");
        let updated = update_session(
            &db,
            &created.id,
            UpdateSessionInput {
                title: None,
                profile_id: None,
                color: None,
                thinking_intensity: None,
                template_id: None,
                cli_args: input.cli_args,
                env_vars: None,
                is_running: None,
                closed_at: None,
                project_id: None,
                cli_session_id: None,
                category_id: None,
                llm_provider_id: None,
                model_name: None,
                claude_models: None,
            },
        )
        .unwrap();

        assert!(raw_password(&db, &created.id).starts_with("b64:"));
        assert_eq!(password_of(&updated.cli_args), "new");
    }

    #[test]
    fn non_ssh_session_stores_cli_args_verbatim() {
        let db = test_db_with_project();
        let mut input = ssh_input("pw");
        input.tool_type = "claude".to_string();

        let created = create_session(&db, input).unwrap();
        let conn = db.conn.lock().unwrap();
        let raw: Option<String> = conn
            .query_row("SELECT cli_args FROM sessions WHERE id = ?1", [&created.id], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(raw.unwrap().contains(r#""password":"pw""#));
    }

    #[test]
    fn new_session_appends_to_end_of_its_own_group() {
        let db = test_db_with_project();
        make_category(&db, "c1");
        make_category(&db, "c2");

        let a = create_session(&db, plain_input("p1", Some("c1"))).unwrap();
        let b = create_session(&db, plain_input("p1", Some("c1"))).unwrap();
        // 另一个分类独立编号,不受 c1 里已有两条影响
        let x = create_session(&db, plain_input("p1", Some("c2"))).unwrap();
        // 未分类同样是独立的一组
        let n = create_session(&db, plain_input("p1", None)).unwrap();

        assert_eq!(a.sort_order, 0);
        assert_eq!(b.sort_order, 1);
        assert_eq!(x.sort_order, 0);
        assert_eq!(n.sort_order, 0);
    }

    #[test]
    fn list_sessions_follows_sort_order_even_when_updated_at_is_inverted() {
        let db = test_db_with_project();
        let a = create_session(&db, plain_input("p1", None)).unwrap();
        let b = create_session(&db, plain_input("p1", None)).unwrap();

        // 把 b(排序值 1)弄成"最近更新"。按旧的 updated_at DESC 规则 b 会排到第一,
        // 只有排序值压过更新时间时才会维持 a,b 的顺序 —— 这才是这个用例要证的。
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET updated_at = ?2 WHERE id = ?1",
            rusqlite::params![b.id, chrono::Utc::now().timestamp_millis() + 10_000],
        )
        .unwrap();
        drop(conn);

        let ids = sorted_ids(&db, None);
        assert_eq!(ids, vec![a.id, b.id], "排序值应压过更新时间");
    }

    #[test]
    fn reorder_sessions_across_groups_renumbers_both_sides() {
        let db = test_db_with_project();
        make_category(&db, "c1");
        let a = create_session(&db, plain_input("p1", None)).unwrap();
        let b = create_session(&db, plain_input("p1", None)).unwrap();
        let x = create_session(&db, plain_input("p1", Some("c1"))).unwrap();
        let y = create_session(&db, plain_input("p1", Some("c1"))).unwrap();

        // 把 a 拖进 c1 的最前面。未分类组剩 b,c1 组变 a,x,y —— 两组都要从 0 重排。
        reorder_sessions(
            &db,
            vec![
                SessionMove { project_id: None, id: a.id.clone(), category_id: Some("c1".into()), sort_order: 0 },
                SessionMove { project_id: None, id: x.id.clone(), category_id: Some("c1".into()), sort_order: 1 },
                SessionMove { project_id: None, id: y.id.clone(), category_id: Some("c1".into()), sort_order: 2 },
                SessionMove { project_id: None, id: b.id.clone(), category_id: None, sort_order: 0 },
            ],
        )
        .unwrap();

        assert_eq!(sorted_ids(&db, Some("c1")), vec![a.id.clone(), x.id, y.id]);
        assert_eq!(sorted_ids(&db, None), vec![b.id]);
    }

    #[test]
    fn reorder_sessions_can_clear_category_to_project_root() {
        let db = test_db_with_project();
        make_category(&db, "c1");
        let a = create_session(&db, plain_input("p1", Some("c1"))).unwrap();

        reorder_sessions(
            &db,
            vec![SessionMove { project_id: None, id: a.id.clone(), category_id: None, sort_order: 0 }],
        )
        .unwrap();

        assert_eq!(sorted_ids(&db, Some("c1")), Vec::<String>::new());
        assert_eq!(sorted_ids(&db, None), vec![a.id]);
    }

    #[test]
    fn reorder_sessions_can_move_between_projects() {
        let db = test_db_with_project();
        db.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ('p2', 'P2', '/tmp/p2', 1, 1)",
                [],
            )
            .unwrap();
        let a = create_session(&db, plain_input("p1", None)).unwrap();

        reorder_sessions(
            &db,
            vec![SessionMove {
                project_id: Some("p2".into()),
                id: a.id.clone(),
                category_id: None,
                sort_order: 0,
            }],
        )
        .unwrap();

        assert!(sorted_ids(&db, None).is_empty(), "不应再留在 p1 下");
        let moved = list_sessions(&db, Some("p2")).unwrap();
        assert_eq!(moved.len(), 1);
        assert_eq!(moved[0].id, a.id);
    }

    #[test]
    fn reorder_sessions_leaves_updated_at_untouched() {
        let db = test_db_with_project();
        let a = create_session(&db, plain_input("p1", None)).unwrap();

        let before: i64 = db
            .conn
            .lock()
            .unwrap()
            .query_row("SELECT updated_at FROM sessions WHERE id = ?1", [&a.id], |r| r.get(0))
            .unwrap();

        reorder_sessions(
            &db,
            vec![SessionMove { project_id: None, id: a.id.clone(), category_id: None, sort_order: 0 }],
        )
        .unwrap();

        let after: i64 = db
            .conn
            .lock()
            .unwrap()
            .query_row("SELECT updated_at FROM sessions WHERE id = ?1", [&a.id], |r| r.get(0))
            .unwrap();
        assert_eq!(before, after, "换个位置不该让会话看起来刚被用过");
    }

    fn sort_orders(db: &AppDatabase, sql: &str) -> Vec<i32> {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(sql).unwrap();
        let rows = stmt
            .query_map([], |r| r.get::<_, i32>(0))
            .unwrap();
        rows.map(|r| r.unwrap()).collect()
    }

    #[test]
    fn migration_v15_backfills_projects_without_duplicate_sort_order() {
        let db = test_db_at_version(14);
        {
            let conn = db.conn.lock().unwrap();
            // updated_at 完全相同：不打破平局的话两者会拿到同一个编号
            conn.execute(
                "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ('a', 'A', '/tmp/a', 1000, 1000)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ('b', 'B', '/tmp/b', 1000, 1000)",
                [],
            )
            .unwrap();
        }

        apply_migration(&db, 15);

        let mut orders = sort_orders(&db, "SELECT sort_order FROM projects");
        orders.sort_unstable();
        assert_eq!(orders, vec![0, 1], "存量项目应回填成不重复的连续序号");
    }

    #[test]
    fn migration_v15_backfills_sessions_per_category_group() {
        let db = test_db_at_version(14);
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ('p1', 'P', '/tmp/p1', 1, 1)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO session_categories (id, project_id, name, sort_order, created_at, updated_at) VALUES ('c1', 'p1', 'C1', 0, 1, 1)",
                [],
            )
            .unwrap();
            // c1 下两条 + 未分类下两条，各自成组
            for id in ["s1", "s2"] {
                conn.execute(
                    "INSERT INTO sessions (id, project_id, tool_type, category_id, created_at, updated_at) VALUES (?1, 'p1', 'claude', 'c1', 1, 100)",
                    [id],
                )
                .unwrap();
            }
            for id in ["s3", "s4"] {
                conn.execute(
                    "INSERT INTO sessions (id, project_id, tool_type, category_id, created_at, updated_at) VALUES (?1, 'p1', 'claude', NULL, 1, 100)",
                    [id],
                )
                .unwrap();
            }
        }

        apply_migration(&db, 15);

        let mut in_cat = sort_orders(
            &db,
            "SELECT sort_order FROM sessions WHERE category_id = 'c1'",
        );
        in_cat.sort_unstable();
        let mut uncategorized = sort_orders(
            &db,
            "SELECT sort_order FROM sessions WHERE category_id IS NULL",
        );
        uncategorized.sort_unstable();

        assert_eq!(in_cat, vec![0, 1]);
        assert_eq!(uncategorized, vec![0, 1], "每个分组都应独立从 0 开始");
    }
}
