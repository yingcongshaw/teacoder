use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::dev_env::{DevEnvironment, TOOL_CC, TOOL_CMAKE, TOOL_MAVEN, TOOL_MSBUILD};
use crate::services::{KIND_CPP, KIND_DOTNET, KIND_GO, KIND_JAVA, KIND_NODE, KIND_PYTHON, KIND_RUST};

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

/// 启动命令里的产物占位符。启动前换成实际构建出来的文件。
pub const ARTIFACT_PLACEHOLDER: &str = "{artifact}";

/// 识别出来的服务（还没入库）。
#[derive(Debug, Clone)]
pub struct DetectedService {
    pub name: String,
    pub kind: String,
    pub command: String,
    pub working_dir: String,
    /// 需要先构建才能跑的命令。C/C++ 这类要先编译出可执行文件。
    pub build_command: Option<String>,
    /// 构建产物的基名。Java 取 pom 的 artifactId，C/C++ 取可执行文件名。
    pub artifact_id: Option<String>,
    /// 产物所在子目录，相对工作目录。Java 是 target。
    pub artifact_dir: Option<String>,
    /// 入口类全限定名。
    pub main_class: Option<String>,
    /// 入口文件或清单文件路径。
    pub entry_path: Option<String>,
}

/// 手工添加服务时的入口候选。
///
/// 候选只来自项目绑定的开发/运行环境能覆盖的源代码工程 —— 跟自动识别一个口径，
/// 用户选完入口类就行，版本、用哪个 JDK 都不用自己挑。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceCandidate {
    pub name: String,
    pub kind: String,
    /// 入口文件或清单文件路径
    pub path: String,
    pub command: String,
    pub working_dir: String,
    pub build_command: Option<String>,
    pub artifact_id: Option<String>,
    pub artifact_dir: Option<String>,
    pub main_class: Option<String>,
}

/// 在项目里找出所有能跑的服务。
///
/// 能识别出什么，由项目绑定的开发/运行环境决定：没绑 Java 环境就不会冒出 Java 服务，
/// 绑了哪套 JDK / Maven 就用哪套 —— 识别出来的服务也只按那套环境跑。
pub fn detect_services(root: &Path, envs: &[DevEnvironment]) -> Vec<DetectedService> {
    let mut out = Vec::new();

    if has_env_kind(envs, KIND_JAVA) {
        out.extend(detect_java_services(root, envs));
    }
    if has_env_kind(envs, KIND_NODE) {
        out.extend(detect_node_services(root));
    }
    if has_env_kind(envs, KIND_DOTNET) {
        out.extend(detect_dotnet_services(root, envs));
    }
    if has_env_kind(envs, KIND_PYTHON) {
        out.extend(detect_python_services(root));
    }
    if has_env_kind(envs, KIND_RUST) {
        out.extend(detect_rust_services(root));
    }
    if has_env_kind(envs, KIND_GO) {
        out.extend(detect_go_services(root));
    }
    if has_env_kind(envs, KIND_CPP) {
        out.extend(detect_cpp_services(root, envs));
    }

    out
}

/// 手工添加服务时的入口候选。
///
/// 跟自动识别同源：候选只列项目绑定的环境能跑起来的东西。
pub fn entry_candidates(root: &Path, envs: &[DevEnvironment]) -> Vec<ServiceCandidate> {
    let mut out = Vec::new();

    // Java 的候选按入口类给，一个模块里有几个 main 方法就有几个候选。
    if env_has_tool(envs, KIND_JAVA, TOOL_MAVEN) {
        for module in maven_modules(root) {
            for (path, class) in find_main_classes(&module.dir) {
                out.push(ServiceCandidate {
                    name: class_simple_name(&class),
                    kind: KIND_JAVA.to_string(),
                    path: path.to_string_lossy().into_owned(),
                    command: format!("java -jar {}", ARTIFACT_PLACEHOLDER),
                    working_dir: module.dir.to_string_lossy().into_owned(),
                    build_command: Some(MVN_PACKAGE.to_string()),
                    artifact_id: Some(module.artifact_id.clone()),
                    artifact_dir: Some("target".to_string()),
                    main_class: Some(class),
                });
            }
        }
    }

    for service in detect_services(root, envs) {
        if service.kind == KIND_JAVA {
            continue;
        }
        let Some(path) = service.entry_path else {
            continue;
        };
        out.push(ServiceCandidate {
            name: service.name,
            kind: service.kind,
            path,
            command: service.command,
            working_dir: service.working_dir,
            build_command: service.build_command,
            artifact_id: service.artifact_id,
            artifact_dir: service.artifact_dir,
            main_class: service.main_class,
        });
    }

    out
}

