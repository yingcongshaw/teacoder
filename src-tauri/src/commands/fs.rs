//! 本地文件系统相关的 IPC 命令。
//!
//! 文件传输面板的右栏要列本地目录内容 —— 前端拿不到文件系统，只能由
//! Rust 侧读。这与「下载落到哪个目录」是同一类能力：都是用户指定路径、
//! 由后端去读。

use crate::fsdir::DirEntry;

/// 列出本地目录的内容。
///
/// 路径由用户（或前端默认的项目目录）给出。`show_hidden` 控制是否列出隐藏文件。
#[tauri::command]
pub fn fs_list_dir(path: String, show_hidden: bool) -> Result<Vec<DirEntry>, String> {
    crate::fsdir::list_local_dir(&path, show_hidden)
}
