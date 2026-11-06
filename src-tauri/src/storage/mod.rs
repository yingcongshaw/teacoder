use std::sync::Mutex;

use rusqlite::Connection;

pub mod transfer_log;

/// 内嵌的迁移脚本。
///
/// 必须编进二进制：打包后的应用读不到源码目录，迁移若在运行时从磁盘读，
/// 换台机器全新安装就一张表都建不出来（报 no such table: projects）。
///
/// 清单要跟 migrations/ 目录保持一致 —— storage::tests 里的
/// embedded_migrations_match_dir 会核对，漏登记会在 cargo test 时报错。
const EMBEDDED_MIGRATIONS: &[(i32, &str, &str)] = &[
    (
        1,
        "v1_initial.sql",
        include_str!("../../migrations/v1_initial.sql"),
    ),
    (
        2,
        "v2_tool_settings.sql",
        include_str!("../../migrations/v2_tool_settings.sql"),
    ),
    (
        3,
        "v3_projects.sql",
        include_str!("../../migrations/v3_projects.sql"),
    ),
    (
        4,
        "v4_cli_session_id.sql",
        include_str!("../../migrations/v4_cli_session_id.sql"),
    ),
    (
        5,
        "v5_session_categories.sql",
        include_str!("../../migrations/v5_session_categories.sql"),
    ),
    (
        6,
        "v6_session_messages.sql",
        include_str!("../../migrations/v6_session_messages.sql"),
    ),
    (
        7,
        "v7_app_settings.sql",
        include_str!("../../migrations/v7_app_settings.sql"),
    ),
    (
        8,
        "v8_llm_providers.sql",
        include_str!("../../migrations/v8_llm_providers.sql"),
    ),
    (
        9,
        "v9_llm_provider_default.sql",
        include_str!("../../migrations/v9_llm_provider_default.sql"),
    ),
    (
        10,
        "v10_llm_provider_auth_type.sql",
        include_str!("../../migrations/v10_llm_provider_auth_type.sql"),
    ),
    (
        11,
        "v11_llm_provider_api_key.sql",
        include_str!("../../migrations/v11_llm_provider_api_key.sql"),
    ),
    (
        12,
        "v12_llm_provider_oauth_token.sql",
        include_str!("../../migrations/v12_llm_provider_oauth_token.sql"),
    ),
    (
        13,
        "v13_claude_models.sql",
        include_str!("../../migrations/v13_claude_models.sql"),
    ),
    (
        14,
        "v14_session_message_sensitive.sql",
        include_str!("../../migrations/v14_session_message_sensitive.sql"),
    ),
    (
        15,
        "v15_sidebar_sort_order.sql",
        include_str!("../../migrations/v15_sidebar_sort_order.sql"),
    ),
    (
        16,
        "v16_transfer_log.sql",
        include_str!("../../migrations/v16_transfer_log.sql"),
    ),
    (
        17,
        "v17_dev_environments.sql",
        include_str!("../../migrations/v17_dev_environments.sql"),
    ),
    (
        18,
        "v18_services.sql",
        include_str!("../../migrations/v18_services.sql"),
    ),
    (
        19,
        "v19_dev_env_tools.sql",
        include_str!("../../migrations/v19_dev_env_tools.sql"),
    ),
    (
        20,
        "v20_clear_legacy_env_columns.sql",
        include_str!("../../migrations/v20_clear_legacy_env_columns.sql"),
    ),
    (
        21,
        "v21_service_spec_fields.sql",
        include_str!("../../migrations/v21_service_spec_fields.sql"),
    ),
];

/// 从 `v13_claude_models.sql` 这样的文件名解析出 13。
/// 解析不出来返回 None —— 文件名写错时要报错，不能静默当成 v0 跳过。
fn migration_version(name: &str) -> Option<i32> {
    name.strip_prefix('v')?
        .split('_')
        .next()?
        .parse()
        .ok()
}


pub struct AppDatabase {
    pub conn: Mutex<Connection>,
}

