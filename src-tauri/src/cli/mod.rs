pub mod detector;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolType {
    Claude,
    Codex,
    Gemini,
    OpenCode,
    Terminal,
    Ssh,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliTool {
    pub tool_type: ToolType,
    pub version: Option<String>,
    pub path: Option<String>,
    pub is_available: bool,
    pub last_detected_at: i64,
}
