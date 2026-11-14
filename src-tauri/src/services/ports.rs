use std::collections::{BTreeSet, HashMap};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;

use crate::storage::AppDatabase;

/// 探测端口时的连接超时。
///
/// 本机端口没人监听时连接会立刻被拒，这个超时只是兜底，不会真的等满。
const PROBE_TIMEOUT: Duration = Duration::from_millis(200);

/// 单个配置文件的大小上限，避免读进巨大的文件。
const MAX_CONFIG_BYTES: u64 = 512 * 1024;

/// 配置文件里读出来的端口缓存多久（毫秒）。配置不会频繁变，缓存住省掉重复读盘。
const CACHE_TTL_MS: i64 = 60_000;

/// 端口候选缓存：service_id -> (缓存时刻, 端口)。
type ConfigCache = HashMap<String, (i64, Vec<u16>)>;

static CONFIG_CACHE: Lazy<Mutex<ConfigCache>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// 可能写着端口的配置文件，按服务类别分。
///
/// 同一个工程里常同时有 Java 与 Node 的服务，各写各的配置文件。
/// 读错类别就会把别人的端口算到自己头上。
fn config_files_for(kind: &str) -> &'static [&'static str] {
    match kind {
        crate::dev_env::KIND_JAVA => {
            &["application.properties", "application.yml", "application.yaml"]
        }
        crate::dev_env::KIND_NODE => &[
            "package.json",
            ".env",
            "vite.config.ts",
            "vite.config.js",
            "vue.config.js",
        ],
        crate::dev_env::KIND_DOTNET => &["appsettings.json", "Properties/launchSettings.json"],
        crate::dev_env::KIND_PYTHON => &[".env"],
        _ => &[".env"],
    }
}

/// Java 工程把配置放在资源目录里，位置是约定好的。
const RESOURCE_CONFIG_FILES: &[&str] = &[
    "application.properties",
    "application.yml",
    "application.yaml",
];

/// 探测服务占用的端口。
///
/// 服务没在跑就不占端口，直接返回空。端口来源有三条：
/// 框架打在日志里的端口最准，命令行参数其次，配置文件里的默认值最后。
/// 三条都只是「候选」，最后统一探一次 TCP —— 真有人在听才算数。
///
/// 端口必须只属于这一个服务 —— 同一工程下的多个子工程各占各的端口，
/// 不能把兄弟工程的端口也列到这一行上。
pub fn detect_ports(db: &AppDatabase, service_id: &str) -> Vec<u16> {
    if !crate::services::runtime::is_running(service_id) {
        return Vec::new();
    }

    let Ok(service) = crate::services::get_service(db, service_id) else {
        return Vec::new();
    };

    let logs = crate::services::runtime::service_logs(service_id, 200);
    let working_dir = resolve_working_dir(db, &service);

    let config_ports = config_candidates(service_id, working_dir.as_deref(), &service.kind);
    let mut candidates = port_candidates(&logs, &service.command, &config_ports);

    // Spring Boot 没配端口时默认 8080。只有在没别的候选时才补，
    // 免得别的服务占了 8080 却被算到这一行头上。
    if candidates.is_empty() && config_ports.is_empty() && service.command.contains("spring-boot") {
        candidates.insert(8080);
    }

    candidates.into_iter().filter(|port| is_listening(*port)).collect()
}

/// 汇总端口候选。
///
/// 日志与命令行里的端口一定属于这个服务自己，最准；配置文件里的端口未必 ——
/// 同一工程下常有多个子工程共用一份配置。所以只有前面都没线索时才用配置里的。
fn port_candidates(logs: &[String], command: &str, config: &[u16]) -> BTreeSet<u16> {
    let mut candidates: BTreeSet<u16> = BTreeSet::new();
    for line in logs {
        candidates.extend(ports_from_text(line));
    }
    candidates.extend(ports_from_text(command));

    if candidates.is_empty() {
        candidates.extend(config.iter().copied());
    }
    candidates
}

/// 服务的工作目录：填了就用填的，没填就退回项目路径。
fn resolve_working_dir(db: &AppDatabase, service: &crate::services::Service) -> Option<String> {
    if !service.working_dir.trim().is_empty() {
        return Some(service.working_dir.clone());
    }
    let conn = db.conn.lock().ok()?;
    let path: String = conn
        .query_row(
            "SELECT path FROM projects WHERE id = ?1",
            [&service.project_id],
            |row| row.get(0),
        )
        .ok()?;
    Some(path)
}

