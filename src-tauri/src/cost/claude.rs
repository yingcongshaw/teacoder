use std::collections::HashMap;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Deserialize;
use walkdir::WalkDir;

use super::SessionCost;
use crate::storage::AppDatabase;

/// 一轮扫描的结果。
pub struct ScanOutcome {
    /// 磁盘上统计到的会话总数(含本轮因未变化而跳过的文件)
    pub total: usize,
    /// 本轮真正重新解析并写库的会话数
    pub refreshed: usize,
}

/// 文件指纹:(最后修改时间, 字节数)。两者都没变 → 内容没变 → token 没变。
#[derive(Clone, Copy, PartialEq, Eq)]
struct FileFingerprint {
    modified_ns: u128,
    size: u64,
}

fn file_fingerprint(path: &Path) -> Option<FileFingerprint> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    Some(FileFingerprint {
        modified_ns: modified.as_nanos(),
        size: meta.len(),
    })
}

/// 缓存条目：文件指纹 + 当时的定价指纹。
struct CacheEntry {
    file: FileFingerprint,
    pricing: u64,
}

/// 已完成统计的文件。
///
/// 轮询每 30 秒一次;若每轮都重读全部 transcript(本机实测 210 个文件 /
/// 1.74 GB / 4.73 秒),主线程会被占住将近 5 秒 —— 界面整块卡死,
/// 正在终端里打字的人会觉得应用没反应。文件没变 → token 没变 → 跳过即可。
/// 定价变了指纹也会变,缓存自动失效。
static SCAN_CACHE: Mutex<Option<HashMap<PathBuf, CacheEntry>>> = Mutex::new(None);

/// 定价表的指纹。定价一改,所有已缓存的统计都必须重算。
fn pricing_fingerprint(pricing: &HashMap<String, (f64, f64, f64, f64)>) -> u64 {
    let mut keys: Vec<&str> = pricing.keys().map(|k| k.as_str()).collect();
    keys.sort_unstable();
    let canonical: String = keys
        .iter()
        .map(|k| {
            let v = pricing[*k];
            format!("{k}:{:?},{:?},{:?},{:?};", v.0, v.1, v.2, v.3)
        })
        .collect();
    simple_hash(&canonical)
}

/// Claude Code 的 transcript 行里,model / usage 嵌在 `message` 对象下,
/// 且字段名是 snake_case(`input_tokens`)。
///
/// 这两个结构必须与磁盘上的实际形状一致:错一层(当成顶层字段)或错一种命名风格
/// (camelCase),usage 都会整体解析成 None —— token 总量恒为 0,每个会话都被
/// 判成"无 token 数据"跳过,费用表永远为空。
#[derive(Debug, Deserialize)]
struct ClaudeMessage {
    message: Option<ClaudePayload>,
}

#[derive(Debug, Deserialize)]
struct ClaudePayload {
    model: Option<String>,
    usage: Option<ClaudeUsage>,
}

#[derive(Debug, Deserialize)]
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
) -> Result<ScanOutcome, String> {
    let config_dir = match claude_config_dir {
        Some(dir) => PathBuf::from(dir),
        None => default_claude_config_dir(),
    };

    let projects_dir = config_dir.join("projects");
    if !projects_dir.exists() {
        return Ok(ScanOutcome {
            total: 0,
            refreshed: 0,
        });
    }

    let pricing = super::load_pricing_map(db)?;
    let pricing_fp = pricing_fingerprint(&pricing);
    let mut total = 0;
    let mut refreshed = 0;

    // 缓存锁持有到本轮扫描结束:同时只允许一次扫描,
    // 否则两个轮询会各把全部文件重读一遍。
    let mut guard = SCAN_CACHE.lock().map_err(|e| e.to_string())?;
    let cache = guard.get_or_insert_with(HashMap::new);

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

                // 文件与定价都没变,且费用仍在库里 → 无需重新解析。
                let file_fp = file_fingerprint(path);
                let unchanged = match (file_fp, cache.get(path)) {
                    (Some(fp), Some(entry)) => entry.file == fp && entry.pricing == pricing_fp,
                    _ => false,
                };
                if unchanged && super::session_cost_exists(db, &session_id)? {
                    total += 1;
                    continue;
                }

                if let Ok(session_cost) =
                    parse_claude_session(path, profile_id, &session_id, &pricing)
                {
                    super::upsert_session_cost(db, &session_cost)?;
                    if let Some(fp) = file_fp {
                        cache.insert(
                            path.to_path_buf(),
                            CacheEntry {
                                file: fp,
                                pricing: pricing_fp,
                            },
                        );
                    }
                    total += 1;
                    refreshed += 1;
                }
            }
        }
    }

    Ok(ScanOutcome { total, refreshed })
}

