use crate::cost;
use crate::profile;
use crate::storage::AppDatabase;
use tauri::{Emitter, Manager};

#[tauri::command]
pub fn get_session_cost(
    db: tauri::State<AppDatabase>,
    session_id: String,
) -> Result<Option<cost::SessionCost>, String> {
    cost::get_session_cost(&db, &session_id)
}

#[tauri::command]
pub fn get_profile_cost(
    db: tauri::State<AppDatabase>,
    profile_id: String,
    range: Option<serde_json::Value>,
) -> Result<cost::CostSummary, String> {
    let from = range
        .as_ref()
        .and_then(|v| v.get("from"))
        .and_then(|v| v.as_i64());
    let to = range
        .as_ref()
        .and_then(|v| v.get("to"))
        .and_then(|v| v.as_i64());
    cost::get_profile_cost(&db, &profile_id, from, to)
}

#[tauri::command]
pub fn get_global_cost(
    db: tauri::State<AppDatabase>,
    range: Option<serde_json::Value>,
) -> Result<cost::CostSummary, String> {
    let from = range
        .as_ref()
        .and_then(|v| v.get("from"))
        .and_then(|v| v.as_i64());
    let to = range
        .as_ref()
        .and_then(|v| v.get("to"))
        .and_then(|v| v.as_i64());
    cost::get_global_cost(&db, from, to)
}

#[tauri::command]
pub fn list_pricing(
    db: tauri::State<AppDatabase>,
) -> Result<Vec<cost::PricingConfig>, String> {
    cost::list_pricing(&db)
}

#[tauri::command]
pub fn update_pricing(
    db: tauri::State<AppDatabase>,
    model: String,
    config: serde_json::Value,
) -> Result<(), String> {
    let input_price = config.get("inputPrice").and_then(|v| v.as_f64());
    let output_price = config.get("outputPrice").and_then(|v| v.as_f64());
    let cache_creation_price = config.get("cacheCreationPrice").and_then(|v| v.as_f64());
    let cache_read_price = config.get("cacheReadPrice").and_then(|v| v.as_f64());
    cost::update_pricing(&db, &model, input_price, output_price, cache_creation_price, cache_read_price)
}

/// 手动扫描费用。
///
/// 扫描要遍历整个 `~/.claude/projects`(本机实测 210 个文件 / 1.74 GB),
/// 同步命令会跑在 Tauri 主线程上 —— 那正是 WebView 的 UI 线程,
/// 主线程被占住时界面就整块卡住。所以整个扫描丢到阻塞线程池里跑。
#[tauri::command]
pub async fn scan_costs(
    app: tauri::AppHandle,
    profile_id: Option<String>,
) -> Result<usize, String> {
    Ok(run_scan(app, profile_id.as_deref()).await?.total)
}

/// 周期性的费用轮询:扫描 Claude 会话,有变化时发 `cost:updated` 事件。
/// 前端在有会话运行时每 30 秒调一次。
#[tauri::command]
pub async fn poll_costs(app: tauri::AppHandle) -> Result<usize, String> {
    let outcome = run_scan(app.clone(), None).await?;

    // 只有真的重算了才发事件:文件没变的会话被缓存跳过时,费用数字不会变,
    // 发事件只会让前端白刷新一次。
    if outcome.refreshed > 0 {
        let _ = app.emit("cost:updated", serde_json::json!({
            "scanned": outcome.refreshed,
        }));
    }

    Ok(outcome.total)
}

/// 把扫描丢到阻塞线程池执行。
///
/// `AppHandle` 是 'static 的,可以在闭包里 `app.state::<AppDatabase>()` 取到
/// 数据库 —— 比把 `State<'_, _>` 带进 future 少一层生命周期麻烦。
async fn run_scan(
    app: tauri::AppHandle,
    profile_id: Option<&str>,
) -> Result<cost::claude::ScanOutcome, String> {
    let profile_id = profile_id.map(str::to_string);
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<AppDatabase>();
        scan_costs_inner(&db, profile_id.as_deref())
    })
    .await
    .map_err(|e| format!("费用扫描任务失败: {e}"))?
}

fn scan_costs_inner(
    db: &AppDatabase,
    profile_id: Option<&str>,
) -> Result<cost::claude::ScanOutcome, String> {
    let profiles = profile::list_profiles(db, None)?;

    let target_profiles: Vec<_> = if let Some(pid) = profile_id {
        profiles.into_iter().filter(|p| p.id == pid).collect()
    } else {
        profiles
    };

    let mut total = 0;
    let mut refreshed = 0;
    for p in target_profiles {
        let claude_dir = p.app_data_root.as_deref();
        let outcome = cost::claude::scan_claude_sessions(db, &p.id, claude_dir)?;
        total += outcome.total;
        refreshed += outcome.refreshed;
    }

    Ok(cost::claude::ScanOutcome { total, refreshed })
}

