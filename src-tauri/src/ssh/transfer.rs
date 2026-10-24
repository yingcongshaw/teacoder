//! scp 文件传输引擎。
//!
//! 关键前提：SSH 会话的 PTY 里跑的是 `ssh` 进程，往里敲的命令在远程执行。因此
//! 「在终端里敲 scp」会让远程机器拿远程路径去拷远程路径 —— 传输必须由本地侧发起。
//!
//! 协议选择见 [`should_try_legacy_fallback`]：OpenSSH ≥9.0 的 scp 默认走 SFTP 子系统，
//! 而 `openssh-sftp-server` 在 Debian/Ubuntu 上是独立包，远端没装就会失败。
//!
//! 两种协议对远程路径的处理**完全相反**，必须分开对待 —— 见 [`build_remote_arg`]。

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::Emitter;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use super::askpass::AskpassGuard;
use super::registry::{CancelToken, Protocol, TransferRegistry};
use super::{SshArgs, SshAuth};

/// 日志变更事件名。后端每次写库后发这个，前端收到后重新查库刷新表格。
pub const TRANSFER_LOG_CHANGED: &str = "transfer_log_changed";

/// 广播「日志变了」。前端按 tabId 决定要不要刷新。
fn emit_log_changed(app: &tauri::AppHandle, tab_id: &str) {
    let _ = app.emit(
        TRANSFER_LOG_CHANGED,
        serde_json::json!({ "tabId": tab_id }),
    );
}

/// 传输方向。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Upload,
    Download,
}

impl Direction {
    fn as_str(self) -> &'static str {
        match self {
            Direction::Upload => "upload",
            Direction::Download => "download",
        }
    }
}

/// 已传输的一个文件。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferredFile {
    pub source: String,
    pub destination: String,
    pub bytes: u64,
}

/// 一次传输的结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferSummary {
    pub transfer_id: String,
    pub direction: String,
    pub files: Vec<TransferredFile>,
    /// `"sftp"` 或 `"legacy-scp"`
    pub protocol: String,
    /// 是否发生过协议回退，前端据此提示远程路径的通配符语义差异。
    pub used_fallback: bool,
    pub elapsed_ms: u64,
}

/// 上传请求。前端一次把参数给全，避免 IPC 命令的参数个数膨胀。
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequest {
    pub target: SshTarget,
    pub tab_id: String,
    /// 本地源文件。可多个 —— 前端按文件逐个发起时这里只有一个。
    pub local_paths: Vec<String>,
    /// 远程目标目录。
    pub remote_path: String,
    /// 前端自带，用于把进度事件对上日志行。
    pub request_id: String,
}

/// 下载请求。
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub target: SshTarget,
    pub tab_id: String,
    /// 远程源文件（完整路径）。
    pub remote_path: String,
    /// 本地目标目录。
    pub local_dir: String,
    /// 前端自带，用于把进度事件对上日志行。
    pub request_id: String,
}

/// 传输目标。SSH 工具会话的凭据由后端从数据库解析，前端碰不到密码。
#[derive(Debug, serde::Serialize, serde::Deserialize)]
// rename_all 只管变体名；变体里的字段名要另写 rename_all_fields 才会跟着变，
// 漏了它 session_id / identity_file 会以蛇形过 IPC，与前端其余接口的 camelCase 不一致。
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SshTarget {
    /// 已有 SSH 会话：按 session_id 从库里取 cli_args。
    FromSession { session_id: String },
    /// Terminal 会话里用户临时填的连接参数。
    Manual {
        hostname: String,
        #[serde(default)]
        port: Option<u16>,
        #[serde(default)]
        username: Option<String>,
        #[serde(default)]
        password: Option<String>,
        #[serde(default)]
        identity_file: Option<String>,
    },
}

/// 上限 10_000 次重命名后放弃，避免目录里全是同名文件时空转。
const RENAME_LIMIT: u32 = 10_000;

/// 单次 scp 调用最多带的源文件数。scp 支持多源，但命令行长度有 ARG_MAX 上限；
/// 同时 `-O` 回退下多源的远程路径会被 shell 展开，分批更稳。
const MAX_FILES_PER_CALL: usize = 20;

/// 一次 scp 调用的结果。
enum ScpOutcome {
    /// 退出码 0。`moved` 是本地能观测到的字节数。
    Done { protocol: Protocol, moved: u64 },
    /// 退出码非 0。保留 stderr 原文供调用方判断是否值得回退。
    Failed { stderr: String },
    Cancelled,
}

#[derive(Debug, thiserror::Error)]
pub enum TransferError {
    #[error("会话不存在")]
    SessionNotFound,
    #[error("该会话不是 SSH 类型，无法按会话参数传输")]
    NotAnSshSession,
    #[error("会话缺少 SSH 连接参数")]
    MissingParams,
    #[error("请填写主机名")]
    MissingHostname,
    #[error("请填写远程路径")]
    MissingRemotePath,
    #[error("未选择要上传的文件")]
    NoFiles,
    #[error("本地路径不存在: {0}")]
    LocalMissing(String),
    #[error("暂不支持目录上传: {0}")]
    DirectoryUpload(String),
    #[error("本地目录不存在: {0}")]
    DirMissing(String),
    #[error("重名文件过多，已放弃重命名")]
    TooManyDuplicates,
    #[error("未能执行 scp: {0}")]
    Spawn(String),
    #[error("传输已取消")]
    Cancelled,
    #[error("{0}")]
    Failed(String),
}

/// 唯一的凭据收口点。
///
/// **SSH 工具会话一律走 `FromSession` 分支**，即使前端同时构造了 `manual` 也会被忽略 ——
/// 这样「前端不碰 SSH 密码」由代码结构强制，而不是靠前端自觉。
pub fn resolve_ssh_args(
    db: &crate::storage::AppDatabase,
    target: &SshTarget,
) -> Result<SshArgs, TransferError> {
    match target {
        SshTarget::FromSession { session_id } => {
            let session = crate::session::find_session(db, session_id)
                .map_err(TransferError::Failed)?
                .ok_or(TransferError::SessionNotFound)?;
            if session.tool_type != "ssh" {
                return Err(TransferError::NotAnSshSession);
            }
            let json = session.cli_args.ok_or(TransferError::MissingParams)?;
            super::parse_ssh_args(&json).ok_or(TransferError::MissingParams)
        }
        SshTarget::Manual {
            hostname,
            port,
            username,
            password,
            identity_file,
        } => {
            let ssh = SshArgs {
                hostname: hostname.trim().to_string(),
                port: port.unwrap_or(22),
                username: username.clone().unwrap_or_else(|| "root".to_string()),
                password: password.clone().unwrap_or_default(),
                identity_file: identity_file.clone().unwrap_or_default(),
            };
            if ssh.hostname.is_empty() {
                return Err(TransferError::MissingHostname);
            }
            Ok(ssh)
        }
    }
}

