//! 修复被旧版探测逻辑污染的 `cli_session_id`。
//!
//! 旧版 `closeTab` 在关闭标签时按 work_dir 探测"最近修改的 JSONL"，把它的 UUID
//! 覆写到当前会话。同项目（= 同一 JSONL 目录）下多个会话轮流关闭时，探测到的
//! 往往是另一个活跃会话的文件，于是这批会话的 ID 全部收敛到同一个值 —— 打开
//! 其中任意一个都会 `--resume` 到同一段对话。
//!
//! 修复思路不是"在重复组里挑一个留下、其余清空"，而是**按创建时间反查真实归属**：
//! TeaCoder 用 `--session-id` 启动时，Claude Code 会立刻在项目目录下建出以该 UUID
//! 命名的 JSONL，其首条记录落在 `session.created_at` 之后约一秒内。实测全部命中
//! 样本的偏差在 +0.4s ~ +4.3s 之间，因此按此时间差匹配可以无歧义地找回每个会话
//! 真正的对话文件。
//!
//! 制造污染的代码已随预分配改造删除，这里只做一次性数据修复。
//! 仅处理重复组成员 —— 唯一 ID 的会话不在本次修复范围内，即使它也可能被污染过。
//! 修复是幂等的：清洗后不存在重复组，重复执行即为空操作。

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::session::claude_path::encode_project_dir_name;
use crate::storage::AppDatabase;

/// 允许的创建时间 → JSONL 首条时间偏差上限。
/// 实测命中样本集中在 +0.4s ~ +4.3s，留一分钟余量吸收磁盘与调度抖动；
/// 再宽就会把"用户隔了一阵才在该会话里首次发言"误判成另一个会话的对话。
const MATCH_WINDOW_MS: i64 = 60_000;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct DedupeOutcome {
    /// 命中的重复组数
    pub groups: usize,
    /// ID 本就正确、未改动的会话数
    pub unchanged: usize,
    /// 改回真实 JSONL UUID 的会话数
    pub reassigned: usize,
    /// 无法判定归属、被清空的会话数
    pub cleared: usize,
}

impl DedupeOutcome {
    /// 没有任何会话被改动 —— 启动时据此决定是否打印日志。
    pub fn is_noop(&self) -> bool {
        self.reassigned == 0 && self.cleared == 0
    }
}

/// 一个待修复会话的最终处置：`next` 为 `None` 表示清空 `cli_session_id`。
struct Repair {
    session_id: String,
    next: Option<String>,
}

pub fn dedupe_cli_session_ids(db: &AppDatabase) -> Result<DedupeOutcome, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法解析 home 目录".to_string())?;
    dedupe_with_home(db, &home)
}

fn dedupe_with_home(db: &AppDatabase, home: &Path) -> Result<DedupeOutcome, String> {
    let mut guard = db.conn.lock().map_err(|e| e.to_string())?;
    let tx = guard
        .transaction()
        .map_err(|e| format!("开启修复事务失败: {e}"))?;

    let (groups, repairs) = plan_repairs(&tx, home)?;
    let outcome = apply_repairs(&tx, groups, repairs)?;

    tx.commit().map_err(|e| format!("提交修复事务失败: {e}"))?;
    Ok(outcome)
}

fn apply_repairs(
    conn: &Connection,
    groups: usize,
    repairs: Vec<Repair>,
) -> Result<DedupeOutcome, String> {
    let mut outcome = DedupeOutcome {
        groups,
        ..Default::default()
    };
    for repair in &repairs {
        let next = repair.next.as_deref();
        match next {
            None => {
                conn.execute(
                    "UPDATE sessions SET cli_session_id = NULL WHERE id = ?1",
                    [&repair.session_id],
                )
                .map_err(|e| format!("清空 cli_session_id 失败: {e}"))?;
                outcome.cleared += 1;
            }
            Some(_) => {
                let changed: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM sessions \
                         WHERE id = ?1 AND (cli_session_id IS NULL OR cli_session_id != ?2)",
                        rusqlite::params![repair.session_id, next],
                        |row| row.get(0),
                    )
                    .map_err(|e| format!("比对 cli_session_id 失败: {e}"))?;
                conn.execute(
                    "UPDATE sessions SET cli_session_id = ?2 WHERE id = ?1",
                    rusqlite::params![repair.session_id, next],
                )
                .map_err(|e| format!("回写 cli_session_id 失败: {e}"))?;
                if changed == 0 {
                    outcome.unchanged += 1;
                } else {
                    outcome.reassigned += 1;
                }
            }
        }
    }
    Ok(outcome)
}

