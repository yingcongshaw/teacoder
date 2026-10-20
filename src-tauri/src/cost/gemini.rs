use std::path::{Path, PathBuf};

use async_trait::async_trait;

use super::provider::{CostProvider, SessionFile, ToolType};
use super::SessionCost;
use crate::profile::Profile;

#[allow(dead_code)]
pub struct GeminiProvider;

#[async_trait]
impl CostProvider for GeminiProvider {
    fn tool_type(&self) -> ToolType {
        ToolType::Gemini
    }

    fn data_dir(&self, _profile: &Profile) -> PathBuf {
        // TODO: Determine Gemini CLI data directory location
        let home = dirs::home_dir().unwrap_or_default();
        home.join(".gemini")
    }

    async fn list_sessions(&self, _profile: &Profile) -> Result<Vec<SessionFile>, String> {
        // TODO: Implement Gemini session file discovery
        Ok(vec![])
    }

    async fn parse_session(&self, _file_path: &Path) -> Result<SessionCost, String> {
        // TODO: Implement Gemini JSONL parsing
        Err("Gemini cost parsing not yet implemented".to_string())
    }

    async fn get_live_usage(&self, _profile: &Profile, _session_id: &str) -> Result<SessionCost, String> {
        // TODO: Implement Gemini live usage tracking
        Err("Gemini live usage not yet implemented".to_string())
    }
}
