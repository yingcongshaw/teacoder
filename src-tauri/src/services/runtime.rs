use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::dev_env::DevEnvironment;
use crate::storage::AppDatabase;

/// 日志环形缓冲：最多 200 行，且总字节不超过 64KB。
const LOG_MAX_LINES: usize = 200;
const LOG_MAX_BYTES: usize = 64 * 1024;

/// 停止服务时给进程的宽限时间，超时后强杀。
const TERM_GRACE: Duration = Duration::from_millis(3000);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceRuntimeState {
    pub service_id: String,
    pub running: bool,
    pub pid: Option<u32>,
    pub started_at: Option<i64>,
    /// 服务实际占用的端口。运行态才有，由 services::ports 探测后填入。
    pub ports: Vec<u16>,
}

struct ServiceRuntime {
    pid: u32,
    started_at: i64,
    project_id: String,
}

/// 运行中的服务进程。进程句柄由看门线程持有，这里只记 pid 与归属项目。
static RUNTIMES: Lazy<std::sync::Mutex<HashMap<String, ServiceRuntime>>> =
    Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

/// 各服务的输出缓冲。
static LOGS: Lazy<std::sync::Mutex<HashMap<String, VecDeque<String>>>> =
    Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

fn runtime_lock() -> Result<std::sync::MutexGuard<'static, HashMap<String, ServiceRuntime>>, String> {
    RUNTIMES.lock().map_err(|e| e.to_string())
}

fn logs_lock() -> Result<std::sync::MutexGuard<'static, HashMap<String, VecDeque<String>>>, String> {
    LOGS.lock().map_err(|e| e.to_string())
}

pub fn is_running(service_id: &str) -> bool {
    runtime_lock()
        .map(|map| map.contains_key(service_id))
        .unwrap_or(false)
}

pub fn service_states() -> Vec<ServiceRuntimeState> {
    let Ok(map) = runtime_lock() else {
        return Vec::new();
    };
    map.iter()
        .map(|(id, r)| ServiceRuntimeState {
            service_id: id.clone(),
            running: true,
            pid: Some(r.pid),
            started_at: Some(r.started_at),
            ports: Vec::new(),
        })
        .collect()
}

pub fn service_logs(service_id: &str, limit: usize) -> Vec<String> {
    let Ok(map) = logs_lock() else {
        return Vec::new();
    };
    let Some(lines) = map.get(service_id) else {
        return Vec::new();
    };
    let take = if limit == 0 { lines.len() } else { limit.min(lines.len()) };
    lines.iter().skip(lines.len() - take).cloned().collect()
}

fn push_log(service_id: &str, line: &str) {
    let Ok(mut map) = logs_lock() else {
        return;
    };
    let entry = map.entry(service_id.to_string()).or_default();
    entry.push_back(line.to_string());

    let mut total_bytes: usize = entry.iter().map(|l| l.len() + 1).sum();
    while entry.len() > LOG_MAX_LINES || (total_bytes > LOG_MAX_BYTES && entry.len() > 1) {
        if let Some(front) = entry.pop_front() {
            total_bytes = total_bytes.saturating_sub(front.len() + 1);
        } else {
            break;
        }
    }
}

/// 把命令行拆成程序与参数。
///
/// 不做 shell 解释：不支持 `&&`、管道、重定向。手填的命令要复杂就该用脚本。
fn split_command(command: &str) -> (String, Vec<String>) {
    let mut parts = command.split_whitespace();
    let program = parts.next().unwrap_or("").to_string();
    let args: Vec<String> = parts.map(|s| s.to_string()).collect();
    (program, args)
}

fn resolve_executable(program: &str, search_path: &std::ffi::OsStr) -> String {
    if program.is_empty() {
        return program.to_string();
    }
    if program.contains('/') || program.contains('\\') {
        return program.to_string();
    }
    crate::dev_env::detector::find_in_paths(program, search_path)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| program.to_string())
}

