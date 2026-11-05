use tauri::Manager;

use crate::dev_env;
use crate::storage::AppDatabase;

#[tauri::command]
pub fn dev_environment_list(
    db: tauri::State<AppDatabase>,
    kind: Option<String>,
) -> Result<Vec<dev_env::DevEnvironment>, String> {
    dev_env::list_dev_environments(&db, kind.as_deref())
}

#[tauri::command]
pub fn dev_environment_create(
    db: tauri::State<AppDatabase>,
    input: dev_env::SaveDevEnvironmentInput,
) -> Result<dev_env::DevEnvironment, String> {
    dev_env::create_dev_environment(&db, input)
}

#[tauri::command]
pub fn dev_environment_update(
    db: tauri::State<AppDatabase>,
    id: String,
    input: dev_env::SaveDevEnvironmentInput,
) -> Result<dev_env::DevEnvironment, String> {
    dev_env::update_dev_environment(&db, &id, input)
}

#[tauri::command]
pub fn dev_environment_delete(db: tauri::State<AppDatabase>, id: String) -> Result<(), String> {
    dev_env::delete_dev_environment(&db, &id)
}

/// 自动识别。扫盘 + 跑 `java -version` 之类，可能要好几秒，放阻塞线程池里跑。
#[tauri::command]
pub async fn dev_environment_detect(
    app: tauri::AppHandle,
    kind: String,
) -> Result<dev_env::DetectResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<AppDatabase>();
        dev_env::detect_and_persist(&db, &kind)
    })
    .await
    .map_err(|e| format!("自动识别任务失败: {}", e))?
}
