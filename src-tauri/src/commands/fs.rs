//! 本地文件系统相关的 IPC 命令。
//!
//! 文件传输面板的右栏要列本地目录内容 —— 前端拿不到文件系统，只能由
//! Rust 侧读。这与「下载落到哪个目录」是同一类能力：都是用户指定路径、
//! 由后端去读。

use tauri::Emitter;

use crate::fsdir::DirEntry;
use crate::ssh::transfer::TRANSFER_LOG_CHANGED;
use crate::storage::transfer_log;
use crate::storage::AppDatabase;

/// 列出本地目录的内容。
///
/// 路径由用户（或前端默认的项目目录）给出。`show_hidden` 控制是否列出隐藏文件。
#[tauri::command]
pub fn fs_list_dir(path: String, show_hidden: bool) -> Result<Vec<DirEntry>, String> {
    crate::fsdir::list_local_dir(&path, show_hidden)
}

/// 删除本地文件或目录（目录递归删）。
///
/// **破坏性操作** —— 前端必须先弹确认框。
#[tauri::command]
pub fn fs_delete(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
    path: String,
    session_id: Option<String>,
) -> Result<(), String> {
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());
    let bytes = std::fs::metadata(&path).ok().map(|m| m.len());

    let result = crate::fsdir::delete_local(&path);
    if let Err(e) = transfer_log::insert_delete(
        &db,
        &name,
        &path,
        bytes,
        session_id.as_deref(),
        transfer_log::LogSide::Local,
        result.as_ref().err().map(|s| s.as_str()),
    ) {
        eprintln!("[TRANSFER-LOG] 写入失败: {e}");
    }
    let _ = app.emit(
        TRANSFER_LOG_CHANGED,
        serde_json::json!({ "tabId": session_id }),
    );
    result
}