/// 命令里的程序名换成项目绑定环境里的那个可执行文件。
///
/// 拿到完整路径最稳：跑的就是项目选定的那个版本，不会因为 PATH 上还有别的
/// 同名程序而跑错。环境里只记了名字时退回按名字找。
fn align_program_with_env(program: &str, kind: &str, envs: &[DevEnvironment]) -> String {
    let Some(tool) = tool_for_program(kind, program) else {
        return program.to_string();
    };
    for env in envs.iter().filter(|e| e.kind == kind) {
        let Some(raw) = env.tool_path(tool) else {
            continue;
        };
        if let Some(exe) = crate::dev_env::tool_exe_path(tool, raw) {
            return exe.to_string_lossy().into_owned();
        }
        if let Some(exe) = env.tool_exe_name(tool) {
            if exe != program {
                return exe;
            }
        }
    }
    program.to_string()
}

/// 命令里的程序名对应环境里的哪件工具。
fn tool_for_program(kind: &str, program: &str) -> Option<&'static str> {
    use crate::dev_env::{
        TOOL_CARGO, TOOL_CC, TOOL_CMAKE, TOOL_DOTNET, TOOL_GO, TOOL_JDK, TOOL_MAVEN, TOOL_MSBUILD,
        TOOL_NODE, TOOL_PYTHON,
    };
    match (kind, program) {
        (crate::services::KIND_PYTHON, "python" | "python3") => Some(TOOL_PYTHON),
        (crate::services::KIND_NODE, "node") => Some(TOOL_NODE),
        (crate::services::KIND_RUST, "cargo") => Some(TOOL_CARGO),
        (crate::services::KIND_GO, "go") => Some(TOOL_GO),
        (crate::services::KIND_DOTNET, "dotnet") => Some(TOOL_DOTNET),
        (crate::services::KIND_DOTNET, "msbuild") => Some(TOOL_MSBUILD),
        (crate::services::KIND_JAVA, "mvn") => Some(TOOL_MAVEN),
        (crate::services::KIND_JAVA, "java") => Some(TOOL_JDK),
        (crate::services::KIND_CPP, "cmake") => Some(TOOL_CMAKE),
        (crate::services::KIND_CPP, "gcc" | "g++" | "clang" | "cc") => Some(TOOL_CC),
        _ => None,
    }
}

/// 在目录里找构建产物。
///
/// 产物常带版本号（demo-1.0.jar），也有不带版本号的（demo.jar），两种都算命中；
/// 多个候选取最新的那个。
fn find_artifact(dir: &Path, base: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !artifact_matches(file_name, base) {
            continue;
        }
        let mtime = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::UNIX_EPOCH);
        match &best {
            Some((best_time, _)) if *best_time >= mtime => {}
            _ => best = Some((mtime, path)),
        }
    }

    best.map(|(_, path)| path)
}

/// 产物名跟基名对不对得上。demo-1.0.jar、demo.jar、demo 都算 demo。
fn artifact_matches(file_name: &str, base: &str) -> bool {
    let stem = file_name
        .strip_suffix(".jar")
        .or_else(|| file_name.strip_suffix(".exe"))
        .unwrap_or(file_name);
    stem == base || stem.starts_with(&format!("{}-", base))
}

/// 产物是不是比源码旧。旧了得重新构建，不然跑的是老代码。
fn artifact_is_stale(artifact: &Path, working_dir: &Path) -> bool {
    let Ok(artifact_time) = std::fs::metadata(artifact).and_then(|m| m.modified()) else {
        return false;
    };
    match newest_source_time(working_dir) {
        Some(source_time) => source_time > artifact_time,
        None => false,
    }
}

