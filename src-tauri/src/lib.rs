mod cli;
mod commands;
mod cost;
mod crypto;
mod profile;
mod project;
mod pty;
mod session;
mod session_category;
mod session_message;
mod storage;
mod tool_settings;
mod tray;

use pty::manager::PtyManager;
use serde::{Deserialize, Serialize};
use storage::AppDatabase;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

use std::sync::Mutex;
use once_cell::sync::Lazy;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum CloseBehavior {
    MinimizeToTray,
    Exit,
}

impl Default for CloseBehavior {
    fn default() -> Self {
        CloseBehavior::Exit
    }
}

static CLOSE_BEHAVIOR: Lazy<Mutex<CloseBehavior>> = Lazy::new(|| Mutex::new(CloseBehavior::default()));

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 当通过自启动唤醒时，显示窗口
            if let Some(window) = app.get_webview_window("main") {
                window.show().ok();
                window.set_focus().ok();
            }
        }))
        .setup(|app| {
            let db = AppDatabase::new(app.handle())?;
            app.manage(db);

            {
                use crate::session;
                let db_state = app.state::<AppDatabase>();
                session::reset_all_running(&db_state).ok();
            }

            // 从数据库加载 close_behavior 设置
            {
                let db_state = app.state::<AppDatabase>();
                let conn = db_state.conn.lock().unwrap();
                if let Ok(value) = conn.query_row(
                    "SELECT value FROM app_settings WHERE key = 'close_behavior'",
                    [],
                    |row| row.get::<_, String>(0),
                ) {
                    let behavior = match value.as_str() {
                        "minimize" => CloseBehavior::MinimizeToTray,
                        "exit" => CloseBehavior::Exit,
                        _ => CloseBehavior::Exit,
                    };
                    *CLOSE_BEHAVIOR.lock().unwrap() = behavior;
                }
            }

            // macOS: 保留原生信号灯按钮，使用 Overlay 标题栏
            #[cfg(target_os = "macos")]
            {
                use tauri::TitleBarStyle;
                let window = app.get_webview_window("main").expect("no main window");
                window.set_decorations(true).ok();
                window.set_title_bar_style(TitleBarStyle::Overlay).ok();
            }

            // 非 macOS: 设置窗口透明以支持圆角
            #[cfg(not(target_os = "macos"))]
            {
                let window = app.get_webview_window("main").expect("no main window");
                window.set_decorations(false).ok();
            }

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").expect("no main window");
                window.open_devtools();
            }

            // 创建系统托盘
            tray::create_tray(app.handle())?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 读取关闭行为设置
                let behavior = CLOSE_BEHAVIOR.lock().unwrap().clone();

                match behavior {
                    CloseBehavior::MinimizeToTray => {
                        // 隐藏到托盘而不是关闭
                        window.hide().ok();
                        api.prevent_close();
                    }
                    CloseBehavior::Exit => {
                        // 允许关闭，程序退出
                    }
                }
            }
        })
        .manage(PtyManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::cli::detect_cli_tools,
            commands::pty::start_session,
            commands::pty::stop_session,
            commands::pty::write_to_pty,
            commands::pty::resize_pty,
            commands::pty::test_ssh_connection,
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
            commands::session_category::category_list,
            commands::session_category::category_create,
            commands::session_category::category_update,
            commands::session_category::category_delete,
            commands::session_message::session_message_list,
            commands::session_message::session_message_create,
            commands::session_message::session_message_delete,
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
            commands::system::is_autostart_enabled,
            commands::system::set_autostart_enabled,
            commands::system::set_close_behavior,
            commands::system::get_close_behavior,
            commands::system::set_tray_visible,
            commands::system::open_path_in_file_manager,
            commands::system::open_terminal,
            commands::system_fonts::list_system_fonts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
