use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use portable_pty::{
    native_pty_system, Child, CommandBuilder, MasterPty, PtySize,
};
use tauri::Emitter;

use super::ToolType;
use crate::ssh::askpass::AskpassGuard;
use crate::ssh::{parse_ssh_args, redact_secrets, SshAuth};

/// 远程 cwd 探测的哨兵前缀与后缀。中间的 uuid 区分并发的探测请求，
/// 前端/其他标签页的同名字符串不会误命中。
const PROBE_PREFIX: &str = "__TEACODE_PWD__";
const PROBE_SUFFIX: &str = ":__END__";

/// 一次在途的远程 cwd 探测。
struct ProbeRequest {
    /// 本次探测的 uuid。
    id: String,
    reply: tokio::sync::oneshot::Sender<String>,
}

/// 探测槽。reader 线程与调用方共享同一个 `Arc`。
type ProbeSlot = Arc<Mutex<Option<ProbeRequest>>>;

struct PtyEntry {
    master: Box<dyn MasterPty + Send>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    reader_handle: Option<std::thread::JoinHandle<()>>,
    child: Box<dyn Child + Send>,
    /// 密码认证的临时文件。Drop 即清理，进程被 kill 之外的所有路径都覆盖到。
    ///
    /// 字段从不被读取 —— 它存在的全部意义就是让 guard 活到 session 结束。
    #[allow(dead_code)]
    ssh_askpass: Option<AskpassGuard>,
    probe_slot: ProbeSlot,
}

/// 从一段输出里取出哨兵包裹的远程路径。
///
/// 输入是已 `strip_ansi` 且跨 PTY 读块拼接过的滚动窗口，因此：
/// 哨兵本身被切断、前面有命令回显、路径含 ANSI 残留，都不应影响命中。
///
/// 必须扫**所有**出现位置而不是第一个：shell 会把命令本身回显出来，
/// 而回显里也是同一枚哨兵（`$PWD` 未展开）。窗口只在校准时才清空，
/// 回显会一直留在里面 —— 只取首个匹配的话，回显会永久挡在真实输出前面，
/// 探测永远命中不了。绝对路径校验把回显那份挡掉，逐个往后找即可。
fn extract_probe_path(window: &str, probe_id: &str) -> Option<String> {
    let needle = format!("{PROBE_PREFIX}{probe_id}__:");
    let mut from = 0;
    while let Some(rel) = window[from..].find(&needle) {
        let start = from + rel + needle.len();
        if let Some(end) = window[start..].find(PROBE_SUFFIX) {
            let path = window[start..start + end].trim();
            // 远端 pwd 恒为绝对路径，这条校验顺带挡掉未展开的 `$PWD`
            if path.starts_with('/') {
                return Some(path.to_string());
            }
        }
        from = start;
    }
    None
}

/// 剥除 ANSI / VT 转义序列(CSI / SGR / 光标移动),Claude Code Ink TUI 反复重绘同一行
/// 时会插入这类序列,直接做子串匹配会被它们打断命中。
fn strip_ansi(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        // ESC [ ... <final> 形式:final 字节范围 0x40..=0x7E(@ A..Z [ \ ] ^ _ ` { | } ~)
        if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            let mut j = i + 2;
            while j < bytes.len() && !(0x40..=0x7e).contains(&bytes[j]) {
                j += 1;
            }
            if j < bytes.len() {
                i = j + 1;
            } else {
                // 未终结的转义,保留原样以防截断 prompt
                out.push(bytes[i]);
                i += 1;
            }
            continue;
        }
        // 其他 ESC 序列:两字节 OSC / 其他,跳过整个控制符长度
        if bytes[i] == 0x1b && i + 1 < bytes.len() {
            // ESC 后跟一个 P(SOS)/X(SOH)/...(ST 结束) 等,简化处理:丢一字节后续
            i += 2;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 检测 PTY 输出尾部是否含已知密码/PIN 提示串。
/// 不引入 regex crate —— 子串扫描对以下 6 类已足够,TUI 重绘反复命中由调用方用 2s 防抖控制。
/// 返回命中的提示类别名,方便日后做 UI 分类标签。
fn detect_sensitive_prompt(tail: &str) -> Option<&'static str> {
    let lower = tail.to_lowercase();
    if lower.contains("[sudo] password for") {
        Some("sudo")
    } else if lower.contains("(current) unix password") {
        Some("sudo_retry")
    } else if lower.contains("old password:") {
        Some("passwd")
    } else if lower.contains("password:") {
        Some("generic")
    } else if lower.contains("passphrase") {
        Some("passphrase")
    } else if lower.contains("enter pin") || lower.contains("enter your pin") {
        Some("pin")
    } else {
        None
    }
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtyEntry>>,
}