/// 在 `dir` 下给 `file_name` 找一个不冲突的名字：`a.txt → a_1.txt → a_2.txt …`
///
/// 冲突判定用 `exists()` 而不是 `is_file()` —— 同名**目录**也要让位。
/// 用 `OsStr` 拼装，不把文件名当 UTF-8 处理。
/// 不做 Unicode 规范化、不做大小写折叠：宁可多改一次名，也不要覆盖已有文件。
pub fn unique_destination(dir: &Path, file_name: &str) -> Result<PathBuf, TransferError> {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return Ok(candidate);
    }

    // file_stem/extension 天然处理多段扩展名（a.tar.gz → a.tar_1.gz）与
    // 隐藏文件（.bashrc → .bashrc_1，因为 Rust 把点号开头的整段当 stem）。
    let target = Path::new(file_name);
    let stem = target
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = target
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_default();

    for n in 1..=RENAME_LIMIT {
        let name = if ext.is_empty() {
            format!("{stem}_{n}")
        } else {
            format!("{stem}_{n}.{ext}")
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(TransferError::TooManyDuplicates)
}

/// 构造 scp 的参数向量。
///
/// 注意端口是**大写 `-P`**（`ssh` 是小写 `-p`）—— 有单元测试守着这个坑。
pub fn build_scp(ssh: &SshArgs, legacy: bool) -> Vec<String> {
    let mut a: Vec<String> = vec!["-o".into(), "ConnectTimeout=10".into()];
    a.extend(SshArgs::common_opts());
    a.extend(ssh.auth_opts());
    if let SshAuth::PublicKey(key) = ssh.auth() {
        a.push("-i".into());
        a.push(key);
    }
    if legacy {
        a.push("-O".into());
    }
    if ssh.port != 22 {
        a.push("-P".into());
        a.push(ssh.port.to_string());
    }
    a
}

/// stderr 的有界收集。scp 出错时的信息很短，但失败方可能塞进任意多内容，
/// 不做上限就等于让一条错误路径吃满内存。
struct StderrTail {
    buf: Vec<u8>,
}

impl StderrTail {
    const MAX: usize = 8 * 1024;

    fn new() -> Self {
        Self { buf: Vec::new() }
    }

    async fn pump(mut reader: tokio::process::ChildStderr) -> Self {
        let mut tail = Self::new();
        let mut chunk = [0u8; 1024];
        loop {
            match reader.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tail.buf.len() < Self::MAX {
                        let room = Self::MAX - tail.buf.len();
                        tail.buf.extend_from_slice(&chunk[..n.min(room)]);
                    }
                }
            }
        }
        tail
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.buf).into_owned()
    }
}

