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

/// 改服务名称。
#[tauri::command]
pub fn service_rename(
    db: tauri::State<AppDatabase>,
    id: String,
    name: String,
) -> Result<(), String> {
    crate::services::rename_service(&db, &id, &name)
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

/// 启动服务。要先构建的服务会在构建阶段阻塞一阵，放到阻塞线程池里跑，别卡住 UI。
#[tauri::command]
pub async fn service_start(
    app: AppHandle,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<AppDatabase>();
        runtime::start_service(&app, &db, &id)
    })
    .await
    .map_err(|e| format!("启动服务任务失败: {}", e))?
}

#[tauri::command]
pub fn service_stop(id: String) -> Result<(), String> {
    runtime::stop_service(&id)
}

#[tauri::command]
pub fn service_logs(id: String, limit: Option<usize>) -> Result<Vec<String>, String> {
    Ok(runtime::service_logs(&id, limit.unwrap_or(200)))
}

/// 手工添加服务时的入口候选。
///
/// 候选只列项目绑定的开发/运行环境能跑起来的源代码工程，
/// 跟自动识别一个口径。扫盘可能很慢，放到阻塞线程池里跑。
#[tauri::command]
pub async fn service_entry_candidates(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<crate::services::detector::ServiceCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<AppDatabase>();
        let path = crate::services::project_path(&db, &project_id)?;
        let envs = crate::dev_env::list_project_envs(&db, &project_id)?;
        Ok(crate::services::detector::entry_candidates(
            std::path::Path::new(&path),
            &envs,
        ))
    })
    .await
    .map_err(|e| format!("查询服务入口候选失败: {}", e))?
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
