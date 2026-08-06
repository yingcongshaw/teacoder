use std::collections::HashMap;
use std::io::{Read, Write};
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

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtyEntry>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn start_session(
        &self,
        app: &tauri::AppHandle,
        tab_id: String,
        tool_type: ToolType,
        work_dir: String,
        env_vars: HashMap<String, String>,
        args: Vec<String>,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();

        let cmd_name = match tool_type {
            ToolType::Claude => "claude",
            ToolType::Codex => "codex",
            ToolType::Gemini => "gemini",
            ToolType::OpenCode => "opencode",
        };

        let mut cmd = CommandBuilder::new(cmd_name);
        cmd.cwd(work_dir);

        for (key, value) in env_vars {
            cmd.env(key, value);
        }

        for arg in args {
            cmd.arg(arg);
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
        let reader = master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))?;
        let writer = master
            .take_writer()
            .map_err(|e| format!("Failed to take writer: {}", e))?;

        let tab_id_clone = tab_id.clone();
        let app_clone = app.clone();

        let reader_handle = std::thread::spawn(move || {
            let mut reader = reader;
            let mut pending = Vec::new();

            loop {
                let mut buf = [0u8; 4096];
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => {
                        let _ = app_clone.emit("pty:exit", &tab_id_clone);
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

                        let _ = app_clone.emit("pty:output", serde_json::json!({
                            "tabId": tab_id_clone,
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
        writer
            .flush()
            .map_err(|e| format!("Failed to flush PTY: {}", e))?;
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
        // "hello" + incomplete 3-byte start (\xE4 only 1 byte) + "world"
        // \xE4 is a 3-byte start but next byte 'w' is not a continuation byte
        // So we stop at "hello" (5 bytes)
        let data = b"hello\xE4world";
        assert_eq!(find_valid_utf8_boundary(data), 5);
    }

    #[test]
    fn test_valid_utf8_boundary_incomplete_2byte_then_ascii() {
        // "hello" + incomplete 2-byte (\xC3 only 1 byte) + "world"
        let data = b"hello\xC3world";
        assert_eq!(find_valid_utf8_boundary(data), 5);
    }

    #[test]
    fn test_valid_utf8_boundary_complete_then_incomplete() {
        // "你" (E4 BD A0) + incomplete 3-byte start (E4 BD)
        let data = b"\xE4\xBD\xA0\xE4\xBD";
        assert_eq!(find_valid_utf8_boundary(data), 3);
    }

    #[test]
    fn test_valid_utf8_boundary_lone_continuation() {
        // Valid ASCII + lone continuation byte + valid ASCII
        let data = b"hi\x80bye";
        assert_eq!(find_valid_utf8_boundary(data), 2);
    }

    #[test]
    fn test_valid_utf8_boundary_only_continuation() {
        assert_eq!(find_valid_utf8_boundary(b"\x80\x81\x82"), 0);
    }
}