/// 在 PTY slave 侧禁用 ECHO，防止输入字符被内核回显到 master 侧。
/// Linux 上 master/slave 有独立的 termios，必须对 slave fd 调用 tcsetattr 才能真正禁用回显。
#[cfg(unix)]
fn disable_slave_echo(master_fd: libc::c_int) {
    // 通过 ptsname 获取 slave 设备路径
    let slave_path = unsafe {
        let mut buf = [0u8; 256];
        let ptr = libc::ptsname_r(master_fd, buf.as_mut_ptr() as *mut libc::c_char, buf.len());
        if ptr != 0 {
            eprintln!("[PTY] ptsname_r failed, cannot disable slave echo");
            return;
        }
        let len = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        String::from_utf8_lossy(&buf[..len]).to_string()
    };

    // 打开 slave 设备并禁用 ECHO
    let slave_fd = unsafe {
        libc::open(
            slave_path.as_ptr() as *const libc::c_char,
            libc::O_RDWR | libc::O_NOCTTY,
        )
    };
    if slave_fd < 0 {
        eprintln!("[PTY] Failed to open slave device {}, cannot disable echo", slave_path);
        return;
    }

    let result = unsafe {
        let mut termios = std::mem::MaybeUninit::<libc::termios>::uninit();
        if libc::tcgetattr(slave_fd, termios.as_mut_ptr()) != 0 {
            libc::close(slave_fd);
            eprintln!("[PTY] tcgetattr on slave failed");
            return;
        }
        let termios = termios.assume_init_mut();
        termios.c_lflag &= !(libc::ECHOK | libc::ECHONL);
        let r = libc::tcsetattr(slave_fd, libc::TCSANOW, termios);
        libc::close(slave_fd);
        r
    };
    if result != 0 {
        eprintln!("[PTY] tcsetattr on slave failed");
    } else {
        eprintln!("[PTY] Disabled ECHO on slave device {}", slave_path);
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    #[allow(clippy::too_many_arguments)] // Tauri 命令参数由 IPC schema 决定，无法拆分
    pub fn start_session(
        &self,
        app: tauri::AppHandle,
        tab_id: String,
        tool_type: ToolType,
        work_dir: String,
        env_vars: HashMap<String, String>,
        args: Vec<String>,
        cli_args_raw: Option<String>,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();

        let cmd_name: String = match tool_type {
            ToolType::Claude => "claude".to_string(),
            ToolType::Codex => "codex".to_string(),
            ToolType::Gemini => "gemini".to_string(),
            ToolType::OpenCode => "opencode".to_string(),
            ToolType::Terminal => {
                // 终端类型：使用系统默认 shell
                #[cfg(unix)]
                {
                    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
                }
                #[cfg(windows)]
                {
                    "cmd.exe".to_string()
                }
            }
            ToolType::Ssh => "ssh".to_string(),
        };

        let mut cmd = CommandBuilder::new(&cmd_name);

        // SSH 密码认证时持有 askpass guard,会话关闭（或提前返回）时自动清理
        let mut ssh_askpass: Option<AskpassGuard> = None;
        // SSH 不需要本地 work_dir，但 PTY 需要一个有效的目录
        #[cfg(unix)]
        cmd.cwd(if work_dir == "~" || work_dir.is_empty() {
            std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
        } else {
            work_dir.clone()
        });
        #[cfg(windows)]
        cmd.cwd(&work_dir);

        // 设置 TERM 环境变量，支持 256 色 ANSI 颜色输出
        cmd.env("TERM", "xterm-256color");

        // 通过登录 shell 获取完整 PATH，解决 nvm/fnm 等用户级安装的工具找不到的问题
        #[cfg(unix)]
        if matches!(
            tool_type,
            ToolType::Claude | ToolType::Codex | ToolType::Gemini | ToolType::OpenCode | ToolType::Ssh
        ) {
            if let Ok(output) = std::process::Command::new("bash")
                .args(["-lc", "echo $PATH"])
                .output()
            {
                if output.status.success() {
                    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !path.is_empty() {
                        cmd.env("PATH", path);
                    }
                }
            }
        }

        for (key, value) in env_vars {
            cmd.env(key, value);
        }

        // Terminal 类型：传递 -l 参数启动登录 shell
        if matches!(tool_type, ToolType::Terminal) {
            #[cfg(unix)]
            {
                cmd.arg("-l");
            }
            #[cfg(windows)]
            {
                // Windows cmd.exe 不需要额外参数
            }
        }

        // SSH 类型：从 cli_args 解析连接参数
        // cli_args 是 JSON 对象字符串（前端 buildSshArgs() 输出）,
        // 不能走 Vec<String> 反序列化路径,这里直接传入原始 JSON。
        if matches!(tool_type, ToolType::Ssh) {
            if let Some(ref json) = cli_args_raw {
                if let Some(ssh_args) = parse_ssh_args(json) {
                    // JSON 中可能含明文 password —— 打日志时脱敏，避免密码落盘/上送到日志收集。
                    eprintln!("[PTY] SSH 启动 cli_args 解析成功: {}", redact_secrets(json));
                    if ssh_args.hostname.is_empty() {
                        return Err("SSH 会话缺少主机名".to_string());
                    }

                    // 添加用户@主机
                    cmd.arg(ssh_args.target());

                    // ssh 的端口是小写 -p（非默认 22 时才加）
                    if ssh_args.port != 22 {
                        cmd.arg("-p");
                        cmd.arg(ssh_args.port.to_string());
                    }

                    match ssh_args.auth() {
                        SshAuth::PublicKey(key_path) => {
                            cmd.arg("-i");
                            cmd.arg(&key_path);
                            cmd.args(ssh_args.auth_opts());
                        }
                        SshAuth::Password(password) => {
                            cmd.args(ssh_args.auth_opts());

                            // 通过 SSH_ASKPASS 设置密码(动态生成辅助脚本与 0600 密码文件)
                            match AskpassGuard::create(&password) {
                                Ok(guard) => {
                                    cmd.env("SSH_ASKPASS", guard.script_path());
                                    cmd.env("SSH_ASKPASS_REQUIRE", "force");
                                    ssh_askpass = Some(guard);
                                }
                                Err(e) => {
                                    eprintln!("[PTY] 创建 SSH_ASKPASS 失败: {e}");
                                    return Err(e);
                                }
                            }
                        }
                        // 既无私钥也无密码：交给 ssh 走 agent 与默认密钥
                        SshAuth::AgentOrDefault => {}
                    }

                    // 禁用严格的主机密钥检查（首次连接友好）
                    cmd.args(crate::ssh::SshArgs::common_opts());
                } else {
                    eprintln!("[PTY] SSH 参数 JSON 解析失败，原始 cli_args: {}", redact_secrets(json));
                    return Err("SSH 参数 JSON 解析失败".to_string());
                }
            } else {
                eprintln!("[PTY] SSH 会话缺少 cli_args（PTY 连接参数等）");
                return Err("SSH 会话缺少连接参数".to_string());
            }
        } else {
            for arg in args {
                cmd.arg(arg);
            }
        }

        let size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn command: {}", e))?;

        let master = pair.master;

        // 在 slave 侧禁用 ECHO — Linux 上 master/slave 有独立 termios，
        // 必须对 slave 设备调用 tcsetattr 才能真正阻止内核回显输入字符。
        #[cfg(unix)]
        {
            if let Some(fd) = master.as_raw_fd() {
                disable_slave_echo(fd);
            }
        }

        let reader = master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))?;
        let writer = master
            .take_writer()
            .map_err(|e| format!("Failed to take writer: {}", e))?;

        let app_arc = Arc::new(app);
        let tab_id_clone = tab_id.clone();
        let tab_id_for_emit = tab_id.clone();
        let probe_slot: ProbeSlot = Arc::new(Mutex::new(None));
        let probe_slot_reader = Arc::clone(&probe_slot);

        let reader_handle = std::thread::spawn(move || {
            let mut reader = reader;
            let mut pending: Vec<u8> = Vec::new();
            let tab_id = tab_id_for_emit;

            // 敏感提示匹配:闭包局部状态(reader 线程 1:1 绑 tab,无需 PtyManager 上挂 HashMap)。
            // sensitive_tail 保留最近 ~256 字节去 ANSI 后的输出,跨 PTY 读块拼接也能命中跨边界提示。
            let mut sensitive_tail = String::new();
            let mut last_sensitive_emit: Option<Instant> = None;

            // 远程 cwd 探测的滚动窗口。比 sensitive_tail 宽,因为哨兵命令的回显
            // 本身就占几十字节,窗口太窄会把哨兵挤出去。
            let mut probe_tail = String::new();
            // 已应答过的探测 id。同一个 id 不再看,但换新 id 后必须重新开始匹配 ——
            // 用户可以在同一个 tab 上反复探测远程目录。
            let mut probe_handled: Option<String> = None;

            loop {
                let mut buf = [0u8; 4096];
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => {
                        let _ = app_arc.emit("pty:exit", &tab_id_clone);
                        break;
                    }
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);

                        let valid_end = find_valid_utf8_boundary(&pending);
                        if valid_end == 0 {
                            continue;
                        }

                        let data = String::from_utf8_lossy(&pending[..valid_end]).to_string();
                        pending = pending[valid_end..].to_vec();

                        // 剥 ANSI → 拼到尾部 → 截断到 256 → 扫描
                        let stripped = strip_ansi(&data);
                        sensitive_tail.push_str(&stripped);
                        if sensitive_tail.len() > 256 {
                            // 按字节下标切片(都是 ASCII/UTF-8,字符边界安全)
                            let start = sensitive_tail.len() - 256;
                            // 避免在多字节字符中间切:找到 start 之后的下一个 UTF-8 起点
                            let mut cut = start;
                            while cut < sensitive_tail.len()
                                && (sensitive_tail.as_bytes()[cut] & 0xc0) == 0x80
                            {
                                cut += 1;
                            }
                            sensitive_tail.replace_range(..cut, "");
                        }
                        if let Some(_kind) = detect_sensitive_prompt(&sensitive_tail) {
                            let now = Instant::now();
                            let should_emit = last_sensitive_emit
                                .map(|t| now.duration_since(t) > Duration::from_secs(2))
                                .unwrap_or(true);
                            if should_emit {
                                last_sensitive_emit = Some(now);
                                let _ = app_arc.emit(
                                    "pty:sensitive_prompt_detected",
                                    serde_json::json!({ "tabId": tab_id }),
                                );
                            }
                        }

                        // 远程 cwd 探测：命中就把路径回给等待方并清空槽位，
                        // 之后无需再看这个 id。
                        if !stripped.is_empty() {
                            let maybe_id = probe_slot_reader
                                .lock()
                                .ok()
                                .and_then(|g| g.as_ref().map(|r| r.id.clone()));
                            if let Some(id) = maybe_id {
                                if probe_handled.as_deref() != Some(id.as_str()) {
                                    probe_tail.push_str(&stripped);
                                    if probe_tail.len() > 2048 {
                                        let cut = probe_tail.len() - 2048;
                                        let mut at = cut;
                                        while at < probe_tail.len()
                                            && (probe_tail.as_bytes()[at] & 0xc0) == 0x80
                                        {
                                            at += 1;
                                        }
                                        probe_tail.replace_range(..at, "");
                                    }
                                    if let Some(path) = extract_probe_path(&probe_tail, &id) {
                                        if let Ok(mut guard) = probe_slot_reader.lock() {
                                            if let Some(req) = guard.take() {
                                                let _ = req.reply.send(path);
                                                probe_handled = Some(id);
                                                probe_tail.clear();
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        let _ = app_arc.emit("pty:output", serde_json::json!({
                            "tabId": tab_id,
                            "data": data,
                        }));
                    }
                }
            }
        });

        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        // 共享 PTY 语义:同 tabId 重复 start 通常视为"前端显式多开或误调",
        // 复用现有 PtyEntry。但若旧 child 已退出(僵尸 PTY:之前启动失败 / 外部信号终止),
        // 必须先清理再启动新的,否则用户看到"已打开但终端空白"且无法恢复。
        if let Some(existing) = sessions.get_mut(&tab_id) {
            let child_alive = existing
                .child
                .try_wait()
                .ok()
                .map(|status| status.is_none())
                .unwrap_or(false);
            if child_alive {
                eprintln!("[PTY] tab={} 旧 PTY 仍运行,复用(共享 PTY 语义)", tab_id);
                return Ok(());
            }
            eprintln!("[PTY] tab={} 检测到僵尸 PTY,清理并重启", tab_id);
            // reader_handle 是 Option,可 take;writer / master 通过 sessions.remove
            // 触发 entry 整体 drop,避免 move 出 &mut 借用的所有权错误。
            if let Some(handle) = existing.reader_handle.take() {
                let _ = handle.join();
            }
        }
        sessions.remove(&tab_id);
        sessions.insert(
            tab_id,
            PtyEntry {
                master,
                writer: Mutex::new(writer),
                reader_handle: Some(reader_handle),
                child,
                ssh_askpass,
                probe_slot: Arc::clone(&probe_slot),
            },
        );

        Ok(())
    }

    pub fn write_to_pty(&self, tab_id: &str, data: &str) -> Result<(), String> {
        // 仅记录长度，不打 data —— 击键内容（含密码原文）会泄漏到 stderr。
        eprintln!("[PTY-WRITE] tab={} len={}", tab_id, data.len());
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let entry = sessions
            .get(tab_id)
            .ok_or_else(|| format!("Session {} not found", tab_id))?;

        let mut writer = entry.writer.lock().map_err(|e| e.to_string())?;
        writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;

        Ok(())
    }

    /// 探测该会话 shell 的当前工作目录。
    ///
    /// 往 PTY 敲一条带哨兵的 `echo`，由 reader 线程匹配回显并回传路径。选在 Rust
    /// 侧匹配而非前端，是因为 reader 线程已经在跨读块拼接，而前端拿到的
    /// `pty:output` 只是任意 4096 字节切片、无行边界保证。
    ///
    /// 超时或未命中时返回 `Err`，调用方据此回落到 `~/`。
    pub async fn probe_remote_cwd(
        &self,
        app: tauri::AppHandle,
        tab_id: String,
    ) -> Result<String, String> {
        const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

        let probe_id = uuid::Uuid::new_v4().to_string();
        let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();

        {
            let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
            let entry = sessions
                .get(&tab_id)
                .ok_or_else(|| format!("Session {} not found", tab_id))?;
            let mut slot = entry.probe_slot.lock().map_err(|e| e.to_string())?;
            *slot = Some(ProbeRequest {
                id: probe_id.clone(),
                reply: reply_tx,
            });
        }

        // 双引号让 $PWD 在远端展开；uuid 是十六进制与连字符，不会破坏 format/quote。
        let command = format!("echo \"{PROBE_PREFIX}{probe_id}__:$PWD{PROBE_SUFFIX}\"\r");
        if let Err(e) = self.write_to_pty(&tab_id, &command) {
            self.clear_probe(&tab_id);
            return Err(e);
        }

        let result = tokio::time::timeout(PROBE_TIMEOUT, reply_rx).await;
        // 无论命中与否都要清槽，否则下一次探测的哨兵 id 与残留请求不一致。
        self.clear_probe(&tab_id);

        match result {
            Ok(Ok(path)) => {
                let _ = app.emit("pty:cwd", serde_json::json!({ "tabId": tab_id, "path": path }));
                Ok(path)
            }
            Ok(Err(_)) => Err("远程目录探测被中断".to_string()),
            Err(_) => Err("远程目录探测超时".to_string()),
        }
    }

    fn clear_probe(&self, tab_id: &str) {
        if let Ok(sessions) = self.sessions.lock() {
            if let Some(entry) = sessions.get(tab_id) {
                if let Ok(mut slot) = entry.probe_slot.lock() {
                    *slot = None;
                }
            }
        }
    }

    pub fn resize_pty(
        &self,
        tab_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        eprintln!("[PTY-RESIZE] tab={} cols={} rows={}", tab_id, cols, rows);
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let entry = sessions
            .get(tab_id)
            .ok_or_else(|| format!("Session {} not found", tab_id))?;
        entry
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize PTY: {}", e))?;
        Ok(())
    }

    pub fn stop_session(&self, tab_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        if let Some(mut entry) = sessions.remove(tab_id) {
            let _ = entry.child.kill();
            drop(entry.writer);
            drop(entry.master);
            if let Some(handle) = entry.reader_handle.take() {
                let _ = handle.join();
            }
            // entry 在此 drop，ssh_askpass guard 随之清理临时文件
        }
        Ok(())
    }
}

/// Find the last valid UTF-8 boundary in a byte slice.
/// Returns the index up to which all bytes form valid complete UTF-8 code points.
/// Incomplete trailing bytes (start of a multi-byte sequence without enough continuation bytes)
/// are left for the next read cycle.
fn find_valid_utf8_boundary(data: &[u8]) -> usize {
    if data.is_empty() {
        return 0;
    }

    let mut i = 0;
    let len = data.len();
    let mut last_valid = 0;

    while i < len {
        let byte = data[i];

        // ASCII byte
        if byte & 0x80 == 0 {
            i += 1;
            last_valid = i;
            continue;
        }

        // Continuation byte without a start byte — invalid, stop here
        if byte & 0xC0 == 0x80 {
            return last_valid;
        }

        // Start byte of a multi-byte sequence
        let expected_len = if byte & 0xE0 == 0xC0 {
            2
        } else if byte & 0xF0 == 0xE0 {
            3
        } else if byte & 0xF8 == 0xF0 {
            4
        } else {
            // Invalid UTF-8 start byte
            return last_valid;
        };

        // Check if we have enough bytes
        if i + expected_len > len {
            // Incomplete sequence at end of buffer — save for next read
            return last_valid;
        }

        // Verify continuation bytes
        for j in 1..expected_len {
            if data[i + j] & 0xC0 != 0x80 {
                // Invalid continuation byte — stop before this sequence
                return last_valid;
            }
        }

        // Complete valid sequence
        i += expected_len;
        last_valid = i;
    }

    last_valid
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_valid_utf8_boundary_ascii() {
        assert_eq!(find_valid_utf8_boundary(b"hello"), 5);
    }

    #[test]
    fn test_valid_utf8_boundary_complete_cjk() {
        // "你" = E4 BD A0 (3 bytes)
        assert_eq!(find_valid_utf8_boundary(b"hello\xE4\xBD\xA0"), 8);
    }

    #[test]
    fn test_valid_utf8_boundary_incomplete_2byte() {
        // Start of 2-byte sequence without continuation
        assert_eq!(find_valid_utf8_boundary(b"hello\xC3"), 5);
    }

    #[test]
    fn test_valid_utf8_boundary_incomplete_3byte() {
        // Start of 3-byte sequence with only 1 continuation byte
        assert_eq!(find_valid_utf8_boundary(b"hello\xE4\xBD"), 5);
    }

    #[test]
    fn test_valid_utf8_boundary_incomplete_4byte() {
        // Start of 4-byte sequence with only 2 continuation bytes
        assert_eq!(find_valid_utf8_boundary(b"hello\xF0\x9F\x98"), 5);
    }

    #[test]
    fn test_valid_utf8_boundary_incomplete_then_ascii() {
        let data = b"hello\xE4world";
        assert_eq!(find_valid_utf8_boundary(data), 5);
    }

    #[test]
    fn test_valid_utf8_boundary_incomplete_2byte_then_ascii() {
        let data = b"hello\xC3world";
        assert_eq!(find_valid_utf8_boundary(data), 5);
    }

    #[test]
    fn test_valid_utf8_boundary_complete_then_incomplete() {
        let data = b"\xE4\xBD\xA0\xE4\xBD";
        assert_eq!(find_valid_utf8_boundary(data), 3);
    }

    #[test]
    fn test_valid_utf8_boundary_lone_continuation() {
        let data = b"hi\x80bye";
        assert_eq!(find_valid_utf8_boundary(data), 2);
    }

    #[test]
    fn test_valid_utf8_boundary_only_continuation() {
        assert_eq!(find_valid_utf8_boundary(b"\x80\x81\x82"), 0);
    }

    // ----- 敏感提示识别 -----

    #[test]
    fn detect_sudo() {
        assert_eq!(
            detect_sensitive_prompt("[sudo] password for alice:"),
            Some("sudo")
        );
    }

    #[test]
    fn detect_sudo_case_insensitive() {
        assert_eq!(
            detect_sensitive_prompt("[SUDO] Password For bob:"),
            Some("sudo")
        );
    }

    #[test]
    fn detect_sudo_retry() {
        assert_eq!(
            detect_sensitive_prompt("(current) UNIX password:"),
            Some("sudo_retry")
        );
    }

    #[test]
    fn detect_passwd_old_pw() {
        assert_eq!(detect_sensitive_prompt("Old password:"), Some("passwd"));
    }

    #[test]
    fn detect_generic_password_colon() {
        assert_eq!(
            detect_sensitive_prompt("Enter password:"),
            Some("generic")
        );
    }

    #[test]
    fn detect_passphrase() {
        assert_eq!(
            detect_sensitive_prompt("Enter passphrase for key '/home/x/.ssh/id_ed25519':"),
            Some("passphrase")
        );
    }

    #[test]
    fn detect_pin() {
        assert_eq!(detect_sensitive_prompt("Enter PIN: "), Some("pin"));
    }

    #[test]
    fn detect_pin_lowercase() {
        assert_eq!(
            detect_sensitive_prompt("please enter your pin to continue"),
            Some("pin")
        );
    }

    #[test]
    fn no_hit_help_text() {
        // `--password=...` 这种 CLI 参数含 password 字串,但不构成 prompt
        assert!(detect_sensitive_prompt("--password=foo --foo=bar ").is_none());
    }

    #[test]
    fn no_hit_normal_terminal() {
        assert!(detect_sensitive_prompt("$ ls -la\nexit\n").is_none());
    }

    // ----- ANSI 剥离 -----

    #[test]
    fn strip_ansi_removes_csi() {
        let raw = "\x1b[1m[ sudo ]\x1b[0m password for user:";
        assert_eq!(
            strip_ansi(raw),
            "[ sudo ] password for user:"
        );
    }

    #[test]
    fn strip_ansi_keeps_plain_text() {
        assert_eq!(strip_ansi("hello world"), "hello world");
    }

    /// 读线程是滚动窗口累积后再匹配的，且命令回显里也有一份未展开的哨兵。
    /// 三条性质必须同时成立：回显不误命中、收全之前不命中、收全之后能穿过回显命中。
    #[test]
    fn probe_path_skips_the_command_echo_and_survives_a_split_output() {
        let mut window = strip_ansi("$ echo \"__TEACODE_PWD__abc__:$PWD:__END__\"\r\n");
        assert!(
            extract_probe_path(&window, "abc").is_none(),
            "回显里的 $PWD 不是路径，不该命中"
        );

        window.push_str("__TEACODE_PWD__abc__:");
        assert!(extract_probe_path(&window, "abc").is_none(), "哨兵还没收全");

        window.push_str("/root/work:__END__\r\n");
        assert_eq!(
            extract_probe_path(&window, "abc").as_deref(),
            Some("/root/work"),
            "回显在前时应继续往后找，而不是被它挡死"
        );
    }

    #[test]
    fn probe_path_ignores_a_different_probe_id() {
        let window = "__TEACODE_PWD__other__:/root:__END__";
        assert!(extract_probe_path(window, "abc").is_none());
    }

    #[test]
    fn probe_path_rejects_relative_result() {
        let window = "__TEACODE_PWD__abc__:relative/path:__END__";
        assert!(extract_probe_path(window, "abc").is_none());
    }

    #[test]
    fn probe_path_absent_returns_none() {
        assert!(extract_probe_path("just some ordinary terminal output", "abc").is_none());
        assert!(extract_probe_path("", "abc").is_none());
    }

    /// 读线程拿到的是 strip_ansi 之后的文本，这里按真实链路组合一次：
    /// 命令回显带颜色转义时也必须命中。
    #[test]
    fn probe_path_found_after_stripping_real_echo_with_color() {
        let raw = "\u{1b}[32m$\u{1b}[0m echo \"__TEACODE_PWD__abc__:$PWD:__END__\"\r\n\
                   __TEACODE_PWD__abc__:/var/log:__END__\r\n";
        let window = strip_ansi(raw);
        assert_eq!(extract_probe_path(&window, "abc").as_deref(), Some("/var/log"));
    }

    #[test]
    fn strip_ansi_unterminated_escape_preserved() {
        // 未终结的 ESC[（没遇到 final byte）保留尾部，避免截断真 prompt
        let raw = "[sudo] pass\x1b[";
        assert_eq!(strip_ansi(raw), "[sudo] pass\x1b[");
    }
}
