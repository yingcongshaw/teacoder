use std::path::{Path, PathBuf};
use std::process::Command;

use super::{
    DevTool, SaveDevEnvironmentInput, KIND_CPP, KIND_DOTNET, KIND_GO, KIND_JAVA, KIND_NODE,
    KIND_PYTHON, KIND_RUST, TOOL_CARGO, TOOL_CC, TOOL_CMAKE, TOOL_DOTNET, TOOL_GO, TOOL_JDK,
    TOOL_MAVEN, TOOL_MSBUILD, TOOL_NODE, TOOL_PYTHON,
};

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

const DOTNET_ROOTS: &[&str] = &[
    "/usr/share/dotnet",
    "/usr/lib/dotnet",
    "/opt/dotnet*",
    "~/.dotnet",
    "C:\\Program Files\\dotnet",
];

const PYTHON_ROOTS: &[&str] = &[
    "~/.pyenv/versions",
    "~/miniconda3",
    "~/anaconda3",
    "/opt/conda",
    "/usr/local",
    "/usr",
];

const RUST_ROOTS: &[&str] = &["~/.rustup/toolchains", "~/.cargo", "/usr/local/rustup"];

const GO_ROOTS: &[&str] = &[
    "/usr/local/go",
    "/usr/lib/go*",
    "/opt/go*",
    "/opt/homebrew/opt/go*",
    "C:\\Program Files\\Go",
];

const CMAKE_ROOTS: &[&str] = &[
    "/usr/local",
    "/opt/cmake*",
    "/opt",
    "C:\\Program Files\\CMake",
    "C:\\Program Files (x86)\\CMake",
];

const CC_ROOTS: &[&str] = &["/usr/local/bin", "/usr/bin", "/opt", "C:\\Program Files"];

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
        // 反向比较：版本号大的排在前面
        match vb.cmp(&va) {
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

/// 从文本里取出第一个形如 `1.2.3` 的版本片段。
fn first_version_token(text: &str) -> Option<String> {
    for token in text.split_whitespace() {
        let cleaned = token.trim_matches(|c: char| !c.is_ascii_digit() && c != '.');
        if cleaned.contains('.') && cleaned.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            return Some(cleaned.to_string());
        }
    }
    None
}

/// Python 版本：Python 3.12.3
fn parse_python_version(text: &str) -> Option<String> {
    let line = text.lines().map(|l| l.trim()).find(|l| !l.is_empty())?;
    let cleaned = line.strip_prefix("Python ").unwrap_or(line);
    let version: String = cleaned
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

/// Rust 版本：rustc 1.75.0 (82e1608df 2023-12-21)
fn parse_rust_version(text: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        // 探测用的是 `cargo --version`，输出是 "cargo 1.97.1 (...)"；
        // rustc 的输出是 "rustc 1.97.1 (...)"，两种都得认。
        let rest = match line.strip_prefix("cargo ").or_else(|| line.strip_prefix("rustc ")) {
            Some(r) => r,
            None => continue,
        };
        let version: String = rest
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        if !version.is_empty() {
            return Some(version);
        }
    }
    None
}

/// Go 版本：go version go1.22.0 linux/amd64
fn parse_go_version(text: &str) -> Option<String> {
    let line = text.lines().map(|l| l.trim()).find(|l| !l.is_empty())?;
    for token in line.split_whitespace() {
        let cleaned = token.strip_prefix("go").unwrap_or(token);
        if cleaned.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            return Some(cleaned.to_string());
        }
    }
    None
}

/// .NET SDK 版本：8.0.404 [/usr/share/dotnet/sdk]
fn parse_dotnet_version(line: &str) -> Option<String> {
    let token = line.split_whitespace().next()?;
    if token.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        Some(token.to_string())
    } else {
        None
    }
}

/// .NET SDK 列表里的所有版本，取最新的一个。
fn parse_dotnet_sdks(text: &str) -> Vec<String> {
    let mut versions: Vec<String> = text
        .lines()
        .filter_map(parse_dotnet_version)
        .collect();
    versions.sort_by(|a, b| compare_versions_desc(a, b));
    versions.dedup();
    versions
}

/// 扫描候选根目录 + PATH，找出所有可执行文件及其版本。
fn scan_tool_candidates(
    roots: &[&str],
    exe_names: &[&str],
    version_args: &[&str],
    parse: &dyn Fn(&str) -> Option<String>,
) -> Vec<(PathBuf, String)> {
    let mut out: Vec<(PathBuf, String)> = Vec::new();

    let record = |exe: PathBuf, out: &mut Vec<(PathBuf, String)>| {
        if out.iter().any(|(p, _)| *p == exe) {
            return;
        }
        if let Some(text) = probe_version(&exe, version_args) {
            if let Some(version) = parse(&text) {
                out.push((exe, version));
            }
        }
    };

    for exe_name in exe_names {
        for home in collect_tool_homes(&os_strs(roots), exe_name) {
            let (_, bin_dir) = match resolve_tool_home(&home, exe_name) {
                Some(v) => v,
                None => continue,
            };
            record(bin_dir.join(exe_name), &mut out);
        }

        if let Some(exe) = find_in_path(exe_name) {
            record(exe, &mut out);
        }
    }

    out.sort_by(|a, b| compare_versions_desc(&a.1, &b.1));
    out
}

