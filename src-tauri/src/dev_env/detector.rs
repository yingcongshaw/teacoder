use std::path::{Path, PathBuf};
use std::process::Command;

use super::{SaveDevEnvironmentInput, KIND_JAVA, KIND_NODE};

/// 在 PATH 里找可执行文件。
///
/// 不用 shell out `which`：Windows 上没有这个命令，而 std::env::split_paths
/// 是跨平台的。
pub fn find_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    find_in_paths(name, &path)
}

/// 在指定的 PATH 字符串里找可执行文件。
///
/// 服务启动时要用项目环境的 PATH 去解析命令，否则找到的是系统里另一个版本。
pub fn find_in_paths(name: &str, path: &std::ffi::OsStr) -> Option<PathBuf> {
    for dir in std::env::split_paths(path) {
        if let Some(found) = find_executable_in_dir(&dir, name) {
            return Some(found);
        }
    }
    None
}

fn find_executable_in_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    let direct = dir.join(name);
    if is_executable(&direct) {
        return Some(direct);
    }

    #[cfg(windows)]
    {
        let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".EXE;.CMD;.BAT".to_string());
        for ext in exts.split(';').filter(|e| !e.is_empty()) {
            let candidate = dir.join(format!("{}{}", name, ext.to_lowercase()));
            if candidate.is_file() {
                return Some(candidate);
            }
            let upper = dir.join(format!("{}{}", name, ext));
            if upper.is_file() {
                return Some(upper);
            }
        }
    }

    None
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

/// 判断一个路径是不是某个工具的安装根目录，返回 (根目录, bin 目录)。
///
/// 用户手填路径时可能是根目录（`/usr/lib/jvm/java-21`），也可能直接是
/// 可执行文件（`/usr/local/bin/node`），两种都得认。
pub fn resolve_tool_home(root: &Path, exe_name: &str) -> Option<(PathBuf, PathBuf)> {
    let bin_dir = root.join("bin");
    if is_executable(&bin_dir.join(exe_name)) {
        return Some((root.to_path_buf(), bin_dir));
    }

    if root.is_file() {
        let parent = root.parent()?;
        let file_name = root.file_name()?.to_string_lossy().into_owned();
        if file_name.starts_with(exe_name) {
            let home = parent.parent().unwrap_or(parent);
            return Some((home.to_path_buf(), parent.to_path_buf()));
        }
        return None;
    }

    if is_executable(&root.join(exe_name)) {
        let parent = root.parent()?;
        return Some((parent.to_path_buf(), root.to_path_buf()));
    }

    None
}

/// 展开带 `~` 与末尾 `*` 的候选根目录。
///
/// `~` 展开成用户主目录；末段里的 `*` 匹配同级目录，用来覆盖 `/opt/jdk*`
/// 这类安装位置。
fn expand_roots(patterns: &[String]) -> Vec<PathBuf> {
    let home = dirs::home_dir();
    let mut out = Vec::new();

    for pattern in patterns {
        let expanded = match pattern.strip_prefix("~/") {
            Some(rest) => match &home {
                Some(h) => h.join(rest),
                None => continue,
            },
            None if pattern == "~" => match &home {
                Some(h) => h.clone(),
                None => continue,
            },
            None => PathBuf::from(pattern),
        };

        let file_name = expanded
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();

        if !file_name.contains('*') {
            out.push(expanded);
            continue;
        }

        let parent = match expanded.parent() {
            Some(p) => p.to_path_buf(),
            None => continue,
        };
        let prefix = file_name.split('*').next().unwrap_or("");

        let entries = match std::fs::read_dir(&parent) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(prefix) {
                out.push(entry.path());
            }
        }
    }

    out
}

/// 在候选根目录下找出所有含指定可执行文件的目录。
fn collect_tool_homes(roots: &[String], exe_name: &str) -> Vec<PathBuf> {
    let mut homes = Vec::new();

    for root in expand_roots(roots) {
        if resolve_tool_home(&root, exe_name).is_some() {
            homes.push(root.clone());
        }

        let entries = match std::fs::read_dir(&root) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && resolve_tool_home(&path, exe_name).is_some() {
                homes.push(path);
            }
        }
    }

    homes.sort();
    homes.dedup();
    homes
}

const JDK_ROOTS: &[&str] = &[
    "/usr/lib/jvm",
    "/usr/java",
    "/opt/java",
    "/opt/jdk*",
    "/opt/zulu*",
    "/Library/Java/JavaVirtualMachines",
    "~/.sdkman/candidates/java",
    "~/.jdks",
    "~/.gradle/jdks",
    "C:\\Program Files\\Java",
    "C:\\Program Files\\Eclipse Adoptium",
    "C:\\Program Files\\Microsoft",
    "C:\\Program Files\\Zulu",
];

