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
    /// Unix 秒。远端拿不到时为 None。
    pub modified: Option<i64>,
}

/// 列出本地目录。
///
/// 隐藏文件（以 `.` 开头）也列出来 —— 远端用 `ls -A` 是同样口径，两栏对齐。
/// 条目按名称排序，目录排在文件前面（同名时目录优先）。
pub fn list_local_dir(path: &str) -> Result<Vec<DirEntry>, String> {
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
        // 跟随符号链接：指向目录的软链应当能进去。断链读不到元信息，跳过。
        let Ok(meta) = std::fs::metadata(item.path()) else {
            continue;
        };
        entries.push(DirEntry {
            path: item.path().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
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

        let mut entries = list_local_dir(&d.to_string_lossy()).unwrap();
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
        assert!(list_local_dir(&f.to_string_lossy()).is_err());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn missing_directory_is_an_error() {
        assert!(list_local_dir("/definitely/not/here/at/all").is_err());
    }

    #[test]
    fn includes_dotfiles() {
        let d = tmpdir("dot");
        std::fs::write(d.join(".hidden"), b"x").unwrap();
        let entries = list_local_dir(&d.to_string_lossy()).unwrap();
        assert!(entries.iter().any(|e| e.name == ".hidden"));
        std::fs::remove_dir_all(&d).ok();
    }
}