/// 工程里最新的源文件时间。产物目录不算源文件。
fn newest_source_time(root: &Path) -> Option<std::time::SystemTime> {
    const SOURCE_EXTS: &[&str] = &[
        "java", "kt", "scala", "xml", "properties", "yml", "yaml", "json", "ts", "tsx", "js", "jsx",
        "py", "go", "rs", "c", "cc", "cpp", "cxx", "h", "hpp", "cs", "vue",
    ];

    let mut newest: Option<std::time::SystemTime> = None;
    let walker = walkdir::WalkDir::new(root)
        .max_depth(12)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            !crate::services::detector::SKIP_DIRS.contains(&name.as_ref())
        });

    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let is_source = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| SOURCE_EXTS.contains(&e));
        if !is_source {
            continue;
        }
        let Ok(time) = std::fs::metadata(path).and_then(|m| m.modified()) else {
            continue;
        };
        if newest.map(|t| time > t).unwrap_or(true) {
            newest = Some(time);
        }
    }

    newest
}

/// 组装实际要执行的命令。
///
/// Windows 上 npm / mvn 是 .cmd 脚本，不能直接 exec，要经 cmd.exe 跑。
#[cfg(windows)]
fn prepare_command(program: &str, args: &[String], search_path: &std::ffi::OsStr) -> (String, Vec<String>) {
    let exe = resolve_executable(program, search_path);
    let ext = std::path::Path::new(&exe)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if ext == "cmd" || ext == "bat" {
        let mut wrapped = vec!["/C".to_string(), exe];
        wrapped.extend(args.iter().cloned());
        return ("cmd.exe".to_string(), wrapped);
    }
    (exe, args.to_vec())
}

#[cfg(not(windows))]
fn prepare_command(program: &str, args: &[String], search_path: &std::ffi::OsStr) -> (String, Vec<String>) {
    (resolve_executable(program, search_path), args.to_vec())
}

fn spawn_log_reader<R: Read + Send + 'static>(
    reader: R,
    app: AppHandle,
    service_id: String,
) {
    std::thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line in buffered.lines() {
            let Ok(line) = line else {
                break;
            };
            push_log(&service_id, &line);
            let _ = app.emit(
                "service:output",
                serde_json::json!({
                    "serviceId": service_id,
                    "data": format!("{}\n", line),
                }),
            );
        }
    });
}

/// 跑服务时用的一整套环境：项目绑定环境算出来的变量、PATH 与语言类别。
///
/// 构建与启动都得用同一套 —— 拿系统里的另一套 JDK 去跑项目绑定环境打出来的包，
/// 轻则版本对不上，重则直接起不来。
struct RunEnv<'a> {
    working_dir: &'a str,
    overrides: &'a [(String, String)],
    search_path: &'a std::ffi::OsStr,
    kind: &'a str,
    envs: &'a [DevEnvironment],
}

/// 先跑构建命令，成功了再启动服务进程。
///
/// 构建输出并进服务的日志缓冲 —— 编译报错要能在服务面板里直接看到。
fn run_build_command(
    app: &AppHandle,
    service_id: &str,
    build_command: &str,
    run_env: &RunEnv<'_>,
) -> Result<(), String> {
    let (program, args) = split_command(build_command);
    if program.is_empty() {
        return Ok(());
    }
    // 构建工具也得是项目绑定的那套，否则打出来的包跟运行时的 JDK 对不上
    let program = align_program_with_env(&program, run_env.kind, run_env.envs);
    let (program, args) = prepare_command(&program, &args, run_env.search_path);

    let mut command = Command::new(&program);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if !run_env.working_dir.trim().is_empty() {
        command.current_dir(run_env.working_dir);
    }
    for (key, value) in run_env.overrides {
        command.env(key, value);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("构建失败：无法启动 {program}（{e}）"))?;

    if let Some(stdout) = child.stdout.take() {
        spawn_log_reader(stdout, app.clone(), service_id.to_string());
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_log_reader(stderr, app.clone(), service_id.to_string());
    }

    let status = child.wait().map_err(|e| format!("构建失败：{e}"))?;
    if !status.success() {
        let code = status.code().unwrap_or(-1);
        return Err(format!("构建失败（退出码 {code}）"));
    }

    Ok(())
}

