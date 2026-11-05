use std::path::{Path, PathBuf};

use crate::dev_env::DevEnvironment;

/// 扫描项目目录时跳过的目录。
const SKIP_DIRS: &[&str] = &[
    "target",
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "build",
    "dist",
    "out",
    ".idea",
    ".gradle",
    ".venv",
    "__pycache__",
];

/// 扫描深度上限。多模块项目通常不超过三四层。
const MAX_DEPTH: usize = 6;

/// 识别出来的服务（还没入库）。
#[derive(Debug, Clone)]
pub struct DetectedService {
    pub name: String,
    pub kind: String,
    pub command: String,
    pub working_dir: String,
}

/// 在项目里找出所有能跑的服务。
///
/// java_env / node_env 用来判断这台机器上到底有没有 mvn / npm 可用 ——
/// 没有构建工具的话，扫出来的 Maven 服务点了也起不来。
pub fn detect_services(
    root: &Path,
    java_env: Option<&DevEnvironment>,
    node_env: Option<&DevEnvironment>,
) -> Vec<DetectedService> {
    let mut out = Vec::new();

    if maven_available(java_env) {
        out.extend(detect_maven_services(root));
        out.extend(detect_gradle_services(root));
    }

    if node_available(node_env) {
        out.extend(detect_node_services(root));
    }

    out
}

fn maven_available(java_env: Option<&DevEnvironment>) -> bool {
    if let Some(env) = java_env {
        if let Some(path) = env.maven_path.as_ref().filter(|p| !p.trim().is_empty()) {
            if crate::dev_env::detector::resolve_tool_home(Path::new(path.trim()), "mvn").is_some() {
                return true;
            }
        }
    }
    crate::dev_env::detector::find_in_path("mvn").is_some()
}

fn node_available(node_env: Option<&DevEnvironment>) -> bool {
    if node_env.is_some() {
        return true;
    }
    crate::dev_env::detector::find_in_path("node").is_some()
}

/// 找出项目里所有指定名的清单文件。
fn find_manifests(root: &Path, names: &[&str]) -> Vec<PathBuf> {
    let mut out = Vec::new();

    let walker = walkdir::WalkDir::new(root)
        .max_depth(MAX_DEPTH)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            !SKIP_DIRS.contains(&name.as_ref())
        });

    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if names.contains(&name.as_ref()) {
            out.push(entry.path().to_path_buf());
        }
    }

    out.sort();
    out
}

/// 去掉 <parent> 块，免得把父 POM 的 artifactId 当成模块自己的。
fn strip_parent_block(xml: &str) -> String {
    match (xml.find("<parent>"), xml.find("</parent>")) {
        (Some(start), Some(end)) if end > start => {
            let mut out = String::with_capacity(xml.len());
            out.push_str(&xml[..start]);
            out.push_str(&xml[end + "</parent>".len()..]);
            out
        }
        _ => xml.to_string(),
    }
}

fn extract_artifact_id(xml: &str) -> Option<String> {
    let cleaned = strip_parent_block(xml);
    let start = cleaned.find("<artifactId>")? + "<artifactId>".len();
    let rest = &cleaned[start..];
    let end = rest.find("</artifactId>")?;
    let value = rest[..end].trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn is_spring_boot_pom(xml: &str) -> bool {
    xml.contains("spring-boot-starter") || xml.contains("spring-boot-maven-plugin")
}

/// 在模块的 src/main/java 下找带 main 方法的类，返回全限定类名。
fn find_main_class(module_dir: &Path) -> Option<String> {
    let java_root = module_dir.join("src").join("main").join("java");
    if !java_root.is_dir() {
        return None;
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    let walker = walkdir::WalkDir::new(&java_root)
        .max_depth(12)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            !SKIP_DIRS.contains(&name.as_ref())
        });

    for entry in walker.flatten() {
        if entry.file_type().is_file() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "java") {
                candidates.push(path.to_path_buf());
            }
        }
    }
    candidates.sort();

    for path in candidates {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        if !text.contains("public static void main") {
            continue;
        }
        let Ok(rel) = path.strip_prefix(&java_root) else {
            continue;
        };
        let without_ext = rel.with_extension("");
        let fqcn = without_ext
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(".");
        if fqcn.is_empty() {
            continue;
        }
        return Some(fqcn);
    }

    None
}

