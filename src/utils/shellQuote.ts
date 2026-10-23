/**
 * 把路径包成 shell 单引号字符串。
 *
 * 「插入本地路径」是往 PTY 里裸写字节，不经过任何 shell 解析层 ——
 * 引用必须由我们自己加，否则带空格的路径到用户 shell 里会裂成多个词。
 * 单引号里除 `'` 外都是字面量，内嵌的 `'` 按 POSIX 惯例闭合再转义再重开：
 * `a'b` → `'a'\''b'`。
 */
export function shellQuote(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

/** 人类可读的字节数。传输进度用。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}