const MAVEN_ROOTS: &[&str] = &[
    "/opt/maven*",
    "/usr/share/maven",
    "/usr/local/maven*",
    "~/.sdkman/candidates/maven",
    "C:\\Program Files\\Apache\\maven",
    "C:\\apache-maven*",
];

const NODE_ROOTS: &[&str] = &[
    "~/.nvm/versions/node",
    "~/.volta/tools/image/node",
    "/usr/local/n/versions/node",
    "/opt/node*",
    "/usr/local/node*",
    "C:\\Program Files\\nodejs",
    "%APPDATA%\\nvm",
];

fn os_strs(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

/// 解析版本号成数字数组，便于比较大小。
fn version_key(version: &str) -> Vec<u32> {
    version
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .take(3)
        .map(|s| s.parse::<u32>().unwrap_or(0))
        .collect()
}

fn compare_versions_desc(a: &str, b: &str) -> std::cmp::Ordering {
    let ka = version_key(a);
    let kb = version_key(b);
    for i in 0..ka.len().max(kb.len()) {
        let va = ka.get(i).copied().unwrap_or(0);
        let vb = kb.get(i).copied().unwrap_or(0);
        match va.cmp(&vb) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }
    std::cmp::Ordering::Equal
}

/// 执行版本探测命令，把 stdout 和 stderr 合并返回。
fn probe_version(exe: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new(exe).args(args).output().ok()?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push('\n');
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Some(text)
}

fn parse_java_version(text: &str) -> Option<String> {
    // openjdk version "21.0.2" 2024-01-16
    let marker = text.find("version \"")?;
    let rest = &text[marker + "version \"".len()..];
    let end = rest.find('"')?;
    let version = rest[..end].trim();
    if version.is_empty() {
        None
    } else {
        Some(version.to_string())
    }
}

fn parse_maven_version(text: &str) -> Option<String> {
    // Apache Maven 3.9.6 (abc123)
    for line in text.lines() {
        let line = line.trim();
        if let Some(idx) = line.find("Maven ") {
            let rest = line[idx + "Maven ".len()..].trim_start();
            let version: String = rest
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if !version.is_empty() {
                return Some(version);
            }
        }
    }
    None
}

fn parse_node_version(text: &str) -> Option<String> {
    let line = text.lines().map(|l| l.trim()).find(|l| !l.is_empty())?;
    let cleaned = line.strip_prefix('v').unwrap_or(line);
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned.to_string())
    }
}

struct JdkInfo {
    home: PathBuf,
    version: String,
}

struct MavenInfo {
    home: PathBuf,
    version: String,
}

struct NodeInfo {
    exe: PathBuf,
    version: String,
}

fn detect_jdks() -> Vec<JdkInfo> {
    let mut out: Vec<JdkInfo> = Vec::new();

    for home in collect_tool_homes(&os_strs(JDK_ROOTS), "java") {
        let (root, bin_dir) = match resolve_tool_home(&home, "java") {
            Some(v) => v,
            None => continue,
        };
        let exe = bin_dir.join("java");
        let version = match probe_version(&exe, &["-version"]) {
            Some(text) => match parse_java_version(&text) {
                Some(v) => v,
                None => continue,
            },
            None => continue,
        };
        out.push(JdkInfo {
            home: root,
            version,
        });
    }

    // PATH 上的 java 也算一个候选（版本可能比装在标准目录里的更新）
    if let Some(exe) = find_in_path("java") {
        if let Some((root, _)) = resolve_tool_home(&exe, "java") {
            if !out.iter().any(|j| j.home == root) {
                if let Some(text) = probe_version(&exe, &["-version"]) {
                    if let Some(version) = parse_java_version(&text) {
                        out.push(JdkInfo { home: root, version });
                    }
                }
            }
        }
    }

    out.sort_by(|a, b| compare_versions_desc(&a.version, &b.version));
    out.dedup_by(|a, b| a.home == b.home);
    out
}