fn detect_maven_services(root: &Path) -> Vec<DetectedService> {
    let mut out = Vec::new();

    for pom in find_manifests(root, &["pom.xml"]) {
        let Ok(text) = std::fs::read_to_string(&pom) else {
            continue;
        };
        if !is_spring_boot_pom(&text) {
            continue;
        }

        let module_dir = match pom.parent() {
            Some(dir) => dir.to_path_buf(),
            None => continue,
        };

        let name = extract_artifact_id(&text)
            .or_else(|| {
                module_dir
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
            })
            .unwrap_or_else(|| "spring-boot".to_string());

        // 在模块目录里跑 mvn：Maven 会顺 relativePath 找到父 POM，
        // 比从根目录 -pl 更稳（不需要父 POM 已 install 到本地仓库）。
        let mut command = String::from("mvn spring-boot:run");
        if let Some(main_class) = find_main_class(&module_dir) {
            command.push_str(&format!(" -Dspring-boot.run.mainClass={}", main_class));
        }

        out.push(DetectedService {
            name,
            kind: crate::services::KIND_JAVA.to_string(),
            command,
            working_dir: module_dir.to_string_lossy().into_owned(),
        });
    }

    out
}

fn detect_gradle_services(root: &Path) -> Vec<DetectedService> {
    let mut out = Vec::new();

    let gradlew = root.join(if cfg!(windows) { "gradlew.bat" } else { "gradlew" });

    for build_file in find_manifests(root, &["build.gradle", "build.gradle.kts"]) {
        let Ok(text) = std::fs::read_to_string(&build_file) else {
            continue;
        };
        if !text.contains("org.springframework.boot") {
            continue;
        }

        let module_dir = match build_file.parent() {
            Some(dir) => dir.to_path_buf(),
            None => continue,
        };

        let rel = module_dir.strip_prefix(root).unwrap_or(&module_dir);
        let module_path = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(":");

        let task = if module_path.is_empty() {
            "bootRun".to_string()
        } else {
            format!(":{}:bootRun", module_path)
        };

        let command = if gradlew.is_file() {
            let program = if cfg!(windows) { "gradlew.bat" } else { "./gradlew" };
            format!("{} {}", program, task)
        } else {
            format!("gradle {}", task)
        };

        let name = module_dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "bootRun".to_string());

        out.push(DetectedService {
            name,
            kind: crate::services::KIND_JAVA.to_string(),
            command,
            working_dir: root.to_string_lossy().into_owned(),
        });
    }

    out
}

fn detect_node_services(root: &Path) -> Vec<DetectedService> {
    let mut out = Vec::new();

    for pkg_file in find_manifests(root, &["package.json"]) {
        let Ok(text) = std::fs::read_to_string(&pkg_file) else {
            continue;
        };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };

        let pkg_dir = match pkg_file.parent() {
            Some(dir) => dir.to_path_buf(),
            None => continue,
        };

        let pkg_name = json
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                pkg_dir
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
            })
            .unwrap_or_else(|| "app".to_string());

        let scripts = match json.get("scripts").and_then(|v| v.as_object()) {
            Some(s) => s,
            None => continue,
        };

        for script in ["start", "dev", "serve"] {
            if !scripts.contains_key(script) {
                continue;
            }
            out.push(DetectedService {
                name: format!("{}:{}", pkg_name, script),
                kind: crate::services::KIND_NODE.to_string(),
                command: format!("npm run {}", script),
                working_dir: pkg_dir.to_string_lossy().into_owned(),
            });
        }
    }

    out
}
