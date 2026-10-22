//! 解析 Claude Code 的会话 transcript（`<projects>/<work_dir>/<id>.jsonl`），
//! 提取「真人输入 / AI 回复 / 工具调用」主线，供前端会话面板渲染。
//!
//! 两个必须遵守的实测约束（见本文件末尾 tests）：
//!
//! 1. `origin` 字段是 Claude Code 2.1.293 才引入的。2.1.148 的会话里
//!    `origin.kind` 完全不存在，若按它做白名单，所有老会话会显示不出任何用户输入。
//!    因此真人输入采用「先排除已知噪声，剩下即真人」的否定式规则。
//! 2. 单个 transcript 可达 120 MB，必须流式逐行读，且只保留末尾若干条，
//!    不能整文件读进内存。

use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde::{Deserialize, Serialize};

/// transcript 中一条主线记录。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptEntry {
    pub uuid: String,
    /// `user` / `assistant` / `tool`
    pub kind: String,
    pub text: String,
    pub timestamp: i64,
    /// 工具名，如 `Bash` / `Read`（仅 kind == "tool"）
    pub tool_name: Option<String>,
}

// --- JSONL 行结构 ---------------------------------------------------------
//
// 标量字段一律用 `null_as_default`：Claude Code 大量写显式 null
// （如 `"parentUuid": null`），serde 的 `#[serde(default)]` 只在字段缺失时生效，
// 遇到 null 会整个行解析失败。

#[derive(Debug, Deserialize, Default)]
struct RawEntry {
    #[serde(rename = "type")]
    entry_type: Option<String>,
    uuid: Option<String>,
    timestamp: Option<String>,
    #[serde(rename = "isMeta", default, deserialize_with = "null_as_default")]
    is_meta: Option<bool>,
    #[serde(rename = "isCompactSummary", default, deserialize_with = "null_as_default")]
    is_compact_summary: Option<bool>,
    origin: Option<RawOrigin>,
    message: Option<RawMessage>,
}

#[derive(Debug, Deserialize, Default)]
struct RawOrigin {
    #[serde(default, deserialize_with = "null_as_default")]
    kind: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct RawMessage {
    #[serde(default)]
    content: Option<serde_json::Value>,
}

fn null_as_default<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer).unwrap_or(None))
}

