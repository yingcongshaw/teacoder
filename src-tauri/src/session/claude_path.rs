use std::path::PathBuf;

/// 编码后项目目录名的长度上限，超出则截断并追加哈希后缀。
const MAX_ENCODED_LEN: usize = 200;

/// Claude Code 将工作目录路径编码为项目目录名的规则：
/// 把每一个不在 `[A-Za-z0-9]` 内的字符替换为 `-`，而非只替换路径分隔符。
/// 因此含中文、空格、点号、下划线的目录名同样会被整体改写。
///
/// 编码结果超过 `MAX_ENCODED_LEN` 时，截断到前 `MAX_ENCODED_LEN` 个字符并追加
/// `-` + 原始路径的 32 位哈希（base36），以避免长路径撞名。
pub fn encode_project_dir_name(work_dir: &str) -> String {
    // Rust 的 char 是 Unicode 标量值，JS 的 String 按 UTF-16 code unit 遍历。
    // 两者仅在星形平面字符（emoji、部分生僻汉字）上不一致：星形字符占两个 code unit，
    // 在 Claude Code 中会变成两个 `-`，故这里显式按 code unit 迭代。
    // 编码结果只可能是 ASCII 字母数字或 `-`，因此后续按字节截断是安全的。
    let encoded: String = work_dir
        .encode_utf16()
        .map(|unit| match char::from_u32(u32::from(unit)) {
            Some(c) if c.is_ascii_alphanumeric() => c,
            _ => '-',
        })
        .collect();

    if encoded.len() <= MAX_ENCODED_LEN {
        return encoded;
    }
    let truncated = &encoded[..MAX_ENCODED_LEN];
    format!("{truncated}-{}", hash_suffix_base36(work_dir))
}

/// 复刻 Claude Code 的 32 位字符串哈希并按 base36 输出。
///
/// 逐 UTF-16 code unit 累加 `e = (e << 5) - e + code`，每步截断为 int32。
/// 末尾取绝对值转 base36；`unsigned_abs` 可正确处理 int32 最小值取绝对值的情况。
fn hash_suffix_base36(value: &str) -> String {
    let mut hash: i32 = 0;
    for unit in value.encode_utf16() {
        hash = hash
            .wrapping_shl(5)
            .wrapping_sub(hash)
            .wrapping_add(i32::from(unit));
    }

    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut n = hash.unsigned_abs();
    let mut buf = Vec::new();
    while n > 0 {
        buf.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    if buf.is_empty() {
        return "0".to_string();
    }
    buf.reverse();
    String::from_utf8(buf).unwrap_or_default()
}

/// 解析 Claude Code 的配置根目录。`claude_config_dir` 为空或缺失时回落到 `~/.claude`。
fn claude_base_dir(claude_config_dir: Option<&str>) -> Option<PathBuf> {
    match claude_config_dir {
        Some(dir) if !dir.is_empty() => Some(PathBuf::from(dir)),
        _ => Some(dirs::home_dir()?.join(".claude")),
    }
}

/// 解析 Claude Code 的项目目录 `<base>/projects/<encoded_work_dir>`。
pub fn resolve_claude_projects_dir(claude_config_dir: Option<&str>, work_dir: &str) -> Option<PathBuf> {
    let base = claude_base_dir(claude_config_dir)?;
    Some(base.join("projects").join(encode_project_dir_name(work_dir)))
}

/// 解析单个会话的 Claude 会话文件 `<projects_dir>/<cli_session_id>.jsonl`。
pub fn resolve_session_jsonl(
    claude_config_dir: Option<&str>,
    work_dir: &str,
    cli_session_id: &str,
) -> Option<PathBuf> {
    let dir = resolve_claude_projects_dir(claude_config_dir, work_dir)?;
    Some(dir.join(format!("{cli_session_id}.jsonl")))
}

/// 在所有 Claude 项目目录中按 `cli_session_id` 反查会话文件。
///
/// `cli_session_id` 全局唯一，因此当编码后的目录名对不上（编码规则与 Claude Code
/// 版本不一致、或会话本就记录在另一个目录下）时，遍历查找比直接判否更可靠。
pub fn find_session_jsonl_anywhere(
    claude_config_dir: Option<&str>,
    cli_session_id: &str,
) -> Option<PathBuf> {
    let base = claude_base_dir(claude_config_dir)?.join("projects");
    let file_name = format!("{cli_session_id}.jsonl");
    let entries = std::fs::read_dir(base).ok()?;
    for entry in entries.filter_map(std::result::Result::ok) {
        let candidate = entry.path().join(&file_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{MAX_ENCODED_LEN, encode_project_dir_name, resolve_session_jsonl};

    #[test]
    fn encode_unix_path() {
        assert_eq!(
            encode_project_dir_name("/work/CodingTea/proj"),
            "-work-CodingTea-proj"
        );
    }

    #[test]
    fn encode_windows_path() {
        assert_eq!(
            encode_project_dir_name("C:\\Users\\me\\proj"),
            "C--Users-me-proj"
        );
    }

    #[test]
    fn encode_root() {
        assert_eq!(encode_project_dir_name("/"), "-");
    }

    /// 中文目录名必须逐字符替换：只换分隔符会得到与 Claude Code 不同的目录名。
    #[test]
    fn encode_cjk_path_matches_claude_code() {
        assert_eq!(
            encode_project_dir_name("/work/Yndth/承元/src/drl-smart-platform"),
            "-work-Yndth----src-drl-smart-platform"
        );
        assert_eq!(
            encode_project_dir_name("/work/Yndth/Hr/制度/研发部"),
            "-work-Yndth-Hr-------"
        );
    }

    #[test]
    fn encode_replaces_dot_and_underscore() {
        assert_eq!(
            encode_project_dir_name("/home/me/my_repo.v2"),
            "-home-me-my-repo-v2"
        );
    }

    /// 星形平面字符在 JS 中占两个 UTF-16 code unit，应替换为两个 `-`。
    #[test]
    fn encode_astral_char_yields_two_dashes() {
        assert_eq!(encode_project_dir_name("/tmp/🚀"), "-tmp---");
    }

    #[test]
    fn encode_truncates_long_path_with_hash_suffix() {
        let long = format!("/work/{}", "a".repeat(300));
        let encoded = encode_project_dir_name(&long);
        assert!(encoded.len() > MAX_ENCODED_LEN);
        // 200 字符主体（`-work-` + 194 个 a）+ "-" + base36 后缀
        assert_eq!(&encoded[..MAX_ENCODED_LEN], format!("-work-{}", "a".repeat(194)));
        assert_eq!(encoded.as_bytes()[MAX_ENCODED_LEN], b'-');
        assert!(encoded[MAX_ENCODED_LEN + 1..]
            .chars()
            .all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn encode_keeps_path_at_length_limit_untouched() {
        let exact = format!("/{}", "a".repeat(MAX_ENCODED_LEN - 1));
        assert_eq!(encode_project_dir_name(&exact), exact.replace('/', "-"));
    }

    #[test]
    fn jsonl_path_uses_explicit_config_dir() {
        let path = resolve_session_jsonl(Some("/custom/cfg"), "/work/proj", "abc")
            .expect("显式 config_dir 不依赖 home 目录");
        assert_eq!(
            path,
            PathBuf::from("/custom/cfg/projects/-work-proj/abc.jsonl")
        );
    }
}
