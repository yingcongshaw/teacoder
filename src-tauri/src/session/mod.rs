use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

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
    })
}

const SESSION_COLUMNS: &str = "id, project_id, title, tool_type, profile_id, color, thinking_intensity, template_id, cli_args, env_vars, is_running, created_at, updated_at, closed_at, cli_session_id, category_id, llm_provider_id, model_name, claude_models";

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
            .query_map([pid], row_to_session)
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

    conn.execute(
        "INSERT INTO sessions (id, project_id, title, tool_type, profile_id, color, thinking_intensity, template_id, cli_args, env_vars, is_running, created_at, updated_at, cli_session_id, category_id, llm_provider_id, model_name, claude_models) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
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

#[cfg(test)]
mod tests {
    use super::{
        create_session, list_sessions, update_session, CreateSessionInput, UpdateSessionInput,
    };
    use crate::storage::AppDatabase;
    use rusqlite::Connection;
    use std::sync::Mutex;

    /// 按版本号升序跑真实迁移脚本，而不是抄一份 DDL 进测试 ——
    /// 后者会随 schema 演进而静默失真，让 `SESSION_COLUMNS` 的列下标错位测不出来。
    fn test_db() -> AppDatabase {
        let conn = Connection::open_in_memory().unwrap();

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

        for (version, path) in entries {
            let sql = std::fs::read_to_string(&path).unwrap();
            conn.execute_batch(&sql)
                .unwrap_or_else(|e| panic!("迁移 v{version} 执行失败: {e}"));
        }

        AppDatabase {
            conn: Mutex::new(conn),
        }
    }

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
}
