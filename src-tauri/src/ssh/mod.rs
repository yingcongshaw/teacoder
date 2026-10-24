//! SSH 连接参数的单一权威来源。
//!
//! PTY 启动（`pty/manager.rs`）与文件传输（`ssh/transfer.rs`）都要把同一组连接参数
//! 拼成命令行。这里定义一次、两边共用：原先的拼装逻辑埋在 `manager.rs` 里，复制一份
//! 意味着任何加固都要改两处，迟早漂移。
//!
//! 隐含不变量（改动前先看测试）：
//! - PublicKey 优先于 Password；两者都空则交给 ssh 走 agent 与默认密钥。
//! - 端口选项**不在** [`SshArgs`] 的公共方法里产出：`ssh` 用小写 `-p`，`scp` 用大写
//!   `-P`，由各调用方按自己的语法追加。

pub mod askpass;
pub mod probe;
pub mod registry;
pub mod transfer;

use std::fmt;

/// SSH 连接参数。
#[derive(Default)]
pub struct SshArgs {
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub identity_file: String,
}

/// 手工实现 `Debug`，把密码挡在 `{:?}` 之外。
///
/// 派生实现会把明文写进任何一条 `eprintln!("{:?}", args)` —— 传输路径的报错信息
/// 里就可能带连接参数的整体打印。与 `redact_secrets` 是同一条纪律。
impl fmt::Debug for SshArgs {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SshArgs")
            .field("hostname", &self.hostname)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("password", &"<***>")
            .field("identity_file", &self.identity_file)
            .finish()
    }
}

/// ssh / scp 共用的认证方式。
pub enum SshAuth {
    /// 显式私钥路径（`-i`）。
    PublicKey(String),
    /// 密码，调用方需自行准备 `SSH_ASKPASS`。
    Password(String),
    /// 既无私钥也无密码：交给 ssh 走 agent 与默认密钥。
    AgentOrDefault,
}

impl SshArgs {
    /// `user@host`。用户名为空时退化为裸主机名，ssh 会用当前本地用户名。
    pub fn target(&self) -> String {
        if self.username.is_empty() {
            self.hostname.clone()
        } else {
            format!("{}@{}", self.username, self.hostname)
        }
    }

    /// 认证方式。PublicKey 优先于 Password。
    pub fn auth(&self) -> SshAuth {
        if !self.identity_file.is_empty() {
            SshAuth::PublicKey(self.identity_file.clone())
        } else if !self.password.is_empty() {
            SshAuth::Password(self.password.clone())
        } else {
            SshAuth::AgentOrDefault
        }
    }

    /// 认证相关的 `-o` 选项（不含 `-i`，私钥路径由调用方按自己的语法追加）。
    pub fn auth_opts(&self) -> Vec<String> {
        match self.auth() {
            SshAuth::PublicKey(_) => vec!["-o".into(), "PreferredAuthentications=publickey".into()],
            SshAuth::Password(_) => vec![
                "-o".into(),
                "PreferredAuthentications=password".into(),
                "-o".into(),
                "PubkeyAuthentication=no".into(),
            ],
            SshAuth::AgentOrDefault => Vec::new(),
        }
    }

    /// 三条调用方都会用到的 `-o`：两个首次连接友好的 host-key 选项。
    ///
    /// 刻意不含 `ConnectTimeout` —— 交互式 PTY 会话此前没有这个约束，
    /// 顺手加进去会让"握手慢但最终能连上"的远程在 10 秒后失败。
    /// 需要超时的短生命周期子进程（传输）自己追加。
    pub fn common_opts() -> Vec<String> {
        vec![
            "-o".into(),
            "StrictHostKeyChecking=no".into(),
            "-o".into(),
            "UserKnownHostsFile=/dev/null".into(),
        ]
    }

