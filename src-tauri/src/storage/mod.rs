use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;

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
        Ok(db)
    }

    fn run_migrations(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        let current_version: i32 = conn
            .query_row(
                "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let migrations_dir = Self::migrations_dir()?;

        if !migrations_dir.exists() {
            return Ok(());
        }

        let mut entries: Vec<(i32, PathBuf)> = std::fs::read_dir(&migrations_dir)
            .map_err(|e| format!("Failed to read migrations dir: {}", e))?
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .is_some_and(|ext| ext == "sql")
            })
            .map(|e| {
                let path = e.path();
                let version = Self::migration_version(&e.file_name().to_string_lossy())
                    .ok_or_else(|| format!("迁移文件名不以 v<N>_ 开头: {path:?}"));
                version.map(|v| (v, path))
            })
            .collect::<Result<_, _>>()?;

        // 必须按版本号排，不是按文件名排：'v10_' < 'v1_'（'0' < '_'），
        // 字典序会让 v10 先于 v8 执行，而 v10 ALTER 的 llm_providers 彼时尚不存在。
        entries.sort_by_key(|(version, _)| *version);

        for (version, path) in entries {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            if version <= current_version {
                continue;
            }

            let sql = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read migration {}: {}", name, e))?;

            conn.execute_batch(&sql)
                .map_err(|e| format!("Failed to apply migration {}: {}", name, e))?;
        }

        Ok(())
    }

    /// 从 `v13_claude_models.sql` 解析出 13。
    /// 解析不出来返回 None —— 文件名写错时要报错，不能静默当成 v0 跳过。
    fn migration_version(name: &str) -> Option<i32> {
        name.strip_prefix('v')?
            .split('_')
            .next()?
            .parse()
            .ok()
    }

    fn migrations_dir() -> Result<PathBuf, String> {
        // 编译时嵌入 src-tauri 目录路径，dev 和 prod 都可靠
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let dir = manifest_dir.join("migrations");
        if dir.exists() {
            return Ok(dir);
        }

        // Fallback: 相对于 exe 查找
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("Failed to get exe path: {}", e))?
            .parent()
            .ok_or_else(|| "No parent dir for exe".to_string())?
            .to_path_buf();

        Ok(exe_dir.join("migrations"))
    }
}
