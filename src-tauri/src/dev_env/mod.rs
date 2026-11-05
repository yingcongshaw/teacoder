use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

pub mod detector;

/// 开发环境条目的类型：java 表示 JDK+Maven 一组，node 表示 Node 一组。
pub const KIND_JAVA: &str = "java";
pub const KIND_NODE: &str = "node";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevEnvironment {
    pub id: String,
    /// "java" | "node"
    pub kind: String,
    pub name: String,
    pub jdk_version: Option<String>,
    pub jdk_path: Option<String>,
    pub maven_version: Option<String>,
    pub maven_path: Option<String>,
    pub node_version: Option<String>,
    pub node_path: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDevEnvironmentInput {
    pub kind: String,
    pub name: String,
    pub jdk_version: Option<String>,
    pub jdk_path: Option<String>,
    pub maven_version: Option<String>,
    pub maven_path: Option<String>,
    pub node_version: Option<String>,
    pub node_path: Option<String>,
}

/// 自动识别的结果：新增了哪些条目、跳过了多少条已存在的。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectResult {
    pub created: Vec<DevEnvironment>,
    pub skipped: usize,
}

const DEV_ENV_COLUMNS: &str =
    "id, kind, name, jdk_version, jdk_path, maven_version, maven_path, node_version, node_path, created_at, updated_at";

fn row_to_env(row: &rusqlite::Row<'_>) -> rusqlite::Result<DevEnvironment> {
    Ok(DevEnvironment {
        id: row.get(0)?,
        kind: row.get(1)?,
        name: row.get(2)?,
        jdk_version: row.get(3)?,
        jdk_path: row.get(4)?,
        maven_version: row.get(5)?,
        maven_path: row.get(6)?,
        node_version: row.get(7)?,
        node_path: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

pub fn list_dev_environments(
    db: &AppDatabase,
    kind: Option<String>,
) -> Result<Vec<DevEnvironment>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match kind {
        Some(k) => (
            format!(
                "SELECT {} FROM dev_environments WHERE kind = ?1 ORDER BY created_at ASC",
                DEV_ENV_COLUMNS
            ),
            vec![Box::new(k)],
        ),
        None => (
            format!(
                "SELECT {} FROM dev_environments ORDER BY kind ASC, created_at ASC",
                DEV_ENV_COLUMNS
            ),
            vec![],
        ),
    };

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let rows = stmt
        .query_map(param_refs.as_slice(), row_to_env)
        .map_err(|e| format!("Failed to query dev environments: {}", e))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect dev environments: {}", e))
}

pub fn create_dev_environment(
    db: &AppDatabase,
    input: SaveDevEnvironmentInput,
) -> Result<DevEnvironment, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO dev_environments (id, kind, name, jdk_version, jdk_path, maven_version, maven_path, node_version, node_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            id,
            input.kind,
            input.name,
            input.jdk_version,
            input.jdk_path,
            input.maven_version,
            input.maven_path,
            input.node_version,
            input.node_path,
            now,
            now
        ],
    )
    .map_err(|e| format!("Failed to insert dev environment: {}", e))?;

    Ok(DevEnvironment {
        id,
        kind: input.kind,
        name: input.name,
        jdk_version: input.jdk_version,
        jdk_path: input.jdk_path,
        maven_version: input.maven_version,
        maven_path: input.maven_path,
        node_version: input.node_version,
        node_path: input.node_path,
        created_at: now,
        updated_at: now,
    })
}

/// 全量更新：前端表单一次提交所有字段，缺失的字段一律置空。
pub fn update_dev_environment(
    db: &AppDatabase,
    id: &str,
    input: SaveDevEnvironmentInput,
) -> Result<DevEnvironment, String> {
    let now = chrono::Utc::now().timestamp_millis();

    // 锁只覆盖写操作，读回要另开一次锁 —— AppDatabase 用的 std Mutex 不可重入
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE dev_environments SET kind = ?1, name = ?2, jdk_version = ?3, jdk_path = ?4, maven_version = ?5, maven_path = ?6, node_version = ?7, node_path = ?8, updated_at = ?9 WHERE id = ?10",
            rusqlite::params![
                input.kind,
                input.name,
                input.jdk_version,
                input.jdk_path,
                input.maven_version,
                input.maven_path,
                input.node_version,
                input.node_path,
                now,
                id
            ],
        )
        .map_err(|e| format!("Failed to update dev environment: {}", e))?;
    }

    get_dev_environment(db, id)
}

pub fn get_dev_environment(db: &AppDatabase, id: &str) -> Result<DevEnvironment, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM dev_environments WHERE id = ?1",
            DEV_ENV_COLUMNS
        ))
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    stmt.query_row([id], row_to_env)
        .map_err(|e| format!("Failed to fetch dev environment: {}", e))
}

pub fn delete_dev_environment(db: &AppDatabase, id: &str) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM dev_environments WHERE id = ?1", [id])
        .map_err(|e| format!("Failed to delete dev environment: {}", e))?;

    Ok(())
}