/// Maven 打包命令。跳过测试 —— 服务启动不该被测试拖住。
const MVN_PACKAGE: &str = "mvn -DskipTests package";

/// 项目绑定里有没有这个语言类别的环境。
fn has_env_kind(envs: &[DevEnvironment], kind: &str) -> bool {
    envs.iter().any(|e| e.kind == kind)
}

/// 项目绑定里这个类别的环境有没有这件工具。
fn env_has_tool(envs: &[DevEnvironment], kind: &str, tool: &str) -> bool {
    envs.iter()
        .filter(|e| e.kind == kind)
        .any(|e| e.tool_path(tool).is_some())
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

/// 有没有 Spring Boot 的打包配置。
///
/// 父 POM 里的 spring-boot-starter-parent 不算数 —— 继承不算数，模块自己
/// 声明了才算，否则多模块工程里的父工程会被当成一个服务。
fn is_spring_boot_pom(xml: &str) -> bool {
    xml.contains("spring-boot-starter") || xml.contains("spring-boot-maven-plugin")
}

/// maven-jar-plugin 配了 mainClass，打出来的 jar 才能 `java -jar` 起来。
fn has_jar_main_class(xml: &str) -> bool {
    xml.contains("<mainClass>")
}

/// 模块里的入口类。返回 (源文件路径, 全限定类名)。
fn find_main_classes(module_dir: &Path) -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();

    for (lang, ext, marker) in [
        ("java", "java", "public static void main"),
        ("kotlin", "kt", "fun main("),
    ] {
        let src_root = module_dir.join("src").join("main").join(lang);
        if !src_root.is_dir() {
            continue;
        }

        for path in source_files(&src_root, &[ext]) {
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            if !text.contains(marker) {
                continue;
            }
            let Ok(rel) = path.strip_prefix(&src_root) else {
                continue;
            };
            let fqcn = rel
                .with_extension("")
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(".");
            if fqcn.is_empty() {
                continue;
            }
            out.push((path, fqcn));
        }
    }

    out
}

