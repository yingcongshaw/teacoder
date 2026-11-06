use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

pub mod detector;

/// 开发环境类型：一套环境对应一门语言。
pub const KIND_JAVA: &str = "java";
pub const KIND_NODE: &str = "node";
pub const KIND_DOTNET: &str = "dotnet";
pub const KIND_PYTHON: &str = "python";
pub const KIND_RUST: &str = "rust";
pub const KIND_GO: &str = "go";
pub const KIND_CPP: &str = "cpp";

/// 环境里的工具。
pub const TOOL_JDK: &str = "jdk";
pub const TOOL_MAVEN: &str = "maven";
pub const TOOL_NODE: &str = "node";
pub const TOOL_DOTNET: &str = "dotnet";
pub const TOOL_MSBUILD: &str = "msbuild";
pub const TOOL_PYTHON: &str = "python";
pub const TOOL_CARGO: &str = "cargo";
pub const TOOL_GO: &str = "go";
pub const TOOL_CMAKE: &str = "cmake";
pub const TOOL_CC: &str = "cc";

/// 一件工具的版本与路径。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevTool {
    pub tool: String,
    pub version: Option<String>,
    pub path: Option<String>,
}

impl DevTool {
    /// 路径去掉首尾空白，空路径当没有。
    pub fn trimmed_path(&self) -> Option<&str> {
        self.path.as_deref().map(str::trim).filter(|p| !p.is_empty())
    }
}

/// 一套开发环境：一种语言下的一组工具。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevEnvironment {
    pub id: String,
    /// java | node | dotnet | python | rust | go | cpp
    pub kind: String,
    pub name: String,
    pub tools: Vec<DevTool>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl DevEnvironment {
    /// 取这件工具的路径。
    pub fn tool_path(&self, tool: &str) -> Option<&str> {
        self.tools
            .iter()
            .find(|t| t.tool == tool)
            .and_then(|t| t.trimmed_path())
    }

    /// 这件工具的可执行文件名（如 python3 / node）。
    ///
    /// 工具路径的含义各语言不同：JDK、Maven 存的是安装目录，可执行文件在 bin 下；
    /// Go 存的是 GOROOT；其余存的就是可执行文件本身。
    pub fn tool_exe_name(&self, tool: &str) -> Option<String> {
        let raw = self.tool_path(tool)?;
        let path = Path::new(raw);
        let exe = match tool {
            TOOL_JDK => path.join("bin").join("java"),
            TOOL_MAVEN => path.join("bin").join("mvn"),
            TOOL_GO => path.join("bin").join("go"),
            _ => path.to_path_buf(),
        };
        exe.file_name()
            .map(|n| n.to_string_lossy().into_owned())
    }
}

/// 工具可执行文件的完整路径。
///
/// 路径不存在就返回 None —— 装了但没落在这台机器上时不能瞎猜，
/// 否则启动时会跑到别处去。
pub fn tool_exe_path(tool: &str, raw: &str) -> Option<PathBuf> {
    let path = Path::new(raw);
    match tool {
        TOOL_JDK => find_exe_in_bin(path, &["java", "java.exe"]),
        TOOL_MAVEN => find_exe_in_bin(path, &["mvn", "mvn.cmd", "mvn.bat"]),
        TOOL_GO => find_exe_in_bin(path, &["go", "go.exe"]),
        _ => {
            if path.is_file() {
                Some(path.to_path_buf())
            } else {
                None
            }
        }
    }
}

