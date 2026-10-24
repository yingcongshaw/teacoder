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
    request: transfer::UploadRequest,
) -> Result<TransferSummary, String> {
    transfer::execute(
        transfer::Deps {
            app,
            db: &db,
            registry: &registry,
        },
        Direction::Upload,
        request.target,
        request.tab_id,
        request.local_paths.into_iter().map(PathBuf::from).collect(),
        request.remote_path,
        request.request_id,
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
    request: transfer::DownloadRequest,
) -> Result<TransferSummary, String> {
    transfer::execute(
        transfer::Deps {
            app,
            db: &db,
            registry: &registry,
        },
        Direction::Download,
        request.target,
        request.tab_id,
        vec![PathBuf::from(request.local_dir)],
        request.remote_path,
        request.request_id,
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
/// 探测走一条独立的短连接（见 [`crate::ssh::remote`]），**不碰用户的终端** ——
/// 往交互式 PTY 里敲哨兵命令会把命令和输出留在终端里，每次打开面板都刷一屏。
#[tauri::command]
pub async fn ssh_probe_remote_cwd(
    db: tauri::State<'_, AppDatabase>,
    tab_id: String,
) -> Result<String, String> {
    // SSH 会话的 tabId 就是会话 id —— 上传路径也是这么取连接参数的。
    let ssh = transfer::resolve_ssh_args(&db, &SshTarget::FromSession { session_id: tab_id })
        .map_err(|e| e.to_string())?;
    crate::ssh::remote::probe_remote_cwd(&ssh).await.map_err(|e| {
        // 前端会静默回落到 ~/，不留日志就无从判断是回落了还是探测成功
        eprintln!("[SSH-PROBE] 失败: {e}");
        e.to_string()
    })
}

/// 列出远程目录。
///
/// 与传输一样，连接参数由后端按 [`SshTarget`] 解析 —— 前端碰不到密码。
/// `Manual` 目标用于 Terminal 会话：用户手填一次连接参数后也能浏览远端。
#[tauri::command]
pub async fn ssh_list_dir(
    db: tauri::State<'_, AppDatabase>,
    target: SshTarget,
    path: String,
) -> Result<Vec<crate::fsdir::DirEntry>, String> {
    let ssh = transfer::resolve_ssh_args(&db, &target).map_err(|e| e.to_string())?;
    crate::ssh::remote::list_dir(&ssh, &path)
        .await
        .map_err(|e| e.to_string())
}