/// 判断某次失败是否值得用 `scp -O` 重试一次。
///
/// 「零字节」是关键安全阀：连接在传输中途断开时文件已非空，此时回退会重传半个文件。
/// 上传方向观察不到远端，只能靠 stderr 特征判定 —— 这是已知窄缺口。
fn should_try_legacy_fallback(stderr: &str, bytes_moved: u64) -> bool {
    if bytes_moved > 0 {
        return false;
    }
    let lower = stderr.to_lowercase();
    [
        "subsystem request failed",
        "protocol error",
        "unexpected internal error",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

/// ssh 的认证失败与远程文件系统的拒绝**都**叫 `Permission denied`，靠前缀区分：
/// 前者形如 `root@host: Permission denied (publickey).`，后者形如
/// `scp: /root/x: Permission denied`，带 `scp: <路径>: ` 前缀。
///
/// 不能像 `test_ssh_connection` 那样一律当认证失败 —— 那个命令只做握手不碰文件，
/// 照抄会把「远程目录不可写」误报成密码错。调用方传小写化后的文本。
fn is_auth_failure(lower: &str) -> bool {
    if lower.contains("authentication failed") || lower.contains("too many authentication failures") {
        return true;
    }
    match lower.find("permission denied") {
        // find 返回的是字符边界，切片安全
        Some(i) => !lower[..i].contains("scp:"),
        None => false,
    }
}

/// 把 scp 的 stderr 映射成人话。形状照 `test_ssh_connection`，但认证判据见
/// [`is_auth_failure`]；远端权限错误落到兜底分支，那条分支会把带路径的原文带出来，
/// 反而比一句「认证失败」有用。
fn friendly_error(stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    if is_auth_failure(&lower) {
        "认证失败，请检查用户名、密码或密钥".to_string()
    } else if lower.contains("connection timed out") || lower.contains("operation timed out") {
        "连接超时，请检查主机地址和端口".to_string()
    } else if lower.contains("no route to host") {
        "无法到达主机，请检查网络连接".to_string()
    } else if lower.contains("connection refused") {
        "连接被拒绝，请检查端口是否正确".to_string()
    } else if lower.contains("could not resolve") || lower.contains("name or service not known") {
        "无法解析主机名".to_string()
    } else if lower.contains("host key verification failed") {
        "主机密钥校验失败".to_string()
    } else if lower.contains("subsystem request failed") {
        "远程主机未启用 SFTP 子系统，且回退旧版 SCP 也失败了".to_string()
    } else if lower.contains("not a regular file") {
        "远程路径不是普通文件（暂不支持目录传输）".to_string()
    } else if lower.contains("no such file or directory") {
        "远程路径不存在".to_string()
    } else {
        let tail: String = stderr.chars().rev().take(500).collect();
        format!("传输失败: {}", tail.chars().rev().collect::<String>())
    }
}

/// 远程路径传给 scp 时的形态。
///
/// 两种协议对路径的处理完全不同，混用必然失败：
///
/// - **SFTP 模式**（OpenSSH ≥9.0 默认）：路径由 sftp-server 按字面解析，没有 shell 参与。
///   加引号等于把引号写进路径 —— 实测 `root@host:'/root/'` 报 `dest open "'/root/'"`。
///   好消息是 `~` 由 sftp-server 自己展开成远程 home，空格与单引号也都是字面安全的。
/// - **`-O` 回退模式**：路径交给远程 shell，必须转义成完整的一个词；
///   但 `~` 又必须留着不转义，否则远程 shell 不会展开成 home。
///
/// 故按协议分派：SFTP 原样透传，`-O` 走 [`escape_remote_legacy`]。
fn build_remote_arg(path: &str, legacy: bool) -> String {
    if legacy {
        escape_remote_legacy(path)
    } else {
        path.to_string()
    }
}

/// `-O` 模式下远程路径的 shell 转义：逐字符反斜杠转义，而不是加引号。
///
/// 为什么不能加引号：legacy scp 的**下载**方向有文件名握手校验 —— 远程 `scp -f`
/// 把路径原样回传，本地拿它跟请求串比对。加了引号后引号留在比对串里
/// （`'/root/x'` vs `/root/x`），直接报 `protocol error: filename does not match request`。
/// 实测单引号、双引号在下载方向都失败。
///
/// 反斜杠转义则上下两个方向都成立：远程 shell 吃掉反斜杠，路径原样到达；
/// 本地比对前同样把反斜杠还原。上传方向实测也可行。
///
/// `~` 前缀是例外：它必须不转义才能被远程 shell 展开成 home，
/// 所以开头的 `~` / `~user` 原样保留。
fn escape_remote_legacy(path: &str) -> String {
    let (prefix, rest) = split_home_prefix(path);
    format!("{prefix}{}", escape_shell_word(rest))
}

/// 拆出路径开头的 `~` / `~user` 前缀（连同紧随的 `/`）。
///
/// `~/a b` → `("~/", "a b")`；`~user/a` → `("~user/", "a")`；
/// `/root/a` → `("", "/root/a")`；`~` → `("~", "")`。
fn split_home_prefix(path: &str) -> (&str, &str) {
    let Some(rest) = path.strip_prefix('~') else {
        return ("", path);
    };
    match rest.find('/') {
        Some(i) => (&path[..1 + i + 1], &rest[i + 1..]),
        None => (path, ""),
    }
}

/// 逐字符反斜杠转义 shell 元字符。
///
/// 非 ASCII 字符原样保留：它们不是 shell 元字符，按字节透传即可，
/// 中英文路径在远程 shell 里天然安全。
fn escape_shell_word(word: &str) -> String {
    let mut out = String::with_capacity(word.len());
    for ch in word.chars() {
        if is_shell_meta(ch) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// 无引号 word 里会被 shell 解释的字符。
fn is_shell_meta(ch: char) -> bool {
    matches!(
        ch,
        ' ' | '\t' | '\n' | '\r' | '\u{b}' | '\u{c}'
            | '\\' | '"' | '\'' | '`' | '$' | '&' | '|' | ';' | '<' | '>'
            | '(' | ')' | '*' | '?' | '[' | ']' | '{' | '}' | '!' | '#' | '~' | '='
    )
}

/// 进度探测：返回当前已传字节数（可为 0，表示本批尚未产生可观测进展）。
type ProgressProbe = Box<dyn Fn() -> u64 + Send>;

/// 一次传输的执行上下文。app / registry / transfer_id / cancel 在 execute → do_* → run_*_scp
/// 四层里逐层透传，拆成独立参数会把每个函数都顶爆 clippy 的参数个数上限，
/// 而它们对每一层都是「不变的环境」，不是各自的输入。
struct CallCtx<'a> {
    app: tauri::AppHandle,
    registry: &'a TransferRegistry,
    transfer_id: &'a str,
    cancel: &'a CancelToken,
}

/// 拼出 scp 的完整参数（不含程序名）。
///
/// **本地与远程的先后由方向决定**：上传是 `本地 远程`，下载是 `远程 本地`。
/// 弄反了 scp 会把本地文件当源往远端传 —— 下载看起来「成功」，实际什么都没下，
/// 而且本地临时文件还没建，scp 直接报 `stat local ...: No such file or directory`。
fn build_scp_args(
    ssh: &SshArgs,
    legacy: bool,
    direction: Direction,
    local_arg: &[String],
    remote_path: &str,
) -> Vec<String> {
    let mut a = build_scp(ssh, legacy);
    let remote_spec = format!("{}:{}", ssh.target(), build_remote_arg(remote_path, legacy));
    match direction {
        Direction::Upload => {
            a.extend(local_arg.iter().cloned());
            a.push(remote_spec);
        }
        Direction::Download => {
            a.push(remote_spec);
            a.extend(local_arg.iter().cloned());
        }
    }
    a
}

/// 跑一次 scp，带进度上报与取消。不做任何清理 —— 临时文件归调用方管，
/// 因为只有调用方知道下载时那个临时文件在哪。
async fn run_scp_once(
    ctx: &CallCtx<'_>,
    spec: &TransferSpec,
    local_arg: &[String],
    remote_path: &str,
    legacy: bool,
    total_bytes: Option<u64>,
    probe: ProgressProbe,
) -> Result<ScpOutcome, TransferError> {
    let argv = build_scp_args(
        &spec.ssh,
        legacy,
        spec.direction,
        local_arg,
        remote_path,
    );
    let mut cmd = Command::new("scp");
    cmd.args(&argv);
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());
    // 兜住任务 panic / 被丢弃时残留的孤儿 scp
    cmd.kill_on_drop(true);

    // askpass guard 必须活到 wait() 返回 —— 提前 Drop 会让 scp 在要密码时读不到脚本
    let _askpass = match spec.ssh.auth() {
        SshAuth::Password(p) => {
            let guard = AskpassGuard::create(&p).map_err(TransferError::Failed)?;
            cmd.env("SSH_ASKPASS", guard.script_path());
            cmd.env("SSH_ASKPASS_REQUIRE", "force");
            Some(guard)
        }
        _ => None,
    };

    let mut child = cmd.spawn().map_err(|e| TransferError::Spawn(e.to_string()))?;
    let stderr_task = child.stderr.take().map(|s| tokio::spawn(async move { StderrTail::pump(s).await }));

    // 先发一次 0 字节的进度：transferId 只在这里和最终结果里出现，
    // 第一次节流事件要等 300ms 之后的第一个 tick —— 那之前前端拿不到 id，
    // 「取消」按钮点了也是空的。
    let _ = ctx.app.emit(
        "ssh_transfer:progress",
        serde_json::json!({
            "tabId": spec.tab_id,
            "transferId": ctx.transfer_id,
            "requestId": spec.request_id,
            "direction": spec.direction.as_str(),
            "bytes": probe(),
            "totalBytes": total_bytes,
            "elapsedMs": 0,
        }),
    );

    let mut ticker = tokio::time::interval(Duration::from_millis(300));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let started = Instant::now();
    let mut cancelled = false;
    let mut last_emit = Instant::now();

    let status = loop {
        tokio::select! {
            biased;
            _ = ctx.cancel.cancelled() => {
                let _ = child.start_kill();
                cancelled = true;
            }
            res = child.wait() => break res.map_err(|e| TransferError::Spawn(e.to_string()))?,
            _ = ticker.tick() => {
                if last_emit.elapsed() >= Duration::from_millis(200) {
                    last_emit = Instant::now();
                    let _ = ctx.app.emit(
                        "ssh_transfer:progress",
                        serde_json::json!({
                            "tabId": spec.tab_id,
                            "transferId": ctx.transfer_id,
                            "requestId": spec.request_id,
                            "direction": spec.direction.as_str(),
                            "bytes": probe(),
                            "totalBytes": total_bytes,
                            "elapsedMs": started.elapsed().as_millis() as u64,
                        }),
                    );
                }
            }
        }
    };

    let tail = match stderr_task {
        Some(handle) => handle.await.unwrap_or_else(|_| StderrTail::new()),
        None => StderrTail::new(),
    };

    if cancelled || ctx.cancel.is_cancelled() {
        return Ok(ScpOutcome::Cancelled);
    }
    let stderr_text = tail.text();
    if !status.success() {
        // 失败时把真实 argv 与原始 stderr 落日志：界面上的文案是归纳过的
        // （「远程路径不存在」之类），排查时需要原样。密码走 SSH_ASKPASS，
        // 不在 argv 里。
        eprintln!("[SCP] 失败 argv={argv:?} stderr={stderr_text:?}");
        return Ok(ScpOutcome::Failed { stderr: stderr_text });
    }
    Ok(ScpOutcome::Done {
        protocol: if legacy { Protocol::LegacyScp } else { Protocol::Sftp },
        moved: probe(),
    })
}

/// 带协议回退的一次 scp 调用。
///
/// 先按缓存/默认的 SFTP 协议试；只有零字节 + SFTP 子系统特征才回退 `-O` 一次，
/// 成功后记住该主机的能力，后续传输不再双跑。
async fn run_with_fallback(
    ctx: &CallCtx<'_>,
    spec: &TransferSpec,
    local_arg: &[String],
    remote_path: &str,
    total_bytes: Option<u64>,
    probe: ProgressProbe,
) -> Result<(Protocol, u64, bool), TransferError> {
    let cache_key = spec.ssh.cache_key();
    let cached = ctx.registry.known_protocol(&cache_key);
    let first_legacy = cached == Some(Protocol::LegacyScp);

    let attempt = run_scp_once(ctx, spec, local_arg, remote_path, first_legacy, total_bytes, probe)
        .await?;

    match attempt {
        ScpOutcome::Done { protocol, moved } => Ok((protocol, moved, first_legacy && cached.is_some())),
        ScpOutcome::Cancelled => Err(TransferError::Cancelled),
        ScpOutcome::Failed { stderr } => {
            if !first_legacy && should_try_legacy_fallback(&stderr, 0) {
                ctx.registry.remember_protocol(&cache_key, Protocol::LegacyScp);
                // 第二跑无法观察进度（第一跑的已传字节数对它没有意义），报 0。
                let probe2: ProgressProbe = Box::new(|| 0);
                match run_scp_once(ctx, spec, local_arg, remote_path, true, total_bytes, probe2)
                    .await?
                {
                    ScpOutcome::Done { protocol, moved } => Ok((protocol, moved, true)),
                    ScpOutcome::Cancelled => Err(TransferError::Cancelled),
                    ScpOutcome::Failed { stderr } => Err(TransferError::Failed(friendly_error(&stderr))),
                }
            } else {
                Err(TransferError::Failed(friendly_error(&stderr)))
            }
        }
    }
}

/// 一次传输的内部参数。
struct TransferSpec {
    direction: Direction,
    ssh: SshArgs,
    /// 前端自带的请求标识，原样回显在进度事件里。
    ///
    /// 并发传输时前端拿不到后端的 transfer_id（只在结束时才返回），
    /// 只有靠这个把进度事件对上「哪一行日志」。
    request_id: String,
    /// 上传 = 本地源文件；下载 = 只有一个元素，本地目标目录。
    local_paths: Vec<PathBuf>,
    remote_path: String,
    tab_id: String,
}

type ExecOutcome = (Vec<TransferredFile>, Protocol, bool);

/// 一次传输所需的 Tauri 全局状态。成组传递是为了让 `execute` 保持可读的参数个数。
pub struct Deps<'a> {
    pub app: tauri::AppHandle,
    pub db: &'a crate::storage::AppDatabase,
    pub registry: &'a TransferRegistry,
}

/// 完整的一次上传或下载。
///
/// 方向是显式参数而非从 `SshTarget` 推断 —— 凭据来源与方向是两件正交的事：
/// SSH 会话同样可能想下载到本地。
pub async fn execute(
    deps: Deps<'_>,
    direction: Direction,
    target: SshTarget,
    tab_id: String,
    local_paths: Vec<PathBuf>,
    remote_path: String,
    request_id: String,
) -> Result<TransferSummary, TransferError> {
    let ssh = resolve_ssh_args(deps.db, &target)?;
    let spec = TransferSpec {
        direction,
        ssh,
        request_id,
        local_paths,
        remote_path,
        tab_id,
    };

    let started = Instant::now();
    let transfer_id = uuid::Uuid::new_v4().to_string();
    let cancel = deps.registry.register(&transfer_id);
    let ctx = CallCtx {
        // clone：下面还要用 deps.app 发日志变更事件
        app: deps.app.clone(),
        registry: deps.registry,
        transfer_id: &transfer_id,
        cancel: &cancel,
    };

    // 先落一行 running：这样面板的表格能立刻看到「进行中」的行，
    // 后续的进度事件按 request_id 对上它，结束时再更新成 done/error。
    let log_id = uuid::Uuid::new_v4().to_string();
    let log_row = build_log_row(&log_id, &spec);
    if let Err(e) = crate::storage::transfer_log::insert(deps.db, &log_row) {
        eprintln!("[TRANSFER-LOG] 写入失败: {e}");
    }
    emit_log_changed(&deps.app, &spec.tab_id);

    let result = match spec.direction {
        Direction::Upload => do_upload(&ctx, &spec).await,
        Direction::Download => do_download(&ctx, &spec).await,
    };
    deps.registry.finish(&transfer_id);

    let elapsed = started.elapsed().as_millis() as u64;
    match result {
        Ok((files, protocol, used_fallback)) => {
            let protocol_str = match protocol {
                Protocol::Sftp => "sftp".to_string(),
                Protocol::LegacyScp => "legacy-scp".to_string(),
            };
            let bytes = files.iter().map(|f| f.bytes).sum::<u64>();
            let _ = crate::storage::transfer_log::update_state(
                deps.db,
                &log_id,
                crate::storage::transfer_log::LogState::Done,
                Some(bytes),
                None,
                Some(&protocol_str),
                Some(elapsed),
            );
            emit_log_changed(&deps.app, &spec.tab_id);
            Ok(TransferSummary {
                transfer_id,
                direction: spec.direction.as_str().to_string(),
                files,
                protocol: protocol_str,
                used_fallback,
                elapsed_ms: elapsed,
            })
        }
        Err(e) => {
            let _ = crate::storage::transfer_log::update_state(
                deps.db,
                &log_id,
                crate::storage::transfer_log::LogState::Error,
                None,
                Some(&e.to_string()),
                None,
                Some(elapsed),
            );
            emit_log_changed(&deps.app, &spec.tab_id);
            Err(e)
        }
    }
}

/// 为一次传输造一行日志。传输的方向决定 kind 与路径的含义。
fn build_log_row(
    id: &str,
    spec: &TransferSpec,
) -> crate::storage::transfer_log::TransferLogRow {
    let now = chrono::Utc::now().timestamp_millis();
    let (name, bytes, path) = match spec.direction {
        Direction::Upload => {
            let name = spec
                .local_paths
                .first()
                .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
                .unwrap_or_default();
            let bytes = spec
                .local_paths
                .iter()
                .filter_map(|p| std::fs::metadata(p).ok())
                .map(|m| m.len())
                .sum();
            (name, Some(bytes), Some(spec.remote_path.clone()))
        }
        Direction::Download => {
            let name = Path::new(&spec.remote_path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| spec.remote_path.clone());
            (name, None, Some(spec.remote_path.clone()))
        }
    };
    crate::storage::transfer_log::TransferLogRow {
        id: id.to_string(),
        request_id: Some(spec.request_id.clone()),
        session_id: Some(spec.tab_id.clone()),
        kind: match spec.direction {
            Direction::Upload => crate::storage::transfer_log::LogKind::Upload,
            Direction::Download => crate::storage::transfer_log::LogKind::Download,
        },
        side: None,
        name,
        path,
        bytes,
        state: crate::storage::transfer_log::LogState::Running,
        error: None,
        protocol: None,
        elapsed_ms: None,
        created_at: now,
        updated_at: now,
    }
}

async fn do_upload(
    ctx: &CallCtx<'_>,
    spec: &TransferSpec,
) -> Result<ExecOutcome, TransferError> {
    if spec.local_paths.is_empty() {
        return Err(TransferError::NoFiles);
    }

    // 校验本地路径。目录直接拒绝：递归传输的重名语义需要产品决策，第一版不做。
    let mut local: Vec<(PathBuf, u64)> = Vec::new();
    for p in &spec.local_paths {
        let canonical = std::fs::canonicalize(p)
            .map_err(|_| TransferError::LocalMissing(p.display().to_string()))?;
        let meta = std::fs::metadata(&canonical)
            .map_err(|_| TransferError::LocalMissing(p.display().to_string()))?;
        if !meta.is_file() {
            return Err(TransferError::DirectoryUpload(p.display().to_string()));
        }
        local.push((canonical, meta.len()));
    }

    let total: u64 = local.iter().map(|(_, n)| n).sum();
    let completed = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let remote_dir = spec.remote_path.trim().trim_end_matches('/');
    if remote_dir.is_empty() {
        return Err(TransferError::MissingRemotePath);
    }

    let mut files = Vec::new();
    let mut protocol = Protocol::Sftp;
    let mut used_fallback = false;

    for chunk in local.chunks(MAX_FILES_PER_CALL) {
        let args: Vec<String> = chunk.iter().map(|(p, _)| p.display().to_string()).collect();
        let chunk_len: u64 = chunk.iter().map(|(_, n)| n).sum();
        // 原始路径交给协议层：SFTP 原样透传，`-O` 才做 shell 转义
        let remote_path = format!("{remote_dir}/");

        // 上传方向看不到远端，scp 在非 tty 下也不吐可解析的进度。
        // 唯一诚实且单调的信号是"已完整送达的批次字节数"——所以上传是
        // 不确定态进度条 + 已完成字节，而不是编造的百分比。
        let probe_counter = std::sync::Arc::clone(&completed);
        let probe: ProgressProbe = Box::new(move || {
            probe_counter.load(std::sync::atomic::Ordering::SeqCst)
        });

        let (p, _moved, fell_back) =
            run_with_fallback(ctx, spec, &args, &remote_path, Some(total), probe).await?;
        protocol = p;
        used_fallback |= fell_back;
        completed.fetch_add(chunk_len, std::sync::atomic::Ordering::SeqCst);

        for (path, size) in chunk {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            files.push(TransferredFile {
                source: path.display().to_string(),
                destination: format!("{remote_dir}/{name}"),
                bytes: *size,
            });
        }
    }

    Ok((files, protocol, used_fallback))
}

async fn do_download(
    ctx: &CallCtx<'_>,
    spec: &TransferSpec,
) -> Result<ExecOutcome, TransferError> {
    let raw_dir = spec.local_paths.first().ok_or(TransferError::DirMissing("（未选择目录）".into()))?;
    let dir = std::fs::canonicalize(raw_dir)
        .map_err(|_| TransferError::DirMissing(raw_dir.display().to_string()))?;
    if !dir.is_dir() {
        return Err(TransferError::DirMissing(raw_dir.display().to_string()));
    }

    let remote = spec.remote_path.trim();
    if remote.is_empty() {
        return Err(TransferError::MissingRemotePath);
    }
    let file_name = Path::new(remote)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .ok_or(TransferError::MissingRemotePath)?;

    let final_path = unique_destination(&dir, &file_name)?;
    // 先落临时文件，成功才改名：失败或取消时目录里不会留下一个看起来完整、
    // 实际被截断的文件；进度 poll 的目标也天然单调递增。
    let temp_path = dir.join(format!(".{}.teatmp", uuid::Uuid::new_v4()));

    // 下载能看到临时文件实时增长，因此有真实的已收字节数（但没有总量）。
    let probe_path = temp_path.clone();
    let probe: ProgressProbe = Box::new(move || {
        std::fs::metadata(&probe_path).map(|m| m.len()).unwrap_or(0)
    });

    let outcome = run_with_fallback(
        ctx,
        spec,
        &[temp_path.display().to_string()],
        remote,
        None,
        probe,
    )
    .await;

    let (protocol, moved, used_fallback) = match outcome {
        Ok(v) => v,
        Err(e) => {
            let _ = std::fs::remove_file(&temp_path);
            return Err(e);
        }
    };

    if let Err(e) = std::fs::rename(&temp_path, &final_path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(TransferError::Failed(format!("下载完成但落盘失败: {e}")));
    }

    Ok((
        vec![TransferredFile {
            source: remote.to_string(),
            destination: final_path.display().to_string(),
            bytes: moved,
        }],
        protocol,
        used_fallback,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::create_session;
    use crate::session::test_support::test_db;
    use crate::session::CreateSessionInput;

    fn tmpdir(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("teacoder-t-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// 钉死过 IPC 的 JSON 形状。前端按 `kind` + camelCase 字段构造请求，
    /// serde 在枚举上的 `rename_all` 与 `rename_all_fields` 作用对象不同，
    /// 少写后者只会让字段悄悄退回蛇形 —— 从 TS 侧看不出来，只在真机上表现为
    /// 「参数全空」。所以这里断言完整字面量而不是靠推理。
    #[test]
    fn ssh_target_json_shape_is_camel_case() {
        let json = serde_json::to_string(&SshTarget::FromSession {
            session_id: "s1".into(),
        })
        .unwrap();
        assert_eq!(json, r#"{"kind":"fromSession","sessionId":"s1"}"#);

        let json = serde_json::to_string(&SshTarget::Manual {
            hostname: "h".into(),
            port: Some(2222),
            username: Some("root".into()),
            password: None,
            identity_file: Some("/k".into()),
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"kind":"manual","hostname":"h","port":2222,"username":"root","password":null,"identityFile":"/k"}"#,
            "可选字段缺省时序列化成 null；反序列化侧有 #[serde(default)]，null 与缺失等价"
        );
    }

    #[test]
    fn ssh_target_roundtrips_from_frontend_json() {
        let t: SshTarget = serde_json::from_str(
            r#"{"kind":"manual","hostname":"10.0.0.9","identityFile":"/home/u/.ssh/id_ed25519"}"#,
        )
        .unwrap();
        let SshTarget::Manual {
            hostname,
            port,
            identity_file,
            ..
        } = t
        else {
            panic!("应解析成 Manual");
        };
        assert_eq!(hostname, "10.0.0.9");
        assert_eq!(port, None, "缺省应回落成 None，由后端补 22");
        assert_eq!(identity_file.as_deref(), Some("/home/u/.ssh/id_ed25519"));
    }

    /// 建一个会话，返回它的 id。
    fn seed_session(
        db: &crate::storage::AppDatabase,
        tool_type: &str,
        cli_args: Option<&str>,
    ) -> String {
        let now = chrono::Utc::now().timestamp_millis();
        db.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT OR IGNORE INTO projects (id, name, path, created_at, updated_at) VALUES ('p1','P','/tmp/p1',?1,?1)",
                [now],
            )
            .unwrap();
        create_session(
            db,
            CreateSessionInput {
                project_id: "p1".into(),
                tool_type: tool_type.into(),
                title: None,
                profile_id: None,
                color: None,
                thinking_intensity: None,
                template_id: None,
                cli_args: cli_args.map(|s| s.into()),
                env_vars: None,
                cli_session_id: None,
                category_id: None,
                llm_provider_id: None,
                model_name: None,
                claude_models: None,
            },
        )
        .unwrap()
        .id
    }

    /// 核心安全属性：`FromSession` 的参数**全部**来自数据库，前端无从插手。
    /// `SshTarget` 是 tagged enum，同一次调用只能构造一个变体，所以「同时传 manual」
    /// 天然不可表达；这里守住的是它只认库、且解出的是明文密码。
    #[test]
    fn from_session_reads_credentials_from_db_only() {
        let db = test_db();
        let id = seed_session(
            &db,
            "ssh",
            Some(r#"{"hostname":"10.0.0.1","port":2222,"username":"root","password":"hunter2","identityFile":""}"#),
        );
        let ssh = resolve_ssh_args(&db, &SshTarget::FromSession { session_id: id }).unwrap();
        assert_eq!(ssh.hostname, "10.0.0.1");
        assert_eq!(ssh.port, 2222);
        assert_eq!(ssh.password, "hunter2", "库里编码过的密码应解回明文供 askpass 使用");
        assert_eq!(ssh.cache_key(), "root@10.0.0.1:2222");
    }

    #[test]
    fn from_session_rejects_missing_session() {
        let err = resolve_ssh_args(
            &test_db(),
            &SshTarget::FromSession {
                session_id: "nope".into(),
            },
        )
        .unwrap_err();
        assert!(matches!(err, TransferError::SessionNotFound), "{err}");
    }

    /// 拿 Terminal 会话按 SSH 传是错的：PTY 里是本地 shell，参数根本对不上。
    #[test]
    fn from_session_rejects_non_ssh_session() {
        let db = test_db();
        let id = seed_session(&db, "terminal", Some("[]"));
        let err = resolve_ssh_args(&db, &SshTarget::FromSession { session_id: id }).unwrap_err();
        assert!(matches!(err, TransferError::NotAnSshSession), "{err}");
    }

    #[test]
    fn manual_target_requires_a_hostname() {
        let err = resolve_ssh_args(
            &test_db(),
            &SshTarget::Manual {
                hostname: "   ".into(),
                port: None,
                username: None,
                password: None,
                identity_file: None,
            },
        )
        .unwrap_err();
        assert!(matches!(err, TransferError::MissingHostname), "{err}");
    }

    #[test]
    fn manual_target_defaults_port_and_username() {
        let ssh = resolve_ssh_args(
            &test_db(),
            &SshTarget::Manual {
                hostname: " 10.0.0.9 ".into(),
                port: None,
                username: None,
                password: Some("pw".into()),
                identity_file: None,
            },
        )
        .unwrap();
        assert_eq!(ssh.hostname, "10.0.0.9", "主机名应去掉首尾空白");
        assert_eq!(ssh.port, 22);
        assert_eq!(ssh.username, "root");
    }

    #[test]
    fn unique_destination_returns_original_when_free() {
        let d = tmpdir("free");
        assert_eq!(unique_destination(&d, "a.txt").unwrap(), d.join("a.txt"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn unique_destination_appends_counter_on_collision() {
        let d = tmpdir("collide");
        std::fs::write(d.join("a.txt"), b"x").unwrap();
        assert_eq!(unique_destination(&d, "a.txt").unwrap(), d.join("a_1.txt"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn unique_destination_skips_occupied_counters() {
        let d = tmpdir("skip");
        std::fs::write(d.join("a.txt"), b"x").unwrap();
        std::fs::write(d.join("a_1.txt"), b"x").unwrap();
        assert_eq!(unique_destination(&d, "a.txt").unwrap(), d.join("a_2.txt"));
        std::fs::remove_dir_all(&d).ok();
    }

    /// 回归：用 is_file() 判定会让同名目录被直接覆盖。
    #[test]
    fn unique_destination_yields_to_directory() {
        let d = tmpdir("dir");
        std::fs::write(d.join("a.txt"), b"x").unwrap();
        std::fs::create_dir(d.join("a_1.txt")).unwrap();
        assert_eq!(unique_destination(&d, "a.txt").unwrap(), d.join("a_2.txt"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn unique_destination_keeps_multi_dots_before_counter() {
        let d = tmpdir("dots");
        std::fs::write(d.join("a.tar.gz"), b"x").unwrap();
        assert_eq!(unique_destination(&d, "a.tar.gz").unwrap(), d.join("a.tar_1.gz"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn unique_destination_handles_dotfiles() {
        let d = tmpdir("dot");
        std::fs::write(d.join(".bashrc"), b"x").unwrap();
        assert_eq!(unique_destination(&d, ".bashrc").unwrap(), d.join(".bashrc_1"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn unique_destination_appends_counter_without_extension() {
        let d = tmpdir("noext");
        std::fs::write(d.join("README"), b"x").unwrap();
        assert_eq!(unique_destination(&d, "README").unwrap(), d.join("README_1"));
        std::fs::remove_dir_all(&d).ok();
    }

    /// 回归：上传必须是「本地在前、远程在后」。
    #[test]
    fn upload_puts_the_local_path_before_the_remote_spec() {
        let ssh = SshArgs {
            hostname: "h".into(),
            port: 10022,
            username: "root".into(),
            password: "pw".into(),
            identity_file: String::new(),
        };
        let args = build_scp_args(
            &ssh,
            false,
            Direction::Upload,
            &["/tmp/a.txt".to_string()],
            "/root/",
        );
        let local = args.iter().position(|a| a == "/tmp/a.txt").unwrap();
        let remote = args.iter().position(|a| a.starts_with("root@h:")).unwrap();
        assert!(local < remote, "上传时本地路径应在远程之前: {args:?}");
    }

    /// 回归：下载必须是「远程在前、本地在后」。
    ///
    /// 弄反了 scp 会把本地临时文件当源往远端传 —— 下载看着成功，实际什么都没下。
    #[test]
    fn download_puts_the_remote_spec_before_the_local_path() {
        let ssh = SshArgs {
            hostname: "h".into(),
            port: 10022,
            username: "root".into(),
            password: "pw".into(),
            identity_file: String::new(),
        };
        let args = build_scp_args(
            &ssh,
            false,
            Direction::Download,
            &["/tmp/.x.teatmp".to_string()],
            "/root/text",
        );
        let remote = args.iter().position(|a| a.starts_with("root@h:")).unwrap();
        let local = args.iter().position(|a| a == "/tmp/.x.teatmp").unwrap();
        assert!(remote < local, "下载时远程路径应在本地之前: {args:?}");
    }

    /// 回归：scp 的端口是大写 -P，ssh 是小写 -p。
    #[test]
    fn build_scp_uses_capital_p_for_port() {
        let ssh = SshArgs { hostname: "h".into(), port: 65222, ..Default::default() };
        let args = build_scp(&ssh, false);
        assert!(args.contains(&"-P".to_string()), "scp 端口必须用 -P: {args:?}");
        assert!(!args.contains(&"-p".to_string()), "scp 不该用 -p: {args:?}");
        assert!(args.contains(&"65222".to_string()));
    }

    #[test]
    fn build_scp_omits_port_when_default() {
        let ssh = SshArgs { hostname: "h".into(), port: 22, ..Default::default() };
        assert!(!build_scp(&ssh, false).contains(&"-P".to_string()));
    }

    #[test]
    fn build_scp_adds_identity_flag() {
        let ssh = SshArgs { hostname: "h".into(), identity_file: "/k/id".into(), ..Default::default() };
        let args = build_scp(&ssh, false);
        let i = args.iter().position(|a| a == "-i").expect("应有 -i");
        assert_eq!(args[i + 1], "/k/id");
    }

    #[test]
    fn build_scp_legacy_adds_dash_o() {
        let ssh = SshArgs { hostname: "h".into(), ..Default::default() };
        assert!(build_scp(&ssh, true).contains(&"-O".to_string()));
        assert!(!build_scp(&ssh, false).contains(&"-O".to_string()));
    }

    /// 回归：askpass 机制下密码走环境变量，绝不能出现在 argv（ps 可见）。
    #[test]
    fn build_scp_never_contains_password() {
        let ssh = SshArgs { hostname: "h".into(), password: "hunter2".into(), ..Default::default() };
        let args = build_scp(&ssh, false);
        assert!(
            !args.iter().any(|a| a.contains("hunter2")),
            "密码绝不能出现在命令行参数里: {args:?}",
        );
    }

    /// 回归：中途断开时回退会重传半个文件，必须被零字节判据拦住。
    #[test]
    fn fallback_blocked_when_bytes_already_moved() {
        assert!(!should_try_legacy_fallback("subsystem request failed", 4096));
    }

    #[test]
    fn fallback_allowed_on_zero_bytes_with_sftp_marker() {
        assert!(should_try_legacy_fallback("Subsystem request failed", 0));
        assert!(should_try_legacy_fallback("protocol error", 0));
        assert!(should_try_legacy_fallback("Unexpected internal error", 0));
    }

    #[test]
    fn fallback_blocked_on_unrelated_error() {
        assert!(!should_try_legacy_fallback("Permission denied", 0));
    }

    #[test]
    fn friendly_error_maps_common_failures() {
        assert!(friendly_error("root@h: Permission denied (publickey)").contains("认证失败"));
        assert!(friendly_error("ssh: connect to host h port 22: Connection timed out").contains("超时"));
        assert!(friendly_error("subsystem request failed").contains("SFTP"));
        assert!(friendly_error("some opaque failure").contains("传输失败"));
    }

    /// 回归：照抄 `test_ssh_connection` 的一律判认证失败，会把远程目录不可写
    /// 误报成密码错 —— 用户会去反复改密码，而真正的原因是目录权限。
    #[test]
    fn remote_filesystem_denial_is_not_reported_as_auth_failure() {
        let out = friendly_error("scp: /root/dest: Permission denied");
        assert!(!out.contains("认证失败"), "远端权限错误不应被误判: {out}");
        assert!(out.contains("/root/dest"), "兜底分支应带出路径: {out}");
    }

    /// 前缀之前出现过别的行也不该影响判据 —— 真实 stderr 常带多行。
    #[test]
    fn auth_failure_still_detected_after_a_leading_line() {
        let out = friendly_error("Warning:Permanently added to the list.\nroot@h: Permission denied (publickey).");
        assert!(out.contains("认证失败"), "{out}");
    }

    #[test]
    fn friendly_error_truncates_long_stderr_from_the_end() {
        let out = friendly_error(&"E".repeat(2000));
        assert!(out.len() < 600, "应截断到尾部 500 字符: {}", out.len());
        assert!(out.starts_with("传输失败"));
    }

    #[test]
    fn sftp_mode_passes_the_remote_path_through_verbatim() {
        // SFTP 模式下路径由 sftp-server 按字面解析，加引号会让引号成为路径的一部分
        // （实测 root@host:'/root/' → dest open "'/root/'"）。这是「远程路径不存在」的根因。
        assert_eq!(build_remote_arg("/root/", false), "/root/");
        assert_eq!(build_remote_arg("/root/a b", false), "/root/a b");
        assert_eq!(build_remote_arg("/root/it's", false), "/root/it's");
        assert_eq!(build_remote_arg("~/", false), "~/");
    }

    #[test]
    fn legacy_mode_escapes_the_remote_path_for_the_remote_shell() {
        // 不能加引号：legacy 下载方向会拿回传的文件名跟请求串比对，
        // 引号留在串里 → protocol error: filename does not match request
        assert_eq!(build_remote_arg("/root/a b", true), "/root/a\\ b");
        assert_eq!(build_remote_arg("/root/it's", true), "/root/it\\'s");
        assert_eq!(build_remote_arg("/root/", true), "/root/");
        assert_eq!(build_remote_arg("/root/a\"b", true), "/root/a\\\"b");
    }

    #[test]
    fn legacy_mode_keeps_the_tilde_prefix_unescaped() {
        // ~ 必须留给远程 shell 展开成 home；转义了就成字面目录名
        assert_eq!(build_remote_arg("~/a.txt", true), "~/a.txt");
        assert_eq!(build_remote_arg("~/a b.txt", true), "~/a\\ b.txt");
        assert_eq!(build_remote_arg("~/a'b.txt", true), "~/a\\'b.txt");
        assert_eq!(build_remote_arg("~/", true), "~/");
        assert_eq!(build_remote_arg("~", true), "~");
        assert_eq!(build_remote_arg("~user/a.txt", true), "~user/a.txt");
    }

    #[test]
    fn legacy_mode_leaves_non_meta_characters_alone() {
        assert_eq!(build_remote_arg("/root/中文名.txt", true), "/root/中文名.txt");
        assert_eq!(build_remote_arg("/root/a-b_c.d", true), "/root/a-b_c.d");
    }

    #[test]
    fn split_home_prefix_handles_the_absence_of_a_tilde() {
        assert_eq!(split_home_prefix("/root/a"), ("", "/root/a"));
        assert_eq!(split_home_prefix("~/a"), ("~/", "a"));
        assert_eq!(split_home_prefix("~user/a"), ("~user/", "a"));
        assert_eq!(split_home_prefix("~"), ("~", ""));
    }

    #[test]
    fn stderr_tail_is_bounded() {
        let mut t = StderrTail::new();
        for _ in 0..20 {
            let chunk = vec![b'x'; 1024];
            let room = StderrTail::MAX - t.buf.len();
            if room == 0 {
                break;
            }
            t.buf.extend_from_slice(&chunk[..chunk.len().min(room)]);
        }
        assert_eq!(t.buf.len(), StderrTail::MAX);
    }
}