/// 在 <root>/bin 下找可执行文件。路径本身就是可执行文件时按它自己算。
fn find_exe_in_bin(root: &Path, names: &[&str]) -> Option<PathBuf> {
    let bin = root.join("bin");
    for name in names {
        let candidate = bin.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if root.is_file() {
        return Some(root.to_path_buf());
    }
    None
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDevEnvironmentInput {
    pub kind: String,
    pub name: String,
    pub tools: Vec<DevTool>,
}

/// 自动识别的结果：新增了哪些条目、跳过了多少条已存在的。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectResult {
    pub created: Vec<DevEnvironment>,
    pub skipped: usize,
}

const ENV_COLUMNS: &str = "id, kind, name, created_at, updated_at";

fn row_to_env(row: &rusqlite::Row<'_>) -> rusqlite::Result<DevEnvironment> {
    Ok(DevEnvironment {
        id: row.get(0)?,
        kind: row.get(1)?,
        name: row.get(2)?,
        tools: Vec::new(),
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

/// 把一套环境的工具按 env_id 归拢。
fn load_tools(
    conn: &rusqlite::Connection,
) -> Result<std::collections::HashMap<String, Vec<DevTool>>, String> {
    let mut stmt = conn
        .prepare("SELECT env_id, tool, version, path FROM dev_env_tools ORDER BY created_at ASC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                DevTool {
                    tool: row.get(1)?,
                    version: row.get(2)?,
                    path: row.get(3)?,
                },
            ))
        })
        .map_err(|e| format!("Failed to query dev env tools: {}", e))?;

    let mut map: std::collections::HashMap<String, Vec<DevTool>> = std::collections::HashMap::new();
    for row in rows {
        let (env_id, tool) = row.map_err(|e| format!("Failed to collect dev env tool: {}", e))?;
        map.entry(env_id).or_default().push(tool);
    }
    Ok(map)
}

pub fn list_dev_environments(
    db: &AppDatabase,
    kind: Option<&str>,
) -> Result<Vec<DevEnvironment>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match kind {
        Some(k) => (
            format!(
                "SELECT {} FROM dev_environments WHERE kind = ?1 ORDER BY created_at ASC",
                ENV_COLUMNS
            ),
            vec![Box::new(k.to_string())],
        ),
        None => (
            format!(
                "SELECT {} FROM dev_environments ORDER BY kind ASC, created_at ASC",
                ENV_COLUMNS
            ),
            vec![],
        ),
    };

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut envs = stmt
        .query_map(param_refs.as_slice(), row_to_env)
        .map_err(|e| format!("Failed to query dev environments: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect dev environments: {}", e))?;

    let tools = load_tools(&conn)?;
    for env in &mut envs {
        if let Some(list) = tools.get(&env.id) {
            env.tools = list.clone();
        }
    }

    Ok(envs)
}

pub fn create_dev_environment(
    db: &AppDatabase,
    input: SaveDevEnvironmentInput,
) -> Result<DevEnvironment, String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    tx.execute(
        "INSERT INTO dev_environments (id, kind, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, input.kind, input.name, now, now],
    )
    .map_err(|e| format!("Failed to insert dev environment: {}", e))?;

    insert_tools(&tx, &id, &input.tools, now)?;

    tx.commit()
        .map_err(|e| format!("Failed to commit dev environment: {}", e))?;

    Ok(DevEnvironment {
        id,
        kind: input.kind,
        name: input.name,
        tools: input.tools,
        created_at: now,
        updated_at: now,
    })
}

/// 写入一套环境的工具。
fn insert_tools(
    tx: &rusqlite::Transaction<'_>,
    env_id: &str,
    tools: &[DevTool],
    now: i64,
) -> Result<(), String> {
    for tool in tools {
        tx.execute(
            "INSERT INTO dev_env_tools (id, env_id, tool, version, path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                env_id,
                tool.tool,
                tool.version,
                tool.path,
                now,
                now
            ],
        )
        .map_err(|e| format!("Failed to insert dev env tool: {}", e))?;
    }
    Ok(())
}

/// 全量更新：前端表单一次提交所有字段，缺失的字段一律置空。
pub fn update_dev_environment(
    db: &AppDatabase,
    id: &str,
    input: SaveDevEnvironmentInput,
) -> Result<DevEnvironment, String> {
    {
        let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
        let now = chrono::Utc::now().timestamp_millis();

        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;

        tx.execute(
            "UPDATE dev_environments SET kind = ?1, name = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![input.kind, input.name, now, id],
        )
        .map_err(|e| format!("Failed to update dev environment: {}", e))?;

        tx.execute("DELETE FROM dev_env_tools WHERE env_id = ?1", [id])
            .map_err(|e| format!("Failed to clear dev env tools: {}", e))?;
        insert_tools(&tx, id, &input.tools, now)?;

        tx.commit()
            .map_err(|e| format!("Failed to commit dev environment: {}", e))?;
    }

    // 锁必须先放掉再回查，否则同线程二次加锁会自锁
    get_dev_environment(db, id)
}

