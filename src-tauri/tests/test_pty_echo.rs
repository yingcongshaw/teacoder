use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

fn find_valid_utf8_boundary(data: &[u8]) -> usize {
    if data.is_empty() {
        return 0;
    }

    let mut i = 0;
    let len = data.len();
    let mut last_valid = 0;

    while i < len {
        let byte = data[i];

        if byte & 0x80 == 0 {
            i += 1;
            last_valid = i;
            continue;
        }

        if byte & 0xC0 == 0x80 {
            return last_valid;
        }

        let expected_len = if byte & 0xE0 == 0xC0 {
            2
        } else if byte & 0xF0 == 0xE0 {
            3
        } else if byte & 0xF8 == 0xF0 {
            4
        } else {
            return last_valid;
        };

        if i + expected_len > len {
            return last_valid;
        }

        for j in 1..expected_len {
            if data[i + j] & 0xC0 != 0x80 {
                return last_valid;
            }
        }

        i += expected_len;
        last_valid = i;
    }

    last_valid
}

/// 在 PTY slave 侧禁用 ECHO
#[cfg(unix)]
fn disable_slave_echo(master_fd: libc::c_int) {
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
        termios.c_lflag &= !(libc::ECHO | libc::ECHOK | libc::ECHONL);
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

struct PtyEntry {
    master: Box<dyn MasterPty + Send>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    reader_handle: Option<std::thread::JoinHandle<()>>,
    child: Box<dyn Child + Send>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtyEntry>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PtyManager {
    pub fn start_session(
        &self,
        tab_id: String,
        work_dir: String,
        env_vars: HashMap<String, String>,
        args: Vec<String>,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();

        let mut cmd = CommandBuilder::new("sh");
        cmd.cwd(work_dir);

        if !args.is_empty() {
            cmd.arg("-c");
            for arg in args {
                cmd.arg(arg);
            }
        } else {
            cmd.arg("-c");
            cmd.arg("echo 'HELLO_FROM_SHELL' && sleep 5");
        }

        for (key, value) in env_vars {
            cmd.env(key, value);
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

        // 在 slave 侧禁用 ECHO
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

        let tab_id_clone = tab_id.clone();
        let tab_id_for_emit = tab_id.clone();

        let reader_handle = std::thread::spawn(move || {
            let mut reader = reader;
            let mut pending: Vec<u8> = Vec::new();
            let _tab_id = tab_id_for_emit;

            loop {
                let mut buf = [0u8; 4096];
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);

                        let valid_end = find_valid_utf8_boundary(&pending);
                        if valid_end == 0 {
                            continue;
                        }

                        let data = String::from_utf8_lossy(&pending[..valid_end]).to_string();
                        pending = pending[valid_end..].to_vec();

                        eprintln!("[PTY-OUTPUT] tab={} data={:?} len={}", tab_id_clone, data, data.len());
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
        eprintln!("[PTY-INPUT] tab={} data={:?} len={}", tab_id, data, data.len());

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

fn main() {
    println!("=== PTY Echo Suppression Test ===");
    println!();

    // Test 1: Pure ASCII echo suppression
    println!("Test 1: ASCII characters");
    let manager = PtyManager::new();
    match manager.start_session(
        "test".to_string(),
        "/tmp".to_string(),
        HashMap::new(),
        vec![],
    ) {
        Ok(_) => println!("  ✓ Session started"),
        Err(e) => {
            eprintln!("  ✗ Failed to start session: {}", e);
            std::process::exit(1);
        }
    }

    let test_data = "hello world";
    println!();
    println!("Writing: '{}'", test_data);
    match manager.write_to_pty("test", test_data) {
        Ok(_) => println!("  ✓ Write succeeded"),
        Err(e) => {
            eprintln!("  ✗ Failed to write: {}", e);
            std::process::exit(1);
        }
    }

    std::thread::sleep(std::time::Duration::from_millis(500));
    match manager.stop_session("test") {
        Ok(_) => println!("  ✓ Session stopped"),
        Err(e) => eprintln!("  ✗ Failed to stop: {}", e),
    }

    // Test 2: Chinese characters echo suppression
    println!();
    println!("Test 2: Chinese characters");
    let manager = PtyManager::new();
    match manager.start_session(
        "test".to_string(),
        "/tmp".to_string(),
        HashMap::new(),
        vec![],
    ) {
        Ok(_) => println!("  ✓ Session started"),
        Err(e) => {
            eprintln!("  ✗ Failed to start session: {}", e);
            std::process::exit(1);
        }
    }

    let test_data = "你是谁";
    println!();
    println!("Writing: '{}'", test_data);
    match manager.write_to_pty("test", test_data) {
        Ok(_) => println!("  ✓ Write succeeded"),
        Err(e) => {
            eprintln!("  ✗ Failed to write: {}", e);
            std::process::exit(1);
        }
    }

    std::thread::sleep(std::time::Duration::from_millis(500));
    match manager.stop_session("test") {
        Ok(_) => println!("  ✓ Session stopped"),
        Err(e) => eprintln!("  ✗ Failed to stop: {}", e),
    }

    // Test 3: Mixed characters
    println!();
    println!("Test 3: Mixed ASCII + Chinese");
    let manager = PtyManager::new();
    match manager.start_session(
        "test".to_string(),
        "/tmp".to_string(),
        HashMap::new(),
        vec![],
    ) {
        Ok(_) => println!("  ✓ Session started"),
        Err(e) => {
            eprintln!("  ✗ Failed to start session: {}", e);
            std::process::exit(1);
        }
    }

    let test_data = "你好世界";
    println!();
    println!("Writing: '{}'", test_data);
    match manager.write_to_pty("test", test_data) {
        Ok(_) => println!("  ✓ Write succeeded"),
        Err(e) => {
            eprintln!("  ✗ Failed to write: {}", e);
            std::process::exit(1);
        }
    }

    std::thread::sleep(std::time::Duration::from_millis(500));
    match manager.stop_session("test") {
        Ok(_) => println!("  ✓ Session stopped"),
        Err(e) => eprintln!("  ✗ Failed to stop: {}", e),
    }

    println!();
    println!("=== All tests completed ===");
}
