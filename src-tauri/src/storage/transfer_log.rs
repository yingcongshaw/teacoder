//! 传输与删除操作日志的存储。
//!
//! 面板底部的「同步进度和日志」表数据源在这里。前端只管实时进度（内存里的
//! Map，不落库），行的增删改由后端在这里做 —— 前端不再自己维护日志行，
//! 也就不会出现「内存一份、库里一份」的重复。

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::storage::AppDatabase;

/// 传输记录保留条数上限（删除记录不受此限，永久保留）。
///
/// 传输日志的审计价值远低于删除 —— 传错了再传一次就是，而删错了找不回来。
/// 所以只对传输做裁剪，删除记录留着。
pub const TRANSFER_KEEP_LIMIT: usize = 5000;

/// 操作类别。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogKind {
    Upload,
    Download,
    Delete,
}

impl LogKind {
    pub fn as_str(self) -> &'static str {
        match self {
            LogKind::Upload => "upload",
            LogKind::Download => "download",
            LogKind::Delete => "delete",
        }
    }
}

/// 行状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogState {
    Running,
    Done,
    Error,
}

impl LogState {
    pub fn as_str(self) -> &'static str {
        match self {
            LogState::Running => "running",
            LogState::Done => "done",
            LogState::Error => "error",
        }
    }
}

/// 删的是哪一端。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogSide {
    Remote,
    Local,
}

impl LogSide {
    pub fn as_str(self) -> &'static str {
        match self {
            LogSide::Remote => "remote",
            LogSide::Local => "local",
        }
    }
}

/// 枚举存进库里就是小写字符串。
macro_rules! impl_to_sql {
    ($ty:ty) => {
        impl rusqlite::ToSql for $ty {
            fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
                Ok(rusqlite::types::ToSqlOutput::from(self.as_str()))
            }
        }
    };
}

impl_to_sql!(LogKind);
impl_to_sql!(LogState);
impl_to_sql!(LogSide);

/// 一条日志。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferLogRow {
    pub id: String,
    /// 前端生成的请求标识，用来把实时进度对应到这一行。
    pub request_id: Option<String>,
    /// 发起操作的会话 id。按会话过滤时用。
    pub session_id: Option<String>,
    pub kind: LogKind,
    pub side: Option<LogSide>,
    pub name: String,
    pub path: Option<String>,
    pub bytes: Option<u64>,
    pub state: LogState,
    pub error: Option<String>,
    pub protocol: Option<String>,
    pub elapsed_ms: Option<u64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 插入一条日志。
///
/// `kind` 为传输时顺带裁剪旧的传输记录（删除记录不限）。
pub fn insert(db: &AppDatabase, row: &TransferLogRow) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    // session_id 走子查询：会话不存在就写 NULL，而不是让整条插入被外键挡掉。
    // （日志写不进去不该影响传输本身。）
    conn.execute(
        "INSERT INTO transfer_log (id, request_id, session_id, kind, side, name, path, bytes, \
         state, error, protocol, elapsed_ms, created_at, updated_at) \
         VALUES (?1, ?2, (SELECT id FROM sessions WHERE id = ?3), ?4, ?5, ?6, ?7, ?8, \
         ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            row.id,
            row.request_id,
            row.session_id,
            row.kind,
            row.side,
            row.name,
            row.path,
            row.bytes,
            row.state,
            row.error,
            row.protocol,
            row.elapsed_ms,
            row.created_at,
            row.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to insert transfer log: {}", e))?;
    drop(conn);
    // 传输记录限量保留（删除记录永久留着），裁剪放在写完之后顺手做。
    prune_transfers(db, TRANSFER_KEEP_LIMIT)
}

/// 解析库里存的 kind。遇到认不出的值按 upload 兜底 —— 日志是给人看的，
/// 不能因为一个脏值让整个列表读不出来。
fn parse_kind(raw: String) -> rusqlite::Result<LogKind> {
    Ok(match raw.as_str() {
        "download" => LogKind::Download,
        "delete" => LogKind::Delete,
        _ => LogKind::Upload,
    })
}

fn parse_state(raw: String) -> rusqlite::Result<LogState> {
    Ok(match raw.as_str() {
        "done" => LogState::Done,
        "error" => LogState::Error,
        _ => LogState::Running,
    })
}

