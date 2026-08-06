use std::process::Command;
use std::time::SystemTime;

use super::{CliTool, ToolType};

struct ToolDef {
    tool_type: ToolType,
    executable: &'static str,
    version_arg: &'static str,
}

const TOOL_DEFS: &[ToolDef] = &[
    ToolDef {
        tool_type: ToolType::Claude,
        executable: "claude",
        version_arg: "--version",
    },
    ToolDef {
        tool_type: ToolType::Codex,
        executable: "codex",
        version_arg: "--version",
    },
    ToolDef {
        tool_type: ToolType::Gemini,
        executable: "gemini",
        version_arg: "--version",
    },
    ToolDef {
        tool_type: ToolType::OpenCode,
        executable: "opencode",
        version_arg: "--version",
    },
];

pub fn detect_all() -> Vec<CliTool> {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    TOOL_DEFS
        .iter()
        .map(|def| {
            let which_output = Command::new("which")
                .arg(def.executable)
                .output()
                .ok();

            let path = which_output
                .as_ref()
                .and_then(|o| {
                    if o.status.success() {
                        String::from_utf8(o.stdout.trim_ascii().to_vec()).ok()
                    } else {
                        None
                    }
                });

            let version = path.as_ref().and_then(|_| {
                Command::new(def.executable)
                    .arg(def.version_arg)
                    .output()
                    .ok()
                    .and_then(|o| {
                        if o.status.success() {
                            String::from_utf8(o.stdout.trim_ascii().to_vec()).ok()
                        } else {
                            None
                        }
                    })
            });

            let is_available = path.is_some();

            CliTool {
                tool_type: def.tool_type.clone(),
                version,
                path,
                is_available,
                last_detected_at: now,
            }
        })
        .collect()
}
