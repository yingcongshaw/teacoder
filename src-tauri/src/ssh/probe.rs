//! 远程当前目录的探测。
//!
//! 走一条**独立的短连接**执行 `pwd`，而不是往用户的交互式终端里敲探测命令。
//! 后者会把命令和它的输出留在终端里 —— 每次打开文件传输面板都刷一屏
//! `echo "__TEACODE_PWD__…"` —— 用户明确要求过不要这个。

use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

use super::askpass::AskpassGuard;
use super::{SshArgs, SshAuth};

/// 探测超时。远端不可达时不能把调用方（面板）一直挂住。
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, thiserror::Error)]
pub enum ProbeError {
    #[error("远程目录探测超时")]
    Timeout,
    #[error("未能执行 ssh: {0}")]
    Spawn(String),
    #[error("远程目录探测失败: {0}")]
    Remote(String),
    #[error("远程目录探测未返回绝对路径")]
    NotAbsolute,
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

/// 探测远端当前工作目录。
///
/// 返回远端账号的**登录目录**（sshd 启动登录 shell 时的 cwd，通常是 home）。
/// 拿不到「交互会话里 `cd` 之后的目录」—— 独立连接看不到交互会话的状态。
/// 面板里的输入框始终可编辑，用户要别的路径直接改。
pub async fn probe_remote_cwd(ssh: &SshArgs) -> Result<String, ProbeError> {
    let mut cmd = Command::new("ssh");
    cmd.args(build_ssh(ssh));
    cmd.arg(ssh.target());
    cmd.arg("pwd");
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    // 兜住超时 / 任务被丢弃时残留的孤儿 ssh
    cmd.kill_on_drop(true);

    // askpass guard 必须活到命令结束 —— 提前 Drop 会让 ssh 要密码时读不到脚本
    let _askpass = match ssh.auth() {
        SshAuth::Password(p) => {
            let guard = AskpassGuard::create(&p).map_err(ProbeError::Spawn)?;
            cmd.env("SSH_ASKPASS", guard.script_path());
            cmd.env("SSH_ASKPASS_REQUIRE", "force");
            Some(guard)
        }
        _ => None,
    };

    let out = tokio::time::timeout(PROBE_TIMEOUT, cmd.output())
        .await
        .map_err(|_| ProbeError::Timeout)?
        .map_err(|e| ProbeError::Spawn(e.to_string()))?;

    if !out.status.success() {
        return Err(ProbeError::Remote(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let path = stdout
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with('/'))
        .unwrap_or_default()
        .to_string();
    if path.is_empty() {
        return Err(ProbeError::NotAbsolute);
    }
    eprintln!("[SSH-PROBE] {} -> {path}", ssh.target());
    Ok(path)
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
}