fn parse_side(raw: Option<String>) -> rusqlite::Result<Option<LogSide>> {
    Ok(raw.as_deref().map(|s| match s {
        "local" => LogSide::Local,
        _ => LogSide::Remote,
    }))
}

/// 记一次删除。
///
/// 删除是破坏性操作 —— 比传输更该留痕。`error` 为 None 表示删成功。
pub fn insert_delete(
    db: &AppDatabase,
    name: &str,
    path: &str,
    bytes: Option<u64>,
    session_id: Option<&str>,
    side: LogSide,
    error: Option<&str>,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    insert(
        db,
        &TransferLogRow {
            id: uuid::Uuid::new_v4().to_string(),
            request_id: None,
            session_id: session_id.map(|s| s.to_string()),
            kind: LogKind::Delete,
            side: Some(side),
            name: name.to_string(),
            path: Some(path.to_string()),
            bytes,
            state: if error.is_some() {
                LogState::Error
            } else {
                LogState::Done
            },
            error: error.map(|e| e.to_string()),
            protocol: None,
            elapsed_ms: None,
            created_at: now,
            updated_at: now,
        },
    )
}

/// 更新一行（传输结束时把 running 改成 done/error）。
pub fn update_state(
    db: &AppDatabase,
    id: &str,
    state: LogState,
    bytes: Option<u64>,
    error: Option<&str>,
    protocol: Option<&str>,
    elapsed_ms: Option<u64>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "UPDATE transfer_log SET state = ?2, bytes = COALESCE(?3, bytes), error = ?4, \
         protocol = COALESCE(?5, protocol), elapsed_ms = COALESCE(?6, elapsed_ms), updated_at = ?7 \
         WHERE id = ?1",
        params![id, state.as_str(), bytes, error, protocol, elapsed_ms, now],
    )
    .map_err(|e| format!("Failed to update transfer log: {}", e))?;
    Ok(())
}

/// 按时间倒序取日志。
///
/// `session_id` 为 `None` 时取全部会话的（「全部历史」视图）。`limit` 为 0 表示不限制。
pub fn list(
    db: &AppDatabase,
    session_id: Option<&str>,
    limit: usize,
) -> Result<Vec<TransferLogRow>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    // session_id 传 NULL 时不过滤，所以占位符个数固定，不必为两种情况拼两条 SQL。
    let sql = "SELECT id, request_id, session_id, kind, side, name, path, bytes, state, error, \
               protocol, elapsed_ms, created_at, updated_at FROM transfer_log \
               WHERE (?1 IS NULL OR session_id = ?1) \
               ORDER BY created_at DESC, rowid DESC LIMIT ?2";
    let cap = if limit == 0 {
        i64::MAX
    } else {
        limit as i64
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let mapper = |row: &rusqlite::Row<'_>| -> rusqlite::Result<TransferLogRow> {
        Ok(TransferLogRow {
            id: row.get(0)?,
            request_id: row.get(1)?,
            session_id: row.get(2)?,
            kind: parse_kind(row.get(3)?)?,
            side: parse_side(row.get(4)?)?,
            name: row.get(5)?,
            path: row.get(6)?,
            bytes: row.get(7)?,
            state: parse_state(row.get(8)?)?,
            error: row.get(9)?,
            protocol: row.get(10)?,
            elapsed_ms: row.get(11)?,
            created_at: row.get(12)?,
            updated_at: row.get(13)?,
        })
    };
    let rows = stmt
        .query_map(params![session_id, cap], mapper)
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 裁剪传输记录，只保留最近 `keep` 条。删除记录不动。
pub fn prune_transfers(db: &AppDatabase, keep: usize) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM transfer_log WHERE kind != 'delete' AND id NOT IN (\
           SELECT id FROM transfer_log WHERE kind != 'delete' \
           ORDER BY created_at DESC, rowid DESC LIMIT ?1)",
        params![keep as i64],
    )
    .map_err(|e| format!("Failed to prune transfer log: {}", e))?;
    Ok(())
}

