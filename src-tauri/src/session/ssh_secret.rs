//! SSH 会话密码的落库编码。
//!
//! `sessions.cli_args` 是跨工具通用的参数字段，SSH 会话把连接参数（含密码）
//! 以 JSON 对象形式存进去。为了不让明文密码躺在 SQLite 里，写库时把 `password`
//! 字段编码成 `b64:<base64>`，读库时还原。
//!
//! 契约：`cli_args` 跨 IPC 边界时始终是明文，只有落 SQLite 的那一刻是 base64。
//! 因此前端与 `pty::manager::parse_ssh_args` 都不需要感知编码。
//!
//! 兼容性：本模块上线前写入的 SSH 密码没有 `b64:` 前缀，按明文原样处理；
//! 用户下次编辑保存该会话时自动升级为编码格式，无需数据迁移。

use base64::Engine;
use serde_json::Value;

/// 编码标记前缀。字段无此前缀 = 历史明文。
const PREFIX: &str = "b64:";

fn engine() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

/// 从 cli_args JSON 对象里取字符串形态的 password 字段。
/// 非 JSON、非对象、无 password 或 password 非字符串时返回 None。
fn read_password(cli_args: &str) -> Option<String> {
    let value: Value = serde_json::from_str(cli_args).ok()?;
    value.get("password")?.as_str().map(str::to_string)
}

/// 回写 password 字段并重新序列化。serde_json::Value 的 object 是 BTreeMap，
/// 键序会按字母序归一 —— 与前端写入时的键序不同，但取值一律按字段名，语义无影响。
fn write_password(cli_args: &str, password: &str) -> Option<String> {
    let mut value: Value = serde_json::from_str(cli_args).ok()?;
    value
        .as_object_mut()?
        .insert("password".to_string(), Value::String(password.to_string()));
    serde_json::to_string(&value).ok()
}

/// 写库前：明文密码 → `b64:<base64>`。
/// 非 SSH 工具、无 cli_args、非 JSON 对象、无密码字段、密码为空或已编码时原样返回。
pub fn encode_cli_args(tool_type: &str, cli_args: Option<String>) -> Option<String> {
    if tool_type != "ssh" {
        return cli_args;
    }
    let args = cli_args?;
    let password = match read_password(&args) {
        Some(p) if !p.is_empty() && !p.starts_with(PREFIX) => p,
        // 空密码不值得编码，`b64:` 只会让 DB 多一个无信息量的前缀
        _ => return Some(args),
    };
    let encoded = format!("{PREFIX}{}", engine().encode(password.as_bytes()));
    write_password(&args, &encoded).or(Some(args))
}

/// 读库后：`b64:<base64>` → 明文。无前缀的历史明文原样返回。
///
/// 解码失败（数据损坏、手工改过 DB）时保留原值并打日志：宁可让连接失败，
/// 也不要把一段不可用的字节串当成密码写进 askpass 临时文件。
pub fn decode_cli_args(tool_type: &str, cli_args: Option<String>) -> Option<String> {
    if tool_type != "ssh" {
        return cli_args;
    }
    let args = cli_args?;
    let password = match read_password(&args) {
        Some(p) => p,
        None => return Some(args),
    };
    let Some(encoded) = password.strip_prefix(PREFIX) else {
        return Some(args);
    };
    let decoded = engine()
        .decode(encoded)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok());
    match decoded {
        Some(plain) => write_password(&args, &plain).or(Some(args)),
        None => {
            eprintln!("[session] SSH 密码 base64 解码失败，保留原值: {encoded}");
            Some(args)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_cli_args, encode_cli_args};

    fn pwd_of(args: Option<String>) -> String {
        let v: serde_json::Value = serde_json::from_str(&args.expect("cli_args 应存在")).unwrap();
        v["password"].as_str().unwrap().to_string()
    }

    fn ssh(json: &str) -> Option<String> {
        Some(json.to_string())
    }

    #[test]
    fn round_trip_restores_plaintext() {
        let encoded = encode_cli_args("ssh", ssh(r#"{"password":"P@ss w0rd/中"}"#));
        assert_eq!(pwd_of(encoded.clone()), "b64:UEBzcyB3MHJkL+S4rQ==");
        assert_eq!(pwd_of(decode_cli_args("ssh", encoded)), "P@ss w0rd/中");
    }

    #[test]
    fn round_trip_preserves_other_fields() {
        let original = r#"{"hostname":"h","port":22,"username":"root","password":"p","identityFile":""}"#;
        let encoded = encode_cli_args("ssh", ssh(original)).unwrap();
        let decoded = decode_cli_args("ssh", Some(encoded)).unwrap();
        let v: serde_json::Value = serde_json::from_str(&decoded).unwrap();
        assert_eq!(v["hostname"], "h");
        assert_eq!(v["port"], 22);
        assert_eq!(v["username"], "root");
        assert_eq!(v["password"], "p");
        assert_eq!(v["identityFile"], "");
    }

    #[test]
    fn legacy_plaintext_passes_through_decode() {
        let legacy = r#"{"hostname":"h","password":"明文密码"}"#;
        assert_eq!(
            decode_cli_args("ssh", ssh(legacy)).unwrap(),
            legacy
        );
    }

    #[test]
    fn legacy_plaintext_is_upgraded_on_next_encode() {
        let encoded = encode_cli_args("ssh", ssh(r#"{"password":"pw"}"#)).unwrap();
        assert!(pwd_of(Some(encoded)).starts_with("b64:"));
    }

    #[test]
    fn empty_password_is_not_encoded() {
        let original = r#"{"password":""}"#;
        assert_eq!(encode_cli_args("ssh", ssh(original)).unwrap(), original);
    }

    #[test]
    fn already_encoded_is_idempotent() {
        let once = encode_cli_args("ssh", ssh(r#"{"password":"pw"}"#)).unwrap();
        let twice = encode_cli_args("ssh", Some(once.clone())).unwrap();
        assert_eq!(once, twice);
    }

    #[test]
    fn non_ssh_tool_untouched() {
        let claude = r#"["--resume","abc"]"#;
        assert_eq!(encode_cli_args("claude", ssh(claude)).unwrap(), claude);
        assert_eq!(decode_cli_args("claude", ssh(claude)).unwrap(), claude);
    }

    #[test]
    fn ssh_json_array_untouched() {
        // SSH 正常是 JSON 对象；若历史数据是数组，不应被当作对象改写
        let arr = r#"["--foo"]"#;
        assert_eq!(encode_cli_args("ssh", ssh(arr)).unwrap(), arr);
    }

    #[test]
    fn malformed_json_untouched() {
        let bad = "not-json";
        assert_eq!(encode_cli_args("ssh", ssh(bad)).unwrap(), bad);
        assert_eq!(decode_cli_args("ssh", ssh(bad)).unwrap(), bad);
    }

    #[test]
    fn corrupt_base64_preserved() {
        let corrupt = r#"{"password":"b64:!!!!"}"#;
        assert_eq!(
            decode_cli_args("ssh", ssh(corrupt)).unwrap(),
            corrupt
        );
    }

    #[test]
    fn none_stays_none() {
        assert!(encode_cli_args("ssh", None).is_none());
        assert!(decode_cli_args("ssh", None).is_none());
    }
}
