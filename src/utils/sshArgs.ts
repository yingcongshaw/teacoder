import type { SshArgs } from "../types";

/** 表单初始值：端口 22、用户名 root，两者都是后端 `parse_ssh_args` 的默认值。 */
export const EMPTY_SSH_ARGS: SshArgs = {
  hostname: "",
  port: 22,
  username: "root",
  password: "",
  identityFile: "",
};

/** 把 SSH 参数序列化成 `cli_args` 的 JSON 字符串。
 *
 * 键序即声明序。后端 `parse_ssh_args` 按名取值、不依赖顺序，但编辑会话时要用
 * 生成结果与 DB 读回的 JSON 做等价比较（见 EditSessionModal 的 sshParamsDiffer），
 * 所以这里保持稳定输出。
 */
export function serializeSshArgs(args: SshArgs): string {
  return JSON.stringify({
    hostname: args.hostname,
    port: args.port,
    username: args.username,
    password: args.password,
    identityFile: args.identityFile,
  });
}

/** 从 `cli_args` 还原 SSH 参数。非对象形态（数组形态是别的工具的参数）返回 null。 */
export function parseSshArgsJson(json: string | undefined | null): SshArgs | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const o = parsed as Record<string, unknown>;
  const port = Number(o.port);
  return {
    hostname: typeof o.hostname === "string" ? o.hostname : "",
    // 后端在字段缺失时回落 22；这里对非数字同样回落，避免表单里出现 NaN
    port: Number.isFinite(port) && port > 0 ? port : 22,
    username: typeof o.username === "string" ? o.username : "root",
    password: typeof o.password === "string" ? o.password : "",
    identityFile: typeof o.identityFile === "string" ? o.identityFile : "",
  };
}