pub fn get_dev_environment(db: &AppDatabase, id: &str) -> Result<DevEnvironment, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM dev_environments WHERE id = ?1",
            ENV_COLUMNS
        ))
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let mut env = stmt
        .query_row([id], row_to_env)
        .map_err(|e| format!("Failed to fetch dev environment: {}", e))?;

    let tools = load_tools(&conn)?;
    if let Some(list) = tools.get(id) {
        env.tools = list.clone();
    }

    Ok(env)
}

pub fn delete_dev_environment(db: &AppDatabase, id: &str) -> Result<(), String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    tx.execute("DELETE FROM dev_env_tools WHERE env_id = ?1", [id])
        .map_err(|e| format!("Failed to delete dev env tools: {}", e))?;
    tx.execute("DELETE FROM project_dev_envs WHERE env_id = ?1", [id])
        .map_err(|e| format!("Failed to delete project env bindings: {}", e))?;
    tx.execute("DELETE FROM dev_environments WHERE id = ?1", [id])
        .map_err(|e| format!("Failed to delete dev environment: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit dev environment: {}", e))?;

    Ok(())
}

/// 识别系统里已装的工具链，落库并返回新增的条目。
///
/// 已存在的组合（同样的路径）不重复入库 —— 用户反复点「自动识别」不该堆出一堆重复行。
pub fn detect_and_persist(db: &AppDatabase, kind: &str) -> Result<DetectResult, String> {
    let candidates = detector::detect(kind)?;

    let existing = list_dev_environments(db, None)?;
    let mut created = Vec::new();
    let mut skipped = 0usize;

    for cand in candidates {
        let duplicated = existing.iter().any(|e| {
            e.kind == cand.kind
                && e.tools.len() == cand.tools.len()
                && e.tools.iter().all(|t| {
                    cand.tools
                        .iter()
                        .any(|c| c.tool == t.tool && c.path == t.path)
                })
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
                tools: cand.tools,
            },
        )?;
        created.push(saved);
    }

    Ok(DetectResult { created, skipped })
}

/// 项目绑定的环境清单。
pub fn list_project_envs(db: &AppDatabase, project_id: &str) -> Result<Vec<DevEnvironment>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.kind, e.name, e.created_at, e.updated_at
             FROM dev_environments e
             JOIN project_dev_envs b ON b.env_id = e.id
             WHERE b.project_id = ?1
             ORDER BY e.kind ASC, e.created_at DESC",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let mut envs = stmt
        .query_map([project_id], row_to_env)
        .map_err(|e| format!("Failed to query project dev envs: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect project dev envs: {}", e))?;

    let tools = load_tools(&conn)?;
    for env in &mut envs {
        if let Some(list) = tools.get(&env.id) {
            env.tools = list.clone();
        }
    }

    Ok(envs)
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

/// 可执行文件所在的目录。传进来的本来就是目录时就用它自己。
fn exe_dir(path: &Path) -> String {
    if path.is_dir() {
        return path.to_string_lossy().into_owned();
    }
    match path.parent() {
        Some(parent) => parent.to_string_lossy().into_owned(),
        None => path.to_string_lossy().into_owned(),
    }
}

/// 项目绑定的工具路径。服务启动与 PTY 会话共用这一份，保证两边看到的工具版本一致。
#[derive(Debug, Clone, Default)]
pub struct ProjectTools {
    pub java_home: Option<String>,
    pub maven_home: Option<String>,
    pub dotnet_root: Option<String>,
    pub goroot: Option<String>,
    pub cargo_home: Option<String>,
    /// 需要前置到 PATH 的 bin 目录
    pub path_prefixes: Vec<String>,
}

/// 从绑定的环境条目里解析出工具的根目录与 bin 目录。
pub fn resolve_project_tools(envs: &[DevEnvironment]) -> ProjectTools {
    let mut tools = ProjectTools::default();

    for env in envs {
        for tool in &env.tools {
            apply_tool(&mut tools, tool);
        }
    }

    tools
}