/// 清空全部日志。
pub fn clear(db: &AppDatabase) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM transfer_log", [])
        .map_err(|e| format!("Failed to clear transfer log: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    fn db() -> AppDatabase {
        // 测试用内存库：迁移在真实库里跑过，这里只需表结构。
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            // sessions 只需要 id —— insert 的子查询要用它
            "CREATE TABLE sessions (id TEXT PRIMARY KEY);
             CREATE TABLE transfer_log (
               id TEXT PRIMARY KEY, request_id TEXT,
               session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
               kind TEXT NOT NULL, side TEXT, name TEXT NOT NULL, path TEXT,
               bytes INTEGER, state TEXT NOT NULL, error TEXT, protocol TEXT,
               elapsed_ms INTEGER,
               created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);",
        )
        .unwrap();
        conn.execute("INSERT INTO sessions (id) VALUES ('s1')", []).unwrap();
        AppDatabase {
            conn: Mutex::new(conn),
        }
    }

    fn conn_exec(db: &AppDatabase, sql: &str) {
        let conn = db.conn.lock().unwrap();
        conn.execute(sql, []).unwrap();
    }

    fn row(id: &str, kind: LogKind, at: i64) -> TransferLogRow {
        TransferLogRow {
            id: id.to_string(),
            request_id: Some(format!("r-{id}")),
            session_id: Some("s1".to_string()),
            kind,
            side: None,
            name: format!("{id}.txt"),
            path: Some(format!("/tmp/{id}.txt")),
            bytes: Some(10),
            state: LogState::Done,
            error: None,
            protocol: Some("sftp".to_string()),
            elapsed_ms: Some(120),
            created_at: at,
            updated_at: at,
        }
    }

    #[test]
    fn inserts_and_lists_by_session() {
        let db = db();
        insert(&db, &row("a", LogKind::Upload, 1)).unwrap();
        insert(&db, &row("b", LogKind::Upload, 2)).unwrap();

        let all = list(&db, None, 0).unwrap();
        assert_eq!(all.len(), 2);
        // 倒序：新的在前
        assert_eq!(all[0].id, "b");

        let one = list(&db, Some("s1"), 0).unwrap();
        assert_eq!(one.len(), 2);
        assert_eq!(list(&db, Some("other"), 0).unwrap().len(), 0);
    }

    #[test]
    fn respects_the_limit() {
        let db = db();
        for i in 0..5 {
            insert(&db, &row(&format!("r{i}"), LogKind::Upload, i)).unwrap();
        }
        assert_eq!(list(&db, None, 3).unwrap().len(), 3);
    }

    #[test]
    fn prunes_transfers_but_keeps_deletes() {
        let db = db();
        for i in 0..5 {
            insert(&db, &row(&format!("t{i}"), LogKind::Upload, i)).unwrap();
        }
        insert(&db, &row("d0", LogKind::Delete, 100)).unwrap();

        prune_transfers(&db, 2).unwrap();
        let left = list(&db, None, 0).unwrap();
        assert_eq!(left.len(), 3, "两条传输 + 一条删除");
        assert!(
            left.iter().any(|r| r.kind == LogKind::Delete),
            "删除记录要留着"
        );
    }

    #[test]
    fn updates_state() {
        let db = db();
        insert(&db, &row("a", LogKind::Upload, 1)).unwrap();
        update_state(
            &db,
            "a",
            LogState::Error,
            Some(5),
            Some("断了"),
            None,
            None,
        )
        .unwrap();
        let rows = list(&db, None, 0).unwrap();
        assert_eq!(rows[0].state, LogState::Error);
        assert_eq!(rows[0].error.as_deref(), Some("断了"));
        assert_eq!(rows[0].bytes, Some(5));
    }

    /// 回归：会话被删掉时它的日志要级联清掉 —— 这是明确要求的行为。
    #[test]
    fn deleting_a_session_cascades_its_logs() {
        let db = db();
        // 另一个会话的记录要留着
        conn_exec(&db, "INSERT INTO sessions (id) VALUES ('s2')");
        insert(&db, &row("a", LogKind::Upload, 1)).unwrap(); // s1
        insert(&db, &row("b", LogKind::Upload, 2)).unwrap();
        conn_exec(&db, "UPDATE transfer_log SET session_id = 's2' WHERE id = 'b'");

        conn_exec(&db, "DELETE FROM sessions WHERE id = 's1'");
        let left = list(&db, None, 0).unwrap();
        assert_eq!(left.len(), 1, "只剩另一个会话的记录");
        assert_eq!(left[0].id, "b");
    }

    #[test]
    fn clear_removes_everything() {
        let db = db();
        insert(&db, &row("a", LogKind::Upload, 1)).unwrap();
        insert(&db, &row("b", LogKind::Delete, 2)).unwrap();
        clear(&db).unwrap();
        assert_eq!(list(&db, None, 0).unwrap().len(), 0);
    }
}
