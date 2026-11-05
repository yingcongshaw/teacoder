use std::path::{Path, PathBuf};

use crate::dev_env::DevEnvironment;

/// 扫描项目目录时跳过的目录。
pub const SKIP_DIRS: &[&str] = &[
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
    "venv",
    "env",
    ".tox",
    "__pycache__",
    "obj",
    "vendor",
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
    /// 需要先构建才能跑的命令。C/C++ 这类要先编译出可执行文件。
    pub build_command: Option<String>,
}

/// 在项目里找出所有能跑的服务。
///
/// 绑定的环境决定这台机器上到底有没有对应工具 —— 没有构建工具的话，
/// 扫出来的服务点了也起不来。环境里没配的，退回看系统 PATH。
pub fn detect_services(root: &Path, envs: &[DevEnvironment]) -> Vec<DetectedService> {
    let mut out = Vec::new();

    if tool_available(envs, crate::dev_env::TOOL_MAVEN, &["mvn"]) {
        out.extend(detect_maven_services(root));
    }
    if tool_available(envs, "", &["gradle"]) || root.join(gradlew_name()).is_file() {
        out.extend(detect_gradle_services(root));
    }
    if tool_available(envs, crate::dev_env::TOOL_NODE, &["node"]) {
        out.extend(detect_node_services(root));
    }
    if tool_available(envs, crate::dev_env::TOOL_DOTNET, &["dotnet"])
        || tool_available(envs, crate::dev_env::TOOL_MSBUILD, &["msbuild"])
    {
        out.extend(detect_dotnet_services(root));
    }
    if tool_available(envs, crate::dev_env::TOOL_PYTHON, &["python3", "python"]) {
        out.extend(detect_python_services(root));
    }
    if tool_available(envs, crate::dev_env::TOOL_CARGO, &["cargo"]) {
        out.extend(detect_rust_services(root));
    }
    if tool_available(envs, crate::dev_env::TOOL_GO, &["go"]) {
        out.extend(detect_go_services(root));
    }
    // C/C++ 的门控看构建工具：CMake 工程要 cmake，Makefile 工程要 make。
    // 编译器是构建时才用到的，cmake 自己会在 PATH 上找。
    if tool_available(envs, crate::dev_env::TOOL_CMAKE, &["cmake"])
        || tool_available(envs, "", &["make"])
    {
        out.extend(detect_cpp_services(root, envs));
    }

    out
}

/// 工具可不可用：项目绑定的环境里有，或者系统 PATH 上有。
fn tool_available(envs: &[DevEnvironment], tool: &str, exes: &[&str]) -> bool {
    if !tool.is_empty() && envs.iter().any(|e| e.tool_path(tool).is_some()) {
        return true;
    }
    exes
        .iter()
        .any(|exe| crate::dev_env::detector::find_in_path(exe).is_some())
}

fn gradlew_name() -> &'static str {
    if cfg!(windows) {
        "gradlew.bat"
    } else {
        "gradlew"
    }
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

/// 按后缀找文件（.csproj / .sln 这类）。
fn find_by_extension(root: &Path, exts: &[&str]) -> Vec<PathBuf> {
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
        let path = entry.path();
        if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| exts.contains(&e))
        {
            out.push(path.to_path_buf());
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
            build_command: None,
        });
    }

    out
}

fn detect_gradle_services(root: &Path) -> Vec<DetectedService> {
    let mut out = Vec::new();

    let gradlew = root.join(gradlew_name());

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
            build_command: None,
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
                build_command: None,
            });
        }
    }

    out
}

/// .NET：可执行的项目（Web / Worker / 有 OutputType Exe）。
fn detect_dotnet_services(root: &Path) -> Vec<DetectedService> {
    let mut out = Vec::new();

    for project_file in find_by_extension(root, &["csproj"]) {
        let Ok(text) = std::fs::read_to_string(&project_file) else {
            continue;
        };

        let project_dir = match project_file.parent() {
            Some(dir) => dir.to_path_buf(),
            None => continue,
        };

        let name = project_file
            .file_stem()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "dotnet-app".to_string());

        // .NET Framework 老项目没有 Sdk 属性，dotnet run 用不了，得让 MSBuild 编译。
        if text.contains("<TargetFrameworkVersion>") {
            out.push(DetectedService {
                name: name.clone(),
                kind: crate::services::KIND_DOTNET.to_string(),
                command: executable_path("bin/Debug", &name),
                working_dir: project_dir.to_string_lossy().into_owned(),
                build_command: Some(format!("MSBuild {}", project_file.to_string_lossy())),
            });
            continue;
        }

        let runnable = text.contains("Microsoft.NET.Sdk.Web")
            || text.contains("Microsoft.NET.Sdk.Worker")
            || text.contains("<OutputType>Exe</OutputType>");
        if !runnable {
            continue;
        }

        out.push(DetectedService {
            name,
            kind: crate::services::KIND_DOTNET.to_string(),
            command: format!("dotnet run --project {}", project_file.to_string_lossy()),
            working_dir: project_dir.to_string_lossy().into_owned(),
            build_command: None,
        });
    }

    out
}