fn tool(tool: &str, version: &str, path: &Path) -> DevTool {
    DevTool {
        tool: tool.to_string(),
        version: Some(version.to_string()),
        path: Some(path.to_string_lossy().into_owned()),
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
                        out.push(MavenInfo {
                            home: root,
                            version,
                        });
                    }
                }
            }
        }
    }

    out.sort_by(|a, b| compare_versions_desc(&a.version, &b.version));
    out.dedup_by(|a, b| a.home == b.home);
    out
}

/// 识别 .NET SDK 与 .NET Framework 的 MSBuild。
///
/// .NET Core / 5+ 走 `dotnet` 命令；.NET Framework 只在 Windows 上有，
/// 用它自带的 MSBuild 编译老项目。
fn detect_dotnets() -> Vec<SaveDevEnvironmentInput> {
    let mut out = Vec::new();

    let sdks = scan_tool_candidates(
        DOTNET_ROOTS,
        &["dotnet"],
        &["--list-sdks"],
        &|text| parse_dotnet_sdks(text).first().cloned(),
    );

    // .NET Framework 的 MSBuild：Windows 系统目录下的 v4.0.30319
    let framework_msbuild = [
        "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\MSBuild.exe",
        "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\MSBuild.exe",
    ]
    .iter()
    .map(PathBuf::from)
    .find(|p| p.is_file());

    if let Some((exe, version)) = sdks.first() {
        let mut tools = vec![tool(TOOL_DOTNET, version, exe)];
        let mut name = format!(".NET SDK {}", version);

        if let Some(msbuild) = &framework_msbuild {
            tools.push(DevTool {
                tool: TOOL_MSBUILD.to_string(),
                version: None,
                path: Some(msbuild.to_string_lossy().into_owned()),
            });
            name.push_str(" + .NET Framework");
        }

        out.push(SaveDevEnvironmentInput {
            kind: KIND_DOTNET.to_string(),
            name,
            tools,
        });
    } else if let Some(msbuild) = &framework_msbuild {
        out.push(SaveDevEnvironmentInput {
            kind: KIND_DOTNET.to_string(),
            name: ".NET Framework".to_string(),
            tools: vec![DevTool {
                tool: TOOL_MSBUILD.to_string(),
                version: None,
                path: Some(msbuild.to_string_lossy().into_owned()),
            }],
        });
    }

    out
}

/// 识别 Python 解释器。
fn detect_pythons() -> Vec<SaveDevEnvironmentInput> {
    scan_tool_candidates(
        PYTHON_ROOTS,
        &["python3", "python"],
        &["--version"],
        &parse_python_version,
    )
    .into_iter()
    .map(|(exe, version)| SaveDevEnvironmentInput {
        kind: KIND_PYTHON.to_string(),
        name: format!("Python {}", version),
        tools: vec![tool(TOOL_PYTHON, &version, &exe)],
    })
    .collect()
}

/// 识别 Rust 工具链。
fn detect_rusts() -> Vec<SaveDevEnvironmentInput> {
    scan_tool_candidates(
        RUST_ROOTS,
        &["cargo"],
        &["--version"],
        &parse_rust_version,
    )
    .into_iter()
    .map(|(exe, version)| SaveDevEnvironmentInput {
        kind: KIND_RUST.to_string(),
        name: format!("Rust {}", version),
        tools: vec![tool(TOOL_CARGO, &version, &exe)],
    })
    .collect()
}

/// 识别 Go 工具链。路径存 GOROOT（`go env GOROOT` 的输出），不是可执行文件。
fn detect_gos() -> Vec<SaveDevEnvironmentInput> {
    let candidates = scan_tool_candidates(GO_ROOTS, &["go"], &["version"], &parse_go_version);

    let mut out = Vec::new();
    for (exe, version) in candidates {
        let root = probe_version(&exe, &["env", "GOROOT"])
            .map(|text| {
                text.lines()
                    .map(|l| l.trim())
                    .find(|l| !l.is_empty())
                    .map(PathBuf::from)
            })
            .unwrap_or(None)
            .filter(|p| p.is_dir())
            .or_else(|| {
                exe.parent()
                    .and_then(|bin| bin.parent())
                    .filter(|p| p.is_dir())
                    .map(|p| p.to_path_buf())
            });

        let root = match root {
            Some(r) => r,
            None => continue,
        };

        out.push(SaveDevEnvironmentInput {
            kind: KIND_GO.to_string(),
            name: format!("Go {}", version),
            tools: vec![tool(TOOL_GO, &version, &root)],
        });
    }

    out
}

