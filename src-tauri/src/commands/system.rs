use crate::CloseBehavior;
use crate::tray;
use crate::CLOSE_BEHAVIOR;
use crate::storage::AppDatabase;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;
use std::path::Path;

const SETTING_KEY_CLOSE_BEHAVIOR: &str = "close_behavior";

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
pub fn set_close_behavior(app: AppHandle, behavior: String) -> Result<(), String> {
    let new_behavior = match behavior.as_str() {
        "minimize" => CloseBehavior::MinimizeToTray,
        "exit" => CloseBehavior::Exit,
        _ => return Err("Invalid close behavior".to_string()),
    };

    // 更新内存
    *CLOSE_BEHAVIOR.lock().unwrap() = new_behavior.clone();

    // 持久化到数据库
    let db = app.state::<AppDatabase>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
        (&SETTING_KEY_CLOSE_BEHAVIOR, &behavior, &now),
    )
    .map_err(|e| format!("Failed to save close behavior: {}", e))?;

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

#[tauri::command]
pub fn open_path_in_file_manager(_app: AppHandle, path: String) -> Result<(), String> {
    let path = Path::new(&path);
    let path_str = path.to_string_lossy();

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(path_str.as_ref())
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg(path_str.as_ref())
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        // 优先使用 xdg-open，如果失败则尝试其他文件管理器
        let result = Command::new("xdg-open")
            .arg(path_str.as_ref())
            .spawn();

        if result.is_err() {
            // 尝试常见文件管理器
            let managers = ["nautilus", "dolphin", "thunar", "pcmanfm", "caja", "nemo"];
            for manager in managers {
                if Command::new(manager).arg(path_str.as_ref()).spawn().is_ok() {
                    return Ok(());
                }
            }
            return Err("无法找到合适的文件管理器".to_string());
        }
    }

    Ok(())
}

#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    let path_str = path.to_string_lossy();

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("cmd")
            .args(["/c", "start", "cmd", "/k", &format!("cd /d {}", path_str)])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("osascript")
            .args(["-e", &format!("tell application \"Terminal\" to do script \"cd {}\"", path_str)])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;

        // 尝试常见终端模拟器
        let cd_cmd = format!("cd '{}' && exec $SHELL", path_str);

        let terminals: Vec<(&str, Vec<&str>)> = vec![
            ("gnome-terminal", vec!["--", "bash", "-c", &cd_cmd]),
            ("konsole", vec!["--hold", "-e", "bash", "-c", &cd_cmd]),
            ("xfce4-terminal", vec!["--hold", "-e", "bash", "-c", &cd_cmd]),
            ("xterm", vec!["-hold", "-e", "bash", "-c", &cd_cmd]),
            ("tilix", vec!["--hold", "-e", "bash", "-c", &cd_cmd]),
            ("terminator", vec!["--hold", "-e", "bash", "-c", &cd_cmd]),
        ];

        for (name, args) in terminals {
            if Command::new(name).args(&args).spawn().is_ok() {
                return Ok(());
            }
        }
    }

    Ok(())
}
