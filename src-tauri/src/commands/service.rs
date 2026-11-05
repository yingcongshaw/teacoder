use tauri::{AppHandle, Manager};

use crate::services::{runtime, DetectServicesResult, Service};
use crate::storage::AppDatabase;

#[tauri::command]
pub fn service_list(
    db: tauri::State<AppDatabase>,
    project_id: Option<String>,
) -> Result<Vec<Service>, String> {
    crate::services::list_services(&db, project_id.as_deref())
}

#[tauri::command]
pub fn service_create(
    db: tauri::State<AppDatabase>,
    input: crate::services::CreateServiceInput,
) -> Result<Service, String> {
    crate::services::create_service(&db, input)
}

#[tauri::command]
pub fn service_delete(db: tauri::State<AppDatabase>, id: String) -> Result<(), String> {
    crate::services::delete_service(&db, &id)
}

/// 识别服务。扫描目录可能很慢，放到阻塞线程池里跑，别卡住 UI。
///
/// project_id 为 None 表示识别全部项目。
#[tauri::command]
pub async fn service_detect(
    app: AppHandle,
    project_id: Option<String>,
) -> Result<DetectServicesResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<AppDatabase>();
        crate::services::detect_and_persist_services(&db, project_id.as_deref())
    })
    .await
    .map_err(|e| format!("服务识别任务失败: {}", e))?
}

#[tauri::command]
pub fn service_start(
    app: AppHandle,
    db: tauri::State<AppDatabase>,
    id: String,
) -> Result<(), String> {
    runtime::start_service(&app, &db, &id)
}

#[tauri::command]
pub fn service_stop(id: String) -> Result<(), String> {
    runtime::stop_service(&id)
}

#[tauri::command]
pub fn service_logs(id: String, limit: Option<usize>) -> Result<Vec<String>, String> {
    Ok(runtime::service_logs(&id, limit.unwrap_or(200)))
}

/// 查询运行中的服务及其占用的端口。
///
/// 端口要探 TCP 才能确定，耗时不可控，放到阻塞线程池里跑，别卡住 UI。
#[tauri::command]
pub async fn service_states(app: AppHandle) -> Result<Vec<runtime::ServiceRuntimeState>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<AppDatabase>();
        let mut states = runtime::service_states();
        for state in &mut states {
            state.ports = crate::services::ports::detect_ports(&db, &state.service_id);
        }
        Ok(states)
    })
    .await
    .map_err(|e| format!("查询服务状态失败: {e}"))?
}
