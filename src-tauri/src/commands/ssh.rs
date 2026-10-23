use std::path::PathBuf;

use crate::ssh::registry::TransferRegistry;
use crate::ssh::transfer::{self, Direction, SshTarget, TransferSummary};
use crate::storage::AppDatabase;

/// 把若干本地文件上传到远程目录。
///
/// `target` 为 `FromSession` 时连接参数由后端从库里取，前端不接触密码；
/// 为 `Manual` 时用调用方临时填的参数（仅 Terminal 会话，见 `resolve_ssh_args`）。
#[tauri::command]
pub async fn ssh_upload(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
    registry: tauri::State<'_, TransferRegistry>,
    target: SshTarget,
    tab_id: String,
    local_paths: Vec<String>,
    remote_path: String,
) -> Result<TransferSummary, String> {
    transfer::execute(
        transfer::Deps {
            app,
            db: &db,
            registry: &registry,
        },
        Direction::Upload,
        target,
        tab_id,
        local_paths.into_iter().map(PathBuf::from).collect(),
        remote_path,
    )
    .await
    .map_err(|e| e.to_string())
}

/// 把远程文件下载到本地目录。落到重名文件时自动加序号，不覆盖已有内容。
#[tauri::command]
pub async fn ssh_download(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
    registry: tauri::State<'_, TransferRegistry>,
    target: SshTarget,
    tab_id: String,
    remote_path: String,
    local_dir: String,
) -> Result<TransferSummary, String> {
    transfer::execute(
        transfer::Deps {
            app,
            db: &db,
            registry: &registry,
        },
        Direction::Download,
        target,
        tab_id,
        vec![PathBuf::from(local_dir)],
        remote_path,
    )
    .await
    .map_err(|e| e.to_string())
}

/// 请求取消进行中的传输。返回 false 表示该任务已结束或 id 未知。
#[tauri::command]
pub fn ssh_transfer_cancel(
    registry: tauri::State<'_, TransferRegistry>,
    transfer_id: String,
) -> Result<bool, String> {
    Ok(registry.cancel(&transfer_id))
}

/// 主动探测远程当前工作目录。
///
/// 只对 SSH 工具会话有意义：Terminal 会话的 PTY 是本地 shell，即便用户在里面手动
/// `ssh` 了，`$PWD` 也是本地路径，返回它会误导。因此 Terminal 会话不调用本命令。
///
/// 哨兵命令会可见地出现在终端里 —— PTY 内联无法隐藏，这与既有的 `/rename` 先例一致。
#[tauri::command]
pub async fn ssh_probe_remote_cwd(
    app: tauri::AppHandle,
    pty_manager: tauri::State<'_, crate::pty::manager::PtyManager>,
    tab_id: String,
) -> Result<String, String> {
    pty_manager.probe_remote_cwd(app, tab_id).await
}