impl AppDatabase {
    pub fn new(_app: &tauri::AppHandle) -> Result<Self, String> {
        let app_dir = dirs::home_dir()
            .map(|h| h.join(".teacoder"))
            .ok_or_else(|| "Failed to resolve home directory".to_string())?;

        std::fs::create_dir_all(&app_dir)
            .map_err(|e| format!("Failed to create app data dir: {}", e))?;

        let db_path = app_dir.join("teacoder.db");
        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| format!("Failed to set pragmas: {}", e))?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.run_migrations()?;
        // best-effort 数据修复：旧版 closeTab 的探测逻辑曾把同一项目下多个会话的
        // cli_session_id 覆写成同一个值。修复幂等，失败不阻塞启动。
        match crate::session::dedupe::dedupe_cli_session_ids(&db) {
            Ok(outcome) if !outcome.is_noop() => {
                eprintln!(
                    "已修复重复 cli_session_id：{} 组，正确 {} 个，改回 {} 个，清空 {} 个",
                    outcome.groups, outcome.unchanged, outcome.reassigned, outcome.cleared
                );
            }
            Ok(_) => {}
            Err(e) => eprintln!("拆分重复 cli_session_id 失败: {e}"),
        }
        Ok(db)
    }

    pub(crate) fn run_migrations(&self) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;

        let current_version: i32 = conn
            .query_row(
                "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        // 按版本号升序执行，不是按文件名：'v10_' < 'v1_'（'0' < '_'），
        // 字典序会让 v10 先于 v8 执行，而 v10 ALTER 的 llm_providers 彼时尚不存在。
        let mut migrations: Vec<(i32, &str, &str)> = EMBEDDED_MIGRATIONS.to_vec();
        migrations.sort_by_key(|(version, _, _)| *version);

        for (version, name, sql) in migrations {
            // 版本号必须与文件名一致：抄错一行会让迁移的执行顺序错乱
            match migration_version(name) {
                Some(v) if v == version => {}
                Some(v) => {
                    return Err(format!(
                        "迁移 {name} 的版本号与清单不符：文件名是 v{v}，清单写的是 {version}"
                    ))
                }
                None => return Err(format!("迁移文件名不以 v<N>_ 开头: {name}")),
            }

            if version <= current_version {
                continue;
            }

            // 单个迁移放在事务里：中途失败要整体回滚，不能留下半套 schema
            let tx = conn
                .transaction()
                .map_err(|e| format!("Failed to begin transaction for {}: {}", name, e))?;
            tx.execute_batch(sql)
                .map_err(|e| format!("Failed to apply migration {}: {}", name, e))?;
            tx.commit()
                .map_err(|e| format!("Failed to commit migration {}: {}", name, e))?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 迁移目录里的每个 .sql 都必须在 EMBEDDED_MIGRATIONS 里登记。
    /// 漏登记不会导致编译失败，只会让线上少建一张表 —— 这种错误必须在
    /// cargo test 阶段就暴露。
    #[test]
    fn embedded_migrations_match_migrations_dir() {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("migrations");

        let mut on_disk: Vec<(i32, String)> = std::fs::read_dir(&dir)
            .expect("migrations 目录应存在")
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|ext| ext == "sql"))
            .map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                let version = migration_version(&name)
                    .unwrap_or_else(|| panic!("迁移文件名不以 v<N>_ 开头: {name}"));
                (version, name)
            })
            .collect();
        on_disk.sort();

        let embedded: Vec<(i32, String)> = EMBEDDED_MIGRATIONS
            .iter()
            .map(|(version, name, _)| (*version, name.to_string()))
            .collect();

        assert_eq!(
            embedded, on_disk,
            "内嵌迁移清单与 migrations/ 目录不一致：新增迁移文件后要同步登记到 EMBEDDED_MIGRATIONS"
        );
    }

    /// 版本号必须从 1 开始连续递增：跳号会让中间那段迁移永远不执行。
    #[test]
    fn embedded_migration_versions_are_contiguous() {
        let mut versions: Vec<i32> = EMBEDDED_MIGRATIONS.iter().map(|(v, _, _)| *v).collect();
        versions.sort_unstable();

        let expected: Vec<i32> = (1..=versions.len() as i32).collect();
        assert_eq!(versions, expected);
    }

    /// 全新数据库跑完全部迁移后，表结构要齐 —— 特别是 projects，
    /// 打包安装后建项目依赖它。
    #[test]
    fn fresh_database_gets_all_tables() {
        let conn = Connection::open_in_memory().unwrap();
        let mut current_version = 0;

        let mut migrations: Vec<(i32, &str, &str)> = EMBEDDED_MIGRATIONS.to_vec();
        migrations.sort_by_key(|(version, _, _)| *version);

        for (version, name, sql) in migrations {
            conn.execute_batch(sql)
                .unwrap_or_else(|e| panic!("迁移 {name} 执行失败: {e}"));
            current_version = version;
        }
        assert_eq!(current_version, EMBEDDED_MIGRATIONS.len() as i32);

        let tables: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        for expected_table in [
            "app_settings",
            "cli_tools",
            "dev_environments",
            "dev_env_tools",
            "llm_providers",
            "project_dev_envs",
            "projects",
            "schema_version",
            "services",
            "session_categories",
            "session_costs",
            "session_messages",
            "sessions",
            "tool_settings",
            "transfer_log",
        ] {
            assert!(
                tables.iter().any(|t| t == expected_table),
                "缺表 {expected_table}，实际有：{tables:?}"
            );
        }
    }

    /// 升级路径：v18 库里的开发环境要原样搬进 v19 的新结构，不能丢用户的配置。
    #[test]
    fn migration_v19_carries_existing_dev_environments_over() {
        let conn = Connection::open_in_memory().unwrap();

        for (version, name, sql) in EMBEDDED_MIGRATIONS.iter().filter(|(v, _, _)| *v < 19) {
            conn.execute_batch(sql)
                .unwrap_or_else(|e| panic!("迁移 v{version} {name} 执行失败: {e}"));
        }

        conn.execute(
            "INSERT INTO dev_environments (id, kind, name, jdk_version, jdk_path, maven_version, maven_path, node_version, node_path, created_at, updated_at) VALUES ('e1', 'java', 'JDK 21 + Maven', '21.0.2', '/usr/lib/jvm/java-21', '3.9.6', '/opt/maven', NULL, NULL, 1, 1)",
            [],
        )
        .expect("插入旧结构的环境");
        conn.execute(
            "INSERT INTO dev_environments (id, kind, name, jdk_version, jdk_path, maven_version, maven_path, node_version, node_path, created_at, updated_at) VALUES ('e2', 'node', 'Node 22', NULL, NULL, NULL, NULL, '22.13.1', '/usr/bin/node', 1, 1)",
            [],
        )
        .expect("插入旧结构的环境");
        conn.execute(
            "INSERT INTO projects (id, name, path, created_at, updated_at, sort_order) VALUES ('p1', 'demo', '/tmp/demo', 1, 1, 0)",
            [],
        )
        .expect("插入项目");
        conn.execute(
            "UPDATE projects SET java_env_id = 'e1', node_env_id = 'e2' WHERE id = 'p1'",
            [],
        )
        .expect("绑定环境");

        let v19 = EMBEDDED_MIGRATIONS
            .iter()
            .find(|(v, _, _)| *v == 19)
            .expect("清单里应有 v19");
        conn.execute_batch(v19.2)
            .expect("v19 迁移失败");

        // 环境本体搬过来了
        let envs: Vec<(String, String)> = conn
            .prepare("SELECT id, kind FROM dev_environments ORDER BY id")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(
            envs,
            vec![
                ("e1".to_string(), "java".to_string()),
                ("e2".to_string(), "node".to_string())
            ]
        );

        // 工具拆成了独立行
        let tools: Vec<(String, String, String)> = conn
            .prepare(
                "SELECT env_id, tool, path FROM dev_env_tools ORDER BY env_id, tool",
            )
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(
            tools,
            vec![
                ("e1".to_string(), "jdk".to_string(), "/usr/lib/jvm/java-21".to_string()),
                ("e1".to_string(), "maven".to_string(), "/opt/maven".to_string()),
                ("e2".to_string(), "node".to_string(), "/usr/bin/node".to_string()),
            ]
        );

        // 项目绑定也搬过来了
        let bindings: Vec<(String, String)> = conn
            .prepare("SELECT project_id, env_id FROM project_dev_envs ORDER BY env_id")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(
            bindings,
            vec![
                ("p1".to_string(), "e1".to_string()),
                ("p1".to_string(), "e2".to_string())
            ]
        );

        // 旧列被清空，避免读到过期的绑定
        let legacy: Vec<(Option<String>, Option<String>)> = conn
            .prepare("SELECT java_env_id, node_env_id FROM projects WHERE id = 'p1'")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(legacy, vec![(None, None)]);
    }
}