struct Candidate {
    session_id: String,
    created_at: i64,
    project_id: String,
    profile_id: Option<String>,
    current: String,
    /// 最佳匹配：JSONL UUID 与时间差
    match_: Option<(String, i64)>,
}

/// 返回（重复组数, 逐会话的处置方案）。
fn plan_repairs(conn: &Connection, home: &Path) -> Result<(usize, Vec<Repair>), String> {
    let duplicate_ids = duplicate_cli_session_ids(conn)?;
    if duplicate_ids.is_empty() {
        return Ok((0, Vec::new()));
    }
    let groups = duplicate_ids.len();

    let mut candidates = load_candidates(conn, &duplicate_ids)?;
    if candidates.is_empty() {
        return Ok((groups, Vec::new()));
    }

    // 本次不参与修复的会话所持有的 ID：不能被抢占，否则只是把重复换个位置。
    // 注意命名空间：这里的"ID"是 cli_session_id（JSONL 的 UUID），不是 session.id；
    // 之前误把 c.session_id 当成 c.current 写了进去，导致修复组自己持有的 UUID
    // 也被错算成"外来占用"，把本应回填的真身挡在外面。
    let held_by_repair: HashSet<String> = candidates
        .iter()
        .map(|c| c.current.clone())
        .collect();
    let mut held_by_unrepaired: HashSet<String> = HashSet::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT cli_session_id FROM sessions \
                 WHERE cli_session_id IS NOT NULL AND cli_session_id != ''",
            )
            .map_err(|e| format!("准备占用查询失败: {e}"))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("查询占用失败: {e}"))?;
        for row in rows {
            let cid = row.map_err(|e| format!("读取占用记录失败: {e}"))?;
            if !held_by_repair.contains(&cid) {
                held_by_unrepaired.insert(cid);
            }
        }
    }

    // 同一项目目录只扫一次盘，多个会话共用索引。
    let mut index_cache: HashMap<PathBuf, Vec<(String, i64)>> = HashMap::new();
    for candidate in &mut candidates {
        candidate.match_ = find_candidate_match(conn, candidate, home, &mut index_cache);
    }

    // 时间差小的优先认领；同一个 JSONL 被多人认领时只留给最接近的那个，
    // 其余人宁可清空也不要重新制造一对重复。
    let mut claims: Vec<Claim> = candidates
        .into_iter()
        .map(|c| Claim {
            session_id: c.session_id,
            current: c.current,
            delta: c.match_.as_ref().map(|(_, d)| *d).unwrap_or(i64::MAX),
            target: c.match_.map(|(uuid, _)| uuid),
        })
        .collect();
    claims.sort_by(|a, b| a.delta.cmp(&b.delta).then_with(|| a.session_id.cmp(&b.session_id)));

    let mut taken: HashMap<String, i64> = HashMap::new();
    let mut repairs = Vec::with_capacity(claims.len());
    for claim in claims {
        let next = match &claim.target {
            // 真实归属就是当前 ID：无需改动。
            Some(uuid) if *uuid == claim.current => Some(claim.current.clone()),
            // 本次不动的会话正持有它：抢过来只是把重复换个位置。
            Some(uuid) if held_by_unrepaired.contains(uuid) => None,
            Some(uuid) => match taken.get(uuid) {
                Some(best) if *best <= claim.delta => None,
                _ => {
                    taken.insert(uuid.clone(), claim.delta);
                    Some(uuid.clone())
                }
            },
            // 时间窗内没有对应 JSONL：无法判定归属，清空总好过继续共享。
            None => None,
        };
        repairs.push(Repair {
            session_id: claim.session_id,
            next,
        });
    }

    Ok((groups, repairs))
}

