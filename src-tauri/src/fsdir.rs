//! 目录浏览的共享类型与本地目录列举。
//!
//! 文件传输面板左右两栏要列目录内容：左栏是远程（走 SSH），右栏是本地。
//! 两边条目形状一致，前端才能复用同一个列表组件 —— [`DirEntry`] 因此放在
//! 这里这个与传输无关的模块里，远程侧也 import 它。

use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// 目录里的一个条目。远程与本地用同一形状。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    /// 条目名（不含目录）。
    pub name: String,
    /// 完整路径。本地是绝对路径；远程由「远端目录 + 条目名」拼出。
    pub path: String,
    pub is_dir: bool,
    /// 字节数。目录恒为 0 —— 目录大小没有可移植的口径。
    pub size: u64,
    /// 创建时间（Unix 秒）。文件系统不记录 birthtime 时为 None。
    pub created: Option<i64>,
    /// 最后修改时间（Unix 秒）。远端拿不到时为 None。
    pub modified: Option<i64>,
}

/// 列出本地目录。
///
/// `show_hidden` 为 false 时过滤掉以 `.` 开头的条目。远端用 `ls -A` / `find` 是
/// 同样口径，两栏因此可以对齐。
/// 条目按名称排序，目录排在文件前面（同名时目录优先）。
pub fn list_local_dir(path: &str, show_hidden: bool) -> Result<Vec<DirEntry>, String> {
    let dir = Path::new(path);
    let meta = std::fs::metadata(dir).map_err(|e| format!("无法访问目录 {path}: {e}"))?;
    if !meta.is_dir() {
        return Err(format!("{path} 不是目录"));
    }

    let mut entries: Vec<DirEntry> = Vec::new();
    let rd = std::fs::read_dir(dir).map_err(|e| format!("读取目录 {path} 失败: {e}"))?;
    for item in rd {
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().into_owned();
        if !show_hidden && name.starts_with('.') {
            continue;
        }
        // 跟随符号链接：指向目录的软链应当能进去。断链读不到元信息，跳过。
        let Ok(meta) = std::fs::metadata(item.path()) else {
            continue;
        };
        entries.push(DirEntry {
            path: item.path().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            // 很多文件系统不记 birthtime，拿不到就是 None，不猜。
            created: meta
                .created()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64),
            modified: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64),
            name,
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// 删除本地文件或目录（目录递归删）。
///
/// **破坏性操作** —— 调用方必须先弹确认框。
/// 根目录与空路径一律拒绝：路径是从界面来的，不能让它变成「删掉一切」。
pub fn delete_local(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return Err("拒绝删除根目录".to_string());
    }
    let p = Path::new(trimmed);
    let meta = std::fs::metadata(p).map_err(|e| format!("无法访问 {trimmed}: {e}"))?;
    if meta.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| format!("删除目录 {trimmed} 失败: {e}"))
    } else {
        std::fs::remove_file(p).map_err(|e| format!("删除文件 {trimmed} 失败: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!(
            "teacoder-fsdir-{}-{}",
            tag,
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn lists_files_and_subdirectories() {
        let d = tmpdir("list");
        std::fs::write(d.join("b.txt"), b"hello").unwrap();
        std::fs::create_dir_all(d.join("a_dir")).unwrap();

        let mut entries = list_local_dir(&d.to_string_lossy(), true).unwrap();
        entries.sort_by(|a, b| a.name.cmp(&b.name));

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "a_dir");
        assert!(entries[0].is_dir);
        assert_eq!(entries[0].size, 0, "目录大小恒为 0");
        assert_eq!(entries[1].name, "b.txt");
        assert!(!entries[1].is_dir);
        assert_eq!(entries[1].size, 5);

        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn rejects_a_file_path() {
        let d = tmpdir("notdir");
        let f = d.join("x.txt");
        std::fs::write(&f, b"x").unwrap();
        assert!(list_local_dir(&f.to_string_lossy(), true).is_err());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn missing_directory_is_an_error() {
        assert!(list_local_dir("/definitely/not/here/at/all", true).is_err());
    }

    #[test]
    fn includes_dotfiles() {
        let d = tmpdir("dot");
        std::fs::write(d.join(".hidden"), b"x").unwrap();
        let entries = list_local_dir(&d.to_string_lossy(), true).unwrap();
        assert!(entries.iter().any(|e| e.name == ".hidden"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn deletes_a_file_and_a_directory() {
        let d = tmpdir("del");
        let f = d.join("x.txt");
        std::fs::write(&f, b"x").unwrap();
        let sub = d.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("y.txt"), b"y").unwrap();

        delete_local(&f.to_string_lossy()).unwrap();
        assert!(!f.exists());
        delete_local(&sub.to_string_lossy()).unwrap();
        assert!(!sub.exists());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn refuses_to_delete_the_root() {
        assert!(delete_local("/").is_err());
        assert!(delete_local("  ").is_err());
    }

    #[test]
    fn hides_dotfiles_when_asked() {
        let d = tmpdir("nodot");
        std::fs::write(d.join(".hidden"), b"x").unwrap();
        std::fs::write(d.join("shown"), b"x").unwrap();
        let entries = list_local_dir(&d.to_string_lossy(), false).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "shown");
        std::fs::remove_dir_all(&d).ok();
    }
}
