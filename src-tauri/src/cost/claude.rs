use std::collections::HashMap;
use std::path::PathBuf;

use serde::Deserialize;
use walkdir::WalkDir;

use super::SessionCost;
use crate::storage::AppDatabase;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeMessage {
    model: Option<String>,
    usage: Option<ClaudeUsage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeUsage {
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    cache_creation_input_tokens: Option<i64>,
    cache_read_input_tokens: Option<i64>,
}

pub fn scan_claude_sessions(
    db: &AppDatabase,
    profile_id: &str,
    claude_config_dir: Option<&str>,
) -> Result<usize, String> {
    let config_dir = match claude_config_dir {
        Some(dir) => PathBuf::from(dir),
        None => default_claude_config_dir(),
    };

    let projects_dir = config_dir.join("projects");
    if !projects_dir.exists() {
        return Ok(0);
    }

    let pricing = super::load_pricing_map(db)?;
    let mut count = 0;

    for entry in WalkDir::new(&projects_dir)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "jsonl") {
            if let Some(file_stem) = path.file_stem().and_then(|s| s.to_str()) {
                // Include project path hash to avoid collisions from different
                // projects that happen to share the same file stem.
                let project_hash = path
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|n| n.to_str())
                    .map(simple_hash)
                    .unwrap_or(0u64);

                let session_id = format!("claude_{:x}_{}", project_hash, file_stem);

                if let Ok(session_cost) =
                    parse_claude_session(path, profile_id, &session_id, &pricing)
                {
                    super::upsert_session_cost(db, &session_cost)?;
                    count += 1;
                }
            }
        }
    }

    Ok(count)
}

fn parse_claude_session(
    path: &std::path::Path,
    profile_id: &str,
    session_id: &str,
    pricing: &HashMap<String, (f64, f64, f64, f64)>,
) -> Result<SessionCost, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let mut total_input: i64 = 0;
    let mut total_output: i64 = 0;
    let mut total_cache_creation: i64 = 0;
    let mut total_cache_read: i64 = 0;
    let mut model: Option<String> = None;
    let mut first_ts: i64 = i64::MAX;
    let mut last_ts: i64 = 0;

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let msg: ClaudeMessage = match serde_json::from_str(line) {
            Ok(m) => m,
            Err(_) => continue,
        };

        if let Some(m) = msg.model {
            if model.is_none() {
                model = Some(m);
            }
        }

        if let Some(usage) = msg.usage {
            total_input += usage.input_tokens.unwrap_or(0);
            total_output += usage.output_tokens.unwrap_or(0);
            total_cache_creation += usage.cache_creation_input_tokens.unwrap_or(0);
            total_cache_read += usage.cache_read_input_tokens.unwrap_or(0);
        }
    }

    if total_input == 0 && total_output == 0 {
        return Err("No token data found".to_string());
    }

    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("Failed to stat {}: {}", path.display(), e))?;

    let created = metadata
        .created()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    first_ts = first_ts.min(created);
    last_ts = last_ts.max(modified);

    let cost_usd = calculate_cost(
        total_input,
        total_output,
        total_cache_creation,
        total_cache_read,
        model.as_deref(),
        pricing,
    );

    let project_path = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(|s| s.to_string());

    Ok(SessionCost {
        session_id: session_id.to_string(),
        profile_id: profile_id.to_string(),
        tool_type: "claude".to_string(),
        project_path,
        input_tokens: total_input,
        output_tokens: total_output,
        cache_creation_tokens: total_cache_creation,
        cache_read_tokens: total_cache_read,
        cost_usd,
        model,
        started_at: first_ts,
        ended_at: if total_output > 0 { Some(last_ts) } else { None },
        last_updated: last_ts,
    })
}

/// Calculate cost using pricing_config table values when available,
/// falling back to hardcoded defaults for known models.
fn calculate_cost(
    input: i64,
    output: i64,
    cache_creation: i64,
    cache_read: i64,
    model: Option<&str>,
    pricing: &HashMap<String, (f64, f64, f64, f64)>,
) -> f64 {
    let (input_price, output_price, cache_creation_price, cache_read_price) =
        if let Some(model_name) = model {
            if let Some(&(ip, op, ccp, crp)) = pricing.get(model_name) {
                (ip, op, ccp, crp)
            } else {
                default_model_pricing(model_name)
            }
        } else {
            default_model_pricing("")
        };

    (input as f64) * input_price
        + (output as f64) * output_price
        + (cache_creation as f64) * cache_creation_price
        + (cache_read as f64) * cache_read_price
}

fn default_model_pricing(model: &str) -> (f64, f64, f64, f64) {
    match model {
        "claude-sonnet-4-20250514" | "claude-sonnet-4-6" => {
            (3.0 / 1_000_000.0, 15.0 / 1_000_000.0, 3.75 / 1_000_000.0, 0.3 / 1_000_000.0)
        }
        "claude-opus-4-20250514" | "claude-opus-4-7" => {
            (15.0 / 1_000_000.0, 75.0 / 1_000_000.0, 18.75 / 1_000_000.0, 1.5 / 1_000_000.0)
        }
        "claude-haiku-4-5-20251001" => {
            (0.8 / 1_000_000.0, 4.0 / 1_000_000.0, 1.0 / 1_000_000.0, 0.08 / 1_000_000.0)
        }
        // Default to Sonnet pricing for unknown models
        _ => {
            (3.0 / 1_000_000.0, 15.0 / 1_000_000.0, 3.75 / 1_000_000.0, 0.3 / 1_000_000.0)
        }
    }
}

fn default_claude_config_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    home.join(".claude")
}

/// Simple FNV-1a hash for project path disambiguation.
/// Not cryptographic — just needs to be collision-resistant enough
/// to distinguish different project directories.
fn simple_hash(s: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in s.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}
