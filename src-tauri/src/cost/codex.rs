use std::path::PathBuf;

use async_trait::async_trait;

use super::provider::{CostProvider, SessionFile, ToolType};
use super::SessionCost;
use crate::profile::Profile;

pub struct CodexProvider;

#[async_trait]
impl CostProvider for CodexProvider {
    fn tool_type(&self) -> ToolType {
        ToolType::Codex
    }

    fn data_dir(&self, _profile: &Profile) -> PathBuf {
        // TODO: Determine Codex CLI data directory location
        let home = dirs::home_dir().unwrap_or_default();
        home.join(".codex")
    }

    async fn list_sessions(&self, _profile: &Profile) -> Result<Vec<SessionFile>, String> {
        // TODO: Implement Codex session file discovery
        Ok(vec![])
    }

    async fn parse_session(&self, _file_path: &PathBuf) -> Result<SessionCost, String> {
        // TODO: Implement Codex JSONL parsing
        Err("Codex cost parsing not yet implemented".to_string())
    }

    async fn get_live_usage(&self, _profile: &Profile, _session_id: &str) -> Result<SessionCost, String> {
        // TODO: Implement Codex live usage tracking
        Err("Codex live usage not yet implemented".to_string())
    }
}