/// 启动一个服务进程。
pub fn start_service(
    app: &AppHandle,
    db: &AppDatabase,
    service_id: &str,
) -> Result<(), String> {
    if is_running(service_id) {
        return Ok(());
    }

    let service = crate::services::get_service(db, service_id)?;

    let project_path = crate::services::project_path(db, &service.project_id)?;

    let envs = crate::dev_env::list_project_envs(db, &service.project_id)?;
    let env_overrides = crate::dev_env::build_project_env(&envs);

    // 用项目环境的 PATH 解析命令，否则可能跑到系统里另一个版本的 mvn/npm
    let search_path: std::ffi::OsString = env_overrides
        .iter()
        .find(|(k, _)| k == "PATH")
        .map(|(_, v)| std::ffi::OsString::from(v))
        .unwrap_or_else(|| std::env::var_os("PATH").unwrap_or_default());

    // 没填工作目录就用项目路径
    let working_dir = if service.working_dir.trim().is_empty() {
        project_path
    } else {
        service.working_dir.clone()
    };
    let working_dir_path = PathBuf::from(&working_dir);

    let run_env = RunEnv {
        working_dir: &working_dir,
        overrides: &env_overrides,
        search_path: &search_path,
        kind: &service.kind,
        envs: &envs,
    };

    // 构建产物：Java 这类要先用项目绑定环境的 Maven 打包，有了产物才启动。
    // 产物比源码旧也得重新构建，不然跑的是老代码。
    let artifact = match service.artifact_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(base) => {
            let dir = match service
                .artifact_dir
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                Some(sub) => working_dir_path.join(sub),
                None => working_dir_path.clone(),
            };
            let existing = find_artifact(&dir, base);
            let usable = existing.filter(|p| !artifact_is_stale(p, &working_dir_path));
            match usable {
                Some(path) => Some(path),
                None => {
                    let build = service
                        .build_command
                        .as_deref()
                        .map(str::trim)
                        .filter(|c| !c.is_empty())
                        .ok_or_else(|| format!("缺少构建产物（{base}），也没有可用的构建命令"))?;
                    run_build_command(app, service_id, build, &run_env)?;
                    Some(
                        find_artifact(&dir, base)
                            .ok_or_else(|| format!("构建完成但仍找不到产物：{base}"))?,
                    )
                }
            }
        }
        None => None,
    };

    // 没有产物信息的命令：配了构建命令就先构建一次
    if artifact.is_none() {
        if let Some(build_command) = service
            .build_command
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty())
        {
            run_build_command(app, service_id, build_command, &run_env)?;
        }
    }

    // 启动命令里的产物占位符换成实际构建出来的文件
    let mut command_text = service.command.clone();
    if let Some(path) = &artifact {
        command_text = command_text.replace(
            crate::services::detector::ARTIFACT_PLACEHOLDER,
            &path.to_string_lossy(),
        );
    }
    if command_text.contains(crate::services::detector::ARTIFACT_PLACEHOLDER) {
        return Err("服务缺少构建产物，无法启动".to_string());
    }

    let (program, args) = split_command(&command_text);
    if program.is_empty() {
        return Err("启动命令为空".to_string());
    }
    let program = align_program_with_env(&program, &service.kind, &envs);
    let (program, args) = prepare_command(&program, &args, &search_path);

    let mut command = Command::new(&program);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if !working_dir.trim().is_empty() {
        command.current_dir(&working_dir);
    }
    for (key, value) in &env_overrides {
        command.env(key, value);
    }

    #[cfg(unix)]
    {
        // 独立进程组：停止时能连同子进程一起收掉
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("启动服务失败: {}", e))?;

    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    {
        let mut map = runtime_lock()?;
        map.insert(
            service_id.to_string(),
            ServiceRuntime {
                pid,
                started_at: chrono::Utc::now().timestamp_millis(),
                project_id: service.project_id.clone(),
            },
        );
    }

    {
        let mut map = logs_lock()?;
        map.entry(service_id.to_string()).or_default();
    }

    if let Some(stdout) = stdout {
        spawn_log_reader(stdout, app.clone(), service_id.to_string());
    }
    if let Some(stderr) = stderr {
        spawn_log_reader(stderr, app.clone(), service_id.to_string());
    }

    // 看门线程持有子进程句柄：进程一退出就摘登记并发事件，
    // 否则面板会一直显示「运行中」。
    let app_watch = app.clone();
    let id_watch = service_id.to_string();
    std::thread::spawn(move || {
        let status = child.wait();
        if let Ok(mut map) = runtime_lock() {
            map.remove(&id_watch);
        }
        let exit_code = status.ok().and_then(|s| s.code());
        let _ = app_watch.emit(
            "service:exit",
            serde_json::json!({
                "serviceId": id_watch,
                "exitCode": exit_code,
            }),
        );
    });

    Ok(())
}

