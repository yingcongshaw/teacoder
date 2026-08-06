mod cli;
mod commands;
mod cost;
mod crypto;
mod profile;
mod project;
mod pty;
mod session;
mod storage;
mod tool_settings;

use pty::manager::PtyManager;
use storage::AppDatabase;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db = AppDatabase::new(app.handle())?;
            app.manage(db);

            {
                use crate::session;
                let db_state = app.state::<AppDatabase>();
                session::reset_all_running(&db_state).ok();
            }

            // macOS: 保留原生信号灯按钮，使用 Overlay 标题栏
            #[cfg(target_os = "macos")]
            {
                use tauri::TitleBarStyle;
                let window = app.get_webview_window("main").expect("no main window");
                window.set_decorations(true).ok();
                window.set_title_bar_style(TitleBarStyle::Overlay).ok();
            }

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").expect("no main window");
                window.open_devtools();
            }
            Ok(())
        })
        .manage(PtyManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::cli::detect_cli_tools,
            commands::pty::start_session,
            commands::pty::stop_session,
            commands::pty::write_to_pty,
            commands::pty::resize_pty,
            commands::profile::list_profiles,
            commands::profile::create_profile,
            commands::profile::update_profile,
            commands::profile::delete_profile,
            commands::profile::get_profile_credential,
            commands::profile::store_profile_credential,
            commands::project::project_list,
            commands::project::project_create,
            commands::project::project_update,
            commands::project::project_delete,
            commands::session::session_list,
            commands::session::session_create,
            commands::session::session_update,
            commands::session::session_delete,
            commands::cost::get_session_cost,
            commands::cost::get_profile_cost,
            commands::cost::get_global_cost,
            commands::cost::list_pricing,
            commands::cost::update_pricing,
            commands::cost::scan_costs,
            commands::cost::poll_costs,
            commands::tool_settings::get_tool_settings,
            commands::tool_settings::upsert_tool_settings,
            commands::tool_settings::delete_tool_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