/// Python：Django 的 manage.py，以及带 __main__ 入口的脚本。
fn detect_python_services(root: &Path) -> Vec<DetectedService> {
    let mut out = Vec::new();

    for manage in find_manifests(root, &["manage.py"]) {
        let dir = match manage.parent() {
            Some(dir) => dir.to_path_buf(),
            None => continue,
        };
        let name = dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "django".to_string());

        out.push(DetectedService {
            name,
            kind: crate::services::KIND_PYTHON.to_string(),
            command: "python manage.py runserver".to_string(),
            working_dir: dir.to_string_lossy().into_owned(),
            build_command: None,
        });
    }

    for entry in ["main.py", "app.py", "server.py", "run.py"] {
        for file in find_manifests(root, &[entry]) {
            let Ok(text) = std::fs::read_to_string(&file) else {
                continue;
            };
            if !text.contains("__main__") {
                continue;
            }

            let dir = match file.parent() {
                Some(dir) => dir.to_path_buf(),
                None => continue,
            };
            let module = file
                .file_stem()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "main".to_string());

            // FastAPI / Flask 有自己的启动方式，比 python main.py 更贴近项目习惯
            let command = match (
                factory_app_name(&text, "FastAPI("),
                factory_app_name(&text, "Flask("),
            ) {
                (Some(app), _) => format!("uvicorn {}:{} --reload", module, app),
                (None, Some(app)) => format!("flask --app {}:{} run", module, app),
                (None, None) => format!("python {}", entry),
            };

            let name = dir
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "python-app".to_string());

            out.push(DetectedService {
                name,
                kind: crate::services::KIND_PYTHON.to_string(),
                command,
                working_dir: dir.to_string_lossy().into_owned(),
                build_command: None,
            });
        }
    }

    out
}

/// 找出 `xxx = FastAPI(` / `xxx = Flask(` 里的变量名。
///
/// 应用对象不一定叫 app，写成 `myapp = FastAPI()` 很常见，
/// 命令里还写 app 就会启动失败。
fn factory_app_name(text: &str, factory: &str) -> Option<String> {
    for line in text.lines() {
        let Some(at) = line.find(factory) else {
            continue;
        };
        let head = &line[..at];
        let Some(eq) = head.rfind('=') else {
            continue;
        };
        let name = head[..eq]
            .split_whitespace()
            .next()?
            .trim_end_matches(':');
        if !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Some(name.to_string());
        }
    }
    None
}

/// Rust：有 src/main.rs 的 Cargo 包。
fn detect_rust_services(root: &Path) -> Vec<DetectedService> {
    let mut out = Vec::new();

    for manifest in find_manifests(root, &["Cargo.toml"]) {
        let crate_dir = match manifest.parent() {
            Some(dir) => dir.to_path_buf(),
            None => continue,
        };
        if !crate_dir.join("src").join("main.rs").is_file() {
            continue;
        }

        let name = std::fs::read_to_string(&manifest)
            .ok()
            .and_then(|text| crate_name(&text))
            .or_else(|| {
                crate_dir
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
            })
            .unwrap_or_else(|| "cargo-app".to_string());

        out.push(DetectedService {
            name,
            kind: crate::services::KIND_RUST.to_string(),
            command: "cargo run".to_string(),
            working_dir: crate_dir.to_string_lossy().into_owned(),
            build_command: None,
        });
    }

    out
}

/// 从 Cargo.toml 里取 [package] name。
fn crate_name(text: &str) -> Option<String> {
    let start = text.find("[package]")?;
    let rest = &text[start..];
    let end = rest.find("\n[")?;
    let section = &rest[..end];
    let line = section.lines().find(|l| l.trim_start().starts_with("name"))?;
    let value = line.split('=').nth(1)?.trim().trim_matches('"').to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

/// Go：package main 且带 func main 的文件。
fn detect_go_services(root: &Path) -> Vec<DetectedService> {
    let mut out = Vec::new();

    for file in find_by_extension(root, &["go"]) {
        let Ok(text) = std::fs::read_to_string(&file) else {
            continue;
        };
        if !text.contains("package main") || !text.contains("func main(") {
            continue;
        }

        let dir = match file.parent() {
            Some(dir) => dir.to_path_buf(),
            None => continue,
        };

        let name = dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "go-app".to_string());

        out.push(DetectedService {
            name,
            kind: crate::services::KIND_GO.to_string(),
            command: "go run .".to_string(),
            working_dir: dir.to_string_lossy().into_owned(),
            build_command: None,
        });
    }

    out
}