/// 终止一个服务进程及其子进程。
fn terminate(service_id: &str, pid: u32) {
    #[cfg(unix)]
    {
        // 负 pid = 整个进程组，连孙进程一起收
        unsafe {
            libc::kill(-(pid as i32), libc::SIGTERM);
        }

        let deadline = std::time::Instant::now() + TERM_GRACE;
        while std::time::Instant::now() < deadline {
            if !is_running(service_id) {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }

        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }

    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .output();
    }
}

/// 停止服务。没在跑就直接返回。
pub fn stop_service(service_id: &str) -> Result<(), String> {
    let pid = {
        let map = runtime_lock()?;
        match map.get(service_id) {
            Some(runtime) => runtime.pid,
            None => return Ok(()),
        }
    };
    terminate(service_id, pid);
    Ok(())
}

/// 停止某个项目下正在跑的全部服务。删项目前调用，避免留下没人管得着的进程。
pub fn stop_project_services(project_id: &str) {
    let ids: Vec<String> = {
        let Ok(map) = runtime_lock() else {
            return;
        };
        map.iter()
            .filter(|(_, runtime)| runtime.project_id == project_id)
            .map(|(id, _)| id.clone())
            .collect()
    };
    for id in ids {
        let _ = stop_service(&id);
    }
}

/// 应用退出时停掉全部服务，不留孤儿进程。
pub fn stop_all_services() {
    let ids: Vec<String> = {
        let Ok(map) = runtime_lock() else {
            return;
        };
        map.keys().cloned().collect()
    };
    for id in ids {
        let _ = stop_service(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dev_env::{DevTool, TOOL_PYTHON};

    fn python_env(path: &str) -> DevEnvironment {
        DevEnvironment {
            id: "py".to_string(),
            kind: crate::dev_env::KIND_PYTHON.to_string(),
            name: "Python".to_string(),
            tools: vec![DevTool {
                tool: TOOL_PYTHON.to_string(),
                version: Some("3.12.3".to_string()),
                path: Some(path.to_string()),
            }],
            created_at: 0,
            updated_at: 0,
        }
    }

    /// 环境里的解释器叫 python3 时，命令里的 python 要跟着改，
    /// 否则按名字去找会找不到人。
    #[test]
    fn program_name_follows_the_bound_environment() {
        let envs = vec![python_env("/opt/python/bin/python3")];
        assert_eq!(
            align_program_with_env("python", crate::dev_env::KIND_PYTHON, &envs),
            "python3"
        );
        assert_eq!(
            align_program_with_env("python3", crate::dev_env::KIND_PYTHON, &envs),
            "python3"
        );
    }

    /// 没有绑定环境、或程序名与语言无关时保持原样。
    #[test]
    fn program_name_untouched_without_environment() {
        assert_eq!(align_program_with_env("python", crate::dev_env::KIND_PYTHON, &[]), "python");
        assert_eq!(
            align_program_with_env("npm", crate::dev_env::KIND_NODE, &[]),
            "npm"
        );
    }
}