fn detect_mavens() -> Vec<MavenInfo> {
    let mut out: Vec<MavenInfo> = Vec::new();

    for home in collect_tool_homes(&os_strs(MAVEN_ROOTS), "mvn") {
        let (root, bin_dir) = match resolve_tool_home(&home, "mvn") {
            Some(v) => v,
            None => continue,
        };
        let exe = bin_dir.join("mvn");
        let version = match probe_version(&exe, &["-version"]) {
            Some(text) => match parse_maven_version(&text) {
                Some(v) => v,
                None => continue,
            },
            None => continue,
        };
        out.push(MavenInfo {
            home: root,
            version,
        });
    }

    if let Some(exe) = find_in_path("mvn") {
        if let Some((root, _)) = resolve_tool_home(&exe, "mvn") {
            if !out.iter().any(|m| m.home == root) {
                if let Some(text) = probe_version(&exe, &["-version"]) {
                    if let Some(version) = parse_maven_version(&text) {
                        out.push(MavenInfo { home: root, version });
                    }
                }
            }
        }
    }

    out.sort_by(|a, b| compare_versions_desc(&a.version, &b.version));
    out.dedup_by(|a, b| a.home == b.home);
    out
}

fn detect_nodes() -> Vec<NodeInfo> {
    let mut out: Vec<NodeInfo> = Vec::new();

    for home in collect_tool_homes(&os_strs(NODE_ROOTS), "node") {
        let (_, bin_dir) = match resolve_tool_home(&home, "node") {
            Some(v) => v,
            None => continue,
        };
        let exe = bin_dir.join("node");
        let version = match probe_version(&exe, &["--version"]) {
            Some(text) => match parse_node_version(&text) {
                Some(v) => v,
                None => continue,
            },
            None => continue,
        };
        out.push(NodeInfo { exe, version });
    }

    if let Some(exe) = find_in_path("node") {
        if !out.iter().any(|n| n.exe == exe) {
            if let Some(text) = probe_version(&exe, &["--version"]) {
                if let Some(version) = parse_node_version(&text) {
                    out.push(NodeInfo { exe, version });
                }
            }
        }
    }

    out.sort_by(|a, b| compare_versions_desc(&a.version, &b.version));
    out.dedup_by(|a, b| a.exe == b.exe);
    out
}

/// 扫描系统，产出候选开发环境条目。
pub fn detect(kind: &str) -> Result<Vec<SaveDevEnvironmentInput>, String> {
    match kind {
        KIND_NODE => Ok(detect_nodes()
            .into_iter()
            .map(|n| SaveDevEnvironmentInput {
                kind: KIND_NODE.to_string(),
                name: format!("Node {}", n.version),
                jdk_version: None,
                jdk_path: None,
                maven_version: None,
                maven_path: None,
                node_version: Some(n.version),
                node_path: Some(n.exe.to_string_lossy().into_owned()),
            })
            .collect()),
        KIND_JAVA => {
            let jdks = detect_jdks();
            let mavens = detect_mavens();
            let mut out = Vec::new();

            for jdk in &jdks {
                let (maven_version, maven_path, name) = match mavens.first() {
                    Some(m) => (
                        Some(m.version.clone()),
                        Some(m.home.to_string_lossy().into_owned()),
                        format!("JDK {} + Maven {}", jdk.version, m.version),
                    ),
                    None => (None, None, format!("JDK {}", jdk.version)),
                };
                out.push(SaveDevEnvironmentInput {
                    kind: KIND_JAVA.to_string(),
                    name,
                    jdk_version: Some(jdk.version.clone()),
                    jdk_path: Some(jdk.home.to_string_lossy().into_owned()),
                    maven_version,
                    maven_path,
                    node_version: None,
                    node_path: None,
                });
            }

            // 多个 Maven 时，最新的那个已经配到 JDK 上，其余的各自单独成条
            for maven in mavens.iter().skip(1) {
                out.push(SaveDevEnvironmentInput {
                    kind: KIND_JAVA.to_string(),
                    name: format!("Maven {}", maven.version),
                    jdk_version: None,
                    jdk_path: None,
                    maven_version: Some(maven.version.clone()),
                    maven_path: Some(maven.home.to_string_lossy().into_owned()),
                    node_version: None,
                    node_path: None,
                });
            }

            // 没有 JDK 时，MAVEN 列表的第一条也要单独成条
            if jdks.is_empty() {
                if let Some(maven) = mavens.first() {
                    out.push(SaveDevEnvironmentInput {
                        kind: KIND_JAVA.to_string(),
                        name: format!("Maven {}", maven.version),
                        jdk_version: None,
                        jdk_path: None,
                        maven_version: Some(maven.version.clone()),
                        maven_path: Some(maven.home.to_string_lossy().into_owned()),
                        node_version: None,
                        node_path: None,
                    });
                }
            }

            Ok(out)
        }
        other => Err(format!("未知的开发环境类型: {}", other)),
    }
}