/// 从配置文件里找端口候选。结果按服务缓存，TTL 内不重复读盘。
fn config_candidates(service_id: &str, working_dir: Option<&str>, kind: &str) -> Vec<u16> {
    let Some(dir) = working_dir else {
        return Vec::new();
    };
    let root = Path::new(dir);
    if !root.is_dir() {
        return Vec::new();
    }

    let now = chrono::Utc::now().timestamp_millis();
    if let Ok(cache) = CONFIG_CACHE.lock() {
        if let Some((at, ports)) = cache.get(service_id) {
            if now - *at < CACHE_TTL_MS {
                return ports.clone();
            }
        }
    }

    let mut ports = BTreeSet::new();
    for file in collect_config_files(root, kind) {
        let Ok(meta) = std::fs::metadata(&file) else {
            continue;
        };
        if meta.len() > MAX_CONFIG_BYTES {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&file) else {
            continue;
        };
        ports.extend(ports_from_text(&text));
    }

    let result: Vec<u16> = ports.into_iter().collect();
    if let Ok(mut cache) = CONFIG_CACHE.lock() {
        cache.insert(service_id.to_string(), (now, result.clone()));
    }
    result
}

/// 找出服务自己工程目录下的配置文件。
///
/// 不再往子目录里钻 —— 一个工程下往往有多个子工程（多模块），
/// 钻进去会把兄弟工程的端口也读进来，三个 Spring 模块就会互相串号。
/// 只读该服务类别认的那几种配置，别的类别的配置不碰。
fn collect_config_files(root: &Path, kind: &str) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    for name in config_files_for(kind) {
        let path = root.join(name);
        if path.is_file() {
            out.push(path);
        }
    }
    if kind == crate::dev_env::KIND_JAVA {
        for name in RESOURCE_CONFIG_FILES {
            let path = root.join("src").join("main").join("resources").join(name);
            if path.is_file() {
                out.push(path);
            }
        }
    }
    out.sort();
    out
}

/// 从一段文本里捞出可能的端口。
///
/// 认两种写法：`port` 关键词后跟数字（server.port=8080、port(s): 8080），
/// 以及地址里的端口（http://localhost:8080）。
pub fn ports_from_text(text: &str) -> BTreeSet<u16> {
    let mut out = BTreeSet::new();
    let lower = text.to_ascii_lowercase();

    let mut idx = 0;
    while let Some(pos) = lower[idx..].find("port") {
        let start = idx + pos;
        idx = start + 4;
        if let Some(port) = port_after_keyword(&lower[start + 4..]) {
            out.insert(port);
        }
    }

    for port in ports_from_urls(&lower) {
        out.insert(port);
    }

    out
}

/// `port` 关键词后面的数字。
///
/// 关键词后面必须紧跟分隔符或数字 —— `portable`、`important` 这类词不能算数。
fn port_after_keyword(rest: &str) -> Option<u16> {
    let mut s = rest.trim_start();
    for suffix in ["(s)", "(es)"] {
        if let Some(after) = s.strip_prefix(suffix) {
            s = after.trim_start();
            break;
        }
    }
    let s = s.trim_start_matches([':', '=', '-', '"', '\'']);
    let s = s.trim_start();
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    parse_port(&digits)
}

/// 地址里的端口。
fn ports_from_urls(lower: &str) -> BTreeSet<u16> {
    let mut out = BTreeSet::new();
    let markers = ["://", "localhost:", "127.0.0.1:", "0.0.0.0:", "[::1]:", "[::]:"];
    for marker in markers {
        let mut idx = 0;
        while let Some(pos) = lower[idx..].find(marker) {
            let start = idx + pos + marker.len();
            idx = start;
            let tail = if marker == "://" {
                // 跳过主机名再找端口分隔符
                match lower[start..].find(':') {
                    Some(p) => &lower[start + p + 1..],
                    None => continue,
                }
            } else {
                &lower[start..]
            };
            let digits: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Some(port) = parse_port(&digits) {
                out.insert(port);
            }
        }
    }
    out
}

fn parse_port(digits: &str) -> Option<u16> {
    if digits.is_empty() || digits.len() > 5 {
        return None;
    }
    let port: u16 = digits.parse().ok()?;
    if port == 0 {
        return None;
    }
    Some(port)
}

