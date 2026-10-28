import type { Terminal } from "@xterm/xterm";

/**
 * Claude Code 首次在某个工作目录下启动时的安全确认框（Quick safety check）。
 *
 * 该框的默认选中项是「No, exit」：此刻任何回车都会让 Claude Code 直接退出进程，
 * 因此自动注入的指令（/rename 标题同步等）绝不能落在它还显示的时候。
 *
 * 匹配用屏幕上的实际文本，而不是 PTY 输出流：Claude Code 的 Ink TUI 重绘只改
 * 变化的行，按下方向键时输出的片段里并不含「Quick safety check」，只有渲染后的
 * 屏幕才能反映"框还在不在"。
 */
const TRUST_PROMPT_MARKERS = ["Quick safety check", "Yes, I trust this folder"];

/**
 * 读取 xterm 当前可见视口的文本。
 *
 * 只取视口（baseY 起 rows 行），不含回滚区：确认框消失后它的字形仍留在回滚区里，
 * 把回滚区算进来会把"框已消失"误判成"框还在"。
 */
export function readVisibleScreen(term: Terminal): string {
  const buffer = term.buffer.active;
  const top = buffer.baseY;
  const bottom = Math.min(buffer.length - 1, top + term.rows - 1);
  const lines: string[] = [];
  for (let y = top; y <= bottom; y++) {
    const line = buffer.getLine(y);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join("\n");
}

/** 当前屏幕上是否还显示 Claude Code 的安全确认框 */
export function screenHasTrustPrompt(screen: string): boolean {
  return TRUST_PROMPT_MARKERS.some((marker) => screen.includes(marker));
}