/// C/C++：CMake 或 Makefile 工程，先构建再跑产出的可执行文件。
fn detect_cpp_services(root: &Path, envs: &[DevEnvironment]) -> Vec<DetectedService> {
    let mut out = Vec::new();

    let has_cmake = tool_available(envs, crate::dev_env::TOOL_CMAKE, &["cmake"]);
    let has_make = tool_available(envs, "", &["make"]);

    for cmakelists in find_manifests(root, &["CMakeLists.txt"]) {
        let dir = match cmakelists.parent() {
            Some(dir) => dir.to_path_buf(),
            None => continue,
        };

        let Ok(text) = std::fs::read_to_string(&cmakelists) else {
            continue;
        };
        if !text.contains("add_executable") {
            continue;
        }
        if !has_cmake {
            continue;
        }

        // 产出的可执行文件名是 add_executable 的 target 名，
        // project() 里的名字只是工程名，两者常常不一样。
        let name = cmake_executable_target(&text)
            .or_else(|| cmake_project_name(&text))
            .or_else(|| {
                dir.file_name()
                    .map(|n| n.to_string_lossy().into_owned())
            })
            .unwrap_or_else(|| "cpp-app".to_string());

        out.push(DetectedService {
            name: name.clone(),
            kind: crate::services::KIND_CPP.to_string(),
            command: executable_path("build", &name),
            working_dir: dir.to_string_lossy().into_owned(),
            build_command: Some("cmake -S . -B build".to_string()),
        });
    }

    for makefile in find_manifests(root, &["Makefile"]) {
        let dir = match makefile.parent() {
            Some(dir) => dir.to_path_buf(),
            None => continue,
        };

        if !has_make {
            continue;
        }

        // Makefile 各语言都有，Go / Rust 项目也常带一个。
        // 没有 C/C++ 源文件就不能当成 C++ 服务。
        let sources = find_by_extension(&dir, &["c", "cc", "cpp", "cxx"]);
        if sources.is_empty() {
            continue;
        }

        // 编译产物一般跟源文件同名（main.c → main）
        let name = sources
            .first()
            .and_then(|p| p.file_stem())
            .map(|n| n.to_string_lossy().into_owned())
            .or_else(|| dir.file_name().map(|n| n.to_string_lossy().into_owned()))
            .unwrap_or_else(|| "cpp-app".to_string());

        out.push(DetectedService {
            name: name.clone(),
            kind: crate::services::KIND_CPP.to_string(),
            command: executable_path(".", &name),
            working_dir: dir.to_string_lossy().into_owned(),
            build_command: Some("make".to_string()),
        });
    }

    out
}

/// 从 CMakeLists.txt 里取 add_executable() 的 target 名。
///
/// 编译产出的可执行文件用的是 target 名，不是 project() 的工程名。
fn cmake_executable_target(text: &str) -> Option<String> {
    let start = text.find("add_executable(")?;
    let rest = &text[start + "add_executable(".len()..];
    let end = rest.find(')')?;
    let name = rest[..end]
        .split_whitespace()
        .next()?
        .trim_matches('"')
        .to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// 从 CMakeLists.txt 里取 project() 的名字。
fn cmake_project_name(text: &str) -> Option<String> {
    let start = text.find("project(")?;
    let rest = &text[start + "project(".len()..];
    let end = rest.find(')')?;
    let name = rest[..end]
        .split_whitespace()
        .next()?
        .trim_matches('"')
        .to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// 可执行文件的路径。Windows 上要带 .exe。
fn executable_path(dir: &str, name: &str) -> String {
    if cfg!(windows) {
        format!("{}\\{}.exe", dir.trim_end_matches('\\'), name)
    } else {
        format!("{}/{}", dir.trim_end_matches('/'), name)
    }
}

#[cfg(test)]
mod tests {
    use super::factory_app_name;

    /// FastAPI / Flask 的应用对象不叫 app 时，命令里也得用对名字。
    #[test]
    fn finds_python_app_object_name() {
        assert_eq!(
            factory_app_name("myapp = FastAPI()\n", "FastAPI("),
            Some("myapp".to_string())
        );
        assert_eq!(
            factory_app_name("application: FastAPI = FastAPI()\n", "FastAPI("),
            Some("application".to_string())
        );
        assert_eq!(
            factory_app_name("app = Flask(__name__)\n", "Flask("),
            Some("app".to_string())
        );
        assert_eq!(factory_app_name("print(1)\n", "FastAPI("), None);
    }
}
