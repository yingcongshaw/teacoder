use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

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

    let (project_path, java_env_id, node_env_id) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT path, java_env_id, node_env_id FROM projects WHERE id = ?1")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;
        stmt.query_row([&service.project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| format!("Failed to query project env: {}", e))?
    };

    let (java_env, node_env) =
        crate::dev_env::load_project_envs(db, java_env_id.as_deref(), node_env_id.as_deref())?;
    let env_overrides = crate::dev_env::build_project_env(java_env.as_ref(), node_env.as_ref());

    // 用项目环境的 PATH 解析命令，否则可能跑到系统里另一个版本的 mvn/npm
    let search_path: std::ffi::OsString = env_overrides
        .iter()
        .find(|(k, _)| k == "PATH")
        .map(|(_, v)| std::ffi::OsString::from(v))
        .unwrap_or_else(|| std::env::var_os("PATH").unwrap_or_default());

    let (program, args) = split_command(&service.command);
    if program.is_empty() {
        return Err("启动命令为空".to_string());
    }
    let (program, args) = prepare_command(&program, &args, &search_path);

    let mut command = Command::new(&program);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // 没填工作目录就用项目路径
    let working_dir = if service.working_dir.trim().is_empty() {
        project_path
    } else {
        service.working_dir.clone()
    };
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
