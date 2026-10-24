//! 传输与删除操作日志的 IPC 命令。
//!
//! 面板底部的日志表数据源在库里：前端打开面板时查一次，之后由后端写库时发的
//! `transfer_log_changed` 事件驱动刷新。前端不再自己维护日志行。

use crate::storage::transfer_log::{self, TransferLogRow};
use crate::storage::AppDatabase;

/// 取日志。
///
/// `session_id` 为空时取全部会话的（「全部历史」视图）。`limit` 为 0 表示不限制。
#[tauri::command]
pub fn transfer_log_list(
    db: tauri::State<'_, AppDatabase>,
    session_id: Option<String>,
    limit: usize,
) -> Result<Vec<TransferLogRow>, String> {
    transfer_log::list(&db, session_id.as_deref(), limit)
}

/// 清空全部日志。
#[tauri::command]
pub fn transfer_log_clear(db: tauri::State<'_, AppDatabase>) -> Result<(), String> {
    transfer_log::clear(&db)
}
