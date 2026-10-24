//! 远程命令执行：探测当前目录、浏览远程目录。
//!
//! 一律走**独立的短连接**，而不是往用户的交互式终端里敲命令 —— 后者会把
//! 命令和输出留在终端里（每次打开文件传输面板都刷一屏
//! `echo "__TEACODE_PWD__…"`），用户明确要求过不要这个。

use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

use super::askpass::AskpassGuard;
use super::{SshArgs, SshAuth};
use crate::fsdir::DirEntry;

/// 探测超时。远端不可达时不能把调用方（面板）一直挂住。
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
/// 列目录比 `pwd` 慢一点（远程可能是个网关）。
const LIST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, thiserror::Error)]
pub enum RemoteError {
    #[error("远程命令超时")]
    Timeout,
    #[error("未能执行 ssh: {0}")]
    Spawn(String),
    #[error("远程命令失败: {0}")]
    Failed(String),
    #[error("远程返回无法解析: {0}")]
    BadOutput(String),
}

/// 拼出 `ssh` 的参数前缀。
///
/// 与 `transfer::build_scp` 用同一套连接参数，但 `ssh` 是小写 `-p` 表示端口
/// （`scp` 是大写 `-P`）。少一个字母 ssh 会把端口当主机名的一部分。
pub fn build_ssh(ssh: &SshArgs) -> Vec<String> {
    let mut a: Vec<String> = vec!["-o".into(), "ConnectTimeout=10".into()];
    a.extend(SshArgs::common_opts());
    a.extend(ssh.auth_opts());
    if let SshAuth::PublicKey(key) = ssh.auth() {
        a.push("-i".into());
        a.push(key);
    }
    if ssh.port != 22 {
        a.push("-p".into());
        a.push(ssh.port.to_string());
    }
    a
}

/// POSIX 单引号转义。
///
/// 远端命令是**交给远端 shell 解析的字符串**（不是 argv），所以路径必须
/// 自己加引号。这与 scp 的 SFTP 模式正相反：那里路径按字面解析，加引号
/// 反而把引号写进路径。
pub fn shell_quote(path: &str) -> String {
    format!("'{}'", path.replace('\'', r"'\''"))
}