/// 解析 RFC3339 时间戳为毫秒。解析失败返回 0，不影响其余记录。
fn parse_timestamp(ts: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(ts)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

/// 内容块数组里是否含 tool_result —— 命中说明这条 user 记录是工具回灌，不是真人输入。
fn has_tool_result(content: &serde_json::Value) -> bool {
    content
        .as_array()
        .map(|arr| {
            arr.iter()
                .any(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
        })
        .unwrap_or(false)
}

/// 取出消息里的全部文本块；content 也可能是裸字符串。
fn text_blocks(content: &serde_json::Value) -> Vec<String> {
    if let Some(s) = content.as_str() {
        return vec![s.to_string()];
    }
    content
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .map(|t| t.to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// 系统注入内容一律以 `<` 开头的 XML 标签出现（`<command-name>` / `<local-command-caveat>`
/// / `<task-notification>` / `<local-command-stdout>` 等）。真人提问不会以此开头。
fn looks_injected(text: &str) -> bool {
    text.trim_start().starts_with('<')
}

/// 判断一条 user 记录是否为真人输入。否定式规则，见模块文档的实测约束 1。
fn is_human_prompt(entry: &RawEntry, text: &str) -> bool {
    if entry.is_meta.unwrap_or(false) || entry.is_compact_summary.unwrap_or(false) {
        return false;
    }
    if let Some(org) = &entry.origin {
        if org.kind.as_deref() == Some("task-notification") {
            return false;
        }
    }
    if looks_injected(text) {
        return false;
    }
    true
}

/// 敏感值一律替换为这个固定标记。
const MASK: &str = "***";

/// 遮蔽命令行与参数里出现的明文凭据。
///
/// 工具参数是密钥泄露的高发区：`PGPASSWORD=x`、`--password x`、`-p x`、
/// `mysql://user:pass@host`、`sk-xxx` 都会原样进 transcript。原 UserMessageTracker
/// 的敏感标记只覆盖终端输入，管不到这里，所以在这一层统一处理。
fn redact_secrets(text: &str) -> String {
    let mut out = text.to_string();

    // KEY=VALUE / KEY value 形式：只遮蔽值，保留键名以便判断命令意图
    for key in [
        "PGPASSWORD", "MYSQL_PWD", "DB_PASSWORD", "PASSWORD", "PASSWD", "SECRET",
        "API_KEY", "APIKEY", "ACCESS_KEY", "SECRET_KEY", "TOKEN", "AUTH_TOKEN",
    ] {
        // KEY=value
        out = replace_assignment(&out, key);
        // --key value
        out = replace_flag(&out, key);
        out = replace_flag(&out, &key.to_lowercase());
        out = replace_flag(&out, &key.replace('_', "-"));
    }

    // URL 里的 user:pass@host
    out = redact_url_credentials(out);

    // 常见令牌前缀
    for prefix in ["sk-", "ghp_", "gho_", "github_pat_", "xoxb-", "xoxp-"] {
        if let Some(pos) = out.find(prefix) {
            let end = out[pos..]
                .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
                .map(|i| pos + i)
                .unwrap_or(out.len());
            let mut new_out = String::with_capacity(out.len());
            new_out.push_str(&out[..pos]);
            new_out.push_str(prefix);
            new_out.push_str(MASK);
            new_out.push_str(&out[end..]);
            out = new_out;
        }
    }

    out
}

/// 遮蔽 URL authority 里的 `user:pass@`。
///
/// 必须遍历全部 `://` 出现处，且在 URL 不含 `@` 时继续处理后续片段而不是提前
/// 返回 —— 否则同一条命令里紧随其后的令牌会被整段跳过遮蔽。
fn redact_url_credentials(text: String) -> String {
    let mut out = text;
    let mut search_from = 0usize;
    while let Some(pos) = out[search_from..].find("://") {
        let scheme_end = search_from + pos + 3;
        let Some(at) = out[scheme_end..].find('@') else {
            // 该 URL 没有凭据，扫到它之后继续找下一个
            search_from = scheme_end;
            if search_from >= out.len() {
                break;
            }
            continue;
        };
        let authority_end = scheme_end + at;
        let authority = &out[scheme_end..authority_end];
        if let Some(colon) = authority.rfind(':') {
            let user_len = colon;
            let mut new_out = String::with_capacity(out.len());
            new_out.push_str(&out[..scheme_end]);
            new_out.push_str(&out[scheme_end..scheme_end + user_len]);
            new_out.push(':');
            new_out.push_str(MASK);
            new_out.push('@');
            new_out.push_str(&out[authority_end + 1..]);
            out = new_out;
            search_from = scheme_end + user_len + MASK.len() + 1;
        } else {
            search_from = authority_end + 1;
        }
        if search_from >= out.len() {
            break;
        }
    }
    out
}

/// 遮蔽 `KEY=<value>` 中 `<value>` 的部分。
fn replace_assignment(text: &str, key: &str) -> String {
    let needle = format!("{key}=");
    let mut out = text.to_string();
    let mut search_from = 0usize;
    while let Some(pos) = out[search_from..].find(&needle) {
        let value_start = search_from + pos + needle.len();
        // 值可能带引号，遮蔽到配对的引号或空白为止
        let rest = &out[value_start..];
        let end = rest
            .find(|c: char| c.is_whitespace() || c == ';' || c == '&' || c == '|' || c == '"' || c == '\'')
            .map(|i| value_start + i)
            .unwrap_or(out.len());
        if end > value_start {
            let mut new_out = String::with_capacity(out.len());
            new_out.push_str(&out[..value_start]);
            new_out.push_str(MASK);
            new_out.push_str(&out[end..]);
            out = new_out;
            search_from = value_start + MASK.len();
        } else {
            search_from = value_start;
        }
        if search_from >= out.len() {
            break;
        }
    }
    out
}

/// 遮蔽 `--flag <value>` 中 `<value>` 的部分。
fn replace_flag(text: &str, flag: &str) -> String {
    let needle = format!("--{flag} ");
    let mut out = text.to_string();
    let mut search_from = 0usize;
    while let Some(pos) = out[search_from..].find(&needle) {
        let value_start = search_from + pos + needle.len();
        let rest = &out[value_start..];
        let end = rest
            .find(|c: char| c.is_whitespace() || c == ';' || c == '&' || c == '|')
            .map(|i| value_start + i)
            .unwrap_or(out.len());
        if end > value_start {
            let mut new_out = String::with_capacity(out.len());
            new_out.push_str(&out[..value_start]);
            new_out.push_str(MASK);
            new_out.push_str(&out[end..]);
            out = new_out;
            search_from = value_start + MASK.len();
        } else {
            search_from = value_start;
        }
        if search_from >= out.len() {
            break;
        }
    }
    out
}

/// 从 tool_use 的 input 生成一行人类可读摘要。
fn summarize_tool(name: &str, input: &serde_json::Value) -> String {
    let raw_arg: Option<String> = match name {
        "Bash" => input.get("command").and_then(|c| c.as_str()).map(str::to_string),
        "Read" | "Edit" | "Write" | "NotebookEdit" | "NotebookRead" => {
            input.get("file_path").and_then(|p| p.as_str()).map(str::to_string)
        }
        "Grep" => input
            .get("pattern")
            .and_then(|p| p.as_str())
            .map(str::to_string),
        "Glob" => input
            .get("pattern")
            .and_then(|p| p.as_str())
            .map(str::to_string),
        "Task" | "Agent" => input
            .get("description")
            .and_then(|d| d.as_str())
            .map(str::to_string),
        "Skill" => input
            .get("skill")
            .and_then(|d| d.as_str())
            .map(str::to_string),
        "WebFetch" => input.get("url").and_then(|d| d.as_str()).map(str::to_string),
        "WebSearch" => input
            .get("query")
            .and_then(|d| d.as_str())
            .map(str::to_string),
        // TaskCreate / TaskUpdate 等把描述放在不同字段，统一兜底取常见几个
        _ => ["description", "content", "summary", "name", "command", "prompt"]
            .iter()
            .find_map(|k| input.get(k).and_then(|v| v.as_str()).map(str::to_string)),
    };

    let arg = raw_arg.map(|a| redact_secrets(&a));
    match arg {
        Some(a) if !a.trim().is_empty() => format!("[{}] {}", name, first_line(&a)),
        _ => format!("[{}]", name),
    }
}

fn first_line(s: &str) -> String {
    let line = s.lines().next().unwrap_or("").trim();
    if line.chars().count() > 90 {
        let t: String = line.chars().take(90).collect();
        format!("{t}…")
    } else {
        line.to_string()
    }
}

/// 解析单行 JSONL 为 0..n 条主线记录。
fn parse_line(line: &str, out: &mut Vec<TranscriptEntry>) {
    let entry: RawEntry = match serde_json::from_str(line) {
        Ok(e) => e,
        // 未知 type / 单行解析失败都不能中断整个文件
        Err(_) => return,
    };
    let ts = parse_timestamp(entry.timestamp.as_deref().unwrap_or(""));
    let uuid = entry.uuid.clone().unwrap_or_default();
    let msg = match &entry.message {
        Some(m) => m,
        None => return,
    };
    let content = match &msg.content {
        Some(c) => c,
        None => return,
    };

    match entry.entry_type.as_deref() {
        Some("user") => {
            if has_tool_result(content) {
                return;
            }
            let blocks = text_blocks(content);
            if blocks.is_empty() {
                return;
            }
            let joined = blocks.join("\n");
            if !is_human_prompt(&entry, &joined) {
                return;
            }
            out.push(TranscriptEntry {
                uuid,
                kind: "user".to_string(),
                text: joined,
                timestamp: ts,
                tool_name: None,
            });
        }
        Some("assistant") => {
            let arr = match content.as_array() {
                Some(a) => a,
                None => return,
            };
            for block in arr {
                let btype = block.get("type").and_then(|t| t.as_str());
                match btype {
                    // thinking 不进面板：终端里也不显示，无从定位
                    Some("text") => {
                        if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                            if !t.trim().is_empty() {
                                out.push(TranscriptEntry {
                                    uuid: uuid.clone(),
                                    kind: "assistant".to_string(),
                                    text: t.to_string(),
                                    timestamp: ts,
                                    tool_name: None,
                                });
                            }
                        }
                    }
                    Some("tool_use") => {
                        let name = block
                            .get("name")
                            .and_then(|n| n.as_str())
                            .unwrap_or("tool");
                        let input = block.get("input").cloned().unwrap_or_default();
                        out.push(TranscriptEntry {
                            uuid: uuid.clone(),
                            kind: "tool".to_string(),
                            text: summarize_tool(name, &input),
                            timestamp: ts,
                            tool_name: Some(name.to_string()),
                        });
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

/// 流式读取 transcript，只保留末尾 `limit` 条主线记录。
///
/// 单文件实测最大 120 MB，整读会阻塞并吃光内存，所以这里逐行喂给
/// 环形缓冲，写满后自然丢弃最旧的记录。
pub fn read_transcript(path: &Path, limit: usize) -> Result<Vec<TranscriptEntry>, String> {
    let file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open {}: {}", path.display(), e))?;
    let reader = BufReader::with_capacity(64 * 1024, file);

    let mut ring: VecDeque<TranscriptEntry> = VecDeque::with_capacity(limit.max(1));
    let mut scratch: Vec<TranscriptEntry> = Vec::new();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            // 单行读取失败（如非法 UTF-8）跳过，不中断整个文件
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }
        scratch.clear();
        parse_line(&line, &mut scratch);
        for e in scratch.drain(..) {
            if ring.len() == limit.max(1) {
                ring.pop_front();
            }
            ring.push_back(e);
        }
    }

    Ok(ring.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp(name: &str, content: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(name);
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        p
    }

    /// 2.1.148 时代的记录没有 origin 字段，用户提问必须照样识别出来。
    /// 这是模块文档约束 1 的回归测试。
    #[test]
    fn legacy_entry_without_origin_is_still_human_prompt() {
        let line = r#"{"type":"user","uuid":"u1","timestamp":"2026-10-08T04:14:09.289Z","parentUuid":null,"message":{"role":"user","content":"分析：为什么编译报错"}}"#;
        let mut out = vec![];
        parse_line(line, &mut out);
        assert_eq!(out.len(), 1, "无 origin 的老记录应被识别为真人输入");
        assert_eq!(out[0].kind, "user");
        assert_eq!(out[0].text, "分析：为什么编译报错");
    }

    #[test]
    fn origin_human_is_human_prompt() {
        let line = r#"{"type":"user","uuid":"u2","timestamp":"2026-10-12T04:07:08.780Z","origin":{"kind":"human"},"message":{"role":"user","content":"看看这个会话"}}"#;
        let mut out = vec![];
        parse_line(line, &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, "user");
    }

    #[test]
    fn meta_and_compact_summary_are_filtered() {
        for flag in [r#""isMeta":true"#, r#""isCompactSummary":true"#] {
            let line = format!(
                r#"{{"type":"user","uuid":"x","timestamp":"2026-10-08T04:14:09.289Z",{flag},"message":{{"role":"user","content":"some text"}}}}"#
            );
            let mut out = vec![];
            parse_line(&line, &mut out);
            assert!(out.is_empty(), "{flag} 应被过滤");
        }
    }

    #[test]
    fn injected_xml_is_filtered() {
        for txt in [
            "<command-name>/clear</command-name>",
            "<local-command-caveat>Caveat: ...</local-command-caveat>",
            "<task-notification><task-id>x</task-id></task-notification>",
        ] {
            let line = serde_json::json!({
                "type": "user", "uuid": "x",
                "timestamp": "2026-10-08T04:14:09.289Z",
                "message": {"role": "user", "content": txt}
            })
            .to_string();
            let mut out = vec![];
            parse_line(&line, &mut out);
            assert!(out.is_empty(), "注入内容应被过滤: {txt}");
        }
    }

    #[test]
    fn tool_result_user_record_is_filtered() {
        let line = r#"{"type":"user","uuid":"x","timestamp":"2026-10-08T04:14:09.289Z","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}"#;
        let mut out = vec![];
        parse_line(line, &mut out);
        assert!(out.is_empty(), "工具回灌不是真人输入");
    }

    #[test]
    fn assistant_text_and_tool_use_are_split() {
        let line = r#"{"type":"assistant","uuid":"a1","timestamp":"2026-10-12T04:07:08.858Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"..."},{"type":"text","text":"检查到 token 过期"},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"head -30 src/auth.ts"}}]}}"#;
        let mut out = vec![];
        parse_line(line, &mut out);
        assert_eq!(out.len(), 2, "thinking 不产出条目，应得 text + tool_use");
        assert_eq!(out[0].kind, "assistant");
        assert_eq!(out[1].kind, "tool");
        assert_eq!(out[1].tool_name.as_deref(), Some("Bash"));
        assert_eq!(out[1].text, "[Bash] head -30 src/auth.ts");
    }

    #[test]
    fn unknown_type_and_broken_json_do_not_abort() {
        let mut out = vec![];
        parse_line(r#"{"type":"totally-new-type","uuid":"z"}"#, &mut out);
        parse_line("not json at all", &mut out);
        parse_line("", &mut out);
        assert!(out.is_empty());
    }

    #[test]
    fn secrets_in_tool_command_are_redacted() {
        let cases = [
            (r#"{"command":"PGPASSWORD=postgres psql -h 127.0.0.1 -d x"}"#, "postgres"),
            (r#"{"command":"mysql -u root --password hunter2 db"}"#, "hunter2"),
            (r#"{"command":"psql postgres://admin:s3cr3t@10.0.0.1/prod"}"#, "s3cr3t"),
            (r#"{"command":"export API_KEY=sk-AbCdEf1234567890"}"#, "sk-AbCdEf1234567890"),
        ];
        for (input, secret) in cases {
            let value: serde_json::Value = serde_json::from_str(input).unwrap();
            let got = summarize_tool("Bash", &value);
            assert!(
                !got.contains(secret),
                "密钥 {secret} 不应出现在摘要中，实际: {got}"
            );
            assert!(got.contains("***"), "应保留遮蔽标记，实际: {got}");
        }
    }

    #[test]
    fn tool_summary_covers_more_tool_names() {
        let cases: [(&str, serde_json::Value, &str); 3] = [
            ("Read", serde_json::json!({"file_path": "/a/b.ts"}), "[Read] /a/b.ts"),
            (
                "Skill",
                serde_json::json!({"skill": "simplify"}),
                "[Skill] simplify",
            ),
            (
                "WebFetch",
                serde_json::json!({"url": "https://x.dev/a"}),
                "[WebFetch] https://x.dev/a",
            ),
        ];
        for (name, input, expect) in cases {
            assert_eq!(summarize_tool(name, &input), expect);
        }
    }

    /// 回归：URL 分支曾在缺少 `@` 时提前 `return out`，导致同一条命令里
    /// 其后的令牌前缀遮蔽整段被跳过，密钥原样显示在面板上。
    #[test]
    fn token_after_credential_less_url_is_still_redacted() {
        let cmd = r#"curl https://example.com -H "Authorization: sk-abc123secret""#;
        let out = summarize_tool("Bash", &serde_json::json!({ "command": cmd }));
        assert!(
            !out.contains("sk-abc123secret"),
            "URL 不含凭据时不应跳过令牌遮蔽: {out}"
        );
        assert!(out.contains("https://example.com"), "非敏感部分应保留: {out}");
    }

    #[test]
    fn all_url_credentials_are_redacted() {
        let cmd = "curl postgres://a:one@h1/x postgres://b:two@h2/y";
        let out = summarize_tool("Bash", &serde_json::json!({ "command": cmd }));
        assert!(!out.contains("one") && !out.contains("two"), "{out}");
        assert!(out.contains("postgres://a:***@h1/x"), "{out}");
        assert!(out.contains("postgres://b:***@h2/y"), "{out}");
    }

    /// URL 脱敏后不得吞掉后面的内容，也不能无限循环。
    #[test]
    fn url_redaction_terminates_and_preserves_tail() {
        let out = redact_url_credentials("https://a.b https://c.d/x tail".to_string());
        assert_eq!(out, "https://a.b https://c.d/x tail");
    }

    #[test]
    fn read_transcript_keeps_only_tail() {
        let mut content = String::new();
        for i in 0..10 {
            content.push_str(&format!(
                r#"{{"type":"user","uuid":"u{i}","timestamp":"2026-10-08T04:14:09.289Z","message":{{"role":"user","content":"第{i}条"}}}}"#
            ));
            content.push('\n');
        }
        let p = write_temp("teacoder_transcript_tail_test.jsonl", &content);
        let got = read_transcript(&p, 3).unwrap();
        assert_eq!(got.len(), 3);
        assert_eq!(got[2].text, "第9条", "应保留最新的三条");
        let _ = std::fs::remove_file(p);
    }

}
