use crate::cli;

#[tauri::command]
pub fn detect_cli_tools() -> Vec<cli::CliTool> {
    cli::detector::detect_all()
}