/// 在远端跑一条 shell 命令并取回标准输出。
pub async fn run_remote(
    ssh: &SshArgs,
    command: &str,
    timeout: Duration,
) -> Result<String, RemoteError> {
    let mut cmd = Command::new("ssh");
    cmd.args(build_ssh(ssh));
    cmd.arg(ssh.target());
    cmd.arg(command);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    // 兜住超时 / 任务被丢弃时残留的孤儿 ssh
    cmd.kill_on_drop(true);

    // askpass guard 必须活到命令结束 —— 提前 Drop 会让 ssh 要密码时读不到脚本
    let _askpass = match ssh.auth() {
        SshAuth::Password(p) => {
            let guard = AskpassGuard::create(&p).map_err(RemoteError::Spawn)?;
            cmd.env("SSH_ASKPASS", guard.script_path());
            cmd.env("SSH_ASKPASS_REQUIRE", "force");
            Some(guard)
        }
        _ => None,
    };

    let out = tokio::time::timeout(timeout, cmd.output())
        .await
        .map_err(|_| RemoteError::Timeout)?
        .map_err(|e| RemoteError::Spawn(e.to_string()))?;

    if !out.status.success() {
        return Err(RemoteError::Failed(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// 探测远端当前工作目录。
///
/// 返回远端账号的**登录目录**（sshd 启动登录 shell 时的 cwd，通常是 home）。
/// 拿不到「交互会话里 cd 之后的目录」—— 独立连接看不到交互会话的状态。
/// 面板里的输入框始终可编辑，用户要别的路径直接改。
pub async fn probe_remote_cwd(ssh: &SshArgs) -> Result<String, RemoteError> {
    let out = run_remote(ssh, "pwd", PROBE_TIMEOUT).await?;
    let path = out
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with('/'))
        .unwrap_or_default()
        .to_string();
    if path.is_empty() {
        return Err(RemoteError::BadOutput(
            "远程目录探测未返回绝对路径".to_string(),
        ));
    }
    eprintln!("[SSH-PROBE] {} -> {path}", ssh.target());
    Ok(path)
}

/// 列出远程目录。
///
/// 优先用 GNU find 的 `-printf` 一次拿到 类型/大小/时间/名字；远端没有
/// GNU find（busybox、macOS）就退回 POSIX 口径的 `ls -A1` + 逐项判目录。
/// 两条命令输出同一套制表符分隔的格式，解析只有一份。
pub async fn list_dir(ssh: &SshArgs, path: &str) -> Result<Vec<DirEntry>, RemoteError> {
    if path.chars().any(|c| c.is_control()) {
        return Err(RemoteError::BadOutput("路径含控制字符".into()));
    }
    let dir = shell_quote(path);

    let primary = format!(
        "cd -- {dir} 2>/dev/null || exit 3; \
         find . -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n'"
    );
    match run_remote(ssh, &primary, LIST_TIMEOUT).await {
        Ok(out) => Ok(parse_listing(&out, path)),
        Err(first) => {
            let fallback = format!(
                "cd -- {dir} 2>/dev/null || exit 3; \
                 ls -A1 | while IFS= read -r n; do \
                   if [ -d \"$n\" ]; then printf 'd\\t0\\t0\\t%s\\n' \"$n\"; \
                   else printf 'f\\t0\\t0\\t%s\\n' \"$n\"; fi; done"
            );
            match run_remote(ssh, &fallback, LIST_TIMEOUT).await {
                Ok(out) => Ok(parse_listing(&out, path)),
                Err(second) => Err(match second {
                    // 回退也失败时，报第一次的错误更有信息量
                    RemoteError::Failed(_) => first,
                    other => other,
                }),
            }
        }
    }
}

/// 解析制表符分隔的目录列表：`类型\t大小\t时间戳\t名字`。
///
/// 名字里可能带制表符，所以按前三个制表符切、剩下的整体当名字。
fn parse_listing(out: &str, base: &str) -> Vec<DirEntry> {
    let mut entries = Vec::new();
    for line in out.lines() {
        if line.is_empty() {
            continue;
        }
        let mut parts = line.splitn(4, '\t');
        let kind = parts.next().unwrap_or("").trim();
        let size = parts.next().unwrap_or("0").trim();
        let mtime = parts.next().unwrap_or("0").trim();
        let name = parts.next().unwrap_or("");
        if name.is_empty() {
            continue;
        }
        entries.push(DirEntry {
            path: join_remote(base, name),
            // find 的 %y：d 目录、f 普通文件、l 符号链接。
            // 符号链接按文件处理 —— 目标是不是目录要再开一次连接才知道，不值当。
            is_dir: kind == "d",
            size: size.parse().unwrap_or(0),
            modified: mtime
                .split('.')
                .next()
                .and_then(|s| s.trim().parse::<i64>().ok()),
            name: name.to_string(),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    entries
}

/// 远程路径拼接。`base` 是目录，`name` 是条目名。
fn join_remote(base: &str, name: &str) -> String {
    if base.ends_with('/') {
        format!("{base}{name}")
    } else {
        format!("{base}/{name}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(host: &str, port: u16, user: &str, password: &str, key: &str) -> SshArgs {
        SshArgs {
            hostname: host.to_string(),
            port,
            username: user.to_string(),
            password: password.to_string(),
            identity_file: key.to_string(),
        }
    }

    #[test]
    fn build_ssh_uses_lowercase_p_for_port() {
        // ssh 是小写 -p，scp 是大写 -P —— 写错会把端口并进主机名
        let a = build_ssh(&args("h", 10022, "root", "pw", ""));
        assert!(a.windows(2).any(|w| w == ["-p", "10022"]), "应有 -p 10022");
        assert!(!a.windows(2).any(|w| w == ["-P", "10022"]), "不该出现 -P");
    }

    #[test]
    fn build_ssh_omits_port_when_default() {
        let a = build_ssh(&args("h", 22, "root", "pw", ""));
        assert!(!a.iter().any(|x| x == "-p"));
    }

    #[test]
    fn build_ssh_adds_identity_flag() {
        let a = build_ssh(&args("h", 22, "root", "", "/tmp/id_ed25519"));
        assert!(a.windows(2).any(|w| w == ["-i", "/tmp/id_ed25519"]));
    }

    #[test]
    fn build_ssh_never_contains_password() {
        let a = build_ssh(&args("h", 22, "root", "hunter2", ""));
        assert!(!a.iter().any(|x| x.contains("hunter2")));
    }

    #[test]
    fn build_ssh_contains_both_host_key_opts() {
        let a = build_ssh(&args("h", 22, "root", "pw", ""));
        assert!(a.iter().any(|x| x == "StrictHostKeyChecking=no"));
        assert!(a.iter().any(|x| x == "UserKnownHostsFile=/dev/null"));
    }

    #[test]
    fn shell_quote_wraps_and_escapes_single_quotes() {
        assert_eq!(shell_quote("/root/a b"), "'/root/a b'");
        assert_eq!(shell_quote("/root/it's"), r"'/root/it'\''s'");
    }

    #[test]
    fn parses_a_find_listing() {
        let out = "f\t640\t1695000000.1234567\tsome file.txt\n\
                   d\t4096\t1695000001\tfolder\n";
        let entries = parse_listing(out, "/root");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "folder");
        assert!(entries[0].is_dir);
        assert_eq!(entries[0].path, "/root/folder");
        assert_eq!(entries[1].name, "some file.txt");
        assert!(!entries[1].is_dir);
        assert_eq!(entries[1].size, 640);
        assert_eq!(entries[1].modified, Some(1695000000));
    }

    #[test]
    fn listing_keeps_tabs_inside_the_name() {
        let out = "f\t10\t100\tweird\tname.txt\n";
        let entries = parse_listing(out, "/root");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "weird\tname.txt");
    }

    #[test]
    fn listing_joins_paths_correctly() {
        assert_eq!(join_remote("/root", "a.txt"), "/root/a.txt");
        assert_eq!(join_remote("/root/", "a.txt"), "/root/a.txt");
        assert_eq!(join_remote("/", "a.txt"), "/a.txt");
    }

    #[test]
    fn rejects_paths_with_control_characters() {
        // 控制字符会把远端命令拆成多行 —— 直接拒绝，不进 shell
        let ssh = args("h", 22, "root", "pw", "");
        let rt = tokio::runtime::Runtime::new().unwrap();
        let err = rt.block_on(list_dir(&ssh, "/root/a\nrm -rf /")).unwrap_err();
        assert!(matches!(err, RemoteError::BadOutput(_)));
    }
}
