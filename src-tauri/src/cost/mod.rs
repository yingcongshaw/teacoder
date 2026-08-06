use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

pub mod claude;
pub mod codex;
pub mod gemini;
pub mod opencode;
pub mod provider;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCost {
    pub session_id: String,
    pub profile_id: String,
    pub tool_type: String,
    pub project_path: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
    pub cost_usd: f64,
    pub model: Option<String>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub last_updated: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostSummary {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PricingConfig {
    pub model: String,
    pub input_price: f64,
    pub output_price: f64,
    pub cache_creation_price: f64,
    pub cache_read_price: f64,
    pub is_custom: bool,
}

impl CostSummary {
    #[allow(dead_code)]
    pub fn zero() -> Self {
        Self {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
            cost_usd: 0.0,
        }
    }
}

pub fn get_session_cost(db: &AppDatabase, session_id: &str) -> Result<Option<SessionCost>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT session_id, profile_id, tool_type, project_path, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd, model, started_at, ended_at, last_updated FROM session_costs WHERE session_id = ?1",
        [session_id],
        |row| {
            Ok(SessionCost {
                session_id: row.get(0)?,
                profile_id: row.get(1)?,
                tool_type: row.get(2)?,
                project_path: row.get(3)?,
                input_tokens: row.get(4)?,
                output_tokens: row.get(5)?,
                cache_creation_tokens: row.get(6)?,
                cache_read_tokens: row.get(7)?,
                cost_usd: row.get(8)?,
                model: row.get(9)?,
                started_at: row.get(10)?,
                ended_at: row.get(11)?,
                last_updated: row.get(12)?,
            })
        },
    );

    match result {
        Ok(cost) => Ok(Some(cost)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to query session cost: {}", e)),
    }
}

pub fn get_profile_cost(
    db: &AppDatabase,
    profile_id: &str,
    from: Option<i64>,
    to: Option<i64>,
) -> Result<CostSummary, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let sql = match (from, to) {
        (Some(_), Some(_)) => "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_creation_tokens),0), COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cost_usd),0) FROM session_costs WHERE profile_id = ?1 AND started_at >= ?2 AND started_at <= ?3",
        (Some(_), None) => "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_creation_tokens),0), COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cost_usd),0) FROM session_costs WHERE profile_id = ?1 AND started_at >= ?2",
        (None, Some(_)) => "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_creation_tokens),0), COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cost_usd),0) FROM session_costs WHERE profile_id = ?1 AND started_at <= ?3",
        (None, None) => "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_creation_tokens),0), COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cost_usd),0) FROM session_costs WHERE profile_id = ?1",
    };

    let summary = match (from, to) {
        (Some(f), Some(t)) => conn.query_row(sql, rusqlite::params![profile_id, f, t], row_to_summary),
        (Some(f), None) => conn.query_row(sql, rusqlite::params![profile_id, f], row_to_summary),
        (None, Some(t)) => conn.query_row(sql, rusqlite::params![profile_id, t], row_to_summary),
        (None, None) => conn.query_row(sql, rusqlite::params![profile_id], row_to_summary),
    };

    summary.map_err(|e| format!("Failed to query profile cost: {}", e))
}

pub fn get_global_cost(
    db: &AppDatabase,
    from: Option<i64>,
    to: Option<i64>,
) -> Result<CostSummary, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let sql = match (from, to) {
        (Some(_), Some(_)) => "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_creation_tokens),0), COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cost_usd),0) FROM session_costs WHERE started_at >= ?1 AND started_at <= ?2",
        (Some(_), None) => "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_creation_tokens),0), COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cost_usd),0) FROM session_costs WHERE started_at >= ?1",
        (None, Some(_)) => "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_creation_tokens),0), COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cost_usd),0) FROM session_costs WHERE started_at <= ?2",
        (None, None) => "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_creation_tokens),0), COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cost_usd),0) FROM session_costs",
    };

    let summary = match (from, to) {
        (Some(f), Some(t)) => conn.query_row(sql, rusqlite::params![f, t], row_to_summary),
        (Some(f), None) => conn.query_row(sql, rusqlite::params![f], row_to_summary),
        (None, Some(t)) => conn.query_row(sql, rusqlite::params![t], row_to_summary),
        (None, None) => conn.query_row(sql, rusqlite::params![], row_to_summary),
    };

    summary.map_err(|e| format!("Failed to query global cost: {}", e))
}

