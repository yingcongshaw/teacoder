use crate::CloseBehavior;
use crate::tray;
use crate::CLOSE_BEHAVIOR;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
pub fn is_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|e| e.to_string())
    } else {
        autolaunch.disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn set_close_behavior(_app: AppHandle, behavior: String) -> Result<(), String> {
    let new_behavior = match behavior.as_str() {
        "minimize" => CloseBehavior::MinimizeToTray,
        "exit" => CloseBehavior::Exit,
        _ => return Err("Invalid close behavior".to_string()),
    };
    *CLOSE_BEHAVIOR.lock().unwrap() = new_behavior;
    Ok(())
}

#[tauri::command]
pub fn get_close_behavior(_app: AppHandle) -> Result<String, String> {
    let behavior = CLOSE_BEHAVIOR.lock().unwrap();
    match behavior.clone() {
        CloseBehavior::MinimizeToTray => Ok("minimize".to_string()),
        CloseBehavior::Exit => Ok("exit".to_string()),
    }
}

#[tauri::command]
pub fn set_tray_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    if visible {
        tray::create_tray(&app)
    } else {
        tray::destroy_tray(&app);
        Ok(())
    }
}
