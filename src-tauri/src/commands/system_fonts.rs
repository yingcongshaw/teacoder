use std::path::{Path, PathBuf};

const FONT_EXTENSIONS: &[&str] = &["ttf", "otf", "ttc", "otc"];

fn get_system_font_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            dirs.push(home.join(".fonts"));
            dirs.push(home.join(".local/share/fonts"));
        }
        dirs.push(PathBuf::from("/usr/share/fonts"));
        dirs.push(PathBuf::from("/usr/local/share/fonts"));
        dirs.push(PathBuf::from("/usr/share/fonts/truetype"));
        dirs.push(PathBuf::from("/usr/share/fonts/opentype"));
    }

    #[cfg(target_os = "macos")]
    {
        dirs.push(PathBuf::from("/Library/Fonts"));
        dirs.push(PathBuf::from("/System/Library/Fonts"));
        if let Some(home) = dirs::home_dir() {
            dirs.push(home.join("Library/Fonts"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        dirs.push(PathBuf::from("C:\\Windows\\Fonts"));
        if let Some(appdata) = dirs::data_dir() {
            dirs.push(appdata.join("Microsoft\\Windows\\Fonts"));
        }
    }

    dirs.retain(|d| d.exists());
    dirs
}

fn is_font_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    if let Some(ext) = path.extension() {
        let ext = ext.to_string_lossy().to_lowercase();
        return FONT_EXTENSIONS.contains(&ext.as_str());
    }
    false
}

fn parse_ttf_name(bytes: &[u8]) -> Option<String> {
    use ttf_parser::name_id;

    let face = ttf_parser::Face::parse(bytes, 0).ok()?;

    for name in face.names() {
        if !matches!(name.name_id, name_id::FAMILY) {
            continue;
        }
        if let Some(name_str) = name.to_string() {
            if !name_str.is_empty() {
                return Some(name_str);
            }
        }
    }

    None
}

fn extract_font_name(path: &Path) -> Option<String> {
    if let Some(ext) = path.extension() {
        let ext = ext.to_string_lossy().to_lowercase();
        if ext == "ttf" || ext == "otf" {
            if let Ok(bytes) = std::fs::read(path) {
                if let Some(name) = parse_ttf_name(&bytes) {
                    return Some(name);
                }
            }
        }
    }

    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.replace(['_', '-'], " ").trim().to_string())
        .filter(|s| !s.is_empty())
}

#[tauri::command]
pub fn list_system_fonts() -> Vec<String> {
    let font_dirs = get_system_font_dirs();
    let mut fonts = std::collections::HashSet::new();

    for dir in font_dirs {
        for entry in walkdir::WalkDir::new(&dir)
            .max_depth(4)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            if is_font_file(path) {
                if let Some(name) = extract_font_name(path) {
                    fonts.insert(name);
                }
            }
        }
    }

    let mut result: Vec<String> = fonts.into_iter().collect();
    result.sort();
    result
}