/// 把一件工具折算成环境变量与 PATH 前缀。
///
/// 各类工具的路径含义不一样：JDK / Maven 存的是安装根目录，
/// dotnet / node / python 存的是可执行文件，go 存的是 GOROOT。
///
/// 同一种语言绑了多套环境时，只认第一套 —— 列表按创建时间倒序，
/// 也就是新建的那套优先。HOME 类变量与 PATH 前缀必须取同一套，
/// 否则 JAVA_HOME 指向新 JDK、PATH 上却先找到旧 JDK 的 java。
fn apply_tool(tools: &mut ProjectTools, tool: &DevTool) {
    let Some(raw) = tool.trimmed_path() else {
        return;
    };
    let path = Path::new(raw);

    match tool.tool.as_str() {
        TOOL_JDK => {
            let (home, bin) = tool_dirs(raw, "java");
            if tools.java_home.is_none() {
                tools.java_home = Some(home);
            }
            tools.path_prefixes.push(bin);
        }
        TOOL_MAVEN => {
            let (home, bin) = tool_dirs(raw, "mvn");
            if tools.maven_home.is_none() {
                tools.maven_home = Some(home);
            }
            tools.path_prefixes.push(bin);
        }
        TOOL_DOTNET => {
            let dir = exe_dir(path);
            if tools.dotnet_root.is_none() {
                tools.dotnet_root = Some(dir.clone());
            }
            tools.path_prefixes.push(dir);
        }
        TOOL_CARGO => {
            let dir = exe_dir(path);
            // rustup 的工具链在 ~/.rustup/toolchains/<tc>/bin 下，
            // CARGO_HOME 仍该指回 ~/.cargo，不能跟着工具链走。
            if let Some(home) = Path::new(&dir).parent() {
                let is_cargo_home = home
                    .file_name()
                    .map(|n| n.to_string_lossy() == ".cargo")
                    .unwrap_or(false);
                if is_cargo_home && tools.cargo_home.is_none() {
                    tools.cargo_home = Some(home.to_string_lossy().into_owned());
                }
            }
            tools.path_prefixes.push(dir);
        }
        TOOL_GO => {
            // Go 的工具路径统一按 GOROOT 目录存（检测器与界面都是这个口径）。
            // 万一填的是 go 可执行文件，再按安装布局反推根目录。
            let is_exe = path.is_file();
            if is_exe {
                let dir = exe_dir(path);
                if let Some(root) = Path::new(&dir).parent() {
                    if tools.goroot.is_none() {
                        tools.goroot = Some(root.to_string_lossy().into_owned());
                    }
                }
                tools.path_prefixes.push(dir);
            } else {
                if tools.goroot.is_none() {
                    tools.goroot = Some(raw.to_string());
                }
                tools.path_prefixes.push(
                    Path::new(raw).join("bin").to_string_lossy().into_owned(),
                );
            }
        }
        _ => {
            // node / python / cmake / 编译器：只把可执行文件所在目录前置到 PATH
            tools.path_prefixes.push(exe_dir(path));
        }
    }
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
pub fn build_project_env(envs: &[DevEnvironment]) -> Vec<(String, String)> {
    let tools = resolve_project_tools(envs);
    let mut result: Vec<(String, String)> = Vec::new();

    if let Some(home) = &tools.java_home {
        result.push(("JAVA_HOME".to_string(), home.clone()));
    }
    if let Some(home) = &tools.maven_home {
        result.push(("M2_HOME".to_string(), home.clone()));
        result.push(("MAVEN_HOME".to_string(), home.clone()));
    }
    if let Some(root) = &tools.dotnet_root {
        result.push(("DOTNET_ROOT".to_string(), root.clone()));
    }
    if let Some(root) = &tools.goroot {
        result.push(("GOROOT".to_string(), root.clone()));
    }
    if let Some(home) = &tools.cargo_home {
        result.push(("CARGO_HOME".to_string(), home.clone()));
    }

    if !tools.path_prefixes.is_empty() {
        let original = std::env::var("PATH").unwrap_or_default();
        result.push((
            "PATH".to_string(),
            prepend_path_prefixes(&tools.path_prefixes, &original),
        ));
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn test_db() -> AppDatabase {
        let conn = rusqlite::Connection::open_in_memory().expect("打开内存数据库");
        let db = AppDatabase {
            conn: Mutex::new(conn),
        };
        db.run_migrations().expect("执行迁移");
        db
    }

    fn env(kind: &str, tools: Vec<DevTool>) -> DevEnvironment {
        DevEnvironment {
            id: "e1".to_string(),
            kind: kind.to_string(),
            name: "环境".to_string(),
            tools,
            created_at: 0,
            updated_at: 0,
        }
    }

    fn tool(name: &str, path: &str) -> DevTool {
        DevTool {
            tool: name.to_string(),
            version: None,
            path: Some(path.to_string()),
        }
    }

    #[test]
    fn creates_and_lists_env_with_tools() {
        let db = test_db();

        let created = create_dev_environment(
            &db,
            SaveDevEnvironmentInput {
                kind: KIND_JAVA.to_string(),
                name: "JDK 21 + Maven".to_string(),
                tools: vec![
                    tool(TOOL_JDK, "/usr/lib/jvm/java-21"),
                    tool(TOOL_MAVEN, "/opt/maven"),
                ],
            },
        )
        .expect("创建环境");

        assert_eq!(created.tools.len(), 2);

        let listed = list_dev_environments(&db, Some(KIND_JAVA)).expect("查询环境");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].tools.len(), 2);
        assert!(listed[0].tool_path(TOOL_MAVEN).is_some());
        assert_eq!(
            listed[0].tool_path(TOOL_JDK),
            Some("/usr/lib/jvm/java-21")
        );
    }

    #[test]
    fn updating_env_replaces_its_tools() {
        let db = test_db();

        let created = create_dev_environment(
            &db,
            SaveDevEnvironmentInput {
                kind: KIND_NODE.to_string(),
                name: "Node".to_string(),
                tools: vec![tool(TOOL_NODE, "/usr/bin/node")],
            },
        )
        .expect("创建环境");

        update_dev_environment(
            &db,
            &created.id,
            SaveDevEnvironmentInput {
                kind: KIND_NODE.to_string(),
                name: "Node 22".to_string(),
                tools: vec![tool(TOOL_NODE, "/opt/node/bin/node")],
            },
        )
        .expect("更新环境");

        let listed = list_dev_environments(&db, None).expect("查询环境");
        assert_eq!(listed[0].tools.len(), 1);
        assert_eq!(listed[0].tool_path(TOOL_NODE), Some("/opt/node/bin/node"));
    }

    #[test]
    fn deleting_env_clears_project_bindings() {
        let db = test_db();

        let created = create_dev_environment(
            &db,
            SaveDevEnvironmentInput {
                kind: KIND_PYTHON.to_string(),
                name: "Python".to_string(),
                tools: vec![tool(TOOL_PYTHON, "/usr/bin/python3")],
            },
        )
        .expect("创建环境");

        {
            let conn = db.conn.lock().expect("锁");
            conn.execute(
                "INSERT INTO projects (id, name, path, created_at, updated_at, sort_order) VALUES ('p1', 'demo', '/tmp/demo', 1, 1, 0)",
                [],
            )
            .expect("插入项目");
            conn.execute(
                "INSERT INTO project_dev_envs (project_id, env_id, created_at, updated_at) VALUES ('p1', ?1, 1, 1)",
                [&created.id],
            )
            .expect("绑定环境");
        }

        assert_eq!(list_project_envs(&db, "p1").expect("查询绑定").len(), 1);

        delete_dev_environment(&db, &created.id).expect("删除环境");
        assert!(list_project_envs(&db, "p1").expect("查询绑定").is_empty());
    }

    #[test]
    fn project_env_builds_tool_specific_variables() {
        let envs = vec![
            env(
                KIND_JAVA,
                vec![tool(TOOL_JDK, "/usr/lib/jvm/java-21")],
            ),
            env(KIND_DOTNET, vec![tool(TOOL_DOTNET, "/usr/share/dotnet/dotnet")]),
            env(KIND_GO, vec![tool(TOOL_GO, "/usr/local/go")]),
        ];

        let vars = build_project_env(&envs);
        let lookup: std::collections::HashMap<&str, &str> = vars
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();

        assert_eq!(lookup.get("JAVA_HOME"), Some(&"/usr/lib/jvm/java-21"));
        assert_eq!(lookup.get("DOTNET_ROOT"), Some(&"/usr/share/dotnet"));
        assert_eq!(lookup.get("GOROOT"), Some(&"/usr/local/go"));

        let path = lookup.get("PATH").expect("PATH");
        assert!(path.starts_with("/usr/lib/jvm/java-21/bin"));
        assert!(path.contains("/usr/share/dotnet"));
        assert!(path.contains("/usr/local/go/bin"));
    }
}