pub fn list_pricing(db: &AppDatabase) -> Result<Vec<PricingConfig>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT model, input_price, output_price, cache_creation_price, cache_read_price, is_custom FROM pricing_config")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(PricingConfig {
                model: row.get(0)?,
                input_price: row.get(1)?,
                output_price: row.get(2)?,
                cache_creation_price: row.get(3)?,
                cache_read_price: row.get(4)?,
                is_custom: row.get::<_, i32>(5)? != 0,
            })
        })
        .map_err(|e| format!("Failed to query pricing: {}", e))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect pricing: {}", e))
}

pub fn update_pricing(
    db: &AppDatabase,
    model: &str,
    input_price: Option<f64>,
    output_price: Option<f64>,
    cache_creation_price: Option<f64>,
    cache_read_price: Option<f64>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO pricing_config (model, input_price, output_price, cache_creation_price, cache_read_price, is_custom, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6) ON CONFLICT(model) DO UPDATE SET input_price = COALESCE(?2, input_price), output_price = COALESCE(?3, output_price), cache_creation_price = COALESCE(?4, cache_creation_price), cache_read_price = COALESCE(?5, cache_read_price), is_custom = 1, updated_at = ?6",
        rusqlite::params![model, input_price, output_price, cache_creation_price, cache_read_price, now],
    )
    .map_err(|e| format!("Failed to update pricing: {}", e))?;

    Ok(())
}

pub fn upsert_session_cost(db: &AppDatabase, cost: &SessionCost) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO session_costs (session_id, profile_id, tool_type, project_path, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd, model, started_at, ended_at, last_updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) ON CONFLICT(session_id) DO UPDATE SET input_tokens = ?5, output_tokens = ?6, cache_creation_tokens = ?7, cache_read_tokens = ?8, cost_usd = ?9, model = COALESCE(?10, model), ended_at = COALESCE(?12, ended_at), last_updated = ?13",
        rusqlite::params![
            cost.session_id,
            cost.profile_id,
            cost.tool_type,
            cost.project_path,
            cost.input_tokens,
            cost.output_tokens,
            cost.cache_creation_tokens,
            cost.cache_read_tokens,
            cost.cost_usd,
            cost.model,
            cost.started_at,
            cost.ended_at,
            cost.last_updated,
        ],
    )
    .map_err(|e| format!("Failed to upsert session cost: {}", e))?;

    Ok(())
}

fn row_to_summary(row: &rusqlite::Row) -> rusqlite::Result<CostSummary> {
    Ok(CostSummary {
        input_tokens: row.get(0)?,
        output_tokens: row.get(1)?,
        cache_creation_tokens: row.get(2)?,
        cache_read_tokens: row.get(3)?,
        cost_usd: row.get(4)?,
    })
}

/// Load pricing config from the database into a map of
/// model -> (input_price, output_price, cache_creation_price, cache_read_price).
/// Prices are per-token (already divided by 1_000_000).
pub fn load_pricing_map(
    db: &AppDatabase,
) -> Result<HashMap<String, (f64, f64, f64, f64)>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT model, input_price, output_price, cache_creation_price, cache_read_price FROM pricing_config")
        .map_err(|e| format!("Failed to prepare pricing query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let model: String = row.get(0)?;
            let input: f64 = row.get(1)?;
            let output: f64 = row.get(2)?;
            let cache_creation: f64 = row.get(3)?;
            let cache_read: f64 = row.get(4)?;
            Ok((model, (input, output, cache_creation, cache_read)))
        })
        .map_err(|e| format!("Failed to query pricing: {}", e))?;

    let mut map = HashMap::new();
    for row in rows {
        let (model, prices) = row.map_err(|e| format!("Failed to read pricing row: {}", e))?;
        map.insert(model, prices);
    }

    Ok(map)
}
