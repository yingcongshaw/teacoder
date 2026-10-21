// CLI 启动参数的解析与规整工具

/** 带 session id 取值的恢复参数：形如 `--resume <id>` / `-r <id>` */
const RESUME_WITH_ID = new Set(["--resume", "-r"]);
/** 不带取值的恢复参数：形如 `--continue` / `-c` */
const CONTINUE_FLAGS = new Set(["--continue", "-c"]);

function isResumeFlag(arg: string): boolean {
  return (
    RESUME_WITH_ID.has(arg) ||
    CONTINUE_FLAGS.has(arg) ||
    [...RESUME_WITH_ID, ...CONTINUE_FLAGS].some((flag) => arg.startsWith(`${flag}=`))
  );
}

/**
 * 剥离 CLI 参数中的会话恢复参数，返回可安全用于"全新会话"的参数串。
 *
 * 会话复制必须得到一段全新对话：`--resume <id>` 会直接恢复原会话，而
 * `--continue` 恢复的是当前目录最近的对话 —— 同项目下同样指向原会话。
 *
 * SSH 的 cli_args 是 JSON 对象（如 `{"hostname":"..."}`）而非数组，
 * 无法按参数数组处理，原样返回交由后端 PtyManager 解析。
 * JSON 解析失败同样原样返回，避免把用户的参数改坏。
 */
export function stripResumeArgs(cliArgs?: string): string | undefined {
  if (!cliArgs) return cliArgs;

  let parsed: unknown;
  try {
    parsed = JSON.parse(cliArgs);
  } catch {
    return cliArgs;
  }
  if (!Array.isArray(parsed)) return cliArgs;

  const result: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const arg = parsed[i];
    if (typeof arg !== "string") {
      result.push(arg);
      continue;
    }
    if (!isResumeFlag(arg)) {
      result.push(arg);
      continue;
    }
    // `--resume` 后紧跟的非 flag token 是 session id，一并丢弃；
    // `--continue` 不带取值，吞掉下一个 token 会误删用户的普通参数。
    if (RESUME_WITH_ID.has(arg)) {
      const next = parsed[i + 1];
      if (typeof next === "string" && !next.startsWith("-")) i++;
    }
  }

  return JSON.stringify(result);
}