/// 递归收集指定后缀的源文件。
fn source_files(root: &Path, exts: &[&str]) -> Vec<PathBuf> {
    let mut out = Vec::new();

    let walker = walkdir::WalkDir::new(root)
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

/// 全限定类名去掉包名。
fn class_simple_name(fqcn: &str) -> String {
    fqcn.rsplit('.').next().unwrap_or(fqcn).to_string()
}

/// 一个能当服务跑的 Maven 模块。
struct MavenModule {
    dir: PathBuf,
    artifact_id: String,
    main_class: Option<String>,
}

/// 项目里能打成可执行 jar 的 Maven 模块。
///
/// 判据来自 pom.xml：Spring Boot 会重打成胖 jar，maven-jar-plugin 配了
/// mainClass 的 jar 也能直接 `java -jar`。两者都没有的模块跑不起来，不算服务。
fn maven_modules(root: &Path) -> Vec<MavenModule> {
    let mut out = Vec::new();

    for pom in find_manifests(root, &["pom.xml"]) {
        let Ok(text) = std::fs::read_to_string(&pom) else {
            continue;
        };
        let Some(dir) = pom.parent().map(|p| p.to_path_buf()) else {
            continue;
        };

        let cleaned = strip_parent_block(&text);
        // 聚合工程自己不产出可执行的东西
        if cleaned.contains("<packaging>pom</packaging>") {
            continue;
        }
        if !is_spring_boot_pom(&cleaned) && !has_jar_main_class(&cleaned) {
            continue;
        }

        let artifact_id = extract_artifact_id(&text)
            .or_else(|| dir.file_name().map(|n| n.to_string_lossy().into_owned()))
            .unwrap_or_else(|| "java-app".to_string());
        let main_class = find_main_classes(&dir)
            .first()
            .map(|(_, class)| class.clone());

        out.push(MavenModule {
            dir,
            artifact_id,
            main_class,
        });
    }

    out
}

/// Java 服务：Maven 模块打 jar 再跑，Gradle 用工程自带的 wrapper。
fn detect_java_services(root: &Path, envs: &[DevEnvironment]) -> Vec<DetectedService> {
    let mut out = Vec::new();

    // Maven 得是项目绑定的环境里那套，不然打出来的包跟运行时的 JDK 对不上
    if env_has_tool(envs, KIND_JAVA, TOOL_MAVEN) {
        for module in maven_modules(root) {
            out.push(DetectedService {
                name: module.artifact_id.clone(),
                kind: KIND_JAVA.to_string(),
                command: format!("java -jar {}", ARTIFACT_PLACEHOLDER),
                working_dir: module.dir.to_string_lossy().into_owned(),
                build_command: Some(MVN_PACKAGE.to_string()),
                artifact_id: Some(module.artifact_id.clone()),
                artifact_dir: Some("target".to_string()),
                main_class: module.main_class.clone(),
                entry_path: None,
            });
        }
    }

    // Gradle 用工程里自带的 wrapper，版本由工程自己定
    if root.join(gradlew_name()).is_file() {
        out.extend(detect_gradle_services(root));
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
            kind: KIND_JAVA.to_string(),
            command,
            working_dir: root.to_string_lossy().into_owned(),
            build_command: None,
            artifact_id: None,
            artifact_dir: None,
            main_class: None,
            entry_path: Some(build_file.to_string_lossy().into_owned()),
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
                kind: KIND_NODE.to_string(),
                command: format!("npm run {}", script),
                working_dir: pkg_dir.to_string_lossy().into_owned(),
                build_command: None,
                artifact_id: None,
                artifact_dir: None,
                main_class: None,
                entry_path: Some(pkg_file.to_string_lossy().into_owned()),
            });
        }
    }

    out
}

/// .NET：可执行的项目（Web / Worker / 有 OutputType Exe）。
fn detect_dotnet_services(root: &Path, envs: &[DevEnvironment]) -> Vec<DetectedService> {
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
            if !env_has_tool(envs, KIND_DOTNET, TOOL_MSBUILD) {
                continue;
            }
            out.push(DetectedService {
                name: name.clone(),
                kind: KIND_DOTNET.to_string(),
                command: executable_path("bin/Debug", &name),
                working_dir: project_dir.to_string_lossy().into_owned(),
                build_command: Some(format!("msbuild {}", project_file.to_string_lossy())),
                artifact_id: None,
                artifact_dir: None,
                main_class: None,
                entry_path: Some(project_file.to_string_lossy().into_owned()),
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
            kind: KIND_DOTNET.to_string(),
            command: format!("dotnet run --project {}", project_file.to_string_lossy()),
            working_dir: project_dir.to_string_lossy().into_owned(),
            build_command: None,
            artifact_id: None,
            artifact_dir: None,
            main_class: None,
            entry_path: Some(project_file.to_string_lossy().into_owned()),
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
            kind: KIND_PYTHON.to_string(),
            command: "python manage.py runserver".to_string(),
            working_dir: dir.to_string_lossy().into_owned(),
            build_command: None,
            artifact_id: None,
            artifact_dir: None,
            main_class: None,
            entry_path: Some(manage.to_string_lossy().into_owned()),
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
                kind: KIND_PYTHON.to_string(),
                command,
                working_dir: dir.to_string_lossy().into_owned(),
                build_command: None,
                artifact_id: None,
                artifact_dir: None,
                main_class: None,
                entry_path: Some(file.to_string_lossy().into_owned()),
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
            kind: KIND_RUST.to_string(),
            command: "cargo run".to_string(),
            working_dir: crate_dir.to_string_lossy().into_owned(),
            build_command: None,
            artifact_id: None,
            artifact_dir: None,
            main_class: None,
            entry_path: Some(manifest.to_string_lossy().into_owned()),
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
            kind: KIND_GO.to_string(),
            command: "go run .".to_string(),
            working_dir: dir.to_string_lossy().into_owned(),
            build_command: None,
            artifact_id: None,
            artifact_dir: None,
            main_class: None,
            entry_path: Some(file.to_string_lossy().into_owned()),
        });
    }

    out
}

