use std::path::PathBuf;

use async_trait::async_trait;

use super::provider::{CostProvider, SessionFile, ToolType};
use super::SessionCost;
use crate::profile::Profile;

pub struct OpenCodeProvider;

#[async_trait]
impl CostProvider for OpenCodeProvider {
    fn tool_type(&self) -> ToolType {
        ToolType::OpenCode
    }

    fn data_dir(&self, _profile: &Profile) -> PathBuf {
        // TODO: Determine OpenCode data directory location
        let home = dirs::home_dir().unwrap_or_default();
        home.join(".opencode")
    }

    async fn list_sessions(&self, _profile: &Profile) -> Result<Vec<SessionFile>, String> {
        // TODO: Implement OpenCode session file discovery
        Ok(vec![])
    }

    async fn parse_session(&self, _file_path: &PathBuf) -> Result<SessionCost, String> {
        // TODO: Implement OpenCode JSONL parsing
        Err("OpenCode cost parsing not yet implemented".to_string())
    }

    async fn get_live_usage(&self, _profile: &Profile, _session_id: &str) -> Result<SessionCost, String> {
        // TODO: Implement OpenCode live usage tracking
        Err("OpenCode live usage not yet implemented".to_string())
    }
}
