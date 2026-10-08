use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

const TRAY_ID: &str = "main-tray";

pub fn create_tray(app: &AppHandle) -> Result<(), String> {
    // 如果已存在，先移除
    let _ = app.remove_tray_by_id(TRAY_ID);

    let show_item = MenuItemBuilder::with_id("show", "显示窗口")
        .build(app)
        .map_err(|e| e.to_string())?;
    let about_item = MenuItemBuilder::with_id("about", "关于")
        .build(app)
        .map_err(|e| e.to_string())?;
    let quit_item = MenuItemBuilder::with_id("quit", "退出")
        .build(app)
        .map_err(|e| e.to_string())?;
    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .item(&about_item)
        .separator()
        .item(&quit_item)
        .build()
        .map_err(|e| e.to_string())?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    window.show().ok();
                    window.set_focus().ok();
                }
            }
            "about" => {
                if let Some(window) = app.get_webview_window("main") {
                    window.show().ok();
                    window.set_focus().ok();
                }
                app.emit("settings:open-about", ()).ok();
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    window.show().ok();
                    window.set_focus().ok();
                }
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn destroy_tray(app: &AppHandle) {
    let _ = app.remove_tray_by_id(TRAY_ID);
}

#[allow(dead_code)]
pub fn is_tray_visible(app: &AppHandle) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}