fn parse_claude_session(
    path: &Path,
    profile_id: &str,
    session_id: &str,
    pricing: &HashMap<String, (f64, f64, f64, f64)>,
) -> Result<SessionCost, String> {
    // 流式逐行读,不整文件进内存:单个 transcript 可达 150 MB,
    // 整读会让扫描期间的常驻内存按文件大小尖峰。
    let file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open {}: {}", path.display(), e))?;
    let reader = std::io::BufReader::with_capacity(64 * 1024, file);

    let mut total_input: i64 = 0;
    let mut total_output: i64 = 0;
    let mut total_cache_creation: i64 = 0;
    let mut total_cache_read: i64 = 0;
    let mut model: Option<String> = None;
    let mut first_ts: i64 = i64::MAX;
    let mut last_ts: i64 = 0;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            // 单行读失败(非法 UTF-8)跳过,不能中断整个文件
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }

        let msg: ClaudeMessage = match serde_json::from_str(&line) {
            Ok(m) => m,
            Err(_) => continue,
        };
        // 只有 assistant 行带 message 对象;user / system 行的 message 形状不同,
        // 解析不出 usage 就跳过,不能让它把统计打断。
        let Some(payload) = msg.message else { continue };

        if let Some(m) = payload.model {
            if model.is_none() {
                model = Some(m);
            }
        }

        if let Some(usage) = payload.usage {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp(name: &str, content: &str) -> PathBuf {
        let p = std::env::temp_dir().join(name);
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        p
    }

    /// 磁盘上的真实形状:model / usage 嵌在 `message` 下,字段名是 snake_case。
    /// 按 camelCase 或当成顶层字段解析,usage 会整体变成 None,
    /// token 总量恒为 0,会话被当成"无 token 数据"跳过 —— 费用表永远是空的。
    #[test]
    fn parses_tokens_from_real_claude_jsonl_shape() {
        let content = concat!(
            r#"{"type":"assistant","uuid":"u1","timestamp":"2026-11-01T10:00:00.000Z","#,
            r#""message":{"id":"m1","type":"message","role":"assistant","model":"claude-sonnet-4-6","#,
            r#""usage":{"input_tokens":41090,"output_tokens":321,"#,
            r#""cache_creation_input_tokens":7,"cache_read_input_tokens":175}}}"#,
            "\n"
        );
        let path = write_temp("teacoder_cost_parse_test.jsonl", content);
        let pricing = HashMap::new();
        let cost = parse_claude_session(&path, "profile-1", "sess-1", &pricing)
            .expect("应解析出 token 数据");
        assert_eq!(cost.input_tokens, 41090);
        assert_eq!(cost.output_tokens, 321);
        assert_eq!(cost.cache_creation_tokens, 7);
        assert_eq!(cost.cache_read_tokens, 175);
        assert_eq!(cost.model.as_deref(), Some("claude-sonnet-4-6"));
        let _ = std::fs::remove_file(path);
    }

    /// user 行的 message 里没有 usage,不能让它把统计打断。
    #[test]
    fn user_line_without_usage_is_ignored() {
        let content = concat!(
            r#"{"type":"user","uuid":"u1","message":{"role":"user","content":"你好"}}"#,
            "\n",
            r#"{"type":"assistant","uuid":"a1","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":5,"output_tokens":6}}}"#,
            "\n"
        );
        let path = write_temp("teacoder_cost_mixed_test.jsonl", content);
        let pricing = HashMap::new();
        let cost = parse_claude_session(&path, "profile-1", "sess-1", &pricing).unwrap();
        assert_eq!(cost.input_tokens, 5);
        assert_eq!(cost.output_tokens, 6);
        let _ = std::fs::remove_file(path);
    }

    /// 建一个带 profile 的内存库,供扫描相关的测试使用。
    fn test_db() -> crate::storage::AppDatabase {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let db = crate::storage::AppDatabase {
            conn: std::sync::Mutex::new(conn),
        };
        db.run_migrations().unwrap();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO profiles (id, name, tool_type, auth_type, created_at, updated_at) VALUES ('p1', 'test', 'claude', 'api_key', 1, 1)",
                [],
            )
            .unwrap();
        }
        db
    }

    /// 建一个只含一份 transcript 的假 Claude 配置目录。
    fn fake_claude_dir(name: &str, content: &str) -> PathBuf {
        let root = std::env::temp_dir().join(name);
        let projects = root.join("projects").join("-work-demo");
        std::fs::create_dir_all(&projects).unwrap();
        let file = projects.join("sess-1.jsonl");
        std::fs::write(&file, content).unwrap();
        root
    }

    /// 回归:轮询每 30 秒跑一次,若每轮都重读全部 transcript,
    /// 主线程就得反复经历一次全量扫描(本机 210 个文件 / 1.74 GB)。
    /// 文件没变时必须跳过重解析。
    #[test]
    fn unchanged_transcript_is_not_reparsed() {
        let content = concat!(
            r#"{"type":"assistant","uuid":"a1","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":10,"output_tokens":20}}}"#,
            "\n"
        );
        let root = fake_claude_dir("teacoder_cost_cache_test", content);
        let db = test_db();

        let first = scan_claude_sessions(&db, "p1", root.to_str()).unwrap();
        assert_eq!(first.total, 1);
        assert_eq!(first.refreshed, 1, "首次扫描应重新解析");

        let second = scan_claude_sessions(&db, "p1", root.to_str()).unwrap();
        assert_eq!(second.total, 1, "文件没变也应在总数里");
        assert_eq!(second.refreshed, 0, "文件没变不应重新解析");

        // 追加一行 → 文件指纹变化 → 必须重算
        let file = root.join("projects").join("-work-demo").join("sess-1.jsonl");
        let mut text = std::fs::read_to_string(&file).unwrap();
        text.push_str(concat!(
            r#"{"type":"assistant","uuid":"a2","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":5,"output_tokens":6}}}"#,
            "\n"
        ));
        std::fs::write(&file, text).unwrap();

        let third = scan_claude_sessions(&db, "p1", root.to_str()).unwrap();
        assert_eq!(third.refreshed, 1, "文件变了应重新解析");

        let _ = std::fs::remove_dir_all(root);
    }

    /// 回归:profile 被删会级联清掉 `session_costs`。
    /// 若扫描只靠内存缓存判断"文件没变",这些会话就再也补不回来了。
    #[test]
    fn rows_cleared_by_profile_deletion_are_restored_on_next_scan() {
        let content = concat!(
            r#"{"type":"assistant","uuid":"a1","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":10,"output_tokens":20}}}"#,
            "\n"
        );
        let root = fake_claude_dir("teacoder_cost_cascade_test", content);
        let db = test_db();

        let first = scan_claude_sessions(&db, "p1", root.to_str()).unwrap();
        assert_eq!(first.refreshed, 1);

        // 删掉 profile —— 外键级联清掉它的费用行
        {
            let conn = db.conn.lock().unwrap();
            conn.execute("DELETE FROM profiles WHERE id = 'p1'", [])
                .unwrap();
            let left: i64 = conn
                .query_row("SELECT COUNT(*) FROM session_costs", [], |r| r.get(0))
                .unwrap();
            assert_eq!(left, 0, "profile 删除应级联清掉费用行");
            conn.execute(
                "INSERT INTO profiles (id, name, tool_type, auth_type, created_at, updated_at) VALUES ('p1', 'test', 'claude', 'api_key', 1, 1)",
                [],
            )
            .unwrap();
        }

        // 文件没变,但库里的行没了 —— 必须重新解析补回来
        let second = scan_claude_sessions(&db, "p1", root.to_str()).unwrap();
        assert_eq!(second.refreshed, 1, "费用行被清空后应重新解析补回");

        let conn = db.conn.lock().unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM session_costs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1, "费用行应已补回");
        drop(conn);

        let _ = std::fs::remove_dir_all(root);
    }
}