/// C/C++：CMake 或 Makefile 工程，先构建再跑产出的可执行文件。
fn detect_cpp_services(root: &Path, envs: &[DevEnvironment]) -> Vec<DetectedService> {
    let mut out = Vec::new();

    let has_cmake = env_has_tool(envs, KIND_CPP, TOOL_CMAKE);
    // Makefile 的编译器版本得由环境定住，make 本身只是驱动构建
    let has_make = env_has_tool(envs, KIND_CPP, TOOL_CC);

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
            kind: KIND_CPP.to_string(),
            command: ARTIFACT_PLACEHOLDER.to_string(),
            working_dir: dir.to_string_lossy().into_owned(),
            build_command: Some("cmake -S . -B build".to_string()),
            artifact_id: Some(name),
            artifact_dir: Some("build".to_string()),
            main_class: None,
            entry_path: Some(cmakelists.to_string_lossy().into_owned()),
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
            kind: KIND_CPP.to_string(),
            command: ARTIFACT_PLACEHOLDER.to_string(),
            working_dir: dir.to_string_lossy().into_owned(),
            build_command: Some("make".to_string()),
            artifact_id: Some(name),
            artifact_dir: None,
            main_class: None,
            entry_path: Some(makefile.to_string_lossy().into_owned()),
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
    use super::*;
    use crate::dev_env::{DevTool, KIND_NODE, TOOL_JDK, TOOL_NODE};

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

    fn env_with(kind: &str, tools: &[(&str, &str)]) -> DevEnvironment {
        DevEnvironment {
            id: format!("env-{}", kind),
            kind: kind.to_string(),
            name: kind.to_string(),
            tools: tools
                .iter()
                .map(|(tool, path)| DevTool {
                    tool: tool.to_string(),
                    version: Some("1.0.0".to_string()),
                    path: Some(path.to_string()),
                })
                .collect(),
            created_at: 0,
            updated_at: 0,
        }
    }

    /// Java 环境（带 Maven）。
    fn java_env() -> DevEnvironment {
        env_with(
            crate::dev_env::KIND_JAVA,
            &[(TOOL_JDK, "/opt/jdk21"), (TOOL_MAVEN, "/opt/maven")],
        )
    }

    /// 造一个 Spring Boot 的 Maven 模块。
    fn write_maven_module(root: &Path, artifact_id: &str) {
        let module = root.join("demo");
        std::fs::create_dir_all(module.join("src/main/java/com/demo")).expect("建目录");
        std::fs::write(
            module.join("pom.xml"),
            format!(
                r#"<project>
  <parent>
    <artifactId>parent-demo</artifactId>
  </parent>
  <artifactId>{artifact_id}</artifactId>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter</artifactId>
    </dependency>
  </dependencies>
</project>"#
            ),
        )
        .expect("写 pom");
        std::fs::write(
            module.join("src/main/java/com/demo/DemoApplication.java"),
            "package com.demo;\npublic class DemoApplication {\n  public static void main(String[] args) {}\n}\n",
        )
        .expect("写入口类");
    }

    /// Java 模块要绑了 Java 环境才认得出，名字取 pom 的 artifactId。
    #[test]
    fn java_service_needs_bound_java_environment() {
        let dir = std::env::temp_dir().join(format!("teacoder-det-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("建临时目录");
        write_maven_module(&dir, "demo-service");

        let without_env = detect_services(&dir, &[]);
        assert!(
            without_env.is_empty(),
            "没绑 Java 环境不该识别出 Java 服务，实际：{without_env:?}"
        );

        let detected = detect_services(&dir, &[java_env()]);
        let java = detected
            .iter()
            .find(|d| d.kind == KIND_JAVA)
            .expect("应识别出 Java 服务");
        assert_eq!(java.name, "demo-service");
        assert_eq!(java.command, format!("java -jar {}", ARTIFACT_PLACEHOLDER));
        assert_eq!(java.build_command.as_deref(), Some(MVN_PACKAGE));
        assert_eq!(java.artifact_id.as_deref(), Some("demo-service"));
        assert_eq!(java.artifact_dir.as_deref(), Some("target"));
        assert_eq!(java.main_class.as_deref(), Some("com.demo.DemoApplication"));

        std::fs::remove_dir_all(&dir).ok();
    }

    /// Java 环境里没有 Maven，就不该把 Maven 工程当成可运行的服务。
    #[test]
    fn java_service_needs_maven_in_bound_environment() {
        let dir = std::env::temp_dir().join(format!("teacoder-det-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("建临时目录");
        write_maven_module(&dir, "demo-service");

        let jdk_only = env_with(crate::dev_env::KIND_JAVA, &[(TOOL_JDK, "/opt/jdk21")]);
        let detected = detect_services(&dir, &[jdk_only]);
        assert!(
            detected.iter().all(|d| d.kind != KIND_JAVA),
            "没有 Maven 不该识别出 Java 服务，实际：{detected:?}"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 别的语言类别同理：没绑 Node 环境就不认 Node 工程。
    #[test]
    fn detection_is_limited_to_bound_environment_kinds() {
        let dir = std::env::temp_dir().join(format!("teacoder-det-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("建临时目录");
        std::fs::write(
            dir.join("package.json"),
            r#"{"name":"demo","scripts":{"start":"node index.js"}}"#,
        )
        .expect("写 package.json");

        let detected = detect_services(&dir, &[]);
        assert!(
            detected.is_empty(),
            "没绑任何环境不该识别出服务，实际：{detected:?}"
        );

        let node = env_with(KIND_NODE, &[(TOOL_NODE, "/usr/bin/node")]);
        let detected = detect_services(&dir, &[node]);
        assert!(
            detected.iter().any(|d| d.kind == KIND_NODE),
            "绑了 Node 环境就该识别出 Node 服务，实际：{detected:?}"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 手工添加的候选按入口类给，名字取类名，命令按模块的 artifactId 走产物。
    #[test]
    fn java_entry_candidates_are_per_main_class() {
        let dir = std::env::temp_dir().join(format!("teacoder-det-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("建临时目录");
        write_maven_module(&dir, "demo-service");

        let candidates = entry_candidates(&dir, &[java_env()]);
        assert_eq!(candidates.len(), 1);
        let candidate = &candidates[0];
        assert_eq!(candidate.name, "DemoApplication");
        assert_eq!(candidate.kind, KIND_JAVA);
        assert_eq!(candidate.command, format!("java -jar {}", ARTIFACT_PLACEHOLDER));
        assert_eq!(candidate.build_command.as_deref(), Some(MVN_PACKAGE));
        assert_eq!(candidate.artifact_id.as_deref(), Some("demo-service"));
        assert_eq!(candidate.artifact_dir.as_deref(), Some("target"));
        assert_eq!(candidate.main_class.as_deref(), Some("com.demo.DemoApplication"));
        assert!(
            candidate.path.ends_with("DemoApplication.java"),
            "候选路径应是入口类文件，实际：{}",
            candidate.path
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 父 POM 里的 artifactId 不该被当成模块自己的。
    #[test]
    fn artifact_id_ignores_parent_block() {
        let xml = "<project><parent><artifactId>parent-demo</artifactId></parent><artifactId>real-one</artifactId></project>";
        assert_eq!(extract_artifact_id(xml).as_deref(), Some("real-one"));
    }
}