/// 待认领的一行：会话认为哪个 JSONL 才是自己的，以及这个判断有多可信。
struct Claim {
    session_id: String,
    current: String,
    delta: i64,
    target: Option<String>,
}

fn duplicate_cli_session_ids(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT cli_session_id FROM sessions \
             WHERE cli_session_id IS NOT NULL AND cli_session_id != '' \
             GROUP BY cli_session_id HAVING COUNT(*) > 1",
        )
        .map_err(|e| format!("准备重复组查询失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("查询重复组失败: {e}"))?;
    let mut set = HashSet::new();
    for row in rows {
        set.insert(row.map_err(|e| format!("读取重复组失败: {e}"))?);
    }
    Ok(set)
}

fn load_candidates(
    conn: &Connection,
    duplicate_ids: &HashSet<String>,
) -> Result<Vec<Candidate>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, created_at, project_id, profile_id, cli_session_id FROM sessions \
             WHERE cli_session_id IS NOT NULL AND cli_session_id != '' \
             ORDER BY created_at, id",
        )
        .map_err(|e| format!("准备候选查询失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| format!("查询候选失败: {e}"))?;

    let mut out = Vec::new();
    for row in rows {
        let (session_id, created_at, project_id, profile_id, current) =
            row.map_err(|e| format!("读取候选记录失败: {e}"))?;
        if !duplicate_ids.contains(&current) {
            continue;
        }
        out.push(Candidate {
            session_id,
            created_at,
            project_id,
            profile_id,
            current,
            match_: None,
        });
    }
    Ok(out)
}

/// 组内会话可能来自不同 profile，各自的 `app_data_root` 下都可能存着对话文件，
/// 因此逐个候选目录查找，取第一个能匹配上时间窗的。
fn find_candidate_match(
    conn: &Connection,
    candidate: &Candidate,
    home: &Path,
    cache: &mut HashMap<PathBuf, Vec<(String, i64)>>,
) -> Option<(String, i64)> {
    let work_dir: String = conn
        .query_row(
            "SELECT path FROM projects WHERE id = ?1",
            [&candidate.project_id],
            |row| row.get(0),
        )
        .ok()?;

    for base in candidate_bases(conn, candidate.profile_id.as_deref(), home) {
        let key = base.join(encode_project_dir_name(&work_dir));
        let index = cache.entry(key).or_insert_with(|| scan_project_jsonl(&base, &work_dir));
        if let Some(found) = best_match(index, candidate.created_at) {
            return Some(found);
        }
    }
    None
}

fn candidate_bases(conn: &Connection, profile_id: Option<&str>, home: &Path) -> Vec<PathBuf> {
    let mut bases = Vec::new();
    if let Some(pid) = profile_id {
        let root: Option<String> = conn
            .query_row(
                "SELECT app_data_root FROM profiles WHERE id = ?1",
                [pid],
                |row| row.get(0),
            )
            .ok();
        if let Some(root) = root.filter(|r| !r.is_empty()) {
            bases.push(PathBuf::from(root));
        }
    }
    bases.push(home.join(".claude"));
    bases
}

/// 扫描项目目录下所有 JSONL 的首条时间戳，按时间升序返回。
fn scan_project_jsonl(base: &Path, work_dir: &str) -> Vec<(String, i64)> {
    let dir = base.join("projects").join(encode_project_dir_name(work_dir));
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<(String, i64)> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let uuid = name.strip_suffix(".jsonl")?.to_string();
            let ts = first_entry_timestamp_ms(&entry.path())?;
            Some((uuid, ts))
        })
        .collect();
    out.sort_by_key(|(_, ts)| *ts);
    out
}

/// 找出创建时间之后、时间窗内最早落盘的那个 JSONL。
fn best_match(index: &[(String, i64)], created_at: i64) -> Option<(String, i64)> {
    index
        .iter()
        .filter_map(|(uuid, ts)| {
            let delta = ts.checked_sub(created_at)?;
            (0..=MATCH_WINDOW_MS).contains(&delta).then(|| (uuid.clone(), delta))
        })
        .min_by_key(|(_, delta)| *delta)
}