/// 识别系统里已装的 JDK / Maven / Node，落库并返回新增的条目。
///
/// 已存在的组合（同样的路径）不重复入库 —— 用户反复点「自动识别」不该堆出一堆重复行。
pub fn detect_and_persist(
    db: &AppDatabase,
    kind: &str,
) -> Result<DetectResult, String> {
    let candidates = detector::detect(kind)?;

    let existing = list_dev_environments(db, None)?;
    let mut created = Vec::new();
    let mut skipped = 0usize;

    for cand in candidates {
        let duplicated = existing.iter().any(|e| {
            e.kind == cand.kind
                && e.jdk_path == cand.jdk_path
                && e.maven_path == cand.maven_path
                && e.node_path == cand.node_path
        });
        if duplicated {
            skipped += 1;
            continue;
        }

        let saved = create_dev_environment(
            db,
            SaveDevEnvironmentInput {
                kind: cand.kind,
                name: cand.name,
                jdk_version: cand.jdk_version,
                jdk_path: cand.jdk_path,
                maven_version: cand.maven_version,
                maven_path: cand.maven_path,
                node_version: cand.node_version,
                node_path: cand.node_path,
            },
        )?;
        created.push(saved);
    }

    Ok(DetectResult { created, skipped })
}

/// 把一条路径解析成 (根目录, bin 目录)。
///
/// 用户可能填根目录也可能填可执行文件，两种都要认；路径还不存在时按根目录兜底，
/// 免得配置里写了个还没装好的路径就整个环境失效。
fn tool_dirs(root: &str, exe_name: &str) -> (String, String) {
    let trimmed = root.trim().trim_end_matches(['/', '\\']);
    if !trimmed.is_empty() {
        if let Some((home, bin)) = detector::resolve_tool_home(Path::new(trimmed), exe_name) {
            return (
                home.to_string_lossy().into_owned(),
                bin.to_string_lossy().into_owned(),
            );
        }
    }
    (
        trimmed.to_string(),
        format!("{}/bin", trimmed),
    )
}

/// node 的 bin 目录。node_path 存的是可执行文件路径，用户也可能直接填目录。
fn node_bin_dir(node_path: &str) -> Option<String> {
    let trimmed = node_path.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = Path::new(trimmed);
    if path.is_dir() {
        return detector::resolve_tool_home(path, "node")
            .map(|(_, bin)| bin.to_string_lossy().into_owned());
    }
    path.parent()
        .map(|dir| dir.to_string_lossy().into_owned())
        .filter(|dir| !dir.is_empty())
}

/// 项目绑定的工具路径。服务启动与 PTY 会话共用这一份，保证两边看到的工具版本一致。
#[derive(Debug, Clone, Default)]
pub struct ProjectTools {
    pub java_home: Option<String>,
    pub maven_home: Option<String>,
    /// 需要前置到 PATH 的 bin 目录
    pub path_prefixes: Vec<String>,
}

/// 从绑定的环境条目里解析出工具的根目录与 bin 目录。
pub fn resolve_project_tools(
    java_env: Option<&DevEnvironment>,
    node_env: Option<&DevEnvironment>,
) -> ProjectTools {
    let mut tools = ProjectTools::default();

    if let Some(j) = java_env {
        if let Some(jdk_path) = j.jdk_path.as_ref().filter(|s| !s.trim().is_empty()) {
            let (home, bin) = tool_dirs(jdk_path, "java");
            tools.java_home = Some(home);
            tools.path_prefixes.push(bin);
        }
        if let Some(maven_path) = j.maven_path.as_ref().filter(|s| !s.trim().is_empty()) {
            let (home, bin) = tool_dirs(maven_path, "mvn");
            tools.maven_home = Some(home);
            tools.path_prefixes.push(bin);
        }
    }

    if let Some(n) = node_env {
        if let Some(node_path) = n.node_path.as_ref().filter(|s| !s.trim().is_empty()) {
            if let Some(bin) = node_bin_dir(node_path) {
                tools.path_prefixes.push(bin);
            }
        }
    }

    tools
}

/// 把工具的 bin 目录前置到给定 PATH 前面。
pub fn prepend_path_prefixes(prefixes: &[String], base_path: &str) -> String {
    if prefixes.is_empty() {
        return base_path.to_string();
    }
    let separator = if cfg!(windows) { ";" } else { ":" };
    let mut new_path = prefixes.join(separator);
    if !base_path.is_empty() {
        new_path.push_str(separator);
        new_path.push_str(base_path);
    }
    new_path
}

/// 构造项目运行环境的变量覆盖表。
///
/// 服务启动用这一份（PATH 以进程自身 PATH 为底）；
/// PTY 会话另有登录 shell 的 PATH，那边走 prepend_path_prefixes 拼接，
/// 免得把 nvm 之类的路径弄丢。
pub fn build_project_env(
    java_env: Option<&DevEnvironment>,
    node_env: Option<&DevEnvironment>,
) -> Vec<(String, String)> {
    let tools = resolve_project_tools(java_env, node_env);
    let mut envs: Vec<(String, String)> = Vec::new();

    if let Some(home) = &tools.java_home {
        envs.push(("JAVA_HOME".to_string(), home.clone()));
    }
    if let Some(home) = &tools.maven_home {
        envs.push(("M2_HOME".to_string(), home.clone()));
        envs.push(("MAVEN_HOME".to_string(), home.clone()));
    }

    if !tools.path_prefixes.is_empty() {
        let original = std::env::var("PATH").unwrap_or_default();
        envs.push((
            "PATH".to_string(),
            prepend_path_prefixes(&tools.path_prefixes, &original),
        ));
    }

    envs
}

/// 取项目绑定的两条环境条目。
pub fn load_project_envs(
    db: &AppDatabase,
    java_env_id: Option<&str>,
    node_env_id: Option<&str>,
) -> Result<(Option<DevEnvironment>, Option<DevEnvironment>), String> {
    let java_env = match java_env_id {
        Some(id) => Some(get_dev_environment(db, id)?),
        None => None,
    };
    let node_env = match node_env_id {
        Some(id) => Some(get_dev_environment(db, id)?),
        None => None,
    };
    Ok((java_env, node_env))
}
