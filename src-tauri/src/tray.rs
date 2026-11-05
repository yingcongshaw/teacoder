use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use tauri::{
    menu::{MenuBuilder, MenuItem, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};

#[cfg(target_os = "linux")]
use gtk::prelude::GtkWindowExt;

const TRAY_ID: &str = "main-tray";

const LABEL_MAXIMIZE: &str = "最大化窗口";
const LABEL_MINIMIZE: &str = "最小化窗口";
const LABEL_RESTORE: &str = "还原窗口";

/// 托盘菜单里跟窗口状态联动的项：菜单项句柄 + 当前显示的文字。
/// 菜单项句柄要留着，才能在窗口状态变化时改文字。
type StateMenuItem = (MenuItem<Wry>, String);

static MAXIMIZE_ITEM: Lazy<Mutex<Option<StateMenuItem>>> = Lazy::new(|| Mutex::new(None));
static MINIMIZE_ITEM: Lazy<Mutex<Option<StateMenuItem>>> = Lazy::new(|| Mutex::new(None));

/// 状态轮询只启动一次，避免托盘重建时叠加多个任务。
static POLLER_STARTED: AtomicBool = AtomicBool::new(false);

pub fn create_tray(app: &AppHandle) -> Result<(), String> {
    // 如果已存在，先移除
    let _ = app.remove_tray_by_id(TRAY_ID);

    let maximize_item = MenuItemBuilder::with_id("maximize", LABEL_MAXIMIZE)
        .build(app)
        .map_err(|e| e.to_string())?;
    let minimize_item = MenuItemBuilder::with_id("minimize", LABEL_MINIMIZE)
        .build(app)
        .map_err(|e| e.to_string())?;
    let about_item = MenuItemBuilder::with_id("about", "关于")
        .build(app)
        .map_err(|e| e.to_string())?;
    let quit_item = MenuItemBuilder::with_id("quit", "退出")
        .build(app)
        .map_err(|e| e.to_string())?;
    let menu = MenuBuilder::new(app)
        .item(&maximize_item)
        .item(&minimize_item)
        .separator()
        .item(&about_item)
        .separator()
        .item(&quit_item)
        .build()
        .map_err(|e| e.to_string())?;

    *MAXIMIZE_ITEM.lock().map_err(|e| e.to_string())? =
        Some((maximize_item, LABEL_MAXIMIZE.to_string()));
    *MINIMIZE_ITEM.lock().map_err(|e| e.to_string())? =
        Some((minimize_item, LABEL_MINIMIZE.to_string()));
    sync_window_labels(app);

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "maximize" => {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_minimized().unwrap_or(false) {
                        // 最小化状态下点这一项：先还原，再最大化
                        restore_window(app);
                        window.maximize().ok();
                    } else if window.is_maximized().unwrap_or(false) {
                        window.unmaximize().ok();
                        window.set_focus().ok();
                    } else {
                        window.maximize().ok();
                        window.set_focus().ok();
                    }
                }
                sync_window_labels(app);
            }
            "minimize" => {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_minimized().unwrap_or(false) {
                        restore_window(app);
                    } else {
                        window.minimize().ok();
                    }
                }
                sync_window_labels(app);
            }
            "about" => {
                restore_window(app);
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
                restore_window(tray.app_handle());
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    spawn_state_poller(app);

    Ok(())
}

pub fn destroy_tray(app: &AppHandle) {
    let _ = app.remove_tray_by_id(TRAY_ID);
    // 菜单项句柄跟着托盘一起失效，留着会让改文字时操作到旧菜单
    if let Ok(mut guard) = MAXIMIZE_ITEM.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = MINIMIZE_ITEM.lock() {
        *guard = None;
    }
}

/// 把窗口拉回前台，必要时先取消最小化。
fn restore_window(app: &AppHandle) {
    // Linux 上 GTK 的 deiconify 只是 XMapWindow，窗口被窗口管理器收起后这条路拉不回来，
    // 得用 present() 让窗口管理器自己把它还原并置前
    #[cfg(target_os = "linux")]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(window) = handle.get_webview_window("main") {
                if let Ok(gtk_window) = window.gtk_window() {
                    gtk_window.present();
                }
            }
        });
    }

    if let Some(window) = app.get_webview_window("main") {
        window.unminimize().ok();
        window.show().ok();
        window.set_focus().ok();
    }
}

/// 同步托盘菜单里跟窗口状态联动的两项文字。
///
/// 「最大化窗口」在窗口最大化时变成「还原窗口」；「最小化窗口」在窗口已最小化时变成「还原窗口」。
/// 窗口既最大化又最小化时，最大化那项不显示「还原窗口」—— 两项都叫同一个名字会分不清该点哪个。
pub fn sync_window_labels(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let minimized = window.is_minimized().unwrap_or(false);
    let maximized = window.is_maximized().unwrap_or(false);

    let maximize_text = if maximized && !minimized {
        LABEL_RESTORE
    } else {
        LABEL_MAXIMIZE
    };
    let minimize_text = if minimized {
        LABEL_RESTORE
    } else {
        LABEL_MINIMIZE
    };

    set_item_text(&MAXIMIZE_ITEM, maximize_text);
    set_item_text(&MINIMIZE_ITEM, minimize_text);
}

fn set_item_text(slot: &Mutex<Option<StateMenuItem>>, desired: &str) {
    let Ok(mut guard) = slot.lock() else {
        return;
    };
    let Some((item, current)) = guard.as_mut() else {
        return;
    };
    if *current == desired {
        return;
    }
    item.set_text(desired).ok();
    *current = desired.to_string();
}

/// 轮询窗口状态并刷新菜单文字。
///
/// Tauri 没有「窗口最小化 / 还原」的事件，Linux 下最小化也不会触发 Resized，
/// 只能定时查一次窗口状态。
fn spawn_state_poller(app: &AppHandle) {
    if POLLER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(500));
        loop {
            ticker.tick().await;
            sync_window_labels(&app);
        }
    });
}

#[allow(dead_code)]
pub fn is_tray_visible(app: &AppHandle) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}