/// 取 JSONL 第一条带 `timestamp` 的记录时间。
/// Claude Code 的首行可能是无 timestamp 的元数据行，不能只读第一行就下结论。
fn first_entry_timestamp_ms(path: &Path) -> Option<i64> {
    let file = std::fs::File::open(path).ok()?;
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else { return None };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let Some(ts) = value.get("timestamp").and_then(serde_json::Value::as_str) else {
            continue;
        };
        return chrono::DateTime::parse_from_rfc3339(ts)
            .ok()
            .map(|dt| dt.timestamp_millis());
    }
    None
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{
        best_match, dedupe_with_home, first_entry_timestamp_ms, scan_project_jsonl,
        MATCH_WINDOW_MS,
    };
    use crate::session::test_support::test_db;
    use crate::storage::AppDatabase;

    fn temp_home(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("teacoder-dedupe-{tag}-{}", uuid::Uuid::new_v4()))
    }

    fn write_jsonl(home: &Path, work_dir: &str, uuid: &str, timestamp: &str) {
        let dir = home.join(".claude").join("projects").join(super::encode_project_dir_name(work_dir));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(format!("{uuid}.jsonl")),
            format!("{{\"type\":\"summary\"}}\n{{\"timestamp\":\"{timestamp}\"}}"),
        )
        .unwrap();
    }

    fn insert_project(db: &AppDatabase, id: &str, path: &str) {
        let now = chrono::Utc::now().timestamp_millis();
        db.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO projects (id, name, path, created_at, updated_at) \
                 VALUES (?1, ?1, ?2, ?3, ?3)",
                rusqlite::params![id, path, now],
            )
            .unwrap();
    }

    fn insert_session(db: &AppDatabase, id: &str, project_id: &str, created_at: i64, cid: &str) {
        db.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO sessions (id, project_id, tool_type, created_at, updated_at, cli_session_id) \
                 VALUES (?1, ?2, 'claude', ?3, ?3, ?4)",
                rusqlite::params![id, project_id, created_at, cid],
            )
            .unwrap();
    }

    fn cli_session_ids(db: &AppDatabase) -> Vec<(String, Option<String>)> {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, cli_session_id FROM sessions ORDER BY id")
            .unwrap();
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))
            .unwrap();
        rows.map(|r| r.unwrap()).collect()
    }

    #[test]
    fn best_match_takes_earliest_jsonl_within_window() {
        let index = vec![
            ("old".to_string(), 5_000),
            ("near".to_string(), 10_800),
            ("edge".to_string(), 10_000 + MATCH_WINDOW_MS),
            ("late".to_string(), 10_000 + MATCH_WINDOW_MS + 1),
        ];
        // 创建于 10_000：old 在之前被排除，near 是窗内最早的一个
        assert_eq!(
            best_match(&index, 10_000),
            Some(("near".to_string(), 800))
        );
    }

    #[test]
    fn best_match_none_without_candidate() {
        assert_eq!(best_match(&[("a".to_string(), 1_000)], 5_000), None);
        assert_eq!(best_match(&[], 0), None);
    }

    #[test]
    fn first_entry_skips_metadata_without_timestamp() {
        let home = temp_home("first-entry");
        write_jsonl(
            &home,
            "/work/p",
            "cid-1",
            "2026-10-13T01:23:06.722Z",
        );
        let path = home
            .join(".claude")
            .join("projects")
            .join("-work-p")
            .join("cid-1.jsonl");
        let ts = first_entry_timestamp_ms(&path);
        std::fs::remove_dir_all(&home).ok();
        assert_eq!(ts, Some(1_791_854_586_722));
    }

    #[test]
    fn scan_indexes_every_jsonl_by_first_timestamp() {
        let home = temp_home("scan");
        write_jsonl(&home, "/work/p", "later", "2026-10-18T09:20:57.000Z");
        write_jsonl(&home, "/work/p", "earlier", "2026-10-17T21:55:25.000Z");
        let index = scan_project_jsonl(&home.join(".claude"), "/work/p");
        std::fs::remove_dir_all(&home).ok();
        assert_eq!(
            index.iter().map(|(u, _)| u.as_str()).collect::<Vec<_>>(),
            vec!["earlier", "later"]
        );
    }

    /// 真实事故形态：某个会话的真身 JSONL 恰好是"另一个重复组"的 ID，
    /// 所以"按共享 ID 去找 JSONL"必然判错归属 —— 必须按创建时间反查。
    #[test]
    fn reassigns_across_groups_by_created_at() {
        let home = temp_home("cross-group");
        let db = test_db();
        insert_project(&db, "p1", "/work/p");

        // 两个重复组，彼此持有的 ID 正好是对方的真身
        let group_a = "11111111-1111-1111-1111-111111111111";
        let group_b = "44444444-4444-4444-4444-444444444444";
        // 2026-10-03 12:20Z，距任何 JSONL 都远超窗口 → 只能清空
        let t_stale = 1_791_030_000_000;
        let t_late = 1_791_854_585_000; // 2026-10-13T01:23:05Z
        let t_other = 1_791_954_585_000; // 2026-10-14T05:09:45Z
        let t_other2 = 1_792_054_585_000; // 2026-10-15T08:56:25Z

        insert_session(&db, "s-stale", "p1", t_stale, group_a);
        insert_session(&db, "s-late", "p1", t_late, group_a);
        insert_session(&db, "s-other", "p1", t_other, group_b);
        insert_session(&db, "s-other2", "p1", t_other2, group_b);

        // s-late 的真身正好叫 group_b；每个会话各有一份唯一真身
        write_jsonl(&home, "/work/p", group_b, "2026-10-13T01:23:05.700Z");
        write_jsonl(&home, "/work/p", "55555555-5555-5555-5555-555555555555", "2026-10-14T05:09:45.500Z");
        write_jsonl(&home, "/work/p", "66666666-6666-6666-6666-666666666666", "2026-10-15T08:56:25.600Z");

        let outcome = dedupe_with_home(&db, &home).unwrap();
        std::fs::remove_dir_all(&home).ok();

        assert_eq!(outcome.groups, 2);
        assert_eq!(outcome.reassigned, 3);
        assert_eq!(outcome.cleared, 1);
        assert_eq!(
            cli_session_ids(&db),
            vec![
                ("s-late".to_string(), Some(group_b.to_string())),
                ("s-other".to_string(), Some("55555555-5555-5555-5555-555555555555".to_string())),
                ("s-other2".to_string(), Some("66666666-6666-6666-6666-666666666666".to_string())),
                ("s-stale".to_string(), None),
            ]
        );
    }

    #[test]
    fn keeps_id_that_already_matches_created_at() {
        let home = temp_home("already-correct");
        let db = test_db();
        insert_project(&db, "p1", "/work/p");
        let shared = "55555555-5555-5555-5555-555555555555";
        let created = 1_791_854_585_000;
        insert_session(&db, "s1", "p1", created, shared);
        insert_session(&db, "s2", "p1", created, shared);
        write_jsonl(&home, "/work/p", shared, "2026-10-13T01:23:05.722Z");

        let outcome = dedupe_with_home(&db, &home).unwrap();
        std::fs::remove_dir_all(&home).ok();

        assert_eq!(outcome.unchanged, 2);
        assert_eq!(outcome.reassigned, 0);
        assert_eq!(outcome.cleared, 0);
    }

    #[test]
    fn clears_when_no_jsonl_within_window() {
        let home = temp_home("no-window");
        let db = test_db();
        insert_project(&db, "p1", "/work/p");
        let shared = "66666666-6666-6666-6666-666666666666";
        insert_session(&db, "s1", "p1", 1_000, shared);
        insert_session(&db, "s2", "p1", 2_000, shared);
        // 对话在会话创建前两天就已经落盘，指向的是别人
        write_jsonl(&home, "/work/p", shared, "2020-01-01T00:00:00.000Z");

        let outcome = dedupe_with_home(&db, &home).unwrap();
        std::fs::remove_dir_all(&home).ok();

        assert_eq!(outcome.cleared, 2);
        assert_eq!(outcome.reassigned, 0);
        assert_eq!(
            cli_session_ids(&db),
            vec![("s1".to_string(), None), ("s2".to_string(), None)]
        );
    }

    #[test]
    fn only_one_session_claims_the_same_jsonl() {
        let home = temp_home("collision");
        let db = test_db();
        insert_project(&db, "p1", "/work/p");
        let shared = "77777777-7777-7777-7777-777777777777";
        let other = "88888888-8888-8888-8888-888888888888";
        insert_session(&db, "s1", "p1", 1_791_854_585_000, shared);
        insert_session(&db, "s2", "p1", 1_791_854_586_000, shared);
        // 只有这一个 JSONL，两个会话都只能匹配到它
        write_jsonl(&home, "/work/p", other, "2026-10-13T01:23:05.722Z");

        let outcome = dedupe_with_home(&db, &home).unwrap();
        std::fs::remove_dir_all(&home).ok();

        assert_eq!(outcome.reassigned, 1);
        assert_eq!(outcome.cleared, 1);
        let ids = cli_session_ids(&db);
        let winners: Vec<_> = ids.iter().filter(|(_, c)| c.is_some()).collect();
        assert_eq!(winners.len(), 1, "同一 JSONL 不得被两个会话同时认领");
    }

    #[test]
    fn does_not_steal_id_held_by_untouched_session() {
        let home = temp_home("foreign");
        let db = test_db();
        insert_project(&db, "p1", "/work/p");
        let shared = "99999999-9999-9999-9999-999999999999";
        let foreign = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        insert_session(&db, "s-dup", "p1", 1_791_854_585_000, shared);
        insert_session(&db, "s-dup2", "p1", 1_000, shared);
        // s-foreign 不在重复组里，但它的真实 JSONL 恰好被 s-dup 匹配上
        insert_session(&db, "s-foreign", "p1", 1_791_854_586_000, foreign);
        write_jsonl(&home, "/work/p", foreign, "2026-10-13T01:23:05.722Z");

        let outcome = dedupe_with_home(&db, &home).unwrap();
        std::fs::remove_dir_all(&home).ok();

        // 抢不到就清空，不制造新的重复
        assert_eq!(outcome.cleared, 2);
        let ids = cli_session_ids(&db);
        let kept: Vec<_> = ids.iter().filter(|(_, c)| c.is_some()).collect();
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].0, "s-foreign");
    }

    #[test]
    fn dedupe_is_idempotent() {
        let home = temp_home("idempotent");
        let db = test_db();
        insert_project(&db, "p1", "/work/p");
        let shared = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
        insert_session(&db, "s1", "p1", 1_000, shared);
        insert_session(&db, "s2", "p1", 2_000, shared);

        let first = dedupe_with_home(&db, &home).unwrap();
        let second = dedupe_with_home(&db, &home).unwrap();
        std::fs::remove_dir_all(&home).ok();

        assert_eq!(first.cleared, 2);
        assert!(second.is_noop());
    }

    #[test]
    fn leaves_unique_ids_alone() {
        let home = temp_home("unique");
        let db = test_db();
        insert_project(&db, "p1", "/work/p");
        insert_session(&db, "s1", "p1", 1_000, "aaaa");
        insert_session(&db, "s2", "p1", 2_000, "bbbb");
        write_jsonl(&home, "/work/p", "cccc", "2026-10-13T01:23:05.722Z");

        let outcome = dedupe_with_home(&db, &home).unwrap();
        std::fs::remove_dir_all(&home).ok();

        assert!(outcome.is_noop());
        assert_eq!(
            cli_session_ids(&db),
            vec![
                ("s1".to_string(), Some("aaaa".to_string())),
                ("s2".to_string(), Some("bbbb".to_string()))
            ]
        );
    }
}