/// 识别 C/C++ 工具链：CMake 加一个 C 编译器。
fn detect_cpps() -> Vec<SaveDevEnvironmentInput> {
    let cmakes = scan_tool_candidates(CMAKE_ROOTS, &["cmake"], &["--version"], &first_version_token);
    let compilers = scan_tool_candidates(CC_ROOTS, &["gcc", "clang", "cc"], &["--version"], &first_version_token);

    let mut tools: Vec<DevTool> = Vec::new();
    let mut names: Vec<String> = Vec::new();

    if let Some((exe, version)) = cmakes.first() {
        tools.push(tool(TOOL_CMAKE, version, exe));
        names.push(format!("CMake {}", version));
    }
    if let Some((exe, version)) = compilers.first() {
        tools.push(tool(TOOL_CC, version, exe));
        names.push(format!("编译器 {}", version));
    }

    if tools.is_empty() {
        return Vec::new();
    }

    vec![SaveDevEnvironmentInput {
        kind: KIND_CPP.to_string(),
        name: names.join(" + "),
        tools,
    }]
}

/// 扫描系统，产出候选开发环境条目。
pub fn detect(kind: &str) -> Result<Vec<SaveDevEnvironmentInput>, String> {
    match kind {
        KIND_NODE => {
            let candidates = scan_tool_candidates(
                NODE_ROOTS,
                &["node"],
                &["--version"],
                &parse_node_version,
            );
            Ok(candidates
                .into_iter()
                .map(|(exe, version)| SaveDevEnvironmentInput {
                    kind: KIND_NODE.to_string(),
                    name: format!("Node {}", version),
                    tools: vec![tool(TOOL_NODE, &version, &exe)],
                })
                .collect())
        }
        KIND_JAVA => {
            let jdks = detect_jdks();
            let mavens = detect_mavens();
            let mut out = Vec::new();

            for jdk in &jdks {
                let mut tools = vec![tool(TOOL_JDK, &jdk.version, &jdk.home)];
                let mut name = format!("JDK {}", jdk.version);

                // 默认配最新的 Maven
                if let Some(maven) = mavens.first() {
                    tools.push(tool(TOOL_MAVEN, &maven.version, &maven.home));
                    name = format!("JDK {} + Maven {}", jdk.version, maven.version);
                }

                out.push(SaveDevEnvironmentInput {
                    kind: KIND_JAVA.to_string(),
                    name,
                    tools,
                });
            }

            // 多个 Maven 时，最新的那个已经配到 JDK 上，其余的各自单独成条
            for maven in mavens.iter().skip(1) {
                out.push(SaveDevEnvironmentInput {
                    kind: KIND_JAVA.to_string(),
                    name: format!("Maven {}", maven.version),
                    tools: vec![tool(TOOL_MAVEN, &maven.version, &maven.home)],
                });
            }

            // 没有 JDK 时，Maven 也要单独成条
            if jdks.is_empty() {
                if let Some(maven) = mavens.first() {
                    out.push(SaveDevEnvironmentInput {
                        kind: KIND_JAVA.to_string(),
                        name: format!("Maven {}", maven.version),
                        tools: vec![tool(TOOL_MAVEN, &maven.version, &maven.home)],
                    });
                }
            }

            Ok(out)
        }
        KIND_DOTNET => Ok(detect_dotnets()),
        KIND_PYTHON => Ok(detect_pythons()),
        KIND_RUST => Ok(detect_rusts()),
        KIND_GO => Ok(detect_gos()),
        KIND_CPP => Ok(detect_cpps()),
        other => Err(format!("未知的开发环境类型: {}", other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_version_strings() {
        assert_eq!(parse_java_version("openjdk version \"21.0.2\" 2024-01-16").as_deref(), Some("21.0.2"));
        assert_eq!(parse_maven_version("Apache Maven 3.9.6 (abc123)").as_deref(), Some("3.9.6"));
        assert_eq!(parse_python_version("Python 3.12.3").as_deref(), Some("3.12.3"));
        assert_eq!(
            parse_rust_version("rustc 1.75.0 (82e1608df 2023-12-21)").as_deref(),
            Some("1.75.0")
        );
        assert_eq!(
            parse_rust_version("cargo 1.75.0 (82e1608df 2023-12-21)").as_deref(),
            Some("1.75.0")
        );
        assert_eq!(
            parse_go_version("go version go1.22.0 linux/amd64").as_deref(),
            Some("1.22.0")
        );
        assert_eq!(parse_dotnet_version("8.0.404 [/usr/share/dotnet/sdk]").as_deref(), Some("8.0.404"));
        assert_eq!(first_version_token("cmake version 3.28.3").as_deref(), Some("3.28.3"));
    }

    #[test]
    fn dotnet_sdk_list_takes_the_newest() {
        let versions = parse_dotnet_sdks("6.0.428 [/usr/share/dotnet/sdk]\n8.0.404 [/usr/share/dotnet/sdk]");
        assert_eq!(versions.first().map(String::as_str), Some("8.0.404"));
    }

    #[test]
    fn every_kind_is_detectable() {
        for kind in [
            KIND_JAVA,
            KIND_NODE,
            KIND_DOTNET,
            KIND_PYTHON,
            KIND_RUST,
            KIND_GO,
            KIND_CPP,
        ] {
            // 机器上装没装都不要紧：不能因为没装就报错
            assert!(detect(kind).is_ok(), "{kind} 识别失败");
        }
    }
}
