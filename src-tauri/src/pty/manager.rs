use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use portable_pty::{
    native_pty_system, Child, CommandBuilder, MasterPty, PtySize,
};
use tauri::Emitter;

use super::ToolType;

/// SSH 密码认证辅助脚本和密码文件的路径。
/// stop_session 时清理。
#[cfg(unix)]
type SshAskpassPaths = Option<(PathBuf, PathBuf)>;

struct PtyEntry {
    master: Box<dyn MasterPty + Send>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    reader_handle: Option<std::thread::JoinHandle<()>>,
    child: Box<dyn Child + Send>,
    #[cfg(unix)]
    ssh_askpass_paths: SshAskpassPaths,
}

/// SSH 连接参数
#[derive(Debug, Default)]
struct SshArgs {
    hostname: String,
    port: u16,
    username: String,
    password: String,
    identity_file: String,
}

/// 解析 SSH 参数（从前端传入的 JSON 对象字符串）
/// 前端 buildSshArgs() 返回的 JSON 形如：
///   {"hostname":"...","port":22,"username":"root","password":"...","identityFile":"..."}
/// 注意:SSH 的 cli_args 始终是 JSON 对象,不能用 `Vec<String>` 反序列化,
/// 否则会被静默丢弃(unwrap_or_default() → 空 vec),导致 ssh 以零参数启动。
fn parse_ssh_args(json_str: &str) -> Option<SshArgs> {
    let json: serde_json::Value = serde_json::from_str(json_str).ok()?;
    let obj = json.as_object()?;

    Some(SshArgs {
        hostname: obj.get("hostname").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        port: obj.get("port").and_then(|v| v.as_u64()).unwrap_or(22) as u16,
        username: obj.get("username").and_then(|v| v.as_str()).unwrap_or("root").to_string(),
        password: obj.get("password").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        identity_file: obj.get("identityFile").and_then(|v| v.as_str()).unwrap_or("").to_string(),
    })
}

/// 打印前脱敏 JSON 中常见敏感字段，避免密码等原文落进 stderr 与日志采集。
///
/// 两处调用点都在失败分支，此时已无业务需要原文，故解析失败或结构异常时只返回
/// 元信息：回落到 `json.to_string()` 会把明文密码直接写进日志。
fn redact_secrets(json: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(json) {
        Ok(mut v) => {
            redact_value(&mut v);
            // 顶层是标量时无键名可依据，而 SSH 的 cli_args 约定必须是 JSON 对象，
            // 这类内容本身就可能是密码原文，只能整体屏蔽。
            if !v.is_object() && !v.is_array() {
                return "<非对象/数组的 JSON，已屏蔽>".to_string();
            }
            v.to_string()
        }
        Err(e) => format!("<无法解析的 JSON，长度 {}，错误: {e}>", json.len()),
    }
}

