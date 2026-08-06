use std::path::PathBuf;

use async_trait::async_trait;

use super::SessionCost;
use crate::profile::Profile;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolType {
    Claude,
    Codex,
    Gemini,
    OpenCode,
}

/// Trait for reading token usage data from CLI tool local files.
/// Each CLI tool implements this trait to provide cost tracking.
#[async_trait]
pub trait CostProvider: Send + Sync {
    fn tool_type(&self) -> ToolType;
    fn data_dir(&self, profile: &Profile) -> PathBuf;
    async fn list_sessions(&self, profile: &Profile) -> Result<Vec<SessionFile>, String>;
    async fn parse_session(&self, file_path: &PathBuf) -> Result<SessionCost, String>;
    async fn get_live_usage(&self, profile: &Profile, session_id: &str) -> Result<SessionCost, String>;
}

pub struct SessionFile {
    pub path: PathBuf,
    pub session_id: String,
    pub modified_at: i64,
}