/// 这个端口上真的有人在听吗。
///
/// 配置文件里写着的端口未必生效（被别的进程占了、或者压根没起），
/// 探一次连接才能确定服务确实占着它。
fn is_listening(port: u16) -> bool {
    let v4 = SocketAddr::from((std::net::Ipv4Addr::LOCALHOST, port));
    if TcpStream::connect_timeout(&v4, PROBE_TIMEOUT).is_ok() {
        return true;
    }
    let v6 = SocketAddr::from((std::net::Ipv6Addr::LOCALHOST, port));
    TcpStream::connect_timeout(&v6, PROBE_TIMEOUT).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ports(text: &str) -> Vec<u16> {
        ports_from_text(text).into_iter().collect()
    }

    #[test]
    fn reads_port_from_property_file() {
        assert_eq!(ports("server.port=8080"), vec![8080]);
        assert_eq!(ports("  server.port: 9090\n"), vec![9090]);
    }

    #[test]
    fn reads_port_from_command_line() {
        assert_eq!(ports("mvn spring-boot:run --server.port=8800"), vec![8800]);
        assert_eq!(ports("node index.js --port 3000"), vec![3000]);
        assert_eq!(ports("PORT=5173 npm start"), vec![5173]);
    }

    #[test]
    fn reads_port_from_log_line() {
        assert_eq!(ports("Tomcat started on port(s): 8080 (http)"), vec![8080]);
        assert_eq!(ports("Server running at http://localhost:8080"), vec![8080]);
    }

    #[test]
    fn ignores_words_that_merely_contain_port() {
        assert!(ports("important portable support export").is_empty());
        assert!(ports("port is unknown").is_empty());
    }

    #[test]
    fn ignores_out_of_range_ports() {
        assert!(ports("port 99999").is_empty());
        assert!(ports("port 0").is_empty());
    }

    #[test]
    fn config_ports_stay_inside_the_service_project() {
        let root = std::env::temp_dir().join(format!("teacoder-ports-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("建临时目录");
        for (name, port) in [("service-a", 81u16), ("service-b", 82)] {
            let dir = root.join(name).join("src").join("main").join("resources");
            std::fs::create_dir_all(&dir).expect("建目录");
            std::fs::write(
                dir.join("application.properties"),
                format!("server.port={port}\n"),
            )
            .expect("写配置");
        }

        let a = root.join("service-a");
        let b = root.join("service-b");
        assert_eq!(
            config_candidates("svc-a", a.to_str(), crate::dev_env::KIND_JAVA),
            vec![81],
            "A 服务只该看到自己的端口"
        );
        assert_eq!(
            config_candidates("svc-b", b.to_str(), crate::dev_env::KIND_JAVA),
            vec![82],
            "B 服务只该看到自己的端口"
        );
        assert!(
            config_candidates("svc-root", root.to_str(), crate::dev_env::KIND_JAVA).is_empty(),
            "工程根目录不该把子工程的端口都读进来"
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn config_files_are_picked_by_service_kind() {
        let dir = std::env::temp_dir().join(format!("teacoder-ports-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("建临时目录");
        std::fs::write(dir.join("application.yml"), "server:\n  port: 8080\n").expect("写配置");
        std::fs::write(dir.join("package.json"), "{\"scripts\":{\"start\":\"node index.js --port 3000\"}}")
            .expect("写配置");

        assert_eq!(
            config_candidates("java-svc", dir.to_str(), crate::dev_env::KIND_JAVA),
            vec![8080],
            "Java 服务不该读到 Node 的端口"
        );
        assert_eq!(
            config_candidates("node-svc", dir.to_str(), crate::dev_env::KIND_NODE),
            vec![3000],
            "Node 服务不该读到 Java 的端口"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn log_ports_win_over_config_ports() {
        let logs = vec!["Tomcat started on port(s): 81 (http)".to_string()];
        let candidates = port_candidates(&logs, "java -jar {artifact}", &[81, 82, 83]);
        assert_eq!(
            candidates.into_iter().collect::<Vec<u16>>(),
            vec![81],
            "日志里的端口最准，不该再叠上配置里的其它端口"
        );
    }

    #[test]
    fn config_ports_are_used_when_nothing_else_knows() {
        let candidates = port_candidates(&[], "java -jar {artifact}", &[81]);
        assert_eq!(candidates.into_iter().collect::<Vec<u16>>(), vec![81]);
    }
}