fn redact_value(v: &mut serde_json::Value) {
    const KEYS: &[&str] = &[
        "password", "passphrase", "token", "secret", "apiKey", "api_key", "privateKey",
        "private_key", "identityFile", "identity_file",
    ];
    match v {
        serde_json::Value::Object(map) => {
            for (k, val) in map.iter_mut() {
                if KEYS.iter().any(|name| name.eq_ignore_ascii_case(k)) {
                    *val = serde_json::Value::String("***".into());
                } else {
                    redact_value(val);
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr.iter_mut() {
                redact_value(item);
            }
        }
        _ => {}
    }
}

/// 创建 SSH_ASKPASS 辅助脚本与密码文件。
/// 脚本读取密码文件并打印到 stdout;密码文件权限 0600,脚本权限 0755。
/// 调用方负责在会话关闭时清理(`remove_ssh_askpass`)。
#[cfg(unix)]
fn create_ssh_askpass(password: &str) -> Result<(PathBuf, PathBuf), String> {
    use std::os::unix::fs::PermissionsExt;

    let pid = std::process::id();
    let tmp_dir = std::env::temp_dir();
    let script_path = tmp_dir.join(format!("teacoder-ssh-askpass-{pid}.sh"));
    let pwd_file = tmp_dir.join(format!("teacoder-ssh-pwd-{pid}.txt"));

    std::fs::write(&pwd_file, password)
        .map_err(|e| format!("写入 SSH 密码临时文件失败: {e}"))?;
    std::fs::set_permissions(&pwd_file, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("设置 SSH 密码文件权限失败: {e}"))?;

    let script = format!("#!/bin/sh\ncat '{path}'\n", path = pwd_file.display());
    std::fs::write(&script_path, script)
        .map_err(|e| format!("写入 SSH askpass 脚本失败: {e}"))?;
    std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("设置 SSH askpass 脚本权限失败: {e}"))?;

    Ok((script_path, pwd_file))
}

#[cfg(unix)]
fn remove_ssh_askpass(paths: &SshAskpassPaths) {
    if let Some((script, pwd)) = paths {
        let _ = std::fs::remove_file(script);
        let _ = std::fs::remove_file(pwd);
    }
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

        // SSH 密码认证时保存 askpass 路径,会话关闭时清理
        #[cfg(unix)]
        let mut ssh_askpass_paths: SshAskpassPaths = None;
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
                    let user_host = if ssh_args.username.is_empty() {
                        ssh_args.hostname.clone()
                    } else {
                        format!("{}@{}", ssh_args.username, ssh_args.hostname)
                    };
                    cmd.arg(&user_host);

                    // 添加端口（如果不是默认22）
                    if ssh_args.port != 22 {
                        cmd.arg("-p");
                        cmd.arg(ssh_args.port.to_string());
                    }

                    // PublicKey 优先于 Password
                    if !ssh_args.identity_file.is_empty() {
                        // 使用公钥认证
                        cmd.arg("-i");
                        cmd.arg(&ssh_args.identity_file);
                        cmd.arg("-o");
                        cmd.arg("PreferredAuthentications=publickey");
                    } else if !ssh_args.password.is_empty() {
                        // 使用密码认证
                        cmd.arg("-o");
                        cmd.arg("PreferredAuthentications=password");
                        cmd.arg("-o");
                        cmd.arg("PubkeyAuthentication=no");

                        // 通过 SSH_ASKPASS 设置密码(动态生成辅助脚本与 0600 密码文件)
                        match create_ssh_askpass(&ssh_args.password) {
                            Ok((script_path, _pwd_file)) => {
                                cmd.env("SSH_ASKPASS", &script_path);
                                cmd.env("SSH_ASKPASS_REQUIRE", "force");
                                #[cfg(unix)]
                                {
                                    ssh_askpass_paths = Some((script_path, _pwd_file));
                                }
                            }
                            Err(e) => {
                                eprintln!("[PTY] 创建 SSH_ASKPASS 失败: {e}");
                                return Err(e);
                            }
                        }
                    }

                    // 禁用严格的主机密钥检查（首次连接友好）
                    cmd.arg("-o");
                    cmd.arg("StrictHostKeyChecking=no");
                    cmd.arg("-o");
                    cmd.arg("UserKnownHostsFile=/dev/null");
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

        let reader_handle = std::thread::spawn(move || {
            let mut reader = reader;
            let mut pending: Vec<u8> = Vec::new();
            let tab_id = tab_id_for_emit;

            // 敏感提示匹配:闭包局部状态(reader 线程 1:1 绑 tab,无需 PtyManager 上挂 HashMap)。
            // sensitive_tail 保留最近 ~256 字节去 ANSI 后的输出,跨 PTY 读块拼接也能命中跨边界提示。
            let mut sensitive_tail = String::new();
            let mut last_sensitive_emit: Option<Instant> = None;

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
            #[cfg(unix)]
            remove_ssh_askpass(&existing.ssh_askpass_paths);
        }
        sessions.remove(&tab_id);
        sessions.insert(
            tab_id,
            PtyEntry {
                master,
                writer: Mutex::new(writer),
                reader_handle: Some(reader_handle),
                child,
                #[cfg(unix)]
                ssh_askpass_paths,
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
            // 清理 SSH askpass 临时文件
            #[cfg(unix)]
            remove_ssh_askpass(&entry.ssh_askpass_paths);
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
    fn redact_masks_password_field() {
        let out = redact_secrets(
            r#"{"hostname":"10.0.0.1","username":"root","password":"hunter2"}"#,
        );
        assert!(!out.contains("hunter2"), "密码原文泄漏: {out}");
        assert!(out.contains("10.0.0.1"), "非敏感字段应保留: {out}");
    }

    /// 回归：解析失败时曾回落成原文，把明文密码直接写进 stderr。
    #[test]
    fn redact_does_not_leak_on_malformed_json() {
        let out = redact_secrets(r#"{"password":"hunter2""#);
        assert!(!out.contains("hunter2"), "密码原文泄漏: {out}");
        assert!(out.contains("无法解析"), "应说明无法解析: {out}");
    }

    /// 回归：顶层标量没有键名可依据，其内容本身就可能是密码。
    #[test]
    fn redact_masks_top_level_scalar() {
        assert!(!redact_secrets("\"hunter2\"").contains("hunter2"));
        assert!(!redact_secrets("42").contains("42"));
    }

    #[test]
    fn test_parse_ssh_args_valid() {
        let json = r#"{"hostname":"192.168.1.1","port":2222,"username":"admin","password":"secret","identityFile":""}"#;
        let parsed = parse_ssh_args(json).expect("should parse valid SSH JSON");
        assert_eq!(parsed.hostname, "192.168.1.1");
        assert_eq!(parsed.port, 2222);
        assert_eq!(parsed.username, "admin");
        assert_eq!(parsed.password, "secret");
        assert_eq!(parsed.identity_file, "");
    }

    #[test]
    fn test_parse_ssh_args_defaults() {
        // 缺省字段应使用默认值
        let json = r#"{"hostname":"host"}"#;
        let parsed = parse_ssh_args(json).expect("should parse minimal SSH JSON");
        assert_eq!(parsed.hostname, "host");
        assert_eq!(parsed.port, 22);
        assert_eq!(parsed.username, "root");
        assert_eq!(parsed.password, "");
        assert_eq!(parsed.identity_file, "");
    }

    #[test]
    fn test_parse_ssh_args_rejects_array() {
        // 数组形式(其他工具的 cli_args)不能作为 SSH 参数解析
        let json = r#"["--some-arg","value"]"#;
        assert!(parse_ssh_args(json).is_none());
    }

    #[test]
    fn test_parse_ssh_args_rejects_invalid_json() {
        assert!(parse_ssh_args("not-json").is_none());
        assert!(parse_ssh_args("").is_none());
    }

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

    #[test]
    fn strip_ansi_unterminated_escape_preserved() {
        // 未终结的 ESC[（没遇到 final byte）保留尾部，避免截断真 prompt
        let raw = "[sudo] pass\x1b[";
        assert_eq!(strip_ansi(raw), "[sudo] pass\x1b[");
    }
}
