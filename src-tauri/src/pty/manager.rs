use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::sync::Mutex;

use portable_pty::{
    native_pty_system, Child, CommandBuilder, MasterPty, PtySize,
};
use tauri::Emitter;

use super::ToolType;

struct PtyEntry {
    master: Box<dyn MasterPty + Send>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    reader_handle: Option<std::thread::JoinHandle<()>>,
    child: Box<dyn Child + Send>,
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

/// 解析 SSH 参数（从 cli_args JSON 数组中提取第一个 JSON 对象）
fn parse_ssh_args(args: &[String]) -> Option<SshArgs> {
    if args.len() != 1 {
        return None;
    }
    let json_str = &args[0];
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

    pub fn start_session(
        &self,
        app: tauri::AppHandle,
        tab_id: String,
        tool_type: ToolType,
        work_dir: String,
        env_vars: HashMap<String, String>,
        args: Vec<String>,
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
        if matches!(tool_type, ToolType::Ssh) {
            if let Some(ssh_args) = parse_ssh_args(&args) {
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
                    // 通过 SSH_ASKPASS 设置密码
                    cmd.env("SSH_ASKPASS", "/usr/bin/ssh-askpass-helper");
                    cmd.env("SSH_ASKPASS_REQUIRE", "force");
                    cmd.env("DISPLAY", ":0");
                }

                // 禁用严格的主机密钥检查（首次连接友好）
                cmd.arg("-o");
                cmd.arg("StrictHostKeyChecking=no");
                cmd.arg("-o");
                cmd.arg("UserKnownHostsFile=/dev/null");
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
        let tab_id_for_log = tab_id.clone();
        let tab_id_for_emit = tab_id.clone();

        let reader_handle = std::thread::spawn(move || {
            let mut reader = reader;
            let mut pending: Vec<u8> = Vec::new();
            let tab_id = tab_id_for_emit;

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

                        eprintln!("[PTY-OUTPUT] tab={} data={:?} len={}", tab_id_for_log, data, data.len());
                        let _ = app_arc.emit("pty:output", serde_json::json!({
                            "tabId": tab_id,
                            "data": data,
                        }));
                    }
                }
            }
        });

        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        sessions.insert(
            tab_id,
            PtyEntry {
                master,
                writer: Mutex::new(writer),
                reader_handle: Some(reader_handle),
                child,
            },
        );

        Ok(())
    }

    pub fn write_to_pty(&self, tab_id: &str, data: &str) -> Result<(), String> {
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
}
