use crate::cost;
use crate::profile;
use crate::storage::AppDatabase;
use tauri::Emitter;

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

#[tauri::command]
pub fn scan_costs(
    db: tauri::State<AppDatabase>,
    profile_id: Option<String>,
) -> Result<usize, String> {
    scan_costs_inner(&db, profile_id.as_deref())
}

/// Periodic cost polling: scan Claude sessions and emit cost:updated event.
/// Called by the frontend every 30 seconds for running sessions.
#[tauri::command]
pub fn poll_costs(
    app: tauri::AppHandle,
    db: tauri::State<AppDatabase>,
) -> Result<usize, String> {
    let count = scan_costs_inner(&db, None)?;

    if count > 0 {
        let _ = app.emit("cost:updated", serde_json::json!({
            "scanned": count,
        }));
    }

    Ok(count)
}

fn scan_costs_inner(
    db: &AppDatabase,
    profile_id: Option<&str>,
) -> Result<usize, String> {
    let profiles = profile::list_profiles(db, None)?;

    let target_profiles: Vec<_> = if let Some(pid) = profile_id {
        profiles.into_iter().filter(|p| p.id == pid).collect()
    } else {
        profiles
    };

    let mut total = 0;
    for p in target_profiles {
        let claude_dir = p.app_data_root.as_deref();
        total += cost::claude::scan_claude_sessions(db, &p.id, claude_dir)?;
    }

    Ok(total)
}