    /// 协议能力缓存的 key。同一主机的多次传输必须命中同一条记录，
    /// 否则每传一次都要双跑一遍才能发现「这台机器没装 sftp-server」。
    pub fn cache_key(&self) -> String {
        format!("{}@{}:{}", self.username, self.hostname, self.port)
    }
}

/// 解析 SSH 参数（从前端传入的 JSON 对象字符串）
/// 前端 serializeSshArgs() 返回的 JSON 形如：
///   {"hostname":"...","port":22,"username":"root","password":"...","identityFile":"..."}
/// 注意:SSH 的 cli_args 始终是 JSON 对象,不能用 `Vec<String>` 反序列化,
/// 否则会被静默丢弃(unwrap_or_default() → 空 vec),导致 ssh 以零参数启动。
pub fn parse_ssh_args(json_str: &str) -> Option<SshArgs> {
    let json: serde_json::Value = serde_json::from_str(json_str).ok()?;
    let obj = json.as_object()?;

    Some(SshArgs {
        hostname: obj.get("hostname").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        port: obj.get("port").and_then(|v| v.as_u64()).unwrap_or(22) as u16,
        username: obj.get("username").and_then(|v| v.as_str()).unwrap_or("root").to_string(),
        password: obj.get("password").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        identity_file: obj
            .get("identityFile")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

/// 打印前脱敏 JSON 中常见敏感字段，避免密码等原文落进 stderr 与日志采集。
///
/// 两处调用点都在失败分支，此时已无业务需要原文，故解析失败或结构异常时只返回
/// 元信息：回落到 `json.to_string()` 会把明文密码直接写进日志。
pub fn redact_secrets(json: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(json) {
        Ok(mut v) => {
            redact_value(&mut v);
            // 顶层是标量时无键名可依据，而 SSH 的 cli_args 约定必须是 JSON 对象，
            // 这类内容本身就可能是密码原文，只能整体屏蔽。
            if !v.is_object() && !v.is_array() {
                return "<非对象/数组的 JSON，已屏蔽>".to_string();
            }
            v.to_string()
        }
        Err(e) => format!("<无法解析的 JSON，长度 {}，错误: {e}>", json.len()),
    }
}

fn redact_value(v: &mut serde_json::Value) {
    const KEYS: &[&str] = &[
        "password", "passphrase", "token", "secret", "apiKey", "api_key", "privateKey",
        "private_key", "identityFile", "identity_file",
    ];
    match v {
        serde_json::Value::Object(map) => {
            for (k, val) in map.iter_mut() {
                if KEYS.iter().any(|name| name.eq_ignore_ascii_case(k)) {
                    *val = serde_json::Value::String("***".into());
                } else {
                    redact_value(val);
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr.iter_mut() {
                redact_value(item);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_masks_password_field() {
        let out = redact_secrets(
            r#"{"hostname":"10.0.0.1","username":"root","password":"hunter2"}"#,
        );
        assert!(!out.contains("hunter2"), "密码原文泄漏: {out}");
        assert!(out.contains("10.0.0.1"), "非敏感字段应保留: {out}");
    }

    /// 回归：解析失败时曾回落成原文，把明文密码直接写进 stderr。
    #[test]
    fn redact_does_not_leak_on_malformed_json() {
        let out = redact_secrets(r#"{"password":"hunter2""#);
        assert!(!out.contains("hunter2"), "密码原文泄漏: {out}");
        assert!(out.contains("无法解析"), "应说明无法解析: {out}");
    }

    /// 回归：顶层标量没有键名可依据，其内容本身就可能是密码。
    #[test]
    fn redact_masks_top_level_scalar() {
        assert!(!redact_secrets("\"hunter2\"").contains("hunter2"));
        assert!(!redact_secrets("42").contains("42"));
    }

    #[test]
    fn test_parse_ssh_args_valid() {
        let json = r#"{"hostname":"192.168.1.1","port":2222,"username":"admin","password":"secret","identityFile":""}"#;
        let parsed = parse_ssh_args(json).expect("should parse valid SSH JSON");
        assert_eq!(parsed.hostname, "192.168.1.1");
        assert_eq!(parsed.port, 2222);
        assert_eq!(parsed.username, "admin");
        assert_eq!(parsed.password, "secret");
        assert_eq!(parsed.identity_file, "");
    }

    #[test]
    fn test_parse_ssh_args_defaults() {
        // 缺省字段应使用默认值
        let json = r#"{"hostname":"host"}"#;
        let parsed = parse_ssh_args(json).expect("should parse minimal SSH JSON");
        assert_eq!(parsed.hostname, "host");
        assert_eq!(parsed.port, 22);
        assert_eq!(parsed.username, "root");
        assert_eq!(parsed.password, "");
        assert_eq!(parsed.identity_file, "");
    }

    #[test]
    fn test_parse_ssh_args_rejects_array() {
        // 数组形式(其他工具的 cli_args)不能作为 SSH 参数解析
        let json = r#"["--some-arg","value"]"#;
        assert!(parse_ssh_args(json).is_none());
    }

    #[test]
    fn test_parse_ssh_args_rejects_invalid_json() {
        assert!(parse_ssh_args("not-json").is_none());
        assert!(parse_ssh_args("").is_none());
    }

    #[test]
    fn target_uses_user_at_host() {
        let a = SshArgs {
            hostname: "10.0.0.1".into(),
            username: "root".into(),
            ..Default::default()
        };
        assert_eq!(a.target(), "root@10.0.0.1");
    }

    #[test]
    fn target_without_username_is_bare_host() {
        let a = SshArgs {
            hostname: "10.0.0.1".into(),
            username: String::new(),
            ..Default::default()
        };
        assert_eq!(a.target(), "10.0.0.1");
    }

    /// PublicKey 优先于 Password —— 两条路径都填了也只用私钥。
    #[test]
    fn auth_prefers_publickey_over_password() {
        let a = SshArgs {
            identity_file: "/home/u/.ssh/id_rsa".into(),
            password: "hunter2".into(),
            ..Default::default()
        };
        assert!(matches!(a.auth(), SshAuth::PublicKey(_)));
        assert!(!a.auth_opts().iter().any(|o| o.contains("password")));
    }

    #[test]
    fn auth_opts_password_disables_pubkey() {
        let a = SshArgs {
            password: "hunter2".into(),
            ..Default::default()
        };
        let opts = a.auth_opts();
        assert!(opts.iter().any(|o| o == "PreferredAuthentications=password"));
        assert!(opts.iter().any(|o| o == "PubkeyAuthentication=no"));
    }

    /// 两者都空时不能塞任何认证选项，否则会覆盖 ssh 的默认行为。
    #[test]
    fn auth_opts_empty_when_agent_or_default() {
        let a = SshArgs {
            hostname: "h".into(),
            ..Default::default()
        };
        assert!(matches!(a.auth(), SshAuth::AgentOrDefault));
        assert!(a.auth_opts().is_empty(), "应留空让 ssh 走 agent: {:?}", a.auth_opts());
    }

    #[test]
    fn common_opts_always_pin_host_key_policy() {
        let opts = SshArgs::common_opts();
        assert!(opts.iter().any(|o| o == "StrictHostKeyChecking=no"));
        assert!(opts.iter().any(|o| o == "UserKnownHostsFile=/dev/null"));
    }

    /// 回归：派生 Debug 会把密码写进任何一条 `{:?}` 日志。
    #[test]
    fn debug_masks_password() {
        let a = SshArgs {
            hostname: "10.0.0.1".into(),
            username: "root".into(),
            password: "hunter2".into(),
            ..Default::default()
        };
        let out = format!("{a:?}");
        assert!(!out.contains("hunter2"), "密码原文泄漏: {out}");
        assert!(out.contains("<***>"), "应显示占位符: {out}");
        assert!(out.contains("10.0.0.1") && out.contains("root"), "其余字段应保留: {out}");
    }
}