use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

pub struct AppDatabase {
    pub conn: Mutex<Connection>,
}

impl AppDatabase {
    pub fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        let app_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

        std::fs::create_dir_all(&app_dir)
            .map_err(|e| format!("Failed to create app data dir: {}", e))?;

        let db_path = app_dir.join("codingtea.db");
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

        let mut entries: Vec<_> = std::fs::read_dir(&migrations_dir)
            .map_err(|e| format!("Failed to read migrations dir: {}", e))?
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .is_some_and(|ext| ext == "sql")
            })
            .collect();

        entries.sort_by_key(|e| e.file_name());

        for entry in entries {
            let filename = entry.file_name();
            let name = filename.to_string_lossy();

            let version: i32 = name
                .strip_prefix('v')
                .and_then(|s| s.split('_').next())
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);

            if version <= current_version {
                continue;
            }

            let sql = std::fs::read_to_string(entry.path())
                .map_err(|e| format!("Failed to read migration {}: {}", name, e))?;

            conn.execute_batch(&sql)
                .map_err(|e| format!("Failed to apply migration {}: {}", name, e))?;
        }

        Ok(())
    }

    fn migrations_dir() -> Result<PathBuf, String> {
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("Failed to get exe path: {}", e))?
            .parent()
            .ok_or_else(|| "No parent dir for exe".to_string())?
            .to_path_buf();

        // Dev mode: check relative to project root
        let dev_path = exe_dir
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("migrations"));

        if let Some(ref p) = dev_path {
            if p.exists() {
                return Ok(p.clone());
            }
        }

        // Production: migrations alongside binary
        Ok(exe_dir.join("migrations"))
    